import { memo } from 'react';
import { ALLOWED_EMOJIS } from '@bull-em/shared';
import type { GameEmoji } from '@bull-em/shared';

interface Props {
  onReaction: (emoji: GameEmoji) => void;
}

export const EmojiReactionBar = memo(function EmojiReactionBar({ onReaction }: Props) {
  return (
    <div className="flex justify-center gap-1">
      {ALLOWED_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onReaction(emoji)}
          className="emoji-reaction-btn"
          type="button"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
});
