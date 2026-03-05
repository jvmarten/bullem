import { useEffect, useState } from 'react';

/** Full-screen overlay shown when the player's own socket connection drops.
 *  Displays a spinner and reconnect attempt count while Socket.io auto-reconnects. */
export function ReconnectOverlay() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="reconnect-overlay" role="alert" aria-live="assertive">
      <div className="reconnect-overlay-content animate-fade-in">
        <div className="reconnect-spinner" />
        <p className="reconnect-text">
          Reconnecting{dots}
        </p>
        <p className="reconnect-subtext">
          Please wait while we restore your connection
        </p>
      </div>
    </div>
  );
}
