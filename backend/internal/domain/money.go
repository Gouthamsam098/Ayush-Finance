package domain

import (
	"fmt"
	"math"
)

// Paise is a monetary amount stored as an integer count of paise (1 rupee =
// 100 paise). Money is never represented as a float anywhere in the system:
// floating-point rounding drift is unacceptable in a ledger. All arithmetic
// on balances goes through this type.
type Paise int64

// RupeesToPaise converts a rupee value to paise, rounding to the nearest
// paise. Used only at the trust boundary (parsing external input); internal
// math stays in Paise.
func RupeesToPaise(rupees float64) Paise {
	return Paise(math.Round(rupees * 100))
}

// Rupees returns the amount as a float for display/formatting only. Never
// feed this back into calculations.
func (p Paise) Rupees() float64 { return float64(p) / 100 }

// DBRupees returns the amount as a whole-rupee integer for storage. The
// database stores the human rupee amount (₹1,00,000 → 100000), not paise;
// internal math still uses Paise.
//
// Rounds to the NEAREST rupee — it must not truncate. User-entered money is
// validated to whole rupees, but DERIVED money is not: CalcInterest and EMI
// round to the nearest paise, so with a 2-decimal rate they routinely produce
// a .5 remainder (interest 25% of the time, EMI ~83%). Truncating those
// discarded up to 99 paise per row AND — the real defect — disagreed with the
// frontend, which computes the same figures in rupee space with Math.round:
// truncation diverged on 25% of interest values, rounding on none. The
// front/back lock-step required by CLAUDE.md only holds with rounding.
func (p Paise) DBRupees() int64 {
	return int64(math.Round(float64(p) / 100))
}

// PaiseFromDBRupees converts a whole-rupee value read from the database back
// into internal Paise. The inverse of DBRupees.
func PaiseFromDBRupees(rupees int64) Paise { return Paise(rupees * 100) }

// Add returns p + other.
func (p Paise) Add(other Paise) Paise { return p + other }

// Sub returns p - other.
func (p Paise) Sub(other Paise) Paise { return p - other }

// MulInt returns p multiplied by an integer factor (e.g. days × daily amount).
func (p Paise) MulInt(n int64) Paise { return Paise(int64(p) * n) }

// IsPositive reports whether the amount is strictly greater than zero.
func (p Paise) IsPositive() bool { return p > 0 }

// IsNegative reports whether the amount is strictly less than zero.
func (p Paise) IsNegative() bool { return p < 0 }

// CalcInterest computes interest as round(principal × rate / 100), matching
// the frontend's calcInterest exactly. rate is a percentage (e.g. 2 for 2%).
// The multiplication is done in paise-space to avoid float drift on the
// principal, then divided by the percentage denominator.
func CalcInterest(principal Paise, rate float64) Paise {
	return Paise(math.Round(float64(principal) * rate / 100))
}

// String renders the amount as rupees with two decimal places, for logs.
func (p Paise) String() string {
	return fmt.Sprintf("%.2f", p.Rupees())
}
