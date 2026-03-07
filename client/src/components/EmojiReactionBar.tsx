import { memo, useState } from 'react';
import { ALLOWED_EMOJIS } from '@bull-em/shared';
import type { GameEmoji } from '@bull-em/shared';

interface Props {
  onReaction: (emoji: GameEmoji) => void;
}

export const EmojiReactionBar = memo(function EmojiReactionBar({ onReaction }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-4 left-4 z-40 flex flex-col items-start" style={{ maxWidth: '340px' }}>
      {/* Emoji picker panel */}
      {open && (
        <div
          className="glass mb-2 p-3 rounded-lg animate-fade-in"
          style={{ borderRadius: '8px' }}
        >
          <div className="flex flex-wrap gap-1 justify-center">
            {ALLOWED_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { onReaction(emoji); setOpen(false); }}
                className="emoji-reaction-btn"
                type="button"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="btn-ghost rounded-full w-11 h-11 flex items-center justify-center shadow-lg"
        type="button"
        title="Emoji reactions"
        aria-label={open ? 'Hide emoji reactions' : 'Show emoji reactions'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="3" strokeLinecap="round"/><line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="3" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
});
