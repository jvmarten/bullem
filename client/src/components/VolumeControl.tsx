import { useState, useRef, useEffect, useSyncExternalStore } from 'react';
import { useSound } from '../hooks/useSound.js';

/* ── Persistent toggle settings (chat / emoji visibility) ──────── */

const CHAT_KEY = 'bull-em-chat-enabled';
const EMOJI_KEY = 'bull-em-emoji-enabled';

let settingsListeners = new Set<() => void>();
function notifySettings() { settingsListeners.forEach(cb => cb()); }
function subscribeSettings(cb: () => void) {
  settingsListeners.add(cb);
  return () => { settingsListeners.delete(cb); };
}

function readBool(key: string, fallback: boolean): boolean {
  const v = localStorage.getItem(key);
  if (v === null) return fallback;
  return v === '1';
}

let chatEnabled = readBool(CHAT_KEY, true);
let emojiEnabled = readBool(EMOJI_KEY, true);

function getChatEnabled() { return chatEnabled; }
function getEmojiEnabled() { return emojiEnabled; }

function toggleChatEnabled() {
  chatEnabled = !chatEnabled;
  localStorage.setItem(CHAT_KEY, chatEnabled ? '1' : '0');
  notifySettings();
}

function toggleEmojiEnabled() {
  emojiEnabled = !emojiEnabled;
  localStorage.setItem(EMOJI_KEY, emojiEnabled ? '1' : '0');
  notifySettings();
}

/** Hook to read chat/emoji visibility settings. */
export function useUISettings() {
  const chat = useSyncExternalStore(subscribeSettings, getChatEnabled);
  const emoji = useSyncExternalStore(subscribeSettings, getEmojiEnabled);
  return { chatEnabled: chat, emojiEnabled: emoji };
}

export function VolumeControl() {
  const { muted, toggleMute, volume, setVolume, hapticsEnabled, toggleHaptics } = useSound();
  const chatOn = useSyncExternalStore(subscribeSettings, getChatEnabled);
  const emojiOn = useSyncExternalStore(subscribeSettings, getEmojiEnabled);
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
        title="Settings"
        aria-label="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 glass-raised rounded-lg p-3 min-w-[180px] animate-fade-in">
          <div className="flex items-center gap-2">
            {/* Speaker icon — tap to toggle mute */}
            <button
              onClick={toggleMute}
              className="text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors shrink-0 p-0"
              title={muted ? 'Unmute' : 'Mute'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                {!muted && volume > 0 && (
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                )}
                {!muted && volume > 0.5 && (
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                )}
                {(muted || volume === 0) && (
                  <>
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </>
                )}
              </svg>
            </button>
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
              className="volume-slider flex-1"
            />
          </div>

          {/* Haptics toggle */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-[var(--gold-dim)]/20">
            <span className="text-[10px] uppercase tracking-wider text-[var(--gold-dim)] font-semibold">
              Haptics
            </span>
            <button
              onClick={toggleHaptics}
              className={`text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-0.5 ${!hapticsEnabled ? 'opacity-40' : ''}`}
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

          {/* Chat toggle */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--gold-dim)]/20">
            <span className="text-[10px] uppercase tracking-wider text-[var(--gold-dim)] font-semibold">
              Chat
            </span>
            <button
              onClick={toggleChatEnabled}
              className={`text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-0.5 ${!chatOn ? 'opacity-40' : ''}`}
              title={chatOn ? 'Hide chat button' : 'Show chat button'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                {!chatOn && <line x1="2" y1="2" x2="22" y2="22" />}
              </svg>
            </button>
          </div>

          {/* Emoji toggle */}
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-[var(--gold-dim)]/20">
            <span className="text-[10px] uppercase tracking-wider text-[var(--gold-dim)] font-semibold">
              Emoji
            </span>
            <button
              onClick={toggleEmojiEnabled}
              className={`text-[var(--gold-dim)] hover:text-[var(--gold)] transition-colors p-0.5 ${!emojiOn ? 'opacity-40' : ''}`}
              title={emojiOn ? 'Hide emoji button' : 'Show emoji button'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                <line x1="9" y1="9" x2="9.01" y2="9"/>
                <line x1="15" y1="9" x2="15.01" y2="9"/>
                {!emojiOn && <line x1="2" y1="2" x2="22" y2="22" />}
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
