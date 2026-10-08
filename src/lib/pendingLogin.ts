/**
 * Holds a half-finished login while the user completes TOTP (sessionStorage — tab scoped).
 */

import type { MockUser } from '@/lib/mockUsers';
import type { BackendUser } from '@/services/authApi';

const PENDING_KEY = 'anush.auth.pending2fa';
const TOKEN_KEY = 'anush.auth.pending2fa.token';

export interface PendingLogin {
  email: string;
  mode: 'mock' | 'api';
  mockUser?: MockUser;
  apiUser?: BackendUser;
}

export function setPendingLogin(pending: PendingLogin, apiAccessToken?: string): void {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  if (apiAccessToken) {
    sessionStorage.setItem(TOKEN_KEY, apiAccessToken);
  }
}

export function getPendingLogin(): PendingLogin | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingLogin) : null;
  } catch {
    return null;
  }
}

export function getPendingApiToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function clearPendingLogin(): void {
  sessionStorage.removeItem(PENDING_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}
