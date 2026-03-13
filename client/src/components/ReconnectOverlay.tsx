import { useCallback, useEffect, useRef, useState } from 'react';

/** Delay before showing recovery action buttons (relative to overlay mount).
 *  Since the overlay itself is already delayed 4s by GamePage, this means
 *  action buttons appear ~8s after the actual disconnect — long enough to
 *  confirm the reconnect is genuinely stuck. */
const SHOW_ACTIONS_DELAY_MS = 4_000;

/** Full-screen overlay shown when the player's own socket connection drops.
 *  Displays a spinner and — after a delay — actionable recovery options
 *  so the user is never stuck. Kept minimal to avoid alarming the player. */
export function ReconnectOverlay() {
  const [dots, setDots] = useState('');
  const [showActions, setShowActions] = useState(false);
  const mountTime = useRef(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev.length >= 3 ? '' : prev + '.'));

      const elapsed = Date.now() - mountTime.current;
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
        {showActions && (
          <>
            <p className="reconnect-subtext">
              Taking longer than expected
            </p>
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
          </>
        )}
      </div>
    </div>
  );
}
