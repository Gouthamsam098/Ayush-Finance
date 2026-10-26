/**
 * Password-change rules — the same ones the server enforces
 * (backend domain.PasswordChangeInput), shared by every form that changes a
 * password so they cannot drift apart:
 *   at least 8 CHARACTERS · at most 72 BYTES (bcrypt's limit) ·
 *   different from the current one · confirmation must match.
 */
export const PASSWORD_MIN_CHARS = 8;
export const PASSWORD_MAX_BYTES = 72;

export interface PasswordChangeErrors {
  current?: string;
  next?: string;
  confirm?: string;
}

export function validatePasswordChange(current: string, next: string, confirm: string): PasswordChangeErrors {
  const e: PasswordChangeErrors = {};
  if (!current) e.current = 'Enter your current password';
  const chars = [...next].length; // code points — the server counts runes
  const bytes = new TextEncoder().encode(next).length;
  if (chars < PASSWORD_MIN_CHARS) e.next = `Password must be at least ${PASSWORD_MIN_CHARS} characters`;
  else if (bytes > PASSWORD_MAX_BYTES) e.next = 'Password is too long (at most 72 bytes; fewer if it uses non-English letters)';
  else if (current && next === current) e.next = 'Choose a password different from your current one';
  if (!e.next && confirm !== next) e.confirm = 'Passwords do not match';
  return e;
}

/** The server's field errors, mapped onto the same form fields. */
export function passwordChangeServerErrors(fields?: Record<string, string>): PasswordChangeErrors {
  return { current: fields?.current_password, next: fields?.new_password };
}
