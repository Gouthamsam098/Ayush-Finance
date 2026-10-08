/**
 * RFC 6238 TOTP (Google Authenticator compatible) — browser-only, no backend.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return base32Encode(bytes);
}

export function buildOtpAuthUri(email: string, secret: string, issuer = 'Anush LMS'): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const q = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

export function qrCodeImageUrl(otpauthUri: string, size = 200): string {
  return `https://quickchart.io/qr?size=${size}&margin=2&text=${encodeURIComponent(otpauthUri)}`;
}

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/g, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(counter), false);

  const keyMaterial = new Uint8Array(secret);
  const key = await crypto.subtle.importKey('raw', keyMaterial, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24)
    | ((sig[offset + 1] & 0xff) << 16)
    | ((sig[offset + 2] & 0xff) << 8)
    | (sig[offset + 3] & 0xff);
  return String(bin % 1_000_000).padStart(6, '0');
}

export async function totpForStep(secretBase32: string, timeStep: number): Promise<string> {
  return hotp(base32Decode(secretBase32), timeStep);
}

/** Verify a 6-digit code with ±1 time-step window (90s). */
export async function verifyTotpCode(secretBase32: string, code: string): Promise<boolean> {
  const normalized = code.replace(/\D/g, '');
  if (normalized.length !== 6) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    const expected = await totpForStep(secretBase32, step + w);
    if (expected === normalized) return true;
  }
  return false;
}
