package domain

import (
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// This file holds reusable, industrial-standard field validators. Each returns
// a human-readable reason string on failure, or "" on success, so callers can
// accumulate per-field errors. Rules are India-specific where relevant (mobile,
// PAN, Aadhaar, pincode) and defensive against common junk input.

// Field length bounds. Named constants, never magic numbers. Every text field
// has an explicit min and max so both empty-ish junk and overflow are rejected.
const (
	nameMinLen    = 2
	nameMaxLen    = 100
	addressMinLen = 5
	addressMaxLen = 250
	cityMinLen    = 2
	cityMaxLen    = 50
	occupationMin = 2
	occupationMax = 60
	emailMinLen   = 5
	emailMaxLen   = 254 // RFC 5321 maximum
	// Monthly income sanity ceiling (₹100 crore) to catch fat-finger/overflow.
	maxMonthlyIncomePaise = int64(100_00_00_000) * 100
	minAgeYears           = 18
	maxAgeYears           = 100
)

var (
	// Indian mobile: 10 digits starting 6-9.
	mobileStrictRE = regexp.MustCompile(`^[6-9]\d{9}$`)
	// Pincode: 6 digits, first digit 1-9.
	pincodeRE = regexp.MustCompile(`^[1-9]\d{5}$`)
	// PAN: 5 letters, 4 digits, 1 letter. 4th letter is the holder type.
	panStrictRE = regexp.MustCompile(`^[A-Z]{5}[0-9]{4}[A-Z]$`)
	// Aadhaar: 12 digits, cannot begin with 0 or 1 (UIDAI rule).
	aadhaarStrictRE = regexp.MustCompile(`^[2-9]\d{11}$`)
	// Names / places: letters (incl. unicode), spaces, and . ' -
	nameRE = regexp.MustCompile(`^[\p{L}][\p{L}\s.'-]*$`)
	// Occupation: letters, spaces, and & . , - / ( ) — must start with a letter.
	occupationRE = regexp.MustCompile(`^[\p{L}][\p{L}\s&.,/()-]*$`)
	// City: letters, spaces, and . - (e.g. "New Delhi", "Thoothukudi").
	cityRE = regexp.MustCompile(`^[\p{L}][\p{L}\s.-]*$`)
	// Vowels (incl. common Indian transliterations use a/e/i/o/u); a real
	// place/word name contains at least one.
	vowelRE = regexp.MustCompile(`[aeiouAEIOU]`)
	// Pragmatic email check (full RFC is overkill; this rejects obvious junk).
	emailStrictRE = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)
	// Valid 4th characters of a PAN (entity type). P=individual is the common one.
	panHolderTypes = "ABCFGHLJPTKE"
)

// allSameDigit reports whether s is a run of one repeated digit (e.g.
// "0000000000") — a classic placeholder/junk value.
func allSameDigit(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r != rune(s[0]) {
			return false
		}
	}
	return true
}

// validateName checks a required person/place name.
func validateName(label, v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return label + " is required"
	}
	n := utf8.RuneCountInString(v)
	if n < nameMinLen {
		return label + " is too short"
	}
	if n > nameMaxLen {
		return label + " must be at most 100 characters"
	}
	if !nameRE.MatchString(v) {
		return label + " may only contain letters, spaces, and . ' -"
	}
	if looksLikeGibberish(v) {
		return label + " does not look like a valid name"
	}
	return ""
}

// validateOptionalName is like validateName but allows an empty value.
func validateOptionalName(label string, v *string) string {
	if !nonEmpty(v) {
		return ""
	}
	return validateName(label, *v)
}

