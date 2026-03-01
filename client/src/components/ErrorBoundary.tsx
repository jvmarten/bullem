import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uncaught error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6"
             style={{ background: 'linear-gradient(135deg, var(--felt-dark) 0%, var(--felt) 50%, var(--felt-dark) 100%)' }}>
          <div className="glass-raised p-8 max-w-sm w-full text-center space-y-4">
            <h1 className="font-display text-2xl font-bold text-[var(--gold)]">Something went wrong</h1>
            <p className="text-sm text-[var(--gold-dim)]">
              The game hit an unexpected error. Try refreshing the page.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false });
                window.location.href = '/';
              }}
              className="w-full btn-gold py-3"
            >
              Back to Home
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
