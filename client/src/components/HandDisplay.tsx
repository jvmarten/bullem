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
    onPointerLeave: (e: React.PointerEvent) => void;
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

  // Flip animation: progress 0→1 maps to a two-phase rotation.
  // Phase 1 (0→0.5): rotateX 0°→90° — cards fold edge-on
  // Phase 2 (0.5→1): rotateX 90°→0° — cards unfold with new face
  // Content swaps at the halfway point. No rotation in resting state.
  const progress = flipProgress ?? 0;
  const rotateX = progress <= 0.5
    ? progress * 180          // 0° → 90°
    : (1 - progress) * 180;   // 90° → 0°

  // Swap to the other face at the halfway point of the swipe
  const showBack = cardsHidden
    ? (progress <= 0.5)   // hidden: show backs, past halfway show fronts (revealing)
    : (progress > 0.5);   // visible: show fronts, past halfway show backs (hiding)

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
          transform: rotateX > 0 ? `rotateX(${rotateX}deg)` : undefined,
          transition: progress > 0 ? 'none' : 'transform 0.25s cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        {showBack ? (
          // Card backs — same fan layout, no 3D counter-rotation needed
          cards.map((card, i) => (
            <div
              key={`back-${card.rank}-${card.suit}-${i}`}
              className="hand-card-back mx-0.5"
              style={cardStyles[i]}
            />
          ))
        ) : (
          cards.map((card, i) => (
            <CardDisplay
              key={`${card.rank}-${card.suit}-${i}`}
              card={card}
              className={`animate-card-deal deal-delay-${i}${onCardTap && !cardsHidden ? ' cursor-pointer active:scale-95 transition-transform' : ''}`}
              style={cardStyles[i]}
              onClick={onCardTap && !cardsHidden ? () => onCardTap(card) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
});
