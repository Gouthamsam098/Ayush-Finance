/**
 * Single place that owns where the auth token lives in the browser.
 *
 * The session is a hard 1-hour access token with no refresh, so only the
 * access token is stored. It uses localStorage so the session survives a page
 * refresh (until the token expires). This is deliberately the ONLY module that
 * touches the storage mechanism: moving to httpOnly cookies or DB-backed
 * sessions later changes only this file, not its callers.
 */

const ACCESS_KEY = 'anush.access_token';

export const tokenStore = {
  /** The current access token, or null if there is no active session. */
  get(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },

  set(accessToken: string): void {
    localStorage.setItem(ACCESS_KEY, accessToken);
  },

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
  },
};
