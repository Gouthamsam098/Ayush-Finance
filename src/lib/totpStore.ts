/**
 * Per-user Google Authenticator secrets (localStorage only until backend MFA ships).
 * Keyed by normalized email.
 */

const STORE_KEY = 'anush.totp.v1';

export interface TotpEnrollment {
  secret: string;
  enabled: boolean;
  enabledAt?: string;
}

type Store = Record<string, TotpEnrollment>;

function read(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function normalizeTotpEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getTotpEnrollment(email: string): TotpEnrollment | null {
  const key = normalizeTotpEmail(email);
  const row = read()[key];
  if (!row?.secret) return null;
  return row;
}

export function isTotpEnabled(email: string): boolean {
  const row = getTotpEnrollment(email);
  return Boolean(row?.enabled && row.secret);
}

export function saveTotpPending(email: string, secret: string): void {
  const key = normalizeTotpEmail(email);
  const store = read();
  store[key] = { secret, enabled: false };
  write(store);
}

export function enableTotp(email: string): void {
  const key = normalizeTotpEmail(email);
  const store = read();
  const row = store[key];
  if (!row?.secret) return;
  store[key] = { ...row, enabled: true, enabledAt: new Date().toISOString() };
  write(store);
}

export function disableTotp(email: string): void {
  const key = normalizeTotpEmail(email);
  const store = read();
  delete store[key];
  write(store);
}

export function getTotpSecret(email: string): string | null {
  return getTotpEnrollment(email)?.secret ?? null;
}
