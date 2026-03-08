/** Full-screen non-dismissable overlay shown on the OLD device/tab when
 *  the user's session is transferred to a new connection. Directs the user
 *  to continue playing on their other device and prevents auto-reconnect loops. */
export function SessionTransferredOverlay() {
  return (
    <div className="reconnect-overlay" role="alert" aria-live="assertive">
      <div className="reconnect-overlay-content animate-fade-in">
        <p className="reconnect-text">
          Session moved
        </p>
        <p className="reconnect-subtext">
          You're now playing on another device or tab.
          <br />
          This window is no longer active.
        </p>
      </div>
    </div>
  );
}
