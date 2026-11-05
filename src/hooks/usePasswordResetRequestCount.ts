import { useEffect, useState } from 'react';
import { config } from '@/lib/config';
import { userApi } from '@/services/userApi';
import { PASSWORD_RESET_REQUESTS_CHANGED_EVENT } from '@/lib/dataEvents';

/** How often an admin's sidebar re-checks for new "Forgot password?" requests. */
const POLL_MS = 60_000;

/**
 * Number of open "Forgot password?" requests, for the Settings nav badge, so an
 * admin notices one without opening Settings. Admin-only (so is the endpoint);
 * refreshed every minute and immediately when Settings resolves or dismisses one.
 * Best-effort: a failed check keeps the last count — Settings shows the real list.
 */
export function usePasswordResetRequestCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled || !config.useApi) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      userApi.passwordResetRequests()
        .then((rows) => { if (!cancelled) setCount(rows.length); })
        .catch(() => { /* keep the last count */ });
    };
    refresh();
    const timer = window.setInterval(refresh, POLL_MS);
    window.addEventListener(PASSWORD_RESET_REQUESTS_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(PASSWORD_RESET_REQUESTS_CHANGED_EVENT, refresh);
    };
  }, [enabled]);
  return count;
}
