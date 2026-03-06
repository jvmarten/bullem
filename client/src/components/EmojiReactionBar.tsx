import { memo, useState } from 'react';
import { ALLOWED_EMOJIS } from '@bull-em/shared';
import type { GameEmoji } from '@bull-em/shared';

interface Props {
  onReaction: (emoji: GameEmoji) => void;
}

export const EmojiReactionBar = memo(function EmojiReactionBar({ onReaction }: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex justify-center">
        <button
          onClick={() => setOpen(true)}
          className="emoji-reaction-btn"
          type="button"
          title="Show reactions"
          aria-label="Show emoji reactions"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
        </button>
      </div>
    );
  }

  return (
    <div className="flex justify-center gap-1 animate-fade-in">
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
      <button
        onClick={() => setOpen(false)}
        className="emoji-reaction-btn text-[var(--gold-dim)]"
        type="button"
        title="Hide reactions"
        aria-label="Hide emoji reactions"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
});
