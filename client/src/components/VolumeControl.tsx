import { useState, useRef, useEffect } from 'react';
import { useSound } from '../hooks/useSound.js';

export function VolumeControl() {
  const { muted, toggleMute, volume, setVolume, hapticsEnabled, toggleHaptics } = useSound();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-1"
        title="Sound settings"
        aria-label="Sound settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 glass-raised rounded-lg p-3 min-w-[160px] animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--gold-dim)] font-semibold">
              Volume
            </span>
            <button
              onClick={toggleMute}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-0.5"
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              )}
            </button>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              if (v > 0 && muted) toggleMute();
              if (v === 0 && !muted) toggleMute();
            }}
            className="volume-slider w-full"
          />
          <div className="flex justify-between text-[9px] text-[var(--gold-dim)] mt-0.5">
            <span>0%</span>
            <span>{muted ? '0' : Math.round(volume * 100)}%</span>
            <span>100%</span>
          </div>

          {/* Haptics toggle — separate from sound mute */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--gold-dim)]/20">
            <span className="text-[10px] uppercase tracking-wider text-[var(--gold-dim)] font-semibold">
              Haptics
            </span>
            <button
              onClick={toggleHaptics}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-0.5"
              title={hapticsEnabled ? 'Disable haptics' : 'Enable haptics'}
            >
              {hapticsEnabled ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12h2m4-7v2m8-2v2m4 5h2" />
                  <rect x="8" y="9" width="8" height="10" rx="2" />
                  <path d="M5 8a9 9 0 0 1 2.6-4" />
                  <path d="M19 8a9 9 0 0 0-2.6-4" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="8" y="9" width="8" height="10" rx="2" />
                  <line x1="2" y1="2" x2="22" y2="22" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
