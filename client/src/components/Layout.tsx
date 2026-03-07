import { useContext, useState, useRef, useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { GameContext, PresenceContext } from '../context/GameContext.js';
import { useAuth } from '../context/AuthContext.js';
import { useJokerEasterEgg, JokerOverlay } from './JokerEasterEgg.js';
import { TitleLogo } from './TitleLogo.js';
import { VolumeControl } from './VolumeControl.js';
import { socket } from '../socket.js';

interface LayoutProps {
  children: ReactNode;
  largeTitle?: boolean;
  /** Extra elements rendered in the header left group — visible only in landscape/desktop */
  headerLeftExtra?: ReactNode;
  /** Extra elements rendered in the header right group — visible only in landscape/desktop */
  headerRightExtra?: ReactNode;
}

function AuthLink() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;

  // Home page handles its own auth display in the center — hide the header auth link
  if (location.pathname === '/') return null;

  // When in a game/room session, don't navigate away — it would kick the player out
  const inSession = /^\/(room|game|local|results)/.test(location.pathname);

  const userIcon = (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
  );

  if (user) {
    return (
      <Link
        to="/profile"
        className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors flex items-center gap-1 min-h-[44px]"
        title={user.username}
      >
        {userIcon}
        <span>{user.username}</span>
      </Link>
    );
  }

  if (inSession) {
    // Show guest label without navigation to avoid kicking from game
    return (
      <span className="text-xs text-[var(--gold-dim)] flex items-center gap-1 min-h-[44px]">
        {userIcon}
        <span>Guest</span>
      </span>
    );
  }

  return (
    <Link
      to="/login"
      className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors flex items-center gap-1 min-h-[44px]"
    >
      {userIcon}
      <span>Guest</span>
    </Link>
  );
}

export function Layout({ children, largeTitle, headerLeftExtra, headerRightExtra }: LayoutProps) {
  const ctx = useContext(GameContext);
  const isConnected = ctx?.isConnected ?? true;
  const hasConnected = ctx?.hasConnected ?? true;
  // Read presence from the dedicated PresenceContext — this prevents game
  // components from re-rendering when the global online count changes.
  const { onlinePlayerCount, onlinePlayerNames } = useContext(PresenceContext);
  const [showPopup, setShowPopup] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const { phase: jokerPhase, setPhase: setJokerPhase, handleLogoClick: jokerClick, audioRef: jokerAudioRef, audioReady: jokerAudioReady, stopEasterEgg: jokerStop } = useJokerEasterEgg();

  // Stop joker easter egg audio when navigating to a different route
  useEffect(() => {
    jokerStop();
  }, [location.pathname, jokerStop]);

  const handleTitleClick = () => {
    jokerClick();
    const inPotentialSession = /^\/(room|game|local|results)/.test(location.pathname);
    if (inPotentialSession) {
      const ok = window.confirm('Leave current game/session and return home?');
      if (!ok) return;
      ctx?.leaveRoom?.();
    }
    navigate('/');
  };

  // Measure latency via Socket.io engine ping/pong when popup is open
  useEffect(() => {
    if (!showPopup) return;
    const engine = socket.io.engine;
    if (!engine) return;
    // engine-io fires pong with latency in ms, but the TS typings omit the arg
    const onPong = ((ms: number) => setLatencyMs(ms)) as () => void;
    engine.on('pong', onPong);
    return () => { engine.off('pong', onPong); };
  }, [showPopup]);

  useEffect(() => {
    if (!showPopup) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowPopup(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showPopup]);

  return (
    <div className="felt-bg text-[#e8e0d4]">
      <header className={`layout-header flex ${largeTitle ? 'items-end' : 'items-center'} px-4 border-b border-[var(--felt-border)] ${largeTitle ? 'py-3 layout-header-large' : 'py-1.5'}`}>
        {/* Left group */}
        <div className={`flex-1 flex ${largeTitle ? 'flex-col items-start gap-0.5' : 'items-center gap-2'} min-w-0`}>
          {isConnected && (
            <div ref={popupRef} className="relative flex-shrink-0">
              <button
                onClick={() => setShowPopup(prev => !prev)}
                className="flex items-center gap-1 text-[10px] text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
                {onlinePlayerCount || 1}
              </button>
              {showPopup && (
                <div className="absolute left-0 top-full mt-1 glass px-3 py-2 rounded-lg z-50 min-w-[120px] animate-fade-in">
                  <p className="text-[9px] uppercase tracking-widest text-[var(--gold-dim)] font-semibold mb-1">
                    Online ({onlinePlayerNames.length || onlinePlayerCount})
                    {latencyMs !== null && (
                      <span className="ml-2 text-[8px] normal-case tracking-normal opacity-70">
                        {latencyMs}ms
                      </span>
                    )}
                  </p>
                  {onlinePlayerNames.length > 0 ? (
                    <ul className="space-y-0.5">
                      {onlinePlayerNames.map((name, i) => (
                        <li key={i} className="text-xs text-[var(--gold-light)] flex items-center gap-1.5">
                          <span className="inline-block w-1 h-1 rounded-full bg-green-500 flex-shrink-0" />
                          {name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-[var(--gold-dim)]">
                      {onlinePlayerCount} players online
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <div className={largeTitle ? 'mt-auto' : ''}>
            <AuthLink />
          </div>
          {headerLeftExtra && (
            <div className="landscape-only items-center gap-3">{headerLeftExtra}</div>
          )}
        </div>

        {/* Center — logo */}
        <div className="flex-shrink-0">
          <TitleLogo size={largeTitle ? 'large' : 'small'} onClick={handleTitleClick} />
        </div>

        {/* Right group */}
        <div className={`flex-1 flex ${largeTitle ? 'items-end' : 'items-center'} justify-end gap-2 min-w-0`}>
          {headerRightExtra && (
            <div className="landscape-only items-center gap-3">{headerRightExtra}</div>
          )}
          <VolumeControl />
        </div>
      </header>
      {!isConnected && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-[var(--gold)] py-1.5 border-b border-[var(--felt-border)]">
          <span className="dot-disconnected" />
          {hasConnected ? 'Reconnecting\u2026' : 'Connecting\u2026'}
        </div>
      )}
      <main className="max-w-6xl mx-auto px-4 py-3">{children}</main>
      <JokerOverlay phase={jokerPhase} setPhase={setJokerPhase} audioRef={jokerAudioRef} audioReady={jokerAudioReady} />
    </div>
  );
}
