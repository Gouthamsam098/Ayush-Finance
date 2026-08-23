# Collection Ledger — Verified Working Baseline

**Status: ALL LOAN TYPES VERIFIED WORKING — 22 Aug 2026.**

This document records the exact behaviour that was confirmed working end-to-end by the
product owner. Treat it as the regression contract for the collection ledger: before
changing anything in `src/components/LedgerDialog.tsx`, the collection helpers in
`src/mock/DataContext.tsx`, or the profit/overdue logic in `src/pages/Dashboard.tsx`,
read this file, and after changing anything, re-verify every row of the matrix at the end.

Companion rules: `CLAUDE.md` (Collections, profit & ledger — binding rules) and
`DESIGN_RULES.md`. Where this file and an older comment disagree, **this file is current**.

---

## 1. The three economic behaviours

Six loan types collapse into three behaviours. Every ledger decision branches on these —
never on the raw type:

| Behaviour | Types | Predicate |
|---|---|---|
| **Daily Collection** | `DAILY_COLLECTION` | `isDailyLoan(type)` |
| **EMI** | `VEHICLE` / `PROPERTY` in Tenure mode | `behavesEmi(loan)` |
| **Interest-only** | `DAILY_INTEREST`, `MONTHLY_INTEREST`, `FLEXIBLE`, and `VEHICLE`/`PROPERTY` in `MONTHLY_INTEREST` mode | `behavesInterestOnly(loan)` |

`FLEXIBLE` additionally charges its **first cycle on the loan date itself** (`flexSameDay`)
and uses its own `numDays` cadence.

---

## 2. Payment allocation (the core rule)

Allocation decides which schedule row a payment funds. It is **display/attribution only** —
outstanding, collected, and profit are always amount-based sums and never read it.

### Priority order, applied per payment, in payment order (date, then id)

1. **Explicit target** — the schedule slot whose **Add** button was clicked, stored on the
   record as `target_due_date` (frontend `targetDate`).
2. **Receipt-date slot** — the slot due on the payment's own receipt date
   ("today's collection pays today"). **Scheduled loans only** (Daily Collection / EMI).
   Interest-only loans **skip this step** on purpose: their receipts routinely coincide with
   cycle dates, so applying it would silently re-arrange existing production ledgers.
3. **Oldest unpaid slot (FIFO)** — for the surplus and for any untargeted money.

Foreclosure-collapse (CLOSED loans) keeps **pure FIFO** for every type.

### Why a target is stored rather than inferred

Amount + date alone cannot express "pay this row". Several attempts to infer intent each
broke another flow; the worst booked cash received today onto tomorrow's date and corrupted
the dashboard. The target is now explicit data, and the **receipt date always stays the day
the money actually arrived** — see `receipt-date-rule-absolute` in memory.

### Allocation horizon

The scan extends far enough to cover **every stored target**, including targets on future
slots. Without this, a target pointing past the visible range was silently dropped and its
money FIFO-fell onto an older day.

---

## 3. How payments are written

