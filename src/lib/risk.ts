/**
 * Overdue risk banding — one definition, shared by the dashboard's Overdue
 * Loans card and its full-list dialog.
 *
 * Risk is DERIVED from days overdue and nothing else; it is a presentation
 * band, not a stored field, so it must never be persisted or sent to the API.
 * These lived in `Dashboard.tsx` until the dialog needed them too — two copies
 * of the thresholds would eventually disagree about what "High" means, and the
 * card and the dialog would then colour the same loan differently.
 */

export type Risk = 'High Risk' | 'Medium Risk' | 'Low Risk';

export const riskFor = (days: number): Risk =>
  (days > 20 ? 'High Risk' : days > 10 ? 'Medium Risk' : 'Low Risk');

/** The row's risk pill. */
export const RISK_PILL: Record<Risk, string> = {
  'High Risk': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  'Medium Risk': 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Low Risk': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

/** Avatar tint per risk band — softer than the pill (it sits behind initials, so
 *  it must not fight the name for attention) but in the same hue family, so the
 *  row's severity is legible from the left edge. */
export const AVATAR_TINT: Record<Risk, string> = {
  'High Risk': 'bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300',
  'Medium Risk': 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  'Low Risk': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
};
