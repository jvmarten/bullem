import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  /** Called when the boundary triggers a recovery attempt. Clears stale game/overlay state. */
  onRecover?: () => void;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
  /** How many times we've retried rendering after an error. */
  retryCount: number;
  /** True while we're in the retry-delay phase. */
  recovering: boolean;
}

/** Maximum auto-retries before showing manual recovery UI. */
const MAX_AUTO_RETRIES = 2;
/** Delay (ms) before each auto-retry — gives React state time to settle. */
const AUTO_RETRY_DELAY_MS = 500;

/**
 * Error boundary for the game page that auto-retries transient rendering
 * errors (e.g. TDZ errors from race conditions during reconnection) before
 * showing a recovery UI. Unlike the root ErrorBoundary, this one:
 *
 * 1. Attempts up to MAX_AUTO_RETRIES silent re-renders with a brief delay.
 * 2. Calls onRecover() on each retry to clear stale overlay/game state.
 * 3. On exhausted retries, shows a "Rejoin" button that reloads the page
 *    (preserving session storage so the reconnection flow picks up).
 */
export class GameErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: null, retryCount: 0, recovering: false };
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[GameErrorBoundary] Caught error:', error);
    if (info.componentStack) {
      console.error('[GameErrorBoundary] Component stack:', info.componentStack);
    }

    if (this.state.retryCount < MAX_AUTO_RETRIES) {
      // Auto-retry: clear stale state and try re-rendering after a brief delay
      this.setState({ recovering: true });
      this.props.onRecover?.();

      this.retryTimer = setTimeout(() => {
        this.setState(prev => ({
          hasError: false,
          errorMessage: null,
          retryCount: prev.retryCount + 1,
          recovering: false,
        }));
      }, AUTO_RETRY_DELAY_MS);
    }
  }

  componentWillUnmount(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  render() {
    // While in recovery delay, show a brief loading indicator instead of the error
    if (this.state.recovering) {
      return (
        <div className="h-full flex items-center justify-center p-4"
             style={{ background: 'var(--felt)' }}>
          <div className="text-center space-y-3 animate-fade-in">
            <div className="w-8 h-8 border-2 border-[var(--gold)] border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-[var(--gold-dim)]">Recovering&hellip;</p>
          </div>
        </div>
      );
    }

    if (this.state.hasError) {
      // Retries exhausted — show manual recovery UI
      return (
        <div className="h-full flex items-center justify-center p-4"
             style={{ background: 'var(--felt)' }}>
          <div className="text-center space-y-4 glass p-8 max-w-sm">
            <h1 className="font-display text-2xl font-bold text-[var(--gold)]">
              Connection hiccup
            </h1>
            <p className="text-[var(--gold-dim)] text-sm">
              Something went wrong during gameplay. Tap below to rejoin your match.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-gold px-6 py-3 w-full font-bold"
            >
              Rejoin Match
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              className="btn-ghost px-6 py-2 w-full text-sm"
            >
              Go Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
