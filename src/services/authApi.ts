/**
 * Auth API calls mapped to the backend's /api/v1/auth endpoints.
 * Login and refresh are unauthenticated; /me uses the stored access token.
 */

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

export const authApi = {
  /** Authenticate and persist the returned token pair. */
  async login(email: string, password: string): Promise<void> {
    const tokens = await api.post<TokenResponse>(
      '/auth/login',
      { email, password },
      { auth: false },
    );
    tokenStore.set(tokens.access_token);
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
    await api.post('/me/password', { current_password: currentPassword, new_password: newPassword });
  },

  /** Fetch the current user; used to restore a session on page reload. */
  async me(): Promise<BackendUser> {
    return api.get<BackendUser>('/me');
  },

  /** Discard local tokens. (Server-side revocation is a later hardening step.) */
  logout(): void {
    tokenStore.clear();
  },
};
