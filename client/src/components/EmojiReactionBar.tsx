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
        <span style={{ fontSize: '20px', lineHeight: 1 }} aria-hidden="true">{'\u{1F600}'}</span>
      </button>
    </div>
  );
});
