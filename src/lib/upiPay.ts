export type UpiApp = 'phonepe' | 'gpay';

/** Where the portal is open — decides which kind of app link works. */
export type UpiPlatform = 'android' | 'ios' | 'desktop';

export interface UpiPayCredentials {
  payeeVpa: string;
  payeeName: string;
}

/** Rupees → UPI `am` param (two decimal places). */
export function upiAmountString(rupees: number): string {
  const n = Math.max(0, Math.round(rupees * 100) / 100);
  return n.toFixed(2);
}

/** UPI query string. Values are percent-encoded (spaces → %20): URLSearchParams
 *  writes spaces as "+", which UPI apps can show literally ("Anush+Finserv"). */
function queryParams(opts: { amountRupees: number; note: string; payeeVpa: string; payeeName: string }) {
  const params: [string, string][] = [
    ['pa', opts.payeeVpa],
    ['pn', opts.payeeName],
    ['am', upiAmountString(opts.amountRupees)],
    ['cu', 'INR'],
    ['tn', opts.note.slice(0, 80)],
  ];
  // "@" stays readable (pa=name@bank, as in NPCI's examples); it is legal in a
  // query string and some apps parse the UPI ID strictly.
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&');
}

/** Best guess at the device from the browser. iPadOS reports itself as a Mac,
 *  so a touch-screen "Mac" is treated as iOS. */
export function detectUpiPlatform(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0,
): UpiPlatform {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1)) return 'ios';
  return 'desktop';
}

/** Android package names, so the link opens exactly the app that was tapped. */
const ANDROID_PACKAGE: Record<UpiApp, string> = {
  phonepe: 'com.phonepe.app',
  gpay: 'com.google.android.apps.nbu.paisa.user',
};

/**
 * Link that opens PhonePe or Google Pay with the payment pre-filled.
 *  • Android: an intent:// link (a upi://pay intent aimed at the app's package).
 *    `gpay://` is iOS-only — on Android it opened nothing. If the app is not
 *    installed, Android shows its Play Store page.
 *  • iOS: each app's own scheme.
 *  • Desktop has no UPI apps; callers show other options instead of navigating.
 */
export function upiPayUrl(
  app: UpiApp,
  opts: { amountRupees: number; note: string; payeeVpa: string; payeeName: string },
  platform: UpiPlatform = detectUpiPlatform(),
): string {
  const q = queryParams(opts);
  if (platform === 'android') return `intent://pay?${q}#Intent;scheme=upi;package=${ANDROID_PACKAGE[app]};end`;
  if (app === 'phonepe') return `phonepe://pay?${q}`;
  return `gpay://upi/pay?${q}`;
}

/** Generic UPI intent (any installed UPI app). */
export function upiPayUrlGeneric(opts: { amountRupees: number; note: string; payeeVpa: string; payeeName: string }): string {
  return `upi://pay?${queryParams(opts)}`;
}

/** Open the app from a tap. Done through a temporary link click (not by
 *  assigning location) — the form browsers expect for handing off to an app. */
export function openUpiApp(
  app: UpiApp,
  opts: { amountRupees: number; note: string; payeeVpa: string; payeeName: string },
) {
  const a = document.createElement('a');
  a.href = upiPayUrl(app, opts);
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
