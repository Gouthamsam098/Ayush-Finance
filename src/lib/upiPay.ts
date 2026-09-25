import { config } from '@/lib/config';

export type UpiApp = 'phonepe' | 'gpay';

/** Rupees → UPI `am` param (two decimal places). */
export function upiAmountString(rupees: number): string {
  const n = Math.max(0, Math.round(rupees * 100) / 100);
  return n.toFixed(2);
}

function queryParams(opts: { amountRupees: number; note: string; payeeName?: string }) {
  const params = new URLSearchParams({
    pa: config.merchantUpiVpa,
    pn: opts.payeeName ?? config.merchantPayeeName,
    am: upiAmountString(opts.amountRupees),
    cu: 'INR',
    tn: opts.note.slice(0, 80),
  });
  return params.toString();
}

/** Deep link to open PhonePe or Google Pay with a pre-filled UPI payment. */
export function upiPayUrl(app: UpiApp, opts: { amountRupees: number; note: string; payeeName?: string }): string {
  const q = queryParams(opts);
  if (app === 'phonepe') return `phonepe://pay?${q}`;
  return `gpay://upi/pay?${q}`;
}

/** Generic UPI intent (any installed UPI app). */
export function upiPayUrlGeneric(opts: { amountRupees: number; note: string; payeeName?: string }): string {
  return `upi://pay?${queryParams(opts)}`;
}

export function openUpiApp(app: UpiApp, opts: { amountRupees: number; note: string; payeeName?: string }) {
  const url = upiPayUrl(app, opts);
  window.location.href = url;
}
