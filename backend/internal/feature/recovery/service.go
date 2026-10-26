package recovery

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/anush-capitals/lms-backend/internal/audit"
	"github.com/anush-capitals/lms-backend/internal/domain"
	"github.com/jackc/pgx/v5"
)

// PaymentRecorder records an approved claim's money inside the caller's
// transaction (collection.Service.RecordSplitTx).
type PaymentRecorder interface {
	RecordSplitTx(ctx context.Context, tx pgx.Tx, loanID int64, amount domain.Paise, date time.Time,
		mode domain.PayMode, remarks string, postedBy *int64, keyPrefix string,
		collector *domain.Collector) ([]*domain.Collection, error)
}

// CollectedReader sums a loan's collections (collection.Repository).
type CollectedReader interface {
	SumByLoanTx(ctx context.Context, tx pgx.Tx, loanID int64) (domain.Collected, error)
	SumByLoans(ctx context.Context, loanIDs []int64) (map[int64]domain.Collected, error)
}

// LoanReader reads loans (loan.Repository).
type LoanReader interface {
	FindByID(ctx context.Context, id int64) (*domain.Loan, error)
	ListByStatus(ctx context.Context, status domain.LoanStatus) ([]*domain.Loan, error)
}

// Auditor records review decisions and auto-assign runs.
type Auditor interface {
	RecordTx(ctx context.Context, tx pgx.Tx, e audit.Entry) error
}

// Clock is injected for testability.
type Clock func() time.Time

// Service holds the recovery rules.
type Service struct {
	repo      *Repository
	payments  PaymentRecorder
	collected CollectedReader
	loans     LoanReader
	audits    Auditor
	now       Clock
}

func NewService(repo *Repository, payments PaymentRecorder, collected CollectedReader, loans LoanReader, audits Auditor) *Service {
	return &Service{repo: repo, payments: payments, collected: collected, loans: loans, audits: audits, now: time.Now}
}

// ── reads ────────────────────────────────────────────────────────────────────

func (s *Service) Agents(ctx context.Context) ([]Agent, error) { return s.repo.Agents(ctx) }
func (s *Service) Assignments(ctx context.Context) ([]Assignment, error) {
	return s.repo.Assignments(ctx)
}

// Submissions lists submissions; agentID nil = all (staff queue).
func (s *Service) Submissions(ctx context.Context, agentID *int64) ([]*domain.RecoverySubmission, error) {
	return s.repo.ListSubmissions(ctx, agentID)
}

// ── agent actions ────────────────────────────────────────────────────────────

// errNotAssigned is a 404 (it reveals nothing about loans the agent cannot
// see), worded for the agent: the usual cause is an admin reassigning the loan
// while the agent's screen still shows it.
var errNotAssigned = &domain.Error{Code: domain.CodeNotFound, Status: http.StatusNotFound,
	Message: "This loan is no longer assigned to you. Refresh to see your current list."}

// requireAssignedActive confirms the loan is assigned to this agent and ACTIVE.
// An unassigned loan is reported as not found, never revealing other loans.
func (s *Service) requireAssignedActive(ctx context.Context, loanID, agentID int64) error {
	ok, err := s.repo.IsAssigned(ctx, loanID, agentID)
	if err != nil {
		return err
	}
	if !ok {
		return errNotAssigned
	}
	l, err := s.loans.FindByID(ctx, loanID)
	if err != nil {
		return err
	}
	if l.Status != domain.StatusActive {
		return domain.NewConflict("This loan is closed — nothing is due on it")
	}
	return nil
}

// SubmitClaim records an agent's "customer paid" report for admin approval.
// One claim per loan may await approval at a time (any agent).
func (s *Service) SubmitClaim(ctx context.Context, agentID int64, in domain.ClaimInput) (*domain.RecoverySubmission, error) {
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	if err := s.requireAssignedActive(ctx, in.LoanID, agentID); err != nil {
		return nil, err
	}
	id, err := s.repo.CreateClaim(ctx, agentID, in)
	if err != nil {
		return nil, err
	}
	return s.repo.FindSubmission(ctx, id, &agentID)
}

