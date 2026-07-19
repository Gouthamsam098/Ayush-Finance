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
export const fmtDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const initials = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
