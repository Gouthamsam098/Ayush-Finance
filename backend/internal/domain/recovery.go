package domain

import (
	"sort"
	"strings"
	"time"
)

// ScheduleShortfall is what the borrower is behind on today: unpaid accrued
// interest for interest-only loans, missed instalments for Daily Collection,
// missed EMIs otherwise. Never negative (paid ahead = 0). It is the frontend's
// scheduleShortfall/recoveryDueNow, which drives the agent cards, the
// Collections "Due now" and the overdue set for auto-assign.
func ScheduleShortfall(l *Loan, collected Collected, now time.Time) Paise {
	var due Paise
	switch {
	case l.BehavesInterestOnly():
		due = l.TotalDueForInterestOnly(collected.Interest, now)
	case l.Type.IsDailyLoan():
		due = l.TotalDueForDaily(collected.Total(), now)
	default:
		due = l.TotalDueForMonthly(collected.Total(), now)
	}
	if due < 0 {
		return 0
	}
	return due
}

// BalanceOverdueAssignments is the daily auto-assign rule, a port of the UI's
// computeBalancedOverdueAssignments:
//
//   - an overdue loan already on an ACTIVE agent stays there (sticky);
//   - every other overdue loan (unassigned, or on an inactive/removed agent)
//     goes to the active agent with the FEWEST overdue loans, ties to the lower
//     user id, in ascending loan-id order;
//   - loans that are not overdue are never touched (an agent keeps them).
//
// current maps loanID → agentID. The returned map is a new map; only loans whose
// agent changed differ from current.
func BalanceOverdueAssignments(activeAgents []int64, overdueLoans []int64, current map[int64]int64) map[int64]int64 {
	next := make(map[int64]int64, len(current))
	for loanID, agentID := range current {
		next[loanID] = agentID
	}
	if len(activeAgents) == 0 {
		return next
	}
	agents := append([]int64(nil), activeAgents...)
	sort.Slice(agents, func(i, j int) bool { return agents[i] < agents[j] })
	active := make(map[int64]bool, len(agents))
	for _, a := range agents {
		active[a] = true
	}
	loans := append([]int64(nil), overdueLoans...)
	sort.Slice(loans, func(i, j int) bool { return loans[i] < loans[j] })
	overdue := make(map[int64]bool, len(loans))
	for _, id := range loans {
		overdue[id] = true
	}

	overdueCount := func(agentID int64) int {
		n := 0
		for loanID, a := range next {
			if a == agentID && overdue[loanID] {
				n++
			}
		}
		return n
	}

	var unassigned []int64
	for _, loanID := range loans {
		if a, ok := next[loanID]; ok && active[a] {
			continue // sticky
		}
		delete(next, loanID)
		unassigned = append(unassigned, loanID)
	}
	for _, loanID := range unassigned {
		pick := agents[0]
		min := overdueCount(pick)
		for _, a := range agents {
			if c := overdueCount(a); c < min || (c == min && a < pick) {
				min, pick = c, a
			}
		}
		next[loanID] = pick
	}
	return next
}

// RecoverySubmissionType distinguishes an agent's collection claim from a
// promise-to-pay date.
type RecoverySubmissionType string

const (
	SubmissionClaim   RecoverySubmissionType = "COLLECTION_CLAIM"
	SubmissionPromise RecoverySubmissionType = "PROMISE_TO_PAY"
)

// Submission statuses. Claims: PENDING → APPROVED | REJECTED. Promises: OPEN
// (FULFILLED / CANCELLED exist in the schema; nothing sets them yet).
const (
	ClaimPending  = "PENDING"
	ClaimApproved = "APPROVED"
	ClaimRejected = "REJECTED"
	PromiseOpen   = "OPEN"
)

// RecoverySubmission is one agent submission.
type RecoverySubmission struct {
	ID             int64
	Type           RecoverySubmissionType
	LoanID         int64
	LoanNumber     string
	CustomerID     int64
	CustomerName   string
	AgentUserID    int64
	AgentName      string
	Status         string
	Amount         *Paise
	Mode           *PayMode
	ReceiptDate    *time.Time
	PromiseDate    *time.Time
	PromisedAmount *Paise
	Note           *string
	CreatedAt      time.Time
	ReviewedAt     *time.Time
	ReviewNote     *string
}

