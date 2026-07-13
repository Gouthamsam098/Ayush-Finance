/**
 * Frontend runtime configuration, read from Vite env vars.
 *
 * USE_API is the master switch for backend integration. When false (default),
 * the app runs entirely on the in-memory mock data in DataContext, so nothing
 * breaks while the backend is still being built out feature by feature. When
 * true, wired features call the real Go backend through the /api proxy.
 */

export const config = {
  /** Flip to true (VITE_USE_API=true) to use the real backend. */
  useApi: import.meta.env.VITE_USE_API === 'true',
  /** Base path for API calls; the Vite dev server proxies /api -> :4000. */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL as string) || '/api/v1',
};
