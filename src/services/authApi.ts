/**
 * Auth API calls mapped to the backend's /api/v1/auth endpoints.
 * Login and refresh are unauthenticated; /me uses the stored access token.
 */

import { config } from '@/lib/config';
import { clearCachedCustomerPhotos } from '@/lib/customerPhoto';
import { api } from '@/lib/api';
import { tokenStore } from '@/lib/tokenStore';

interface TokenResponse {
  access_token: string;
  // refresh_token is omitted by the backend in hard-session mode.
  refresh_token?: string;
  token_type: string;
}

export interface BackendUser {
  id: number;
  email: string;
  full_name: string;
  role: 'ADMIN' | 'VIEWER' | 'CUSTOMER' | 'RECOVERY_AGENT';
  permissions: Record<string, 'none' | 'view' | 'edit'>;
  mfa_enabled: boolean;
  /** Set only for a CUSTOMER portal login: the customer record it belongs to. */
  customer_id?: number;
}

/** A successful password step: signed in, or (two-factor on) a code is needed next. */
export type LoginOutcome = { mfaRequired: false } | { mfaRequired: true; mfaToken: string };

export const authApi = {
  /**
   * Check the password. Without two-factor the session starts (token stored);
   * with it, nothing is stored yet and the caller sends the code to loginMfa.
   */
  async login(email: string, password: string): Promise<LoginOutcome> {
    const res = await api.post<TokenResponse & { mfa_required?: boolean; mfa_token?: string }>(
      '/auth/login',
      { email, password },
      { auth: false },
    );
    if (res.mfa_required && res.mfa_token) return { mfaRequired: true, mfaToken: res.mfa_token };
    tokenStore.set(res.access_token);
    return { mfaRequired: false };
  },

  /** Second login step: the authenticator code, checked by the server. */
  async loginMfa(mfaToken: string, code: string): Promise<void> {
    const tokens = await api.post<TokenResponse>(
      '/auth/login/mfa',
      { mfa_token: mfaToken, code },
      { auth: false },
    );
    tokenStore.set(tokens.access_token);
  },

  /** Start two-factor setup: the server makes the secret (shown + drawn as a QR here). */
  async mfaSetup(): Promise<{ secret: string; otpauthUri: string }> {
    const r = await api.post<{ secret: string; otpauth_uri: string }>('/me/mfa/setup', {});
    return { secret: r.secret, otpauthUri: r.otpauth_uri };
  },

  async mfaEnable(code: string): Promise<void> {
    await api.post('/me/mfa/enable', { code });
  },

  async mfaDisable(code: string): Promise<void> {
    await api.post('/me/mfa/disable', { code });
  },

  /** "Forgot password?" — asks an administrator to reset the account. Public.
   *  Resolves with the server's message, which is the same whether or not the
   *  email has an account (the form must never reveal that). */
  async requestPasswordReset(email: string): Promise<string> {
    const res = await api.post<{ message: string }>('/auth/password-reset-requests', { email }, { auth: false });
    return res.message;
  },

  /** Login page "Forgot password?" for someone who knows their current password:
   *  email + current password prove who they are (exactly like login), then the
   *  new one is saved. Not signed in, so no token; a wrong email or password is
   *  a 401 with the same message as login. */
  async changePasswordWithCredentials(email: string, currentPassword: string, newPassword: string): Promise<void> {
    await api.post('/auth/change-password',
      { email, current_password: currentPassword, new_password: newPassword },
      { auth: false });
  },

  /** The signed-in user changes their OWN password; the current one is checked
   *  on the server. A wrong current password comes back as a field error
   *  (`current_password`), never 401, so the session is not ended. */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    // The change ends every earlier session (other devices included); this one
    // continues on the fresh token the server returns.
    const tokens = await api.post<TokenResponse | null>('/me/password', {
      current_password: currentPassword, new_password: newPassword,
    });
    if (tokens?.access_token) tokenStore.set(tokens.access_token);
  },

  /** Fetch the current user; used to restore a session on page reload. */
  async me(): Promise<BackendUser> {
    return api.get<BackendUser>('/me');
  },

  /** Discard local tokens and cached customer photos. (Server-side revocation
   *  is a later hardening step.) */
  logout(): void {
    tokenStore.clear();
    if (config.useApi) clearCachedCustomerPhotos();
  },
};