const (
	maxSubmissionNoteLen = 500
	maxReviewNoteLen     = 300
)

// ClaimInput is an agent's "customer paid" report.
type ClaimInput struct {
	LoanID      int64
	Amount      Paise
	Mode        PayMode
	ReceiptDate time.Time
	Note        *string
}

// Validate checks a claim. The receipt date is range-checked against the loan
// again when the claim is approved (the collection's own date rule).
func (in *ClaimInput) Validate(now time.Time) error {
	fields := map[string]string{}
	switch {
	case in.Amount <= 0:
		fields["amount"] = "Enter a valid amount"
	case int64(in.Amount)%100 != 0:
		fields["amount"] = "Enter a whole rupee amount"
	case in.Amount > maxPrincipalPaise:
		fields["amount"] = "Amount is unrealistically large"
	}
	if !IsValidPayMode(in.Mode) {
		fields["mode"] = "Select a valid payment mode"
	}
	if in.ReceiptDate.IsZero() {
		fields["receipt_date"] = "Receipt date is required"
	} else if IsFutureDate(in.ReceiptDate, now) {
		fields["receipt_date"] = "Receipt date cannot be in the future"
	}
	if in.Note != nil && len([]rune(*in.Note)) > maxSubmissionNoteLen {
		fields["note"] = "Max 500 characters"
	}
	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}

// PromiseInput is an agent's promise-to-pay record.
type PromiseInput struct {
	LoanID         int64
	PromiseDate    time.Time
	PromisedAmount *Paise
	Note           *string
}

// Validate checks a promise: the date may not be in the past.
func (in *PromiseInput) Validate(now time.Time) error {
	fields := map[string]string{}
	if in.PromiseDate.IsZero() {
		fields["promise_date"] = "Promise date is required"
	} else if truncateToDay(in.PromiseDate).Before(truncateToDay(now)) {
		fields["promise_date"] = "Promise date cannot be in the past"
	}
	if in.PromisedAmount != nil {
		switch a := *in.PromisedAmount; {
		case a <= 0:
			fields["promised_amount"] = "Enter a valid amount"
		case int64(a)%100 != 0:
			fields["promised_amount"] = "Enter a whole rupee amount"
		case a > maxPrincipalPaise:
			fields["promised_amount"] = "Amount is unrealistically large"
		}
	}
	if in.Note != nil && len([]rune(*in.Note)) > maxSubmissionNoteLen {
		fields["note"] = "Max 500 characters"
	}
	if len(fields) > 0 {
		return NewValidation("Please fix the highlighted fields", fields)
	}
	return nil
}

// CleanReviewNote trims a reject reason and applies the UI's default.
func CleanReviewNote(reason string) (string, error) {
	r := strings.TrimSpace(reason)
	if r == "" {
		r = "Rejected by admin"
	}
	if len([]rune(r)) > maxReviewNoteLen {
		return "", NewValidation("Reason is too long", map[string]string{"reason": "Max 300 characters"})
	}
	return r, nil
}

// CollectorType says who received a payment, for Reports' "Collected by".
type CollectorType string

const (
	CollectorAdmin         CollectorType = "ADMIN"
	CollectorStaff         CollectorType = "STAFF"
	CollectorRecoveryAgent CollectorType = "RECOVERY_AGENT"
	CollectorCustomer      CollectorType = "CUSTOMER"
)

// Collector attributes a collection to the person who received the money.
type Collector struct {
	Type   CollectorType
	Name   string
	UserID *int64
}

// StaffCollector attributes a payment recorded directly by a staff user.
func StaffCollector(u *User) *Collector {
	if u == nil {
		return nil
	}
	t := CollectorStaff
	if u.IsAdmin() {
		t = CollectorAdmin
	}
	id := u.ID
	return &Collector{Type: t, Name: u.FullName, UserID: &id}
}
