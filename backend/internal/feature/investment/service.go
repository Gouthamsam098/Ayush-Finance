package investment

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/anush-capitals/lms-backend/internal/domain"
)

const (
	defaultLimit = 50
	maxLimit     = 500
)

// Clock returns the current time; injected so date validation is testable.
type Clock func() time.Time

// Page is a validated pagination + filter request.
type Page struct {
	Number int
	Limit  int
	Status string
	Search string
}

// Normalize clamps the page/limit into range.
func (p Page) Normalize() Page {
	if p.Number < 1 {
		p.Number = 1
	}
	if p.Limit <= 0 {
		p.Limit = defaultLimit
	}
	if p.Limit > maxLimit {
		p.Limit = maxLimit
	}
	return p
}

func (p Page) offset() int { return (p.Number - 1) * p.Limit }

// Service holds investment business rules: validation before every write, and
// the atomic payout+expense write.
type Service struct {
	repo *Repository
	now  Clock
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo, now: time.Now}
}

// Create validates and persists an investment.
func (s *Service) Create(ctx context.Context, in domain.InvestmentInput) (*domain.Investment, error) {
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	return s.repo.Create(ctx, in)
}

// Update validates and rewrites an investment's details.
func (s *Service) Update(ctx context.Context, id int64, in domain.InvestmentInput) (*domain.Investment, error) {
	if err := in.Validate(s.now()); err != nil {
		return nil, err
	}
	// A settled investment is history — editing its terms would retroactively
	// change interest that has already been paid and expensed.
	existing, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if existing.Status == domain.InvestmentClosed {
		return nil, domain.NewConflict("A settled investment cannot be edited")
	}
	return s.repo.Update(ctx, id, in)
}

// View is an investment plus its derived money figures, computed server-side so
// every client shows the same numbers.
type View struct {
	Investment  *domain.Investment
	Paid        domain.Paise
	PerCycle    domain.Paise
	Accrued     domain.Paise
	InterestDue domain.Paise
	NextPayout  *time.Time
	Cycles      int
}

func (s *Service) view(inv *domain.Investment, paid domain.Paise) View {
	now := s.now()
	return View{
		Investment:  inv,
		Paid:        paid,
		PerCycle:    inv.InterestPerCycle(),
		Accrued:     inv.AccruedInterest(now),
		InterestDue: inv.InterestDue(paid, now),
		NextPayout:  inv.NextPayoutDate(paid, now),
		Cycles:      inv.CyclesElapsed(now),
	}
}

// List returns a page of investments with their derived figures.
func (s *Service) List(ctx context.Context, p Page) ([]View, int64, error) {
	p = p.Normalize()
	items, total, err := s.repo.List(ctx, ListParams{
		Status: p.Status, Search: p.Search, Limit: p.Limit, Offset: p.offset(),
	})
	if err != nil {
		return nil, 0, err
	}
	ids := make([]int64, 0, len(items))
	for _, inv := range items {
		ids = append(ids, inv.ID)
	}
	// One aggregate query for every row's paid total — never N+1.
	paidBy, err := s.repo.SumPaidByInvestments(ctx, ids)
	if err != nil {
		return nil, 0, err
	}
	out := make([]View, 0, len(items))
	for _, inv := range items {
		out = append(out, s.view(inv, paidBy[inv.ID]))
	}
	return out, total, nil
}

// Get returns one investment with its derived figures.
func (s *Service) Get(ctx context.Context, id int64) (View, error) {
	inv, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return View{}, err
	}
	paidBy, err := s.repo.SumPaidByInvestments(ctx, []int64{id})
	if err != nil {
		return View{}, err
	}
	return s.view(inv, paidBy[id]), nil
}

// ListPayouts returns an investment's payout history.
func (s *Service) ListPayouts(ctx context.Context, id int64) ([]*domain.InvestorPayout, error) {
	if _, err := s.repo.FindByID(ctx, id); err != nil {
		return nil, err // 404 for an unknown/deleted investment
	}
	return s.repo.ListPayouts(ctx, id)
}

// PayInterest records an interest payout AND the expense that accounts for it,
// atomically. The expense is what makes the money leave the books, so the two
// must commit together or not at all — a payout without its expense would
// understate costs (and inflate available funds), while an expense without its
// payout would double-count when the payout was retried.
func (s *Service) PayInterest(
	ctx context.Context, in domain.PayoutInput, postedBy *int64,
) (*domain.InvestorPayout, error) {
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	// Rollback is a no-op once committed, so this is safe to defer
	// unconditionally and guarantees no connection leaks on any path.
	defer func() { _ = tx.Rollback(ctx) }()

	// Lock FIRST: the paid total read below must not change under us, or two
	// concurrent payouts could each pass the ceiling check on a stale sum.
	if err := LockInvestmentForUpdate(ctx, tx, in.InvestmentID); err != nil {
		return nil, err
	}
	inv, err := s.repo.FindByID(ctx, in.InvestmentID)
	if err != nil {
		return nil, err
	}
	if inv.Status == domain.InvestmentClosed {
		return nil, domain.NewConflict("This investment is settled — no further interest is due")
	}
	paid, err := s.repo.SumPaidTx(ctx, tx, in.InvestmentID)
	if err != nil {
		return nil, err
	}
	// Server-side ceiling: never trust the client's arithmetic.
	if err := in.Validate(inv, paid, s.now()); err != nil {
		return nil, err
	}

	// The expense first, so the payout can carry its id.
	sub := "Monthly interest"
	if inv.Frequency == domain.PayoutYearly {
		sub = "Yearly interest"
	}
	name := fmt.Sprintf("Interest — %s (%s)", inv.InvestorName, inv.Code)
	expenseID, err := s.repo.InsertExpenseTx(ctx, tx, domain.ExpenseInput{
		Category:    domain.ExpenseInvestorInterest,
		SubCategory: &sub,
		Name:        name,
		Amount:      in.Amount,
		Mode:        in.Mode,
		Date:        in.Date,
		Remarks:     in.Remarks,
	})
	if err != nil {
		return nil, err
	}
	payout, err := s.repo.CreatePayoutTx(ctx, tx, in, expenseID, postedBy)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return payout, nil
}

