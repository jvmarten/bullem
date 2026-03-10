import { useCallback, useEffect, useRef, useState } from 'react';

const SHOW_HINT_DELAY_MS = 3_000;
const SHOW_ACTIONS_DELAY_MS = 6_000;

/** Full-screen overlay shown when the player's own socket connection drops.
 *  Displays a spinner, reconnect attempt count, and — after a delay —
 *  actionable recovery options so the user is never stuck. */
export function ReconnectOverlay() {
  const [dots, setDots] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const mountTime = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));

      const elapsed = Date.now() - mountTime.current;
      setAttempts(Math.floor(elapsed / 2000));

      if (elapsed >= SHOW_HINT_DELAY_MS) {
        setShowHint(true);
      }
      if (elapsed >= SHOW_ACTIONS_DELAY_MS) {
        setShowActions(true);
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(() => {
    window.location.reload();
  }, []);

  const handleGoBack = useCallback(() => {
    window.location.href = '/';
  }, []);

  return (
    <div className="reconnect-overlay" role="alert" aria-live="assertive">
      <div className="reconnect-overlay-content animate-fade-in">
        <div className="reconnect-spinner" />
        <p className="reconnect-text">
          Reconnecting{dots}
        </p>
        <p className="reconnect-subtext">
          {showActions
            ? 'Auto-reconnect is taking longer than expected'
            : showHint
              ? 'Check your internet connection'
              : 'Please wait while we restore your connection'}
        </p>
        {attempts > 0 && (
          <p className="reconnect-attempts">
            Attempt {attempts}
          </p>
        )}
        {showActions && (
          <div className="reconnect-actions animate-fade-in">
            <button
              type="button"
              className="reconnect-refresh-btn"
              onClick={handleRefresh}
            >
              Refresh Page
            </button>
            <button
              type="button"
              className="reconnect-back-btn"
              onClick={handleGoBack}
            >
              Go Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
