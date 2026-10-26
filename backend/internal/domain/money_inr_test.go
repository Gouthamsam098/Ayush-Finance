package domain

import "testing"

// INR is what a borrower or staff member reads in an error message, so it must
// match the frontend's inr(): Indian grouping, ₹, no ".00" on whole rupees.
func TestPaiseINR(t *testing.T) {
	cases := []struct {
		in   Paise
		want string
	}{
		{0, "₹0"},
		{80000, "₹800"},
		{100000, "₹1,000"},
		{12345600, "₹1,23,456"},
		{1234567800, "₹1,23,45,678"},
		{123450, "₹1,234.50"},
		{5, "₹0.05"},
		{-50000, "-₹500"},
	}
	for _, c := range cases {
		if got := c.in.INR(); got != c.want {
			t.Errorf("Paise(%d).INR() = %q, want %q", int64(c.in), got, c.want)
		}
	}
}