// looksLikeGibberish flags obvious junk: a run of 4+ identical letters, or a
// word with no vowel at all (e.g. "bgvfdfdsa", "xxxx", "qwrtp"). Go's RE2 has
// no backreferences, so the repeated-run check is a manual scan.
func looksLikeGibberish(s string) bool {
	// 4+ identical characters in a row.
	run := 1
	for i := 1; i < len(s); i++ {
		if s[i] == s[i-1] {
			run++
			if run >= 4 {
				return true
			}
		} else {
			run = 1
		}
	}
	letters := 0
	consonantRun := 0
	isVowel := func(r rune) bool {
		switch r {
		case 'a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U':
			return true
		}
		return false
	}
	for _, r := range s {
		isAlpha := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		if isAlpha {
			letters++
			if isVowel(r) {
				consonantRun = 0
			} else {
				consonantRun++
				// 5+ consonants with no vowel between them = keyboard mash
				// (real names like "Thrissur" never exceed 4).
				if consonantRun >= 5 {
					return true
				}
			}
		} else {
			consonantRun = 0
		}
	}
	// A word of 3+ letters with no vowel at all is junk.
	if letters >= 3 && !vowelRE.MatchString(s) {
		return true
	}
	return false
}

// validateCity checks a required city: 2–50 chars, letters/spaces/.- only,
// must contain a vowel, and must not look like keyboard mash.
func validateCity(v *string) string {
	if !nonEmpty(v) {
		return "city is required"
	}
	s := strings.TrimSpace(*v)
	n := utf8.RuneCountInString(s)
	if n < cityMinLen {
		return "city is too short"
	}
	if n > cityMaxLen {
		return "city must be at most 50 characters"
	}
	if !cityRE.MatchString(s) {
		return "city may only contain letters, spaces, and . -"
	}
	if looksLikeGibberish(s) {
		return "city does not look like a valid name"
	}
	return ""
}

// validateState checks a required state against the official Indian list.
func validateState(v *string) string {
	if !nonEmpty(v) {
		return "state is required"
	}
	if !IsValidIndianState(*v) {
		return "state must be a valid Indian state or union territory"
	}
	return ""
}

// validateMobile checks a required Indian mobile number.
func validateMobile(label, v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return label + " is required"
	}
	if !mobileStrictRE.MatchString(v) {
		return label + " must be a 10-digit number starting 6-9"
	}
	if allSameDigit(v) {
		return label + " is not a valid number"
	}
	return ""
}

func validateOptionalMobile(label string, v *string) string {
	if !nonEmpty(v) {
		return ""
	}
	return validateMobile(label, *v)
}

// validateEmail checks an optional email address.
func validateEmail(v *string) string {
	if !nonEmpty(v) {
		return ""
	}
	s := strings.TrimSpace(*v)
	n := utf8.RuneCountInString(s)
	if n < emailMinLen {
		return "email is too short"
	}
	if n > emailMaxLen {
		return "email is too long"
	}
	if !emailStrictRE.MatchString(s) {
		return "email is not a valid address"
	}
	return ""
}

// validatePincode checks an optional 6-digit Indian pincode.
func validatePincode(v *string) string {
	if !nonEmpty(v) {
		return ""
	}
	if !pincodeRE.MatchString(strings.TrimSpace(*v)) {
		return "pincode must be 6 digits and cannot start with 0"
	}
	return ""
}

// validatePAN checks an optional PAN, including the holder-type character.
func validatePAN(v *string) string {
	if !nonEmpty(v) {
		return ""
	}
	s := strings.ToUpper(strings.TrimSpace(*v))
	if !panStrictRE.MatchString(s) {
		return "PAN must be in the format AAAAA9999A"
	}
	// 4th character encodes the holder type; reject unknown types.
	if !strings.ContainsRune(panHolderTypes, rune(s[3])) {
		return "PAN has an invalid holder-type character"
	}
	return ""
}

// validateAadhaar checks an optional Aadhaar number: 12 digits, not starting
// 0/1, not a repeated digit, and a valid Verhoeff checksum (UIDAI standard).
func validateAadhaar(v *string) string {
	if !nonEmpty(v) {
		return ""
	}
	s := strings.TrimSpace(*v)
	if !aadhaarStrictRE.MatchString(s) {
		return "Aadhaar must be 12 digits and cannot start with 0 or 1"
	}
	if allSameDigit(s) {
		return "Aadhaar is not a valid number"
	}
	if !verhoeffValid(s) {
		return "Aadhaar checksum is invalid"
	}
	return ""
}