// UpdateClaim edits the agent's own claim while it is still pending.
func (s *Service) UpdateClaim(ctx context.Context, id, agentID int64, in domain.ClaimInput) (*domain.RecoverySubmission, error) {
	cur, err := s.repo.FindSubmission(ctx, id, &agentID)
	if err != nil {
		return nil, err
	}
	in.LoanID = cur.LoanID
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	ok, err := s.repo.UpdatePendingClaim(ctx, id, agentID, in)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.NewConflict("This submission can no longer be edited.")
	}
	return s.repo.FindSubmission(ctx, id, &agentID)
}

// SubmitPromise records a promise-to-pay date for an assigned loan.
func (s *Service) SubmitPromise(ctx context.Context, agentID int64, in domain.PromiseInput) (*domain.RecoverySubmission, error) {
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	if err := s.requireAssignedActive(ctx, in.LoanID, agentID); err != nil {
		return nil, err
	}
	id, err := s.repo.CreatePromise(ctx, agentID, in)
	if err != nil {
		return nil, err
	}
	return s.repo.FindSubmission(ctx, id, &agentID)
}

// ClosePromise lets the agent close their own open promise: FULFILLED (the
// customer paid as promised) or CANCELLED. Closing it again with the same
// status returns it unchanged. Records no money.
func (s *Service) ClosePromise(ctx context.Context, id, agentID int64, status string) (*domain.RecoverySubmission, error) {
	if !domain.IsPromiseCloseStatus(status) {
		return nil, domain.NewValidation("Please fix the highlighted fields",
			map[string]string{"status": "Choose FULFILLED or CANCELLED"})
	}
	cur, err := s.repo.FindSubmission(ctx, id, &agentID)
	if err != nil {
		return nil, err
	}
	if cur.Type != domain.SubmissionPromise {
		return nil, domain.NewNotFound("promise")
	}
	if cur.Status != domain.PromiseOpen {
		if cur.Status == status {
			return cur, nil
		}
		return nil, domain.NewConflict("This promise is already closed.")
	}
	ok, err := s.repo.ClosePromise(ctx, id, agentID, status)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, domain.NewConflict("This promise is already closed.")
	}
	return s.repo.FindSubmission(ctx, id, &agentID)
}

// ── staff review ─────────────────────────────────────────────────────────────

// maxRemarkNote keeps "Recovery: <note>" inside the collection's 300-char remark.
const maxRemarkNote = 280

