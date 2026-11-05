import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** A chunk that no longer exists on the server — the usual cause is a deploy
 *  while the tab was open (index.html references the new hashed bundles, the
 *  open tab still asks for the old ones). Reloading fetches the new build. */
const isChunkLoadError = (e: unknown) =>
  e instanceof Error &&
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed/i.test(
    `${e.name} ${e.message}`,
  );

const RELOAD_KEY = 'anush:chunk-reload-at';

/** Reload at most once per minute for a missing chunk, so a genuinely broken
 *  build shows the error card instead of reloading forever. Storage can be
 *  unavailable (private mode) — then no automatic reload. */
function reloadOnceForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

interface Props {
  children: ReactNode;
  /** Full-screen card (the app shell itself failed) vs. inside the content area. */
  fullScreen?: boolean;
}

interface State {
  error: Error | null;
  reloading: boolean;
}

/**
 * Catches a render error so one broken page cannot blank the whole app. Nothing
 * is written on the way here — a render error never saves or loses data — and
 * the card says so, because "did my payment go through?" is the first question.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error) && reloadOnceForNewBuild()) {
      this.setState({ reloading: true });
      return;
    }
    // Kept in the browser console for support; no data leaves the device.
    console.error('Page failed to render', error, info.componentStack);
  }

  private retry = () => this.setState({ error: null, reloading: false });

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    const newBuild = isChunkLoadError(error);
    return (
      <div className={cn('grid place-items-center px-4', this.props.fullScreen ? 'min-h-dvh bg-surface' : 'min-h-[60vh]')}>
        <div
          role="alert"
          className="w-full max-w-md rounded-card border border-slate-200 bg-surface p-6 text-center shadow-card dark:border-white/[.08]"
        >
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-danger/10 text-danger">
            <AlertTriangle size={22} aria-hidden />
          </div>
          <h2 className="text-base font-bold tracking-tight text-ink">
            {reloading ? 'Loading the latest version…' : newBuild ? 'A new version is available' : 'This page could not be displayed'}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            {newBuild
              ? 'The app was updated while this tab was open. Reload to continue — nothing you saved is affected.'
              : 'Something went wrong while showing this page. Nothing was saved or changed by this error. Try again, or reload the page.'}
          </p>
          {!reloading && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {!newBuild && (
                <Button variant="ghost" onClick={this.retry}>
                  <RotateCcw size={15} aria-hidden /> Try again
                </Button>
              )}
              <Button onClick={() => window.location.reload()}>
                <RefreshCw size={15} aria-hidden /> Reload page
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }
}