// DeletePayout removes a payout and the expense it created, atomically.
// The parent investment is LOCKED first, for the same reason PayInterest locks
// it: deleting a payout lowers the paid total, which re-opens the payout
// ceiling. Without the lock a delete could commit between a concurrent
// payer's SumPaidTx read and its insert, letting the pair exceed the bound.
func (s *Service) DeletePayout(ctx context.Context, id int64) error {
	tx, err := s.repo.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	investmentID, err := s.repo.FindPayoutParentTx(ctx, tx, id)
	if err != nil {
		return err
	}
	if err := LockInvestmentForUpdate(ctx, tx, investmentID); err != nil {
		return err
	}
	if err := s.repo.DeletePayoutTx(ctx, tx, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Settle returns the capital and closes the investment. The principal is NOT
// posted as an expense: returning borrowed money is not a cost, and posting it
// would create a false spike in expense/profit reporting.
func (s *Service) Settle(ctx context.Context, id int64) (*domain.Investment, error) {
	inv, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	// Settle on today, never before the investment started (a same-day
	// settlement is valid; the DB CHECK enforces this too).
	on := s.now()
	if on.Before(inv.StartDate) {
		on = inv.StartDate
	}
	return s.repo.Settle(ctx, id, on.Format("2006-01-02"))
}

// Reopen undoes a settlement (an operator correction).
func (s *Service) Reopen(ctx context.Context, id int64) (*domain.Investment, error) {
	return s.repo.Reopen(ctx, id)
}

// Delete soft-deletes an investment. Its payouts go with it, but the EXPENSES
// they posted are deliberately kept: that money really did leave the business,
// so removing the expense would falsify spending history.
func (s *Service) Delete(ctx context.Context, id int64) error {
	return s.repo.SoftDelete(ctx, id)
}

// Totals is the portfolio roll-up backing the dashboard/page KPIs.
type Totals struct {
	Investors    int
	ActiveCount  int
	Capital      domain.Paise
	MonthlyOutgo domain.Paise
	InterestDue  domain.Paise
	InterestPaid domain.Paise
	OverdueCount int
}

// Totals computes the roll-up across ALL investments (not just a page), so the
// KPI figures never depend on pagination.
func (s *Service) Totals(ctx context.Context) (Totals, error) {
	// PAGE THROUGH every investment. A single Limit:maxLimit read silently
	// truncated at 500 and still reported the result as portfolio-wide, so past
	// 500 investors the dashboard showed wrong money with no error at all.
	var items []*domain.Investment
	for offset := 0; ; offset += maxLimit {
		page, total, err := s.repo.List(ctx, ListParams{Limit: maxLimit, Offset: offset})
		if err != nil {
			return Totals{}, err
		}
		items = append(items, page...)
		if len(page) == 0 || int64(len(items)) >= total {
			break
		}
	}
	ids := make([]int64, 0, len(items))
	for _, inv := range items {
		ids = append(ids, inv.ID)
	}
	paidBy, err := s.repo.SumPaidByInvestments(ctx, ids)
	if err != nil {
		return Totals{}, err
	}
	now := s.now()
	names := map[string]struct{}{}
	var t Totals
	for _, inv := range items {
		// Normalised like the frontend (trim + lowercase) so "Ravi Kumar",
		// "ravi kumar" and " Ravi Kumar " count as ONE investor on both sides.
		names[strings.ToLower(strings.TrimSpace(inv.InvestorName))] = struct{}{}
		t.InterestPaid += paidBy[inv.ID]
		if inv.Status != domain.InvestmentActive {
			continue
		}
		t.ActiveCount++
		t.Capital += inv.Principal
		per := inv.InterestPerCycle()
		if inv.Frequency == domain.PayoutMonthly {
			t.MonthlyOutgo += per
		} else {
			// ROUND, matching the frontend's Math.round(per/12). Integer division
			// truncated, so a yearly investor's monthly carry disagreed by up to
			// 11 paise — amplified 12x by the "annual cost" card.
			t.MonthlyOutgo += domain.Paise(math.Round(float64(per) / 12))
		}
		due := inv.InterestDue(paidBy[inv.ID], now)
		t.InterestDue += due
		if nd := inv.NextPayoutDate(paidBy[inv.ID], now); nd != nil && nd.Before(truncDay(now)) {
			t.OverdueCount++
		}
	}
	t.Investors = len(names)
	return t, nil
}

func truncDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}
