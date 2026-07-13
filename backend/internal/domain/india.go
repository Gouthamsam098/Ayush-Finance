package domain

import "strings"

// IndianStates is the canonical list of the 28 states and 8 union territories
// of India. State input is validated against this list (case-insensitive) so
// typos and junk values cannot be stored. Kept alphabetical for the UI.
var IndianStates = []string{
	"Andaman and Nicobar Islands",
	"Andhra Pradesh",
	"Arunachal Pradesh",
	"Assam",
	"Bihar",
	"Chandigarh",
	"Chhattisgarh",
	"Dadra and Nagar Haveli and Daman and Diu",
	"Delhi",
	"Goa",
	"Gujarat",
	"Haryana",
	"Himachal Pradesh",
	"Jammu and Kashmir",
	"Jharkhand",
	"Karnataka",
	"Kerala",
	"Ladakh",
	"Lakshadweep",
	"Madhya Pradesh",
	"Maharashtra",
	"Manipur",
	"Meghalaya",
	"Mizoram",
	"Nagaland",
	"Odisha",
	"Puducherry",
	"Punjab",
	"Rajasthan",
	"Sikkim",
	"Tamil Nadu",
	"Telangana",
	"Tripura",
	"Uttar Pradesh",
	"Uttarakhand",
	"West Bengal",
}

// indianStateSet is a lowercase lookup built once at startup.
var indianStateSet = func() map[string]bool {
	m := make(map[string]bool, len(IndianStates))
	for _, s := range IndianStates {
		m[strings.ToLower(s)] = true
	}
	return m
}()

// IsValidIndianState reports whether s matches an official state/UT name,
// case-insensitively and ignoring surrounding whitespace.
func IsValidIndianState(s string) bool {
	return indianStateSet[strings.ToLower(strings.TrimSpace(s))]
}