// validateDOB checks an optional date of birth: valid calendar date, not in
// the future, implying an age between 18 and 100.
func validateDOB(v *string, now time.Time) string {
	if !nonEmpty(v) {
		return ""
	}
	s := strings.TrimSpace(*v)
	// Strict layout AND real calendar date (rejects 2026-02-30, 2026-13-01).
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return "date_of_birth must be a real date in YYYY-MM-DD format"
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if t.After(today) {
		return "date_of_birth cannot be in the future"
	}
	age := ageInYears(t, today)
	if age < minAgeYears {
		return "customer must be at least 18 years old"
	}
	if age > maxAgeYears {
		return "date_of_birth implies an unrealistic age"
	}
	return ""
}

// validateAddress checks a required address: 5–250 characters.
func validateAddress(v *string) string {
	if !nonEmpty(v) {
		return "address is required"
	}
	n := utf8.RuneCountInString(strings.TrimSpace(*v))
	if n < addressMinLen {
		return "address is too short"
	}
	if n > addressMaxLen {
		return "address must be at most 250 characters"
	}
	return ""
}

// validateOccupation checks an optional occupation: real words, not junk like
// "$$$" or "123". Allows common punctuation found in job titles.
func validateOccupation(v *string) string {
	if !nonEmpty(v) {
		return ""
	}
	s := strings.TrimSpace(*v)
	n := utf8.RuneCountInString(s)
	if n < occupationMin {
		return "occupation is too short"
	}
	if n > occupationMax {
		return "occupation is too long"
	}
	if !occupationRE.MatchString(s) {
		return "occupation may only contain letters, spaces, and & . , - / ( )"
	}
	return ""
}

// validateIncome bounds an optional monthly income.
func validateIncome(v *Paise) string {
	if v == nil {
		return ""
	}
	if v.IsNegative() {
		return "monthly_income cannot be negative"
	}
	if int64(*v) > maxMonthlyIncomePaise {
		return "monthly_income is unrealistically high"
	}
	return ""
}

func ageInYears(dob, today time.Time) int {
	years := today.Year() - dob.Year()
	if today.Month() < dob.Month() || (today.Month() == dob.Month() && today.Day() < dob.Day()) {
		years--
	}
	return years
}

// verhoeffValid runs the Verhoeff checksum algorithm used by UIDAI for Aadhaar.
func verhoeffValid(number string) bool {
	// Multiplication table (d), permutation table (p), inverse not needed here.
	d := [10][10]int{
		{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
		{1, 2, 3, 4, 0, 6, 7, 8, 9, 5},
		{2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
		{3, 4, 0, 1, 2, 8, 9, 5, 6, 7},
		{4, 0, 1, 2, 3, 9, 5, 6, 7, 8},
		{5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
		{6, 5, 9, 8, 7, 1, 0, 4, 3, 2},
		{7, 6, 5, 9, 8, 2, 1, 0, 4, 3},
		{8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
		{9, 8, 7, 6, 5, 4, 3, 2, 1, 0},
	}
	p := [8][10]int{
		{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
		{1, 5, 7, 6, 2, 8, 3, 0, 9, 4},
		{5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
		{8, 9, 1, 6, 0, 4, 3, 5, 2, 7},
		{9, 4, 5, 3, 1, 2, 6, 8, 7, 0},
		{4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
		{2, 7, 9, 3, 8, 0, 6, 4, 1, 5},
		{7, 0, 4, 6, 9, 1, 3, 2, 5, 8},
	}
	c := 0
	// Process digits right-to-left.
	for i, n := 0, len(number); i < n; i++ {
		digit := int(number[n-1-i] - '0')
		if digit < 0 || digit > 9 {
			return false
		}
		c = d[c][p[i%8][digit]]
	}
	return c == 0
}
