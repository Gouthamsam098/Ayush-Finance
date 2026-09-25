# Demo recovery auto-assign (overdue loans)

**Scope:** Demo recovery agents (`mockUsers` + `localStorage` assignments). Runs with **API or mock loans** as long as the loan book is loaded and at least one active recovery agent exists.

## What it does

Once per **local calendar day** (first app load after midnight, or at **00:00** while a tab is open):

1. Finds **ACTIVE** loans with scheduled shortfall **&gt; 0** (same rule as Collections / agent cards: `recoveryDueNow`).
2. Loads **active** `RECOVERY_AGENT` users from demo Settings (`mockUsers`).
3. **Keeps** each overdue loan on its current agent if that agent is still active (sticky).
4. Assigns any other overdue loan (unassigned or on inactive agent) to the agent with the **fewest** overdue loans (tie-break: lower user id).
5. Does **not** remove non-overdue loans from agents; does **not** move sticky overdue loans for rebalancing.
6. Does **not** exclude loans with pending recovery claims or open promise-to-pay.

Assignments are stored in `localStorage` key `anush.recovery.assignments` (unchanged from manual Settings assign).

## Working flow (manual test)

1. **Recovery agent(s)** in Settings (demo role). **Loans** loaded (mock book or sign in with `VITE_USE_API=true` and wait for sync).
2. **Data:** At least one **ACTIVE** overdue loan and **two** active recovery agents (Settings → Add User → Recovery agent; assign loans optional).
3. **Clear today’s run** (optional): DevTools → Application → Local Storage → delete `anush.recovery.lastAutoAssignDate`.
4. **Run:** Settings → **Run now** under “Demo recovery auto-assign”, or reload the app (auto-run if not yet run today).
5. **Verify:**
   - **Collections** portfolio cards show **Recovery · {agent}** on overdue loans.
   - Log in as each agent → **Collections** shows only their assigned overdue (and any non-overdue you left on them).
6. **Sticky:** Run again the same day with **Run now** (force) — assignments should not shuffle if agents unchanged.
7. **Next day:** Change system date or delete `lastAutoAssignDate`, reload — new unassigned overdue loans get balanced; existing overdue stay on the same agent.

## Midnight / “cron” behaviour

There is **no OS cron** in demo mode (data lives in the browser).

| Trigger | When it runs |
|--------|----------------|
| App load | After today’s scheduled time, if this slot has not run yet |
| Timer | Next **test time** (Settings) or **local midnight** while a tab stays open |
| Tab visible again | Catch-up after scheduled time if still due |
| Settings **Run now** | Force run (ignores once-per-day) |

### Testing schedule (user-set)

1. **Settings → Demo recovery auto-assign → Test schedule** — pick a local **HH:MM** → **Save schedule**.
2. Keep this tab open; watch **Next automatic run** countdown.
3. At that time, assignments update without **Run now**.
4. Change the time and save again to test another slot the same day (each `date|HH:MM` runs once).
5. **Clear** returns to midnight.

Optional default: `VITE_RECOVERY_AUTO_ASSIGN_TEST_TIME=14:30` in `.env.local` (Settings overrides in localStorage).

For **00:00 IST** with no test time, use system timezone **Asia/Kolkata**.

To run without anyone logged in, you would need a future **server-side** job (not part of this demo feature).

## Algorithm self-check

```bash
npx tsx scripts/recovery-auto-assign-selftest.ts
```

## Files

| File | Role |
|------|------|
| `src/features/recovery/autoAssignOverdueLoans.ts` | Pure balance logic |
| `src/features/recovery/recoveryAutoAssign.ts` | Demo runner + midnight helper |
| `src/features/recovery/RecoveryContext.tsx` | Schedules run in demo mode |
| `src/pages/Settings.tsx` | Admin **Run now** + last-run date |
