import { memo, useEffect, useState, useMemo, useRef } from 'react';
import type { RoundResult, Player, OwnedCard } from '@bull-em/shared';
import { handToString } from '@bull-em/shared';
import { getSeatPosition } from '../utils/roundtablePositions.js';
import { CardDisplay } from './CardDisplay.js';
import { useSound } from '../hooks/useSound.js';

/** Timing constants (ms) */
const CARD_FLIP_DURATION = 500;    // 3D card flip animation time
const CARD_FLIP_INTERVAL = 250;    // delay between cards within same player
const PLAYER_PAUSE = 400;          // pause between players for narrative pacing
const SETTLE_DELAY = 300;          // delay after flip before applying highlight/dim
const RESULT_DELAY = 700;          // delay after last card before showing result
const MIN_DISPLAY_TIME = 1500;     // minimum time to show result before allowing dismiss

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
  /** Which card slot this is at the player's seat (for offset positioning) */
  cardSlotIndex: number;
  /** Total cards this player has (for offset calculation) */
  playerCardTotal: number;
  /** Whether this card is part of the called hand */
  isPartOfHand: boolean;
  phase: 'waiting' | 'flipping' | 'revealed';
}

/**
 * Cinematic reveal animation for the roundtable layout.
 * Cards reveal player-by-player at their seat positions with 3D card flips.
 * No overlay — the table stays fully visible throughout.
 * Hand cards get a gold glow; non-hand cards dim after flipping.
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
  const handCardKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const card of result.revealedCards) {
      keys.add(`${card.playerId}-${card.rank}-${card.suit}`);
    }
    return keys;
  }, [result.revealedCards]);

  // Build the reveal sequence: grouped by player (seat order), all cards per player together
  const revealSequence = useMemo(() => {
    // Group cards by player
    const byPlayer = new Map<string, { card: OwnedCard; seatIndex: number; isPartOfHand: boolean }[]>();

    for (const ownedCard of result.revealedCards) {
      const seatIndex = seatIndexByPlayerId.get(ownedCard.playerId) ?? 0;
      const key = `${ownedCard.playerId}-${ownedCard.rank}-${ownedCard.suit}`;
      const isPartOfHand = handCardKeys.has(key);

      if (!byPlayer.has(ownedCard.playerId)) {
        byPlayer.set(ownedCard.playerId, []);
      }
      byPlayer.get(ownedCard.playerId)!.push({ card: ownedCard, seatIndex, isPartOfHand });
    }

    // Order players by seat index for clockwise reveal
    const playerIds = Array.from(byPlayer.keys());
    playerIds.sort((a, b) => (seatIndexByPlayerId.get(a) ?? 0) - (seatIndexByPlayerId.get(b) ?? 0));

    // Flatten into sequence with card slot indices
    const seq: { card: OwnedCard; seatIndex: number; isPartOfHand: boolean; cardSlotIndex: number; playerCardTotal: number }[] = [];
    for (const playerId of playerIds) {
      const cards = byPlayer.get(playerId)!;
      cards.forEach((c, idx) => {
        seq.push({ ...c, cardSlotIndex: idx, playerCardTotal: cards.length });
      });
    }

    return seq;
  }, [result.revealedCards, seatIndexByPlayerId, handCardKeys]);

  // Calculate timing for each card based on player grouping
  const cardTimings = useMemo(() => {
    const timings: number[] = [];
    let currentTime = 0;
    let lastSeatIndex = -1;

    for (const item of revealSequence) {
      // Add pause when switching to a new player
      if (item.seatIndex !== lastSeatIndex && lastSeatIndex !== -1) {
        currentTime += PLAYER_PAUSE;
      }
      timings.push(currentTime);
      currentTime += CARD_FLIP_INTERVAL;
      lastSeatIndex = item.seatIndex;
    }

    return timings;
  }, [revealSequence]);

  // Run the reveal animation
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timerRefs.current = timers;

    // Initialize all cards in waiting state
    const initial: RevealCard[] = revealSequence.map((item, i) => ({
      id: i,
      card: item.card,
      seatIndex: item.seatIndex,
      cardSlotIndex: item.cardSlotIndex,
      playerCardTotal: item.playerCardTotal,
      isPartOfHand: item.isPartOfHand,
      phase: 'waiting' as const,
    }));
    setRevealCards(initial);

    // Reveal cards with player-grouped timing
    revealSequence.forEach((_, i) => {
      const revealDelay = cardTimings[i] ?? i * CARD_FLIP_INTERVAL;

      // Start flipping
      const t1 = setTimeout(() => {
        play('cardDeal');
        setRevealCards(prev =>
          prev.map(c => c.id === i ? { ...c, phase: 'flipping' } : c),
        );
      }, revealDelay);
      timers.push(t1);

      // Complete the flip — card is now face-up with highlight/dim
      const t2 = setTimeout(() => {
        setRevealCards(prev =>
          prev.map(c => c.id === i ? { ...c, phase: 'revealed' } : c),
        );
      }, revealDelay + CARD_FLIP_DURATION + SETTLE_DELAY);
      timers.push(t2);
    });

    // Show result after all cards revealed
    const lastCardTime = cardTimings[cardTimings.length - 1] ?? 0;
    const totalRevealTime = lastCardTime + CARD_FLIP_DURATION + SETTLE_DELAY + RESULT_DELAY;
    const resultTimer = setTimeout(() => setShowResult(true), totalRevealTime);
    timers.push(resultTimer);

    const dismissTimer = setTimeout(() => setCanDismiss(true), totalRevealTime + MIN_DISPLAY_TIME);
    timers.push(dismissTimer);

    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  return (
    <div className="rt-reveal-overlay" onClick={canDismiss ? onComplete : undefined}>
      {/* Called hand label at top — no background overlay, just text with shadow */}
      <div className="rt-reveal-header animate-fade-in">
        <span className="rt-reveal-hand-label">
          {handToString(result.calledHand)}
        </span>
      </div>

      {/* Reveal cards — flip in place at each player's seat */}
      {revealCards.map(rc => (
        <RevealCardElement
          key={rc.id}
          revealCard={rc}
          playerCount={playerCount}
        />
      ))}

      {/* Result banner — only appears after all cards revealed */}
      {showResult && (
        <div className="rt-reveal-result animate-cube-roll-in">
          {/* Subtle scrim just behind the banner text for readability */}
          <div className="rt-reveal-result-scrim" />
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

/** Individual card in the reveal sequence — flips in place at player's seat. */
const RevealCardElement = memo(function RevealCardElement({
  revealCard,
  playerCount,
}: {
  revealCard: RevealCard;
  playerCount: number;
}) {
  const { seatIndex, card, phase, isPartOfHand, cardSlotIndex, playerCardTotal } = revealCard;
  const seatPos = getSeatPosition(playerCount, seatIndex);

  const seatLeft = parseFloat(seatPos.left);
  const seatTop = parseFloat(seatPos.top);

  // Offset cards horizontally within the same player's seat so they fan out
  const spreadOffset = playerCardTotal > 1
    ? (cardSlotIndex - (playerCardTotal - 1) / 2) * 24
    : 0;

  if (phase === 'waiting') return null;

  const isFlipping = phase === 'flipping';
  const isRevealed = phase === 'revealed';

  return (
    <div
      className={[
        'rt-reveal-card',
        isFlipping ? 'rt-reveal-card--flipping' : '',
        isRevealed && isPartOfHand ? 'rt-reveal-card--hand-glow' : '',
        isRevealed && !isPartOfHand ? 'rt-reveal-card--dimmed' : '',
      ].join(' ')}
      style={{
        '--seat-x': `calc(${seatLeft}% + ${spreadOffset}px)`,
        '--seat-y': `${seatTop}%`,
      } as React.CSSProperties}
    >
      <div className="rt-reveal-card-flipper">
        {/* Back face — shown during flip start */}
        <div className="rt-reveal-card-back rt-card-back" />
        {/* Front face — the actual card */}
        <div className="rt-reveal-card-front">
          <CardDisplay card={card} />
        </div>
      </div>
    </div>
  );
});
