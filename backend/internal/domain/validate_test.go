package domain

import (
	"testing"
	"time"
)

// A fixed "today" keeps age-dependent tests deterministic.
var testNow = time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)

// validAadhaar has a correct Verhoeff check digit; validAadhaar2 differs only
// in the check digit and must fail.
const (
	validAadhaar    = "234567890124"
	badCheckAadhaar = "234567890123"
)

func ptrStr(s string) *string { return &s }

func TestVerhoeff(t *testing.T) {
	if !verhoeffValid(validAadhaar) {
		t.Errorf("expected %s to pass Verhoeff", validAadhaar)
	}
	if verhoeffValid(badCheckAadhaar) {
		t.Errorf("expected %s to fail Verhoeff", badCheckAadhaar)
	}
}

// baseValidInput returns an input that passes every rule, so each test can
// mutate one field and assert only that field fails.
func baseValidInput() CustomerInput {
	inc := RupeesToPaise(50000)
	return CustomerInput{
		Name:          "Rohan Sharma",
		Mobile:        "9812345670",
		Address:       ptrStr("12 MG Road, Shivaji Nagar"),
		City:          ptrStr("Pune"),
		State:         ptrStr("Maharashtra"),
		Pincode:       ptrStr("411001"),
		MonthlyIncome: &inc,
		AadhaarNumber: ptrStr(validAadhaar),
		DateOfBirth:   ptrStr("1990-05-15"),
	}
}

func TestValidateHappyPath(t *testing.T) {
	in := baseValidInput()
	if err := in.Validate(testNow, ModeCreate); err != nil {
		t.Fatalf("expected valid input to pass, got %v", err)
	}
}

// fieldError runs Validate and returns the message for the given field key
// (or "" if that field had no error).
func fieldError(t *testing.T, in CustomerInput, field string) string {
	t.Helper()
	err := in.Validate(testNow, ModeCreate)
	if err == nil {
		return ""
	}
	de, ok := AsError(err)
	if !ok {
		t.Fatalf("expected a domain error, got %T", err)
	}
	return de.Fields[field]
}

func TestRequiredFields(t *testing.T) {
	tests := []struct {
		name   string
		field  string
		mutate func(*CustomerInput)
	}{
		{"missing name", "name", func(in *CustomerInput) { in.Name = "" }},
		{"missing mobile", "mobile", func(in *CustomerInput) { in.Mobile = "" }},
		{"missing address", "address", func(in *CustomerInput) { in.Address = nil }},
		{"missing city", "city", func(in *CustomerInput) { in.City = nil }},
		{"missing state", "state", func(in *CustomerInput) { in.State = nil }},
		{"missing pincode", "pincode", func(in *CustomerInput) { in.Pincode = nil }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := baseValidInput()
			tt.mutate(&in)
			if msg := fieldError(t, in, tt.field); msg == "" {
				t.Errorf("expected %s to be required", tt.field)
			}
		})
	}
}

func TestMobileEdgeCases(t *testing.T) {
	tests := []struct {
		mobile string
		valid  bool
	}{
		{"9812345670", true},
		{"6012345678", true},
		{"5812345670", false},  // starts < 6
		{"981234567", false},   // 9 digits
		{"98123456701", false}, // 11 digits
		{"9812a45670", false},  // letter
		{"0000000000", false},  // starts 0 + all-same
		{"9999999999", false},  // all-same digit
	}
	for _, tt := range tests {
		in := baseValidInput()
		in.Mobile = tt.mobile
		got := fieldError(t, in, "mobile") == ""
		if got != tt.valid {
			t.Errorf("mobile %q: valid=%v, want %v", tt.mobile, got, tt.valid)
		}
	}
}

func TestPincodeEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		pin   string
		valid bool
	}{
		{"411001", true},
		{"011001", false},  // starts 0
		{"41100", false},   // 5 digits
		{"4110011", false}, // 7 digits
		{"41a001", false},  // letter
	} {
		in := baseValidInput()
		in.Pincode = ptrStr(tt.pin)
		got := fieldError(t, in, "pincode") == ""
		if got != tt.valid {
			t.Errorf("pincode %q: valid=%v, want %v", tt.pin, got, tt.valid)
		}
	}
}

func TestPANEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		pan   string
		valid bool
	}{
		{"ABCPE1234F", true},  // P = individual holder type
		{"abcpe1234f", true},  // lowercased, normalised by validator
		{"ABCDE1234", false},  // too short
		{"ABCPE12345", false}, // last char not a letter
		{"12CPE1234F", false}, // starts with digits
		{"ABCZE1234F", false}, // Z is not a valid holder type
	} {
		in := baseValidInput()
		// PAN provided; Aadhaar cleared so the KYC-required rule is satisfied by PAN.
		in.AadhaarNumber = nil
		in.PANNumber = ptrStr(tt.pan)
		got := fieldError(t, in, "pan_number") == ""
		if got != tt.valid {
			t.Errorf("pan %q: valid=%v, want %v", tt.pan, got, tt.valid)
		}
	}
}

func TestAadhaarEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		aadhaar string
		valid   bool
	}{
		{validAadhaar, true},
		{badCheckAadhaar, false}, // bad checksum
		{"123456789012", false},  // starts with 1
		{"034567890124", false},  // starts with 0
		{"23456789012", false},   // 11 digits
		{"222222222222", false},  // all-same
	} {
		in := baseValidInput()
		in.AadhaarNumber = ptrStr(tt.aadhaar)
		got := fieldError(t, in, "aadhaar_number") == ""
		if got != tt.valid {
			t.Errorf("aadhaar %q: valid=%v, want %v", tt.aadhaar, got, tt.valid)
		}
	}
}

func TestEmailEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		email string
		valid bool
	}{
		{"a@b.com", true},
		{"user.name+tag@sub.domain.co", true},
		{"no-at-sign", false},
		{"a@b", false},       // no TLD
		{"a@@b.com", false},  // double @
		{"a b@c.com", false}, // space
	} {
		in := baseValidInput()
		in.Email = ptrStr(tt.email)
		got := fieldError(t, in, "email") == ""
		if got != tt.valid {
			t.Errorf("email %q: valid=%v, want %v", tt.email, got, tt.valid)
		}
	}
}

func TestDOBEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		dob   string
		valid bool
	}{
		{"1990-05-15", true},
		{"2020-01-01", false}, // under 18 (age ~6 at testNow)
		{"1800-01-01", false}, // over 100
		{"2030-01-01", false}, // future
		{"1990-13-01", false}, // invalid month
		{"1990-02-30", false}, // invalid day
		{"15-05-1990", false}, // wrong format
	} {
		in := baseValidInput()
		in.DateOfBirth = ptrStr(tt.dob)
		got := fieldError(t, in, "date_of_birth") == ""
		if got != tt.valid {
			t.Errorf("dob %q: valid=%v, want %v", tt.dob, got, tt.valid)
		}
	}
}

func TestNameEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		name  string
		valid bool
	}{
		{"Rohan Sharma", true},
		{"O'Brien", true},
		{"Jean-Luc", true},
		{"A", false},            // too short
		{"Rohan123", false},     // digits
		{"Rohan@Sharma", false}, // symbol
		{"  ", false},           // whitespace only
	} {
		in := baseValidInput()
		in.Name = tt.name
		got := fieldError(t, in, "name") == ""
		if got != tt.valid {
			t.Errorf("name %q: valid=%v, want %v", tt.name, got, tt.valid)
		}
	}
}

func TestOccupationEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		occ   string
		valid bool
	}{
		{"Shopkeeper", true},
		{"Self-Employed", true},
		{"Govt. Officer", true},
		{"Farmer/Trader", true},
		{"Manager (Ops)", true},
		{"$$$", false},       // symbols only
		{"123", false},       // digits only
		{"X", false},         // too short
		{"1Engineer", false}, // starts with digit
		{"Dev@Home", false},  // invalid symbol
	} {
		in := baseValidInput()
		in.Occupation = ptrStr(tt.occ)
		got := fieldError(t, in, "occupation") == ""
		if got != tt.valid {
			t.Errorf("occupation %q: valid=%v, want %v", tt.occ, got, tt.valid)
		}
	}
}

func TestStateEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		state string
		valid bool
	}{
		{"Maharashtra", true},
		{"maharashtra", true}, // case-insensitive
		{"Tamil Nadu", true},
		{"Delhi", true},       // UT
		{"  Kerala  ", true},  // trimmed
		{"bgvfdfdsa", false},  // junk
		{"California", false}, // not Indian
		{"MH", false},         // abbreviation not accepted
		{"", false},           // required
	} {
		in := baseValidInput()
		in.State = ptrStr(tt.state)
		got := fieldError(t, in, "state") == ""
		if got != tt.valid {
			t.Errorf("state %q: valid=%v, want %v", tt.state, got, tt.valid)
		}
	}
}

func TestCityEdgeCases(t *testing.T) {
	for _, tt := range []struct {
		city  string
		valid bool
	}{
		{"Pune", true},
		{"New Delhi", true},
		{"Thoothukudi", true},
		{"D", false},         // too short
		{"bgvfdfdsa", false}, // no vowel -> gibberish
		{"xxxx", false},      // repeated-run mash
		{"Pune123", false},   // digits
		{"", false},          // required
	} {
		in := baseValidInput()
		in.City = ptrStr(tt.city)
		got := fieldError(t, in, "city") == ""
		if got != tt.valid {
			t.Errorf("city %q: valid=%v, want %v", tt.city, got, tt.valid)
		}
	}
}

func TestAddressLengthBounds(t *testing.T) {
	in := baseValidInput()
	in.Address = ptrStr("X")
	if fieldError(t, in, "address") == "" {
		t.Error("expected too-short address to be rejected")
	}
	in2 := baseValidInput()
	long := make([]byte, 260)
	for i := range long {
		long[i] = 'a'
	}
	in2.Address = ptrStr(string(long))
	if fieldError(t, in2, "address") == "" {
		t.Error("expected too-long address to be rejected")
	}
}

// KYC identifiers are OPTIONAL: a customer may be created with neither an
// Aadhaar nor a PAN, so they can be captured later. Only the presence rule was
// relaxed — see TestKYCFormatStillEnforcedWhenProvided for the half that must
// never regress.
func TestKYCIsOptional(t *testing.T) {
	in := baseValidInput()
	in.AadhaarNumber = nil
	in.PANNumber = nil
	if err := in.Validate(testNow, ModeCreate); err != nil {
		t.Errorf("customer with no KYC should be valid, got %v", err)
	}
}

// Making KYC optional must NOT weaken the format rules. A supplied identifier is
// still fully validated — a bad Aadhaar checksum or malformed PAN is rejected
// exactly as before. This is the guard against "optional" quietly becoming
// "unvalidated".
func TestKYCFormatStillEnforcedWhenProvided(t *testing.T) {
	bad := "123456789012" // starts with 1 and fails Verhoeff
	in := baseValidInput()
	in.AadhaarNumber = &bad
	in.PANNumber = nil
	if msg := fieldError(t, in, "aadhaar_number"); msg == "" {
		t.Error("an invalid Aadhaar must still be rejected when supplied")
	}

	badPAN := "ABCD1234EF" // wrong shape
	in2 := baseValidInput()
	in2.AadhaarNumber = nil
	in2.PANNumber = &badPAN
	if msg := fieldError(t, in2, "pan_number"); msg == "" {
		t.Error("an invalid PAN must still be rejected when supplied")
	}
}

func TestAltMobileMustDiffer(t *testing.T) {
	in := baseValidInput()
	in.AltMobile = ptrStr(in.Mobile)
	if msg := fieldError(t, in, "alt_mobile"); msg == "" {
		t.Error("expected alt_mobile to be rejected when equal to primary mobile")
	}
}

func TestIncomeBounds(t *testing.T) {
	neg := Paise(-100)
	in := baseValidInput()
	in.MonthlyIncome = &neg
	if msg := fieldError(t, in, "monthly_income"); msg == "" {
		t.Error("expected negative income to be rejected")
	}

	huge := Paise(int64(200_00_00_000) * 100)
	in2 := baseValidInput()
	in2.MonthlyIncome = &huge
	if msg := fieldError(t, in2, "monthly_income"); msg == "" {
		t.Error("expected unrealistically high income to be rejected")
	}
}
