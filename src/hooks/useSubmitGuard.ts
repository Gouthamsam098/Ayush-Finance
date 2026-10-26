import { useCallback, useRef, useState } from 'react';

/**
 * One in-flight submit at a time, for buttons that write money or records.
 *
 * `busy` drives the button's loading/disabled state; the ref is what actually
 * blocks the second click — React state only lands on the next render, so two
 * clicks dispatched in one frame would both read `busy === false` and both post.
 */
export function useSubmitGuard() {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<void> | void) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
