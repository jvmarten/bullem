import { useContext, useState, useRef, useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { GameContext, PresenceContext } from '../context/GameContext.js';
import { useAuth } from '../context/AuthContext.js';
import { useJokerEasterEgg, JokerOverlay } from './JokerEasterEgg.js';
import { TitleLogo } from './TitleLogo.js';
import { VolumeControl } from './VolumeControl.js';

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
  if (loading) return null;
  if (user) {
    return (
      <Link
        to="/profile"
        className="text-[10px] text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors flex items-center gap-1"
        title={user.username}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span className="hidden sm:inline">{user.username}</span>
      </Link>
    );
  }
  return (
    <Link
      to="/login"
      className="text-[10px] text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
    >
      Guest
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
  const [showVersionPopup, setShowVersionPopup] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const versionRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const { phase: jokerPhase, setPhase: setJokerPhase, handleLogoClick: jokerClick, audioRef: jokerAudioRef } = useJokerEasterEgg();

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

  useEffect(() => {
    if (!showPopup && !showVersionPopup) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (showPopup && popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowPopup(false);
      }
      if (showVersionPopup && versionRef.current && !versionRef.current.contains(e.target as Node)) {
        setShowVersionPopup(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showPopup, showVersionPopup]);

  return (
    <div className="felt-bg text-[#e8e0d4]">
      <header className={`layout-header flex items-center px-4 border-b border-[var(--felt-border)] ${largeTitle ? 'py-6 layout-header-large' : 'py-1.5'}`}>
        {/* Left group */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {isConnected && (
            <div ref={popupRef} className="relative">
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
          {headerLeftExtra && (
            <div className="landscape-only items-center gap-3">{headerLeftExtra}</div>
          )}
        </div>

        {/* Center — logo */}
        <div className="flex-shrink-0">
          <TitleLogo size={largeTitle ? 'large' : 'small'} onClick={handleTitleClick} />
        </div>

        {/* Right group */}
        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
          {headerRightExtra && (
            <div className="landscape-only items-center gap-3">{headerRightExtra}</div>
          )}
          {!isConnected && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--gold)]">
              <span className="dot-disconnected" />
              {hasConnected ? 'Reconnecting\u2026' : 'Connecting\u2026'}
            </div>
          )}
          <AuthLink />
          <VolumeControl />
          <div ref={versionRef} className="relative">
            <button
              onClick={() => setShowVersionPopup(v => !v)}
              className="text-[10px] text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              v0.2.9
            </button>
            {showVersionPopup && (
              <div className="absolute right-0 top-full mt-1 glass px-3 py-2 rounded-lg z-50 min-w-[100px] animate-fade-in">
                <p className="text-[10px] text-[var(--gold-dim)] whitespace-nowrap">
                  v0.2.9 &middot; 05.03.26
                </p>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-3">{children}</main>
      <JokerOverlay phase={jokerPhase} setPhase={setJokerPhase} audioRef={jokerAudioRef} />
    </div>
  );
}
