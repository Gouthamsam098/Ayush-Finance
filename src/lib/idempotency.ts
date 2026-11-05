/**
 * Idempotency keys that survive a failed attempt.
 *
 * A fresh key per HTTP call protects nothing: when a money write's response is
 * lost (timeout, dropped connection, a 502 from the proxy after the server had
 * already committed) the user presses Save again, a new key is minted, and the
 * server records the payment a second time.
 *
 * So the key belongs to the write's CONTENT: the same payload sent again after
 * an UNCERTAIN failure reuses its key, and the server answers with the record it
 * already made. A CERTAIN outcome — success, or a 4xx the server rejected
 * (nothing written) — forgets the key, so a genuinely new identical payment
 * later gets a fresh one.
 */
import { ApiError } from '@/lib/api';

/** crypto.randomUUID is unavailable on older Safari and on non-secure origins,
 *  so fall back to random+timestamp — uniqueness is all that is required (the
 *  key is never a secret). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Keys of writes whose outcome is unknown, by content fingerprint. */
const uncertain = new Map<string, { key: string; at: number }>();
/** How long an unconfirmed write keeps its key (a retry after this is a new write). */
const KEEP_MS = 30 * 60 * 1000;

/**
 * Run `send` with an Idempotency-Key tied to (`scope`, `payload`). Two identical
 * payloads in flight at once share one key too, so a double submit lands once.
 */
export async function withRetrySafeKey<T>(scope: string, payload: unknown, send: (key: string) => Promise<T>): Promise<T> {
  const now = Date.now();
  for (const [fp, e] of uncertain) if (now - e.at > KEEP_MS) uncertain.delete(fp);
  const fp = `${scope}|${JSON.stringify(payload)}`;
  const key = uncertain.get(fp)?.key ?? newIdempotencyKey();
  uncertain.set(fp, { key, at: now });
  try {
    const out = await send(key);
    uncertain.delete(fp);
    return out;
  } catch (e) {
    // The server answered "no" (validation, conflict, permission): nothing was
    // written, so a corrected retry is a new write. Network errors and 5xx keep
    // the key — the write may have landed.
    if (e instanceof ApiError && e.status < 500) uncertain.delete(fp);
    throw e;
  }
}
