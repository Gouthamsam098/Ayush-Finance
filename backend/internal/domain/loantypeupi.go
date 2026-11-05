package domain

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// LoanTypeUPI is the UPI ID (and the payee name UPI apps show) that borrowers
// of one loan type pay to.
type LoanTypeUPI struct {
	LoanType  LoanType
	PayeeVPA  string
	PayeeName string
}

// LoanTypeUPIInput is one row of the admin's settings form, before validation.
type LoanTypeUPIInput struct {
	PayeeVPA  string
	PayeeName string
}

// UPILoanTypes is every loan type, in the order the Settings form shows them.
// All six must be set together: the portal offers UPI only when they are.
var UPILoanTypes = []LoanType{
	LoanDailyCollection, LoanDailyInterest, LoanMonthlyInterest, LoanFlexible, LoanVehicle, LoanProperty,
}

// upiVPAPattern is an NPCI-style UPI ID, user@psp — the same rule as the
// frontend (src/lib/loanTypeUpi.ts UPI_VPA_PATTERN) and the DB CHECK.
var upiVPAPattern = regexp.MustCompile(`^[a-z0-9._-]{2,256}@[a-z]{2,}$`)

// NormalizeUPIVPA trims and lowercases a UPI ID (UPI IDs are case-insensitive).
func NormalizeUPIVPA(s string) string { return strings.ToLower(strings.TrimSpace(s)) }

func validateUPIVPA(vpa string) string {
	switch {
	case vpa == "":
		return "UPI ID is required"
	case len(vpa) > 256:
		return "UPI ID is too long"
	case !upiVPAPattern.MatchString(vpa):
		return "Enter a valid UPI ID (e.g. name@ybl)"
	}
	return ""
}

func validatePayeeName(name string) string {
	n := utf8.RuneCountInString(name)
	switch {
	case n == 0:
		return "Payee name is required"
	case n < 2:
		return "Payee name is too short"
	case n > 80:
		return "Payee name is too long"
	case strings.IndexFunc(name, unicode.IsControl) >= 0:
		return "Payee name contains invalid characters"
	}
	return ""
}

// ValidateLoanTypeUPIs checks the admin's settings: every loan type needs a
// valid UPI ID and payee name, and nothing else may be sent. Field errors are
// keyed "<LOAN_TYPE>.payee_vpa" / "<LOAN_TYPE>.payee_name". Returns the rows
// normalised (UPI ID lowercased, both trimmed), in UPILoanTypes order.
func ValidateLoanTypeUPIs(in map[LoanType]LoanTypeUPIInput) ([]LoanTypeUPI, error) {
	fields := map[string]string{}
	known := map[LoanType]bool{}
	out := make([]LoanTypeUPI, 0, len(UPILoanTypes))
	for _, t := range UPILoanTypes {
		known[t] = true
		row := in[t]
		vpa := NormalizeUPIVPA(row.PayeeVPA)
		name := strings.TrimSpace(row.PayeeName)
		if msg := validateUPIVPA(vpa); msg != "" {
			fields[string(t)+".payee_vpa"] = msg
		}
		if msg := validatePayeeName(name); msg != "" {
			fields[string(t)+".payee_name"] = msg
		}
		out = append(out, LoanTypeUPI{LoanType: t, PayeeVPA: vpa, PayeeName: name})
	}
	for t := range in {
		if !known[t] {
			fields[string(t)] = "Unknown loan type"
		}
	}
	if len(fields) > 0 {
		return nil, NewValidation("Fill a valid UPI ID and payee name for every loan type.", fields)
	}
	return out, nil
}
