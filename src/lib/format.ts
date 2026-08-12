export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const inrShort = (n: number) =>
  n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr'
  : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L'
  : '₹' + Math.round(n).toLocaleString('en-IN');
/** Fallback term (days) for a Daily Collection loan when principal/daily aren't
 *  both known yet (e.g. an old record with no daily amount). Real term derives
 *  from the money — see dailyCollectionTerm. */
export const DAILY_TERM = 100;
/** Daily Collection term = number of days to repay the full principal at the
 *  chosen daily amount = ceil(principal ÷ daily). Returns 0 if daily is unset. */
export const dailyCollectionTerm = (principal: number, daily: number) =>
  daily > 0 ? Math.ceil(principal / daily) : 0;
/** Format a Date as a local-calendar YYYY-MM-DD string (no UTC shift). */
export const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayISO = () => isoLocal(new Date());
/** Add n days to a YYYY-MM-DD string using local-calendar arithmetic (handles month overflow, no UTC shift). */
export const addDays = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return isoLocal(new Date(y, m - 1, d + n));
};
/** Add n calendar months to a YYYY-MM-DD string, then add a day offset (0 = same day-of-month).
 *  Clamps day when the target month has fewer days (e.g. Jan 31 + 1mo → Feb 28). */
export const addMonths = (iso: string, months: number, dayOffset = 0) => {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1 + months, d);
  const expectedMonth = ((m - 1 + months) % 12 + 12) % 12;
  if (target.getMonth() !== expectedMonth) target.setDate(0);
  return dayOffset ? isoLocal(new Date(target.getFullYear(), target.getMonth(), target.getDate() + dayOffset)) : isoLocal(target);
};
export const fmtDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const initials = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
