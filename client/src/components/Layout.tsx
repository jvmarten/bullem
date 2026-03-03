import { useContext, useState, useRef, useEffect, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { GameContext } from '../context/GameContext.js';
import { VolumeControl } from './VolumeControl.js';

export function Layout({ children, largeTitle }: { children: ReactNode; largeTitle?: boolean }) {
  const ctx = useContext(GameContext);
  const isConnected = ctx?.isConnected ?? true;
  const onlinePlayerCount = ctx?.onlinePlayerCount ?? 0;
  const onlinePlayerNames = ctx?.onlinePlayerNames ?? [];
  const [showPopup, setShowPopup] = useState(false);
  const [showVersionDate, setShowVersionDate] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const handleTitleClick = () => {
    const inPotentialSession = /^\/(room|game|local|results)/.test(location.pathname);
    if (inPotentialSession) {
      const ok = window.confirm('Leave current game/session and return home?');
      if (!ok) return;
      ctx?.leaveRoom?.();
    }
    navigate('/');
  };

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
      <header className={`px-4 text-center border-b border-[var(--felt-border)] relative ${largeTitle ? 'py-6' : 'py-1.5'}`}>
        <button
          onClick={handleTitleClick}
          className={`font-title font-bold tracking-wider text-[var(--gold)] title-glow ${largeTitle ? 'text-5xl' : 'text-xl'} cursor-pointer hover:text-[var(--gold-light)] transition-colors min-h-[44px] relative z-10`}
        >
          Bull &rsquo;Em
        </button>
        {onlinePlayerCount > 0 && (
          <div ref={popupRef} className="absolute top-1/2 left-3 -translate-y-1/2">
            <button
              onClick={() => setShowPopup(prev => !prev)}
              className="flex items-center gap-1 text-[10px] text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
              {onlinePlayerCount}
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
        <div className="absolute top-1/2 right-3 -translate-y-1/2 flex items-center gap-2">
          {!isConnected && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--gold)]">
              <span className="dot-disconnected" />
              Reconnecting&hellip;
            </div>
          )}
          <VolumeControl />
          {largeTitle && (
            <button
              onClick={() => setShowVersionDate(v => !v)}
              className="text-[10px] text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors"
            >
              {showVersionDate ? 'v0.1.7 · 03.03.26' : 'v0.1.7'}
            </button>
          )}
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-3">{children}</main>
    </div>
  );
}
