import { memo } from 'react';
import type { QuickDrawSuggestion } from '@bull-em/shared';

interface QuickDrawChipsProps {
  suggestions: QuickDrawSuggestion[];
  onSelect: (suggestion: QuickDrawSuggestion) => void;
  onMore: () => void;
  onDismiss: () => void;
}

const SUIT_SYMBOLS: Record<string, string> = {
  spades: '\u2660',
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
};

/** Replace suit names with symbols for compact chip labels. */
function compactLabel(label: string): string {
  return label
    .replace(/\bin (spades|hearts|diamonds|clubs)\b/g, (_, suit: string) => SUIT_SYMBOLS[suit] ?? suit)
    .replace(/\b(spades|hearts|diamonds|clubs)\b/g, (suit) => SUIT_SYMBOLS[suit] ?? suit);
}

export const QuickDrawChips = memo(function QuickDrawChips({
  suggestions,
  onSelect,
  onMore,
  onDismiss,
}: QuickDrawChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div
      className="quick-draw-row"
      data-tooltip="quick-draw"
      onClick={(e) => {
        // Dismiss if tapping the background (not a chip)
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      {suggestions.map((s, i) => (
        <button
          key={`${s.tier}-${i}`}
          className={`quick-draw-chip quick-draw-chip-${s.tier} animate-quick-draw-in`}
          style={{ animationDelay: `${i * 60}ms` }}
          onClick={() => onSelect(s)}
          title={s.label}
        >
          <span className="quick-draw-chip-label">{compactLabel(s.label)}</span>
        </button>
      ))}
      <button
        className="quick-draw-chip quick-draw-chip-more animate-quick-draw-in"
        style={{ animationDelay: `${suggestions.length * 60}ms` }}
        onClick={onMore}
        title="Open full hand picker"
      >
        More&hellip;
      </button>
    </div>
  );
});