// Approve accepts a pending claim: its amount is recorded as collection(s)
// dated on the agent's receipt date and credited to the agent, the claim is
// marked APPROVED, and — when nothing is due any more — the loan is released
// from the agent. All in ONE transaction: the money lands exactly once or not
// at all. Approving an approved claim returns it unchanged.
func (s *Service) Approve(ctx context.Context, id int64, reviewer *int64) (*domain.RecoverySubmission, []*domain.Collection, error) {
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	sub, err := lockSubmissionTx(ctx, tx, id)
	if err != nil {
		return nil, nil, err
	}
	if sub.Type != domain.SubmissionClaim {
		return nil, nil, domain.NewConflict("Only collection claims can be approved")
	}
	switch sub.Status {
	case domain.ClaimApproved:
		return sub, nil, tx.Commit(ctx)
	case domain.ClaimRejected:
		return nil, nil, domain.NewConflict("This submission was rejected and cannot be approved")
	}

	remarks := "Recovery agent collection (approved)"
	if sub.Note != nil && *sub.Note != "" {
		note := []rune(*sub.Note)
		if len(note) > maxRemarkNote {
			note = note[:maxRemarkNote]
		}
		remarks = "Recovery: " + string(note)
	}
	agentID := sub.AgentUserID
	collector := &domain.Collector{Type: domain.CollectorRecoveryAgent, Name: sub.AgentName, UserID: &agentID}
	colls, err := s.payments.RecordSplitTx(ctx, tx, sub.LoanID, *sub.Amount, *sub.ReceiptDate, *sub.Mode,
		remarks, reviewer, "claim-"+strconv.FormatInt(sub.ID, 10), collector)
	if err != nil {
		return nil, nil, err
	}
	// Reports show which UPI ID a UPI collection was paid to.
	if *sub.Mode == domain.PayUPI {
		if err := stampCollectionPayeeTx(ctx, tx, sub.LoanID, sub.ID, sub.PayeeVPA, sub.PayeeName); err != nil {
			return nil, nil, err
		}
	}
	if err := markReviewedTx(ctx, tx, sub.ID, domain.ClaimApproved, reviewer, nil); err != nil {
		return nil, nil, err
	}
	// The agent's screenshot of this payment is accepted with it — as evidence
	// only: the money was recorded once, above.
	screenshots, err := closeClaimProofsTx(ctx, tx, sub.ID, domain.ClaimApproved, reviewer, sub.ReceiptDate)
	if err != nil {
		return nil, nil, err
	}

	// Nothing due any more → the agent's work on this loan is done.
	l, err := s.loans.FindByID(ctx, sub.LoanID)
	if err != nil {
		return nil, nil, err
	}
	after, err := s.collected.SumByLoanTx(ctx, tx, sub.LoanID)
	if err != nil {
		return nil, nil, err
	}
	released := false
	if domain.ScheduleShortfall(l, after, s.now()) <= 0 {
		if err := unassignTx(ctx, tx, sub.LoanID, sub.AgentUserID); err != nil {
			return nil, nil, err
		}
		released = true
	}

	if s.audits != nil {
		receipts := make([]string, 0, len(colls))
		for _, c := range colls {
			receipts = append(receipts, c.ReceiptNo)
		}
		if err := s.audits.RecordTx(ctx, tx, audit.Entry{
			EntityType: audit.EntityRecoverySubmission, EntityID: sub.ID, Action: audit.ActionApprove,
			After: map[string]any{
				"loan_id": sub.LoanID, "agent_user_id": sub.AgentUserID, "amount": sub.Amount.Rupees(),
				"receipt_date": sub.ReceiptDate.Format("2006-01-02"), "receipts": receipts,
				"released_from_agent": released, "screenshots_accepted": screenshots,
			},
		}); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	out, err := s.repo.FindSubmission(ctx, sub.ID, nil)
	return out, colls, err
}

// Reject marks a pending claim REJECTED with a reason; no money is recorded.
func (s *Service) Reject(ctx context.Context, id int64, reviewer *int64, reason string) (*domain.RecoverySubmission, error) {
	note, err := domain.CleanReviewNote(reason)
	if err != nil {
		return nil, err
	}
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	sub, err := lockSubmissionTx(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if sub.Type != domain.SubmissionClaim {
		return nil, domain.NewConflict("Only collection claims can be rejected")
	}
	switch sub.Status {
	case domain.ClaimRejected:
		return sub, tx.Commit(ctx)
	case domain.ClaimApproved:
		return nil, domain.NewConflict("This submission was already approved — its payment is on the ledger")
	}
	if err := markReviewedTx(ctx, tx, sub.ID, domain.ClaimRejected, reviewer, &note); err != nil {
		return nil, err
	}
	// A rejected claim's screenshot is moot: reject it too, so it never waits
	// for review (and cannot be accepted on its own).
	screenshots, err := closeClaimProofsTx(ctx, tx, sub.ID, domain.ClaimRejected, reviewer, nil)
	if err != nil {
		return nil, err
	}
	if s.audits != nil {
		if err := s.audits.RecordTx(ctx, tx, audit.Entry{
			EntityType: audit.EntityRecoverySubmission, EntityID: sub.ID, Action: audit.ActionUpdate,
			After: map[string]any{"status": domain.ClaimRejected, "loan_id": sub.LoanID, "amount": sub.Amount.Rupees(),
				"screenshots_rejected": screenshots},
		}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.repo.FindSubmission(ctx, sub.ID, nil)
}

// ── daily auto-assign ────────────────────────────────────────────────────────

// AutoAssignResult mirrors the UI's RecoveryAutoAssignResult.
type AutoAssignResult struct {
	Ran             bool   `json:"ran"`
	SkippedReason   string `json:"skipped_reason,omitempty"`
	OverdueCount    int    `json:"overdue_count"`
	AgentsCount     int    `json:"agents_count"`
	ReassignedCount int    `json:"reassigned_count"`
	Slot            string `json:"slot,omitempty"`
}

// slotKey is the once-per-day key: the date, plus HH:MM when a run time is set
// (so changing the time lets it run again the same day, as in the UI).
func slotKey(now time.Time, runTime *string) string {
	d := now.In(time.Local).Format("2006-01-02")
	if runTime != nil && *runTime != "" {
		return d + "|" + *runTime
	}
	return d
}

// scheduledToday is today's run moment (midnight when no time is set).
func scheduledToday(now time.Time, runTime *string) time.Time {
	lt := now.In(time.Local)
	h, m := 0, 0
	if runTime != nil && *runTime != "" {
		_, _ = fmt.Sscanf(*runTime, "%d:%d", &h, &m)
	}
	return time.Date(lt.Year(), lt.Month(), lt.Day(), h, m, 0, 0, time.Local)
}

// NextRun is the next scheduled run after now.
func NextRun(now time.Time, runTime *string) time.Time {
	at := scheduledToday(now, runTime)
	if !at.After(now) {
		at = at.AddDate(0, 0, 1)
	}
	return at
}

// AutoAssign balances overdue loans across active agents (see
// domain.BalanceOverdueAssignments). Once per slot unless force. Serialised on
// the settings row, so overlapping runs cannot double-assign.
func (s *Service) AutoAssign(ctx context.Context, force bool) (*AutoAssignResult, error) {
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	sched, err := lockScheduleTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	now := s.now()
	slot := slotKey(now, sched.RunTime)
	if !force && sched.LastRunSlot != nil && *sched.LastRunSlot == slot {
		return &AutoAssignResult{SkippedReason: "already_ran_today", Slot: slot}, tx.Commit(ctx)
	}

	agentsAll, err := s.repo.Agents(ctx)
	if err != nil {
		return nil, err
	}
	var agents []int64
	for _, a := range agentsAll {
		if a.IsActive {
			agents = append(agents, a.ID)
		}
	}
	if len(agents) == 0 {
		return &AutoAssignResult{SkippedReason: "no_agents", Slot: slot}, tx.Commit(ctx)
	}
	loans, err := s.loans.ListByStatus(ctx, domain.StatusActive)
	if err != nil {
		return nil, err
	}
	if len(loans) == 0 {
		// Nothing to assign today: record the slot so the scheduler doesn't
		// re-check every 30 s (a loan booked today can't be overdue yet).
		res := &AutoAssignResult{SkippedReason: "no_loans", AgentsCount: len(agents), Slot: slot}
		if err := recordRunTx(ctx, tx, slot, map[string]any{"overdue_count": 0, "agents_count": len(agents), "reassigned_count": 0}); err != nil {
			return nil, err
		}
		return res, tx.Commit(ctx)
	}
	ids := make([]int64, 0, len(loans))
	for _, l := range loans {
		ids = append(ids, l.ID)
	}
	collected, err := s.collected.SumByLoans(ctx, ids)
	if err != nil {
		return nil, err
	}
	var overdue []int64
	for _, l := range loans {
		if domain.ScheduleShortfall(l, collected[l.ID], now) > 0 {
			overdue = append(overdue, l.ID)
		}
	}
	sort.Slice(overdue, func(i, j int) bool { return overdue[i] < overdue[j] })

	current := map[int64]int64{}
	rows, err := s.repo.Assignments(ctx)
	if err != nil {
		return nil, err
	}
	for _, a := range rows {
		current[a.LoanID] = a.AgentID
	}
	next := domain.BalanceOverdueAssignments(agents, overdue, current)
	changes := map[int64]int64{}
	for loanID, agentID := range next {
		if cur, ok := current[loanID]; !ok || cur != agentID {
			changes[loanID] = agentID
		}
	}
	if err := applyAutoTx(ctx, tx, changes); err != nil {
		return nil, err
	}
	res := &AutoAssignResult{
		Ran: true, OverdueCount: len(overdue), AgentsCount: len(agents), ReassignedCount: len(changes), Slot: slot,
	}
	if err := recordRunTx(ctx, tx, slot, map[string]any{
		"overdue_count": res.OverdueCount, "agents_count": res.AgentsCount, "reassigned_count": res.ReassignedCount,
	}); err != nil {
		return nil, err
	}
	if s.audits != nil && len(changes) > 0 {
		if err := s.audits.RecordTx(ctx, tx, audit.Entry{
			EntityType: audit.EntityRecoveryAutoAssign, EntityID: 1, Action: audit.ActionUpdate,
			After: map[string]any{"slot": slot, "reassigned": changes, "forced": force},
		}); err != nil {
			return nil, err
		}
	}
	return res, tx.Commit(ctx)
}

// Schedule returns the auto-assign settings.
func (s *Service) Schedule(ctx context.Context) (*Schedule, error) { return s.repo.GetSchedule(ctx) }

// SetSchedule saves the daily run time ("HH:MM", or nil for midnight).
func (s *Service) SetSchedule(ctx context.Context, runTime *string, by *int64) error {
	if runTime != nil {
		var h, m int
		if n, err := fmt.Sscanf(*runTime, "%d:%d", &h, &m); err != nil || n != 2 || len(*runTime) != 5 || h < 0 || h > 23 || m < 0 || m > 59 {
			return domain.NewValidation("Enter a time as HH:MM", map[string]string{"run_time": "Use 24-hour HH:MM"})
		}
	}
	return s.repo.SetRunTime(ctx, runTime, by)
}

// markAutoAssignSlotSkipped records today's slot without assigning (e.g. no agents).
func (s *Service) markAutoAssignSlotSkipped(ctx context.Context, slot string, reason string) error {
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	sched, err := lockScheduleTx(ctx, tx)
	if err != nil {
		return err
	}
	if sched.LastRunSlot != nil && *sched.LastRunSlot == slot {
		return tx.Commit(ctx)
	}
	if err := recordRunTx(ctx, tx, slot, map[string]any{"skipped_reason": reason}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// hasActiveAgent is a cheap, lock-free pre-check for the scheduler.
func (s *Service) hasActiveAgent(ctx context.Context) bool {
	agents, err := s.repo.Agents(ctx)
	if err != nil {
		return true // let AutoAssign surface the error
	}
	for _, a := range agents {
		if a.IsActive {
			return true
		}
	}
	return false
}

// RunScheduler runs the daily auto-assign at its scheduled time, server-side,
// with nobody logged in. It checks every 30 s and runs a slot at most once
// (also after a restart: a missed slot runs on the first check after it).
func (s *Service) RunScheduler(ctx context.Context, log *slog.Logger) {
	check := func() {
		sched, err := s.repo.GetSchedule(ctx)
		if err != nil {
			log.Warn("recovery auto-assign: schedule read failed", "error", err)
			return
		}
		now := s.now()
		if now.Before(scheduledToday(now, sched.RunTime)) {
			return
		}
		if sched.LastRunSlot != nil && *sched.LastRunSlot == slotKey(now, sched.RunTime) {
			return
		}
		// No active agent at/after the scheduled time: mark the slot consumed so
		// creating an agent later the same day does not immediately backfill
		// overdue loans (admin can still POST /auto-assign/run).
		if !s.hasActiveAgent(ctx) {
			if err := s.markAutoAssignSlotSkipped(ctx, slotKey(now, sched.RunTime), "no_agents"); err != nil {
				log.Warn("recovery auto-assign: mark skipped failed", "error", err)
			}
			return
		}
		res, err := s.AutoAssign(ctx, false)
		if err != nil {
			log.Error("recovery auto-assign failed", "error", err)
			return
		}
		if res.Ran {
			log.Info("recovery auto-assign ran", "slot", res.Slot,
				"overdue", res.OverdueCount, "agents", res.AgentsCount, "reassigned", res.ReassignedCount)
		}
	}
	check()
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			check()
		}
	}
}