| Flow | Records written |
|---|---|
| Add on a row (single day) | **One** record, targeted at that day |
| Add spanning several days | **One record per funded day**, each with its own target |
| Advance beyond the visible schedule | Each future day gets its own targeted record; anything past the loan term is one untargeted remainder |
| Clear Overdue | **One** bulk receipt (prefill = overdue **+ today's pending**), untargeted |
| Foreclose / Settle & close | **One** record (interest-only settles as an INTEREST + PRINCIPAL pair) — never split, the collapse view depends on it |
| Interest-only PRINCIPAL settlement | **One** record; never funds cycle rows |

**Why per-day records:** a single record funding several rows made every one of those rows
share one pencil, so editing one day silently changed another. One record per day makes each
row independently editable.

---

## 4. Row status, colours, and actions

### Status

- `Paid` — funded in full
- `Partial` — funded in part
- `Overdue` — unfunded, due date **before** today
- `Next due` — unfunded, due today or later
- `Settled` — the foreclosure payoff row

### Colours (badge + left border)

| Display | Meaning |
|---|---|
| **Green — Paid** | Funded on or before its due date |
| **Violet — Paid late** | Fully funded, but the money arrived **after** the due date |
| **Yellow — Partial** | Part-paid — always yellow, on time or late |
| **Red — Overdue** | Unfunded and past due |
| **Blue — Next due** | The single actionable upcoming row |

### Actions

| Row status | Actions |
|---|---|
| Paid / Paid late | **edit pencil** |
| Partial | **Add only** (its pending is collected as a NEW receipt — the correct money trail) |
| Overdue / Next due | **Add only** |
| Settled | **edit pencil** (no Add exists, so this is the only way to correct a payoff) |
| View-only user (`canEdit('Collections')` false) | — |

### Rows rendered

Every elapsed slot + every funded slot (paid-ahead stays visible) + **exactly one** upcoming
`Next due`. The upcoming row is appended **only** when no rendered slot due today-or-later is
still collectable — otherwise today's unpaid slot already *is* the next due and appending
another would show two. CLOSED loans collapse to regular-funded rows plus one `Settled` row.

---

## 5. Editing

- **Day funded by ONE receipt** → normal edit form (amount, mode, date, remarks).
- **Day funded by SEVERAL receipts** → **day-edit mode** ("Edit day collection"): the form
  edits the **day's total**.
  - Lowering trims the **newest** receipts first, deleting emptied ones — every kept receipt
    keeps its own receipt date, so daily cash stays truthful.
  - Raising records the difference as **one new receipt dated today**, pinned to that day.
  - Capped at the day's scheduled due.
  - The date field is hidden (each receipt keeps its own date).

---

## 6. Amount validation (layered, strictest first)

Enforced live under the field **and** on save; the input itself is capped at 12 characters.

1. Positive
2. Whole rupees
3. ≤ **₹10 crore** (mirrors backend `maxPrincipalPaise`; also guards JS float precision)
4. Day-edit: ≤ the day's due
5. Regular add: ≤ the loan's **outstanding**

Exempt from (5): **foreclosure/settlement** (prefills exactly the outstanding) and
**record edits** (corrections — their money is already inside "collected").

While the amount is invalid, the allocation preview and the "extra clears overdue" banner
are hidden.

---

## 7. Header figures and buttons

- **Clear Overdue** = unpaid **overdue + today's pending**. Today is included because the
  receipt is dated today and allocation funds today's slot first; excluding it left the last
  day unpaid.
- **Settle & close** (interest-only) = remaining principal + **the ledger's own unpaid
  cycles**. It must **not** use `totalDueForInterestOnly`, which nets accrued interest
  against *all* interest collected — advance-paid cycles then cancel genuinely unpaid older
  ones, it reports ₹0, and settling would close the loan while writing off real arrears.
- **Overdue card** (interest-only header) = the ledger's own overdue total, so the header,
  Clear Overdue, Settle & close, and the rows below always agree.
- **Collection Progress** (Daily Collection) = schedule **days elapsed** by today
  (calendar), not amounts collected.

---

## 8. Dashboard interactions

- **Overdue detection** (`isOverdue` → `nextDueFor`): funded slots/cycles are **capped at
  what has actually accrued**. Without the cap, advance payments pushed the next due past
  still-unpaid slots and a loan in arrears vanished from the overdue list entirely.
- **Due Amount** (`dueFor`) dispatches by **behaviour**, not "daily vs everything else":
  interest-only → `totalDueForInterestOnly`, daily → `totalDueForDaily`, EMI →
  `totalDueForMonthly`.
- **Profit** (`profitByCollectionId`) is unchanged by any of the above: interest-only
  recognises every non-PRINCIPAL payment in full; upfront/EMI uses the profit-last band
  `(disbursed, disbursed + margin]`. Allocation never feeds profit.

> **Known lock-step gap (not yet done):** `nextDueFor` is mirrored in
> `backend/internal/domain/loan.go` (`Loan.NextDue`), which feeds payment-date validation and
> the loan list. The accrual cap described above was applied on the **frontend only**, so the
> two can disagree for a loan that is simultaneously in arrears *and* paid ahead. Apply the
> same cap backend-side (with Go tests) when that flow is next touched.

---

## 9. Backend contract

- `collections.target_due_date DATE NULL` — migration
  `0003_collection_target_due.up.sql`. Attribution only; **never** part of balance math.
  NULL = untargeted (bulk, foreclosure, legacy) → falls back to the receipt-date rule.
- Validation: a target may not precede the loan date. Amount ≤ ₹10 crore, whole rupees.
- `Update` deliberately does **not** change a stored target — it is set at creation.
- Recording a payment stays atomic and idempotent (transaction + row lock +
  `Idempotency-Key`); see `idempotency_contract_test.go`.

---

## 10. Regression matrix — re-verify ALL of it after any ledger change

Run for **each** behaviour (Daily Collection, EMI, Interest-only incl. Flexible):

| # | Scenario | Expected |
|---|---|---|
| 1 | Normal cadence payment | Funds its own day, green Paid |
| 2 | Partial payment | Yellow Partial, **Add only**, no pencil |
| 3 | Top up a Partial via Add | Becomes Paid; a NEW receipt is written |
| 4 | Bulk / advance payment | One record per funded day; future days pinned; exactly one Next due |
| 5 | Payment recorded AFTER a bulk | Defaults to today, does not re-date the bulk |
| 6 | Add on an overdue row | That row funds first; surplus to oldest unpaid |
| 7 | Add on the next-due row | That row funds first; receipt stays dated today |
| 8 | Overdue cleared later | Violet **Paid late** |
| 9 | Edit a Paid row | Only that day changes |
| 10 | Edit a day funded by several receipts | Day-edit mode; trims newest first; other days untouched |
| 11 | Clear Overdue | Overdue + today cleared; loan stays ACTIVE |
| 12 | Foreclosure / Settle & close | Includes arrears; collapse renders one Settled row; loan CLOSED |
| 13 | Over-limit amount | Inline error + save blocked |
| 14 | Dashboard | Loan appears in Overdue with the right Due Amount; profit lands in the receipt's month |
| 15 | View-only user | No Add / edit / Clear Overdue / Foreclose |

Then run **`npm run build`**, and if the backend was touched,
**`go build ./... && go test ./...`** from `backend/`.
