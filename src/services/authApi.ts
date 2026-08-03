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
  role: 'ADMIN' | 'VIEWER';
  permissions: Record<string, 'none' | 'view' | 'edit'>;
  mfa_enabled: boolean;
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

  /** Fetch the current user; used to restore a session on page reload. */
  async me(): Promise<BackendUser> {
    return api.get<BackendUser>('/me');
  },

  /** Discard local tokens. (Server-side revocation is a later hardening step.) */
  logout(): void {
    tokenStore.clear();
  },
};
