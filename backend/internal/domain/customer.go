package domain

import (
	"strings"
	"time"
)

// Field-level validation rules live in validate.go. This file wires them into
// the CustomerInput contract.

// Customer is the persisted customer entity. Optional fields are pointers so
// they map cleanly to nullable columns and round-trip NULL rather than "".
type Customer struct {
	ID              string
	Code            string
	Name            string
	FatherName      *string
	Mobile          string
	AltMobile       *string
	Email           *string
	DateOfBirth     *string // YYYY-MM-DD (calendar date, local)
	Address         *string
	City            *string
	State           *string
	Pincode         *string
	Occupation      *string
	MonthlyIncome   *Paise
	ReferenceName   *string
	ReferenceMobile *string
	// KYC identifiers, stored in full. Never log these; mask before returning
	// them in any API response (see MaskAadhaar / MaskPAN).
	AadhaarNumber *string
	PANNumber     *string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// MaskAadhaar hides all but the last 4 digits, e.g. "XXXX-XXXX-1234".
func MaskAadhaar(a *string) *string {
	if a == nil || len(*a) != 12 {
		return nil
	}
	masked := "XXXX-XXXX-" + (*a)[8:]
	return &masked
}

// MaskPAN hides all but the last 4 characters, e.g. "XXXXXX1234".
func MaskPAN(p *string) *string {
	if p == nil || len(*p) != 10 {
		return nil
	}
	masked := "XXXXXX" + (*p)[6:]
	return &masked
}

// CustomerInput is the validated payload for creating or updating a customer.
// It holds already-parsed values; parsing from JSON happens in the handler.
type CustomerInput struct {
	Name            string
	FatherName      *string
	Mobile          string
	AltMobile       *string
	Email           *string
	DateOfBirth     *string
	Address         *string
	City            *string
	State           *string
	Pincode         *string
	Occupation      *string
	MonthlyIncome   *Paise
	ReferenceName   *string
	ReferenceMobile *string
	AadhaarNumber   *string
	PANNumber       *string
}

// ValidationMode distinguishes creating a customer from updating one. On
// update, KYC identifiers may be omitted (the stored values are kept), so the
// "at least one KYC" cross-field rule does not apply.
type ValidationMode int

const (
	ModeCreate ValidationMode = iota
	ModeUpdate
)

// Validate enforces field-level invariants and returns a domain validation
// error listing every offending field, so the client can fix all at once.
// `now` is injected (not read from the clock) so DOB/age checks are pure and
// testable.
//
// Required: name, mobile, address, city, state, pincode. On create, at least
// one KYC identifier (Aadhaar or PAN) is also required. All other fields are
// optional but are fully validated whenever a value is present.
func (in *CustomerInput) Validate(now time.Time, mode ValidationMode) error {
	fields := map[string]string{}
	add := func(key, msg string) {
		if msg != "" {
			if _, exists := fields[key]; !exists {
				fields[key] = msg
			}
		}
	}

	// Required identity fields.
	add("name", validateName("name", in.Name))
	add("mobile", validateMobile("mobile", in.Mobile))

	// Required address fields.
	add("address", validateAddress(in.Address))
	add("city", validateCity(in.City))
	add("state", validateState(in.State))
	add("pincode", requiredPincode(in.Pincode))

	// Optional, validated when present.
	add("father_name", validateOptionalName("father's name", in.FatherName))
	add("alt_mobile", validateOptionalMobile("alternate mobile", in.AltMobile))
	add("reference_name", validateOptionalName("reference name", in.ReferenceName))
	add("reference_mobile", validateOptionalMobile("reference mobile", in.ReferenceMobile))
	add("occupation", validateOccupation(in.Occupation))
	add("email", validateEmail(in.Email))
	add("date_of_birth", validateDOB(in.DateOfBirth, now))
	add("monthly_income", validateIncome(in.MonthlyIncome))
	add("aadhaar_number", validateAadhaar(in.AadhaarNumber))
	add("pan_number", validatePAN(in.PANNumber))

	// Cross-field: on create, at least one KYC identifier is required. On
	// update the stored KYC is kept when omitted, so this rule is skipped.
	if mode == ModeCreate && !nonEmpty(in.AadhaarNumber) && !nonEmpty(in.PANNumber) {
		add("aadhaar_number", "provide an Aadhaar or PAN number")
		add("pan_number", "provide an Aadhaar or PAN number")
	}
	if nonEmpty(in.AltMobile) && *in.AltMobile == in.Mobile {
		add("alt_mobile", "alternate mobile must differ from the primary mobile")
	}

	if len(fields) > 0 {
		return NewValidation("customer validation failed", fields)
	}
	return nil
}

// requiredPincode enforces presence + pincode format.
func requiredPincode(v *string) string {
	if !nonEmpty(v) {
		return "pincode is required"
	}
	return validatePincode(v)
}

func nonEmpty(s *string) bool { return s != nil && strings.TrimSpace(*s) != "" }
