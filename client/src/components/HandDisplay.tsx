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
export const HandDisplay = memo(function HandDisplay({ cards, large, onCardTap, cardsHidden, flipProgress, gestureHandlers }: {
  cards: Card[];
  large?: boolean;
  onCardTap?: (card: Card) => void;
  cardsHidden?: boolean;
  flipProgress?: number;
  gestureHandlers?: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}) {
  if (cards.length === 0) return null;
  const count = cards.length;
  const isWide = useIsWideViewport();

  // In landscape/wide viewports, spread the fan wider (less overlap, more rotation)
  const fanAngle = isWide ? 7 : 5;
  const overlap = -6;
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

  // Compute the 3D rotation for the card flip.
  // 0 = face up, 180 = face down (card back showing).
  // During a swipe, flipProgress (0→1) animates between states.
  const progress = flipProgress ?? 0;
  const baseAngle = cardsHidden ? 180 : 0;
  const swipeAngle = cardsHidden
    ? 180 - progress * 180 // swiping to show: 180 → 0
    : progress * 180;      // swiping to hide: 0 → 180
  const rotateX = progress > 0 ? swipeAngle : baseAngle;

  // When rotateX > 90, the card is past halfway — show back face
  const showBack = rotateX > 90;

  return (
    <div
      className={`flex justify-center py-2${large ? ' hand-display-large' : ''} hand-display-flip-container`}
      style={{
        perspective: '600px',
        touchAction: gestureHandlers ? 'pan-x' : undefined,
      }}
      {...gestureHandlers}
    >
      <div
        className="hand-display-flipper"
        style={{
          transformStyle: 'preserve-3d',
          transform: `rotateX(${rotateX}deg)`,
          transition: progress > 0 ? 'none' : 'transform 0.35s cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        {showBack ? (
          // Card backs — same fan layout
          cards.map((card, i) => (
            <div
              key={`back-${card.rank}-${card.suit}-${i}`}
              className={`hand-card-back mx-0.5 animate-card-deal deal-delay-${i}`}
              style={{
                ...cardStyles[i],
                // Counter-rotate so backs appear correctly when flipped past 90°
                transform: `${cardStyles[i].transform} rotateX(180deg)`,
              }}
            />
          ))
        ) : (
          cards.map((card, i) => (
            <CardDisplay
              key={`${card.rank}-${card.suit}-${i}`}
              card={card}
              className={`animate-card-deal deal-delay-${i}${onCardTap ? ' cursor-pointer active:scale-95 transition-transform' : ''}`}
              style={cardStyles[i]}
              onClick={onCardTap ? () => onCardTap(card) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
});
