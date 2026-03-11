import { memo, useEffect, useState, useMemo, useRef } from 'react';
import type { RoundResult, Player, OwnedCard } from '@bull-em/shared';
import { handToString } from '@bull-em/shared';
import { getSeatPosition } from '../utils/roundtablePositions.js';
import { CardDisplay } from './CardDisplay.js';
import { useSound } from '../hooks/useSound.js';

/** Timing constants (ms) */
const CARD_FLIP_DURATION = 450;    // 3D card flip animation time
const FLY_TO_CENTER_DURATION = 400; // fly from seat to center of table
const CARD_BURN_DURATION = 500;    // non-hand card fade/burn
const CARD_INTERVAL = 300;         // delay between cards within same player
const PLAYER_PAUSE = 500;          // pause between players for narrative pacing
const POST_FLIP_PAUSE = 150;       // brief pause after flip before fly/burn
const RESULT_DELAY = 700;          // delay after last card before showing result
const MIN_DISPLAY_TIME = 1500;     // minimum time to show result before allowing dismiss

interface Props {
  result: RoundResult;
  /** Seat-ordered players (index 0 = local player) */
  orderedPlayers: Player[];
  playerCount: number;
  myPlayerId?: string;
  onComplete: () => void;
}

/** Each slot in the reveal sequence — one per card in every player's hand. */
interface RevealSlot {
  id: number;
  playerId: string;
  seatIndex: number;
  /** Which card slot within this player's hand */
  cardSlotIndex: number;
  /** Total cards this player has */
  playerCardTotal: number;
  /** The revealed card data, or null for non-revealed card backs that will burn */
  revealedCard: OwnedCard | null;
  /** Whether this card is part of the called hand (relevant card that gets revealed) */
  isRelevant: boolean;
  phase: 'hidden' | 'showing' | 'flipping' | 'flying' | 'burning' | 'settled' | 'burned';
  /** Index in the center pile (for stacking offset when flying to center) */
  centerIndex: number;
}

/**
 * Cinematic reveal animation for the roundtable layout.
 *
 * Reveal order: player next to the caller (clockwise) → around the table → caller last.
 * For each player's cards, one by one:
 *   - Revealed (hand-relevant) cards: card back flips face-up, then flies to table center
 *   - Non-revealed cards: card back slowly burns away (fade + dim)
 *
 * The real seat card backs are hidden by the parent layout during this animation.
 */
