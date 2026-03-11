import { memo, useEffect, useState, useMemo, useRef } from 'react';
import type { RoundResult, Player, OwnedCard } from '@bull-em/shared';
import { handToString } from '@bull-em/shared';
import { getSeatPosition } from '../utils/roundtablePositions.js';
import { CardDisplay } from './CardDisplay.js';
import { useSound } from '../hooks/useSound.js';

/** Timing constants (ms) */
const CARD_REVEAL_INTERVAL = 400;   // delay between each card's reveal
const CARD_FLY_DURATION = 400;      // how long the card flies to center or burns
const RESULT_DELAY = 600;           // delay after last card before showing result
const MIN_DISPLAY_TIME = 1500;      // minimum time to show result before allowing dismiss

interface Props {
  result: RoundResult;
  /** Seat-ordered players (index 0 = local player) */
  orderedPlayers: Player[];
  playerCount: number;
  onComplete: () => void;
}

interface RevealCard {
  id: number;
  card: OwnedCard;
  seatIndex: number;
  /** Whether this card is part of the called hand */
  isPartOfHand: boolean;
  phase: 'waiting' | 'revealing' | 'burned' | 'collected';
}

/**
 * Cinematic reveal animation for the roundtable layout.
 * When a call is challenged, cards are revealed one-by-one from each player:
 * - Cards NOT part of the called hand: burn animation (fade red, slide out)
 * - Cards that ARE part of the called hand: fly to center, land face-up
 * After all cards evaluated, shows the result.
 */
