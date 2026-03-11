import { useContext, useState, useRef, useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { GameContext, PresenceContext } from '../context/GameContext.js';
import { useAuth } from '../context/AuthContext.js';
import { useJokerEasterEgg, JokerOverlay } from './JokerEasterEgg.js';
import { TitleLogo } from './TitleLogo.js';
import { VolumeControl } from './VolumeControl.js';
import { useOnlineStatus } from '../hooks/useOnlineStatus.js';
import { socket } from '../socket.js';

interface LayoutProps {
  children: ReactNode;
  largeTitle?: boolean;
  /** Extra elements rendered in the header left group — visible only in landscape/desktop */
  headerLeftExtra?: ReactNode;
  /** Extra elements rendered in the header right group — visible only in landscape/desktop */
  headerRightExtra?: ReactNode;
  /** Override the default title click behavior (e.g., to reset submenu state before navigating home) */
  onTitleClick?: () => void;
  /** Hide the full header in landscape mode and show game info as a floating overlay instead */
  hideHeaderLandscape?: boolean;
}

function getGuestDisplayName(): string {
  const stored = localStorage.getItem('bull-em-player-name');
  if (stored) return stored.toLowerCase();
  return 'guest';
}

function AuthLink() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;

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

  const guestName = getGuestDisplayName();

  if (inSession) {
    // Show guest label without navigation to avoid kicking from game
    return (
      <span className="text-xs text-[var(--gold-dim)] flex items-center gap-1 min-h-[44px]">
        {userIcon}
        <span>{guestName}</span>
      </span>
    );
  }

  return (
    <Link
      to="/login"
      className="text-xs text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors flex items-center gap-1 min-h-[44px]"
    >
      {userIcon}
      <span>{guestName}</span>
    </Link>
  );
}

export function Layout({ children, largeTitle, headerLeftExtra, headerRightExtra, onTitleClick, hideHeaderLandscape }: LayoutProps) {
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

  const isOnline = useOnlineStatus();
  const { phase: jokerPhase, setPhase: setJokerPhase, handleLogoClick: jokerClick, audioRef: jokerAudioRef, audioReady: jokerAudioReady, stopEasterEgg: jokerStop } = useJokerEasterEgg();

  // Stop joker easter egg audio when navigating to a different route
  useEffect(() => {
    jokerStop();
  }, [location.pathname, jokerStop]);

  const handleTitleClick = () => {
    if (largeTitle) jokerClick();
    // In an active game or local session, confirm before leaving
    const inActiveGame = /^\/(game|local|results)/.test(location.pathname);
    if (inActiveGame) {
      // Spectators can leave without confirmation — they have no spot to lose
      const isSpectator = ctx?.gameState ? !ctx.gameState.players.some(p => p.id === ctx.playerId) : false;
      if (!isSpectator) {
        const ok = window.confirm('Leave current game/session and return home?');
        if (!ok) return;
      }
      ctx?.leaveRoom?.();
      navigate('/');
      return;
    }
    // In a lobby room, just navigate away — player stays in the room and
    // will be notified via GameStartBanner when the host starts the game
    const inLobby = /^\/room\//.test(location.pathname);
    if (inLobby) {
      navigate('/');
      return;
    }
    // Allow pages to override title click (e.g., reset submenu state)
    if (onTitleClick) {
      onTitleClick();
      return;
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
    <div className={`felt-bg text-[#e8e0d4]${hideHeaderLandscape ? ' landscape-header-hidden' : ''}`}>
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className={`layout-header flex ${largeTitle ? 'items-end' : 'items-center'} px-4 border-b border-[var(--felt-border)] ${largeTitle ? 'py-3 layout-header-large' : 'py-1.5'}`} role="banner">
        {/* Left group */}
        <div className={`flex-1 flex ${largeTitle ? 'flex-col items-start self-stretch' : 'items-center gap-2'} min-w-0`}>
          {isConnected && (
            <div ref={popupRef} className="relative flex-shrink-0">
              <button
                onClick={() => setShowPopup(prev => !prev)}
                className="flex items-center gap-1 text-[10px] text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
                aria-expanded={showPopup}
                aria-label={`${onlinePlayerCount || 1} players online`}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" aria-hidden="true" />
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
          <div className={largeTitle ? 'mt-auto pb-0.5' : 'self-end'}>
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
      {/* Floating overlay for landscape game mode — replaces hidden header */}
      {hideHeaderLandscape && (headerLeftExtra || headerRightExtra) && (
        <div className="game-header-overlay">
          {headerLeftExtra && (
            <div className="game-header-overlay-left">{headerLeftExtra}</div>
          )}
          {headerRightExtra && (
            <div className="game-header-overlay-right">{headerRightExtra}</div>
          )}
          <div className="game-header-overlay-volume">
            <VolumeControl />
          </div>
        </div>
      )}
      {!isConnected && (
        <div role="alert" className="flex items-center justify-center gap-1.5 text-xs text-[var(--gold)] py-1.5 border-b border-[var(--felt-border)] shrink-0">
          <span className="dot-disconnected" aria-hidden="true" />
          {hasConnected ? 'Reconnecting\u2026' : 'Connecting\u2026'}
        </div>
      )}
      {!isOnline && (
        <div role="alert" className="flex items-center justify-center gap-2 text-xs py-1.5 border-b border-[var(--felt-border)] bg-[#2a1a1a] shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 flex-shrink-0"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          <span className="text-amber-400">You&apos;re offline &mdash; local bot games still work!</span>
        </div>
      )}
      <main id="main-content" className="w-full max-w-6xl mx-auto px-4 py-3 layout-main">{children}</main>
      <JokerOverlay phase={jokerPhase} setPhase={setJokerPhase} audioRef={jokerAudioRef} audioReady={jokerAudioReady} />
    </div>
  );
}