export const RoundtableRevealOverlay = memo(function RoundtableRevealOverlay({
  result,
  orderedPlayers,
  playerCount,
  myPlayerId,
  onComplete,
}: Props) {
  const { play } = useSound();
  const [slots, setSlots] = useState<RevealSlot[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [showBeat2, setShowBeat2] = useState(false);
  const [canDismiss, setCanDismiss] = useState(false);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Personalized beat 1 message (SAFE/WRONG/BUSTED)
  const beat1 = useMemo(() => {
    if (!myPlayerId) return null;
    const isCaller = myPlayerId === result.callerId;
    const wasPenalized = result.penalizedPlayerIds.includes(myPlayerId);

    if (isCaller && wasPenalized && !result.handExists) {
      return { text: 'BUSTED', color: 'var(--danger)' };
    }
    if (wasPenalized) {
      return { text: 'WRONG', color: 'var(--danger)' };
    }
    return { text: 'SAFE', color: 'var(--safe)' };
  }, [myPlayerId, result.callerId, result.handExists, result.penalizedPlayerIds]);

  // Build seat index lookup
  const seatIndexByPlayerId = useMemo(() => {
    const map = new Map<string, number>();
    orderedPlayers.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [orderedPlayers]);

  // Group revealed cards by player for quick lookup
  const revealedByPlayer = useMemo(() => {
    const map = new Map<string, OwnedCard[]>();
    for (const card of result.revealedCards) {
      if (!map.has(card.playerId)) map.set(card.playerId, []);
      map.get(card.playerId)!.push(card);
    }
    return map;
  }, [result.revealedCards]);

  // Determine caller's seat and build the reveal order:
  // start from caller+1 clockwise, end with caller
  const revealPlayerOrder = useMemo(() => {
    const callerSeat = seatIndexByPlayerId.get(result.callerId) ?? 0;
    const order: number[] = [];
    for (let i = 1; i <= playerCount; i++) {
      order.push((callerSeat + i) % playerCount);
    }
    return order;
  }, [seatIndexByPlayerId, result.callerId, playerCount]);

  // Build the full slot sequence — ALL cards for ALL players
  const slotSequence = useMemo(() => {
    const seq: Omit<RevealSlot, 'phase'>[] = [];
    let id = 0;
    let centerIdx = 0;

    for (const seatIdx of revealPlayerOrder) {
      const player = orderedPlayers[seatIdx];
      if (!player || player.isEliminated) continue;

      const playerRevealed = revealedByPlayer.get(player.id) ?? [];
      const totalCards = player.cardCount;

      // Assign revealed cards to the first slots, non-revealed to the rest.
      // This gives a clean visual: relevant cards flip first, then the rest burn.
      for (let cardIdx = 0; cardIdx < totalCards; cardIdx++) {
        const revealedCard = cardIdx < playerRevealed.length ? (playerRevealed[cardIdx] ?? null) : null;
        const isRelevant = revealedCard !== null;

        seq.push({
          id: id++,
          playerId: player.id,
          seatIndex: seatIdx,
          cardSlotIndex: cardIdx,
          playerCardTotal: totalCards,
          revealedCard,
          isRelevant,
          centerIndex: isRelevant ? centerIdx++ : -1,
        });
      }
    }

    return seq;
  }, [revealPlayerOrder, orderedPlayers, revealedByPlayer]);

  // Count total relevant (hand) cards for centering layout
  const totalRelevantCards = useMemo(
    () => slotSequence.filter(s => s.isRelevant).length,
    [slotSequence],
  );

  // Calculate timing for each slot
  const slotTimings = useMemo(() => {
    const timings: number[] = [];
    let currentTime = 200; // brief initial delay
    let lastPlayerId = '';
    let burnGroupStarted = false;

    for (const slot of slotSequence) {
      // Add player pause when switching to a new player
      if (slot.playerId !== lastPlayerId && lastPlayerId !== '') {
        currentTime += PLAYER_PAUSE;
        burnGroupStarted = false;
      }
      timings.push(currentTime);
      // Revealed cards take longer (flip + fly), non-revealed cards just burn
      if (slot.isRelevant) {
        currentTime += CARD_FLIP_DURATION + POST_FLIP_PAUSE + FLY_TO_CENTER_DURATION + CARD_INTERVAL;
        burnGroupStarted = false;
      } else if (!burnGroupStarted) {
        // First non-relevant card in a group: advance time once for all of them
        burnGroupStarted = true;
        currentTime += CARD_BURN_DURATION + CARD_INTERVAL;
      }
      // Subsequent non-relevant cards for the same player share the same start time
      lastPlayerId = slot.playerId;
    }

    return timings;
  }, [slotSequence]);

  // Run the reveal animation
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timerRefs.current = timers;

    // Initialize all slots as "showing" (card backs visible at seats)
    const initial: RevealSlot[] = slotSequence.map(s => ({ ...s, phase: 'showing' as const }));
    setSlots(initial);

    for (let i = 0; i < slotSequence.length; i++) {
      const slot = slotSequence[i]!;
      const startTime = slotTimings[i] ?? 0;

      if (slot.isRelevant) {
        // Revealed card: showing → flipping → flying → settled
        const t1 = setTimeout(() => {
          play('cardDeal');
          setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, phase: 'flipping' } : s));
        }, startTime);
        timers.push(t1);

        const t2 = setTimeout(() => {
          setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, phase: 'flying' } : s));
        }, startTime + CARD_FLIP_DURATION + POST_FLIP_PAUSE);
        timers.push(t2);

        const t3 = setTimeout(() => {
          setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, phase: 'settled' } : s));
        }, startTime + CARD_FLIP_DURATION + POST_FLIP_PAUSE + FLY_TO_CENTER_DURATION);
        timers.push(t3);
      } else {
        // Non-revealed card: showing → burning → burned
        const t1 = setTimeout(() => {
          setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, phase: 'burning' } : s));
        }, startTime);
        timers.push(t1);

        const t2 = setTimeout(() => {
          setSlots(prev => prev.map(s => s.id === slot.id ? { ...s, phase: 'burned' } : s));
        }, startTime + CARD_BURN_DURATION);
        timers.push(t2);
      }
    }

    // Show result after all cards processed
    const lastTime = slotTimings[slotTimings.length - 1] ?? 0;
    const lastSlot = slotSequence[slotSequence.length - 1];
    const lastDuration = lastSlot?.isRelevant
      ? CARD_FLIP_DURATION + POST_FLIP_PAUSE + FLY_TO_CENTER_DURATION
      : CARD_BURN_DURATION;
    const totalTime = lastTime + lastDuration + RESULT_DELAY;

    const resultTimer = setTimeout(() => setShowResult(true), totalTime);
    timers.push(resultTimer);

    // Transition from beat 1 (SAFE/WRONG/BUSTED) to beat 2 (hand exists/fake) after 1.5s
    const beat2Timer = setTimeout(() => setShowBeat2(true), totalTime + 1500);
    timers.push(beat2Timer);

    const dismissTimer = setTimeout(() => setCanDismiss(true), totalTime + MIN_DISPLAY_TIME);
    timers.push(dismissTimer);

    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  return (
    <div className="rt-reveal-overlay" onClick={canDismiss ? onComplete : undefined}>
      {/* Called hand label at top */}
      <div className="rt-reveal-header animate-fade-in">
        <span className="rt-reveal-hand-label">
          {handToString(result.calledHand)}
        </span>
      </div>

      {/* Card slots — each card animates at its seat or flies to center */}
      {slots.map(slot => (
        <RevealSlotElement
          key={slot.id}
          slot={slot}
          playerCount={playerCount}
          totalRelevantCards={totalRelevantCards}
        />
      ))}

      {/* Result banner */}
      {showResult && (
        <div className="rt-reveal-result animate-cube-roll-in">
          <div className="rt-reveal-result-scrim" />
          {beat1 ? (
            <div
              className="rt-reveal-result-box"
              style={{
                borderColor: showBeat2
                  ? (result.handExists ? 'var(--info)' : 'var(--danger)')
                  : beat1.color,
                background: showBeat2
                  ? (result.handExists ? 'var(--info-bg)' : 'var(--danger-bg)')
                  : (beat1.color === 'var(--safe)' ? 'rgba(40, 167, 69, 0.15)' : 'var(--danger-bg)'),
              }}
            >
              {/* Beat 1: SAFE / WRONG / BUSTED */}
              <div
                className="rt-reveal-result-beat"
                style={{
                  color: beat1.color,
                  opacity: showBeat2 ? 0 : 1,
                  transform: showBeat2 ? 'scale(0.8) translateY(-4px)' : 'scale(1) translateY(0)',
                  position: showBeat2 ? 'absolute' : 'relative',
                  inset: showBeat2 ? 0 : undefined,
                }}
              >
                {beat1.text}
              </div>
              {/* Beat 2: hand exists / hand is fake */}
              <div
                className="rt-reveal-result-beat"
                style={{
                  color: result.handExists ? 'var(--info)' : 'var(--danger)',
                  opacity: showBeat2 ? 1 : 0,
                  transform: showBeat2 ? 'scale(1) translateY(0)' : 'scale(1.15) translateY(4px)',
                  position: showBeat2 ? 'relative' : 'absolute',
                  inset: showBeat2 ? undefined : 0,
                }}
              >
                {result.handExists ? 'The hand EXISTS!' : 'Hand is fake!'}
              </div>
            </div>
          ) : (
            <div className={`rt-reveal-result-text ${result.handExists ? 'rt-reveal-result--exists' : 'rt-reveal-result--fake'}`}>
              {result.handExists ? 'The hand EXISTS!' : 'BULL! Hand is fake!'}
            </div>
          )}
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

/** Center of the table — where revealed cards fly to and stack. */
const TABLE_CENTER_X = 50;
const TABLE_CENTER_Y = 42;
/** Horizontal spacing (in px) between cards arranged in a line at center */
const CENTER_CARD_SPACING = 52;

/** Individual card in the reveal sequence. */
const RevealSlotElement = memo(function RevealSlotElement({
  slot,
  playerCount,
  totalRelevantCards,
}: {
  slot: RevealSlot;
  playerCount: number;
  totalRelevantCards: number;
}) {
  const { seatIndex, revealedCard, phase, cardSlotIndex, playerCardTotal, centerIndex } = slot;
  const seatPos = getSeatPosition(playerCount, seatIndex);

  const seatLeft = parseFloat(seatPos.left);
  const seatTop = parseFloat(seatPos.top);

  // Fan offset within player's seat (matches SeatCardBacks layout)
  const spreadOffset = playerCardTotal > 1
    ? (cardSlotIndex - (playerCardTotal - 1) / 2) * 24
    : 0;

  // Don't render hidden or fully burned cards
  if (phase === 'hidden' || phase === 'burned') return null;

  // Cards that have "settled" at center render at the center pile position
  const isAtCenter = phase === 'flying' || phase === 'settled';

  // Arrange cards in a neat horizontal line at center (evenly spaced)
  const centerOffsetX = centerIndex >= 0
    ? (centerIndex - (totalRelevantCards - 1) / 2) * CENTER_CARD_SPACING
    : 0;
  const centerOffsetY = 0;

  const posX = isAtCenter ? `calc(${TABLE_CENTER_X}% + ${centerOffsetX}px)` : `calc(${seatLeft}% + ${spreadOffset}px)`;
  const posY = isAtCenter ? `${TABLE_CENTER_Y}%` : `${seatTop}%`;

  return (
    <div
      className={[
        'rt-reveal-card',
        phase === 'flipping' ? 'rt-reveal-card--flipping' : '',
        phase === 'flying' ? 'rt-reveal-card--flying' : '',
        phase === 'settled' ? 'rt-reveal-card--settled' : '',
        phase === 'burning' ? 'rt-reveal-card--burning' : '',
        phase === 'showing' && !revealedCard ? '' : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--seat-x': posX,
        '--seat-y': posY,
        '--center-x': `calc(${TABLE_CENTER_X}% + ${centerOffsetX}px)`,
        '--center-y': `calc(${TABLE_CENTER_Y}% + ${centerOffsetY}px)`,
        '--seat-orig-x': `calc(${seatLeft}% + ${spreadOffset}px)`,
        '--seat-orig-y': `${seatTop}%`,
        '--center-rotation': '0deg',
        '--fly-duration': `${FLY_TO_CENTER_DURATION}ms`,
        '--burn-duration': `${CARD_BURN_DURATION}ms`,
      } as React.CSSProperties}
    >
      <div className="rt-reveal-card-flipper">
        {/* Back face */}
        <div className="rt-reveal-card-back rt-card-back" />
        {/* Front face — only present for revealed cards */}
        <div className="rt-reveal-card-front">
          {revealedCard ? <CardDisplay card={revealedCard} /> : <div className="rt-card-back" />}
        </div>
      </div>
    </div>
  );
});
