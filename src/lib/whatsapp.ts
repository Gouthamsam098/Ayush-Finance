import { config } from '@/lib/config';

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** Normalise an Indian mobile to E.164 digits without '+' for WhatsApp (wa.me). */
export function whatsappDigits(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, '');
  if (digits.length < 10) return null;

  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  if (digits.length === 12 && digits.startsWith('91')) {
    const local = digits.slice(2);
    return INDIAN_MOBILE.test(local) ? digits : null;
  }

  if (digits.length === 10 && INDIAN_MOBILE.test(digits)) return `91${digits}`;

  // +91 / spaces / separators — keep the last valid 10-digit Indian mobile.
  if (digits.length > 10) {
    const last10 = digits.slice(-10);
    if (INDIAN_MOBILE.test(last10)) return `91${last10}`;
  }

  return null;
}

/** Best available mobile for WhatsApp: loan contact, then customer primary, then alt. */
export function resolveCustomerMobile(
  loan: { contact?: string | null },
  customer?: { mobile?: string | null; altMobile?: string | null } | null,
): string {
  for (const candidate of [loan.contact, customer?.mobile, customer?.altMobile]) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed && whatsappDigits(trimmed)) return trimmed;
  }
  return '';
}

/** wa.me deep link — opens the WhatsApp app on mobile or WhatsApp Web on desktop. */
export function whatsappHref(raw: string, message: string): string | null {
  const digits = whatsappDigits(raw);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Public URL included in payment-request messages (env override, else current origin). */
export function statementPortalUrl(): string {
  const fromEnv = config.statementPortalUrl?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return '';
}

/** Premium plain-text payment request for Collections → Share (WhatsApp).
 *  WhatsApp supports *bold* and emoji only — no images or link cards in the body. */
export function paymentRequestMessage(opts: {
  customerName: string;
  amountLabel: string;
}): string {
  const name = opts.customerName.trim() || 'Customer';
  return [
    '💳 *Payment Request*',
    '',
    `Hi *${name}*,`,
    '',
    '*Anush Finserv* has requested a payment of:',
    '',
    `💰 *${opts.amountLabel}*`,
    '',
    'Please clear the outstanding amount at your earliest convenience.',
    '',
    'If you have already made the payment, kindly ignore this message.',
    '',
    'Thank you for your continued trust. 🙏',
    '',
    '🔵 *Anush Finserv*',
  ].join('\n');
}