export const RoundtableRevealOverlay = memo(function RoundtableRevealOverlay({
  result,
  orderedPlayers,
  playerCount,
  onComplete,
}: Props) {
  const { play } = useSound();
  const [revealCards, setRevealCards] = useState<RevealCard[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Build seat index lookup
  const seatIndexByPlayerId = useMemo(() => {
    const map = new Map<string, number>();
    orderedPlayers.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [orderedPlayers]);

  // Build the set of cards that form the called hand
  // revealedCards from result are the cards that are part of the hand
  const handCardKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const card of result.revealedCards) {
      keys.add(`${card.playerId}-${card.rank}-${card.suit}`);
    }
    return keys;
  }, [result.revealedCards]);

  // Build the reveal sequence from all revealed cards
  const revealSequence = useMemo(() => {
    const seq: { card: OwnedCard; seatIndex: number; isPartOfHand: boolean }[] = [];

    for (const ownedCard of result.revealedCards) {
      const seatIndex = seatIndexByPlayerId.get(ownedCard.playerId) ?? 0;
      const key = `${ownedCard.playerId}-${ownedCard.rank}-${ownedCard.suit}`;
      const isPartOfHand = handCardKeys.has(key);

      seq.push({ card: ownedCard, seatIndex, isPartOfHand });
    }

    // Sort: burn cards first (not part of hand), then hand cards for dramatic buildup
    seq.sort((a, b) => {
      if (a.isPartOfHand !== b.isPartOfHand) return a.isPartOfHand ? 1 : -1;
      return 0; // preserve order within same group
    });

    return seq;
  }, [result.revealedCards, seatIndexByPlayerId, handCardKeys]);

  // Run the reveal animation
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timerRefs.current = timers;

    // Initialize all cards in waiting state
    const initial: RevealCard[] = revealSequence.map((item, i) => ({
      id: i,
      card: item.card,
      seatIndex: item.seatIndex,
      isPartOfHand: item.isPartOfHand,
      phase: 'waiting' as const,
    }));
    setRevealCards(initial);

    // Reveal cards one at a time
    revealSequence.forEach((_, i) => {
      const revealDelay = i * CARD_REVEAL_INTERVAL;

      // Start revealing
      const t1 = setTimeout(() => {
        play('cardDeal');
        setRevealCards(prev =>
          prev.map(c => c.id === i ? { ...c, phase: 'revealing' } : c),
        );
      }, revealDelay);
      timers.push(t1);

      // Complete the animation (burn or collect)
      const t2 = setTimeout(() => {
        setRevealCards(prev =>
          prev.map(c => {
            if (c.id !== i) return c;
            return { ...c, phase: c.isPartOfHand ? 'collected' : 'burned' };
          }),
        );
      }, revealDelay + CARD_FLY_DURATION);
      timers.push(t2);
    });

    // Show result after all cards revealed
    const totalRevealTime = revealSequence.length * CARD_REVEAL_INTERVAL + CARD_FLY_DURATION + RESULT_DELAY;
    const resultTimer = setTimeout(() => setShowResult(true), totalRevealTime);
    timers.push(resultTimer);

    const dismissTimer = setTimeout(() => setCanDismiss(true), totalRevealTime + MIN_DISPLAY_TIME);
    timers.push(dismissTimer);

    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  // Count collected cards for spread layout
  const collectedCount = revealCards.filter(c => c.phase === 'collected').length;

  return (
    <div className="rt-reveal-overlay" onClick={canDismiss ? onComplete : undefined}>
      {/* Called hand label at top */}
      <div className="rt-reveal-header animate-fade-in">
        <span className="rt-reveal-hand-label">
          {handToString(result.calledHand)}
        </span>
      </div>

      {/* Reveal cards */}
      {revealCards.map(rc => (
        <RevealCardElement
          key={rc.id}
          revealCard={rc}
          playerCount={playerCount}
          collectedIndex={
            rc.phase === 'collected'
              ? revealCards.filter(c => c.phase === 'collected' && c.id < rc.id).length
              : 0
          }
          collectedTotal={collectedCount}
        />
      ))}

      {/* Center pile glow when cards are collecting */}
      {collectedCount > 0 && (
        <div className="rt-reveal-center-glow" />
      )}

      {/* Result banner */}
      {showResult && (
        <div className="rt-reveal-result animate-cube-roll-in">
          <div className={`rt-reveal-result-text ${result.handExists ? 'rt-reveal-result--exists' : 'rt-reveal-result--fake'}`}>
            {result.handExists ? 'The hand EXISTS!' : 'BULL! Hand is fake!'}
          </div>
          {canDismiss && (
            <button
              className="rt-reveal-continue btn-gold mt-3 animate-fade-in"
              onClick={onComplete}
            >
              Continue
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/** Individual card in the reveal sequence. */
const RevealCardElement = memo(function RevealCardElement({
  revealCard,
  playerCount,
  collectedIndex,
  collectedTotal,
}: {
  revealCard: RevealCard;
  playerCount: number;
  collectedIndex: number;
  collectedTotal: number;
}) {
  const { seatIndex, card, phase, isPartOfHand } = revealCard;
  const seatPos = getSeatPosition(playerCount, seatIndex);

  const seatLeft = parseFloat(seatPos.left);
  const seatTop = parseFloat(seatPos.top);

  // Center of table for collected cards
  const centerLeft = 50;
  const centerTop = 42;

  // Spread collected cards in center
  const spreadOffset = collectedTotal > 1
    ? (collectedIndex - (collectedTotal - 1) / 2) * 28
    : 0;

  if (phase === 'waiting') return null;

  return (
    <div
      className={`rt-reveal-card rt-reveal-card--${phase} ${isPartOfHand ? 'rt-reveal-card--hand' : 'rt-reveal-card--burn'}`}
      style={{
        '--seat-x': `${seatLeft}%`,
        '--seat-y': `${seatTop}%`,
        '--center-x': `calc(${centerLeft}% + ${spreadOffset}px)`,
        '--center-y': `${centerTop}%`,
        '--fly-duration': `${CARD_FLY_DURATION}ms`,
      } as React.CSSProperties}
    >
      <div className="rt-reveal-card-inner">
        <CardDisplay card={card} />
      </div>
    </div>
  );
});
