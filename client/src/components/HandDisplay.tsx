import { memo, useMemo } from 'react';
import type { Card } from '@bull-em/shared';
import { CardDisplay } from './CardDisplay.js';

// Detect landscape/wide viewport for wider card fan spacing.
// Uses matchMedia so the value updates on orientation change without re-mount.
function useIsWideViewport(): boolean {
  // Safe SSR fallback
  if (typeof window === 'undefined') return false;
  // Landscape phone or tablet/desktop width
  const mql = window.matchMedia('(orientation: landscape) and (max-height: 500px), (min-width: 768px) and (min-height: 501px)');
  return mql.matches;
}

// Memoized: cards don't change during a round — skip re-renders triggered
// by unrelated parent state (current turn, timer, call history).
export const HandDisplay = memo(function HandDisplay({ cards, large }: { cards: Card[]; large?: boolean }) {
  if (cards.length === 0) return null;
  const count = cards.length;
  const isWide = useIsWideViewport();

  // In landscape/wide viewports, spread the fan wider (less overlap, more rotation)
  const fanAngle = isWide ? 7 : 5;
  const overlap = isWide ? 0 : -6;
  const arcScale = isWide ? 3 : 2;

  // Memoize card styles to avoid recalculating on every render
  const cardStyles = useMemo(() =>
    cards.map((_, i) => {
      const angle = count === 1 ? 0 : (i - (count - 1) / 2) * fanAngle;
      const lift = count === 1 ? 0 : -Math.abs(i - (count - 1) / 2) * arcScale;
      return {
        transform: `rotate(${angle}deg) translateY(${lift}px)`,
        marginLeft: i > 0 ? `${overlap}px` : undefined,
        zIndex: i,
      };
    }), [count, fanAngle, overlap, arcScale, cards]);

  return (
    <div className={`flex justify-center py-2${large ? ' hand-display-large' : ''}`}>
      {cards.map((card, i) => (
        <CardDisplay
          key={`${card.rank}-${card.suit}-${i}`}
          card={card}
          className={`animate-card-deal deal-delay-${i}`}
          style={cardStyles[i]}
        />
      ))}
    </div>
  );
});
