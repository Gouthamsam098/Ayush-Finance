package domain

import (
	"strings"
	"testing"
)

func fullUPIInput() map[LoanType]LoanTypeUPIInput {
	in := map[LoanType]LoanTypeUPIInput{}
	for _, t := range UPILoanTypes {
		in[t] = LoanTypeUPIInput{PayeeVPA: "anush." + strings.ToLower(string(t[:3])) + "@ybl", PayeeName: "Anush Finserv"}
	}
	return in
}

func TestValidateLoanTypeUPIsAcceptsAndNormalises(t *testing.T) {
	in := fullUPIInput()
	in[LoanVehicle] = LoanTypeUPIInput{PayeeVPA: "  Anush.Vehicle@OKAXIS ", PayeeName: "  Anush Vehicle  "}
	rows, err := ValidateLoanTypeUPIs(in)
	if err != nil {
		t.Fatalf("valid settings refused: %v", err)
	}
	if len(rows) != len(UPILoanTypes) {
		t.Fatalf("got %d rows, want %d", len(rows), len(UPILoanTypes))
	}
	for i, r := range rows {
		if r.LoanType != UPILoanTypes[i] {
			t.Errorf("row %d is %s, want %s (form order)", i, r.LoanType, UPILoanTypes[i])
		}
		if r.LoanType == LoanVehicle && (r.PayeeVPA != "anush.vehicle@okaxis" || r.PayeeName != "Anush Vehicle") {
			t.Errorf("vehicle not normalised: %+v", r)
		}
	}
}

func TestValidateLoanTypeUPIsRejectsBadRows(t *testing.T) {
	cases := map[string]struct {
		edit  func(map[LoanType]LoanTypeUPIInput)
		field string
	}{
		"missing type": {func(m map[LoanType]LoanTypeUPIInput) { delete(m, LoanFlexible) }, "FLEXIBLE.payee_vpa"},
		"blank vpa":    {func(m map[LoanType]LoanTypeUPIInput) { m[LoanProperty] = LoanTypeUPIInput{PayeeName: "Anush"} }, "PROPERTY.payee_vpa"},
		"no psp": {func(m map[LoanType]LoanTypeUPIInput) {
			m[LoanProperty] = LoanTypeUPIInput{PayeeVPA: "anush", PayeeName: "Anush"}
		}, "PROPERTY.payee_vpa"},
		"digit psp": {func(m map[LoanType]LoanTypeUPIInput) {
			m[LoanProperty] = LoanTypeUPIInput{PayeeVPA: "anush@123", PayeeName: "Anush"}
		}, "PROPERTY.payee_vpa"},
		"space in vpa": {func(m map[LoanType]LoanTypeUPIInput) {
			m[LoanProperty] = LoanTypeUPIInput{PayeeVPA: "an ush@ybl", PayeeName: "Anush"}
		}, "PROPERTY.payee_vpa"},
		"too long vpa": {func(m map[LoanType]LoanTypeUPIInput) {
			m[LoanProperty] = LoanTypeUPIInput{PayeeVPA: strings.Repeat("a", 254) + "@ybl", PayeeName: "Anush"}
		}, "PROPERTY.payee_vpa"},
		"short name": {func(m map[LoanType]LoanTypeUPIInput) {
			m[LoanVehicle] = LoanTypeUPIInput{PayeeVPA: "a.b@ybl", PayeeName: " A "}
		}, "VEHICLE.payee_name"},
		"long name": {func(m map[LoanType]LoanTypeUPIInput) {
			m[LoanVehicle] = LoanTypeUPIInput{PayeeVPA: "a.b@ybl", PayeeName: strings.Repeat("x", 81)}
		}, "VEHICLE.payee_name"},
		"control char name": {func(m map[LoanType]LoanTypeUPIInput) {
			m[LoanVehicle] = LoanTypeUPIInput{PayeeVPA: "a.b@ybl", PayeeName: "Anush\nFinserv"}
		}, "VEHICLE.payee_name"},
		"unknown loan type": {func(m map[LoanType]LoanTypeUPIInput) {
			m["GOLD"] = LoanTypeUPIInput{PayeeVPA: "a.b@ybl", PayeeName: "Gold"}
		}, "GOLD"},
	}
	for name, c := range cases {
		in := fullUPIInput()
		c.edit(in)
		_, err := ValidateLoanTypeUPIs(in)
		de, ok := err.(*Error)
		if !ok {
			t.Errorf("%s: want a validation error, got %v", name, err)
			continue
		}
		if de.Fields[c.field] == "" {
			t.Errorf("%s: want field %q flagged, got %v", name, c.field, de.Fields)
		}
	}
}

func TestValidateLoanTypeUPIsAcceptsEightyRuneName(t *testing.T) {
	in := fullUPIInput()
	in[LoanDailyCollection] = LoanTypeUPIInput{PayeeVPA: "a.b@ybl", PayeeName: strings.Repeat("அ", 80)}
	if _, err := ValidateLoanTypeUPIs(in); err != nil {
		t.Fatalf("an 80-character (non-ASCII) payee name is valid: %v", err)
	}
}
