import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, errorMessage: message };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error);
    if (info.componentStack) {
      console.error('[ErrorBoundary] Component stack:', info.componentStack);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4"
             style={{ background: 'var(--felt)' }}>
          <div className="text-center space-y-4 glass p-8 max-w-sm">
            <h1 className="font-display text-2xl font-bold text-[var(--gold)]">
              Something went wrong
            </h1>
            <p className="text-[var(--gold-dim)] text-sm">
              An unexpected error occurred. Please refresh the page.
            </p>
            {this.state.errorMessage && (
              <p className="text-[var(--danger)] text-xs font-mono break-words opacity-70">
                {this.state.errorMessage}
              </p>
            )}
            <button
              onClick={() => window.location.reload()}
              className="btn-gold px-6 py-2"
            >
              Refresh
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
