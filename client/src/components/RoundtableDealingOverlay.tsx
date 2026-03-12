import { memo, useEffect, useState, useRef, useMemo } from 'react';
import type { Player, Card } from '@bull-em/shared';
import { getSeatPosition } from '../utils/roundtablePositions.js';
import { useSound } from '../hooks/useSound.js';
import { CardDisplay } from './CardDisplay.js';

/** Timing constants (ms) */
const CARD_DEAL_INTERVAL = 200; // delay between each card dealt
const CARD_FLY_DURATION = 420;  // how long each card takes to fly to its seat
const DECK_FADE_DELAY = 300;    // delay after last card before deck fades
const OVERLAY_LINGER = 200;     // extra time before overlay unmounts

interface Props {
  myPlayerId: string | null;
  myCards: Card[];
  playerCount: number;
  /** Seat-ordered players (index 0 = local player) */
  orderedPlayers: Player[];
  /** Called when a card finishes flying and "lands" at a seat — used to
   *  progressively reveal seat card backs in the layout. */
  onCardDealt?: (seatIndex: number) => void;
}

interface FlyingCard {
  id: number;
  seatIndex: number;
  playerId: string;
  /** Card data for the local player's cards (face-up), null for opponents (face-down) */
  card: Card | null;
  startTime: number;
  landed: boolean;
}

/**
 * Animated card dealing overlay for the roundtable layout.
 * Shows a deck in the center of the table, then deals cards one-by-one
 * flying to each player's seat position in turn order.
 *
 * Cards land face-down for opponents, face-up for the local player.
 * After all cards are dealt, the deck fades out and the overlay unmounts.
 */
export const RoundtableDealingOverlay = memo(function RoundtableDealingOverlay({
  myPlayerId,
  myCards,
  playerCount,
  orderedPlayers,
  onCardDealt,
}: Props) {
  const { play } = useSound();
  const [flyingCards, setFlyingCards] = useState<FlyingCard[]>([]);
  const [deckVisible, setDeckVisible] = useState(true);
  const [dealtCount, setDealtCount] = useState(0);
  const [done, setDone] = useState(false);
  const timerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Build the deal sequence: one card at a time, round-robin across players
  // The deal order follows seat order (0, 1, 2, ...) like a real dealer
  const dealSequence = useMemo(() => {
    const seq: { seatIndex: number; playerId: string; card: Card | null; cardIndex: number }[] = [];

    // How many cards does each player have this round?
    const cardCountByPlayer = new Map<string, number>();
    for (const p of orderedPlayers) {
      if (!p.isEliminated) {
        cardCountByPlayer.set(p.id, p.cardCount);
      }
    }

    // Maximum cards any player has
    const maxCards = Math.max(...Array.from(cardCountByPlayer.values()), 0);
    if (maxCards === 0) return seq;

    // Local player's card mapping for face-up display
    const myCardsList = myCards ?? [];

    // Deal round-robin: card 0 to all players, then card 1 to all, etc.
    for (let cardIdx = 0; cardIdx < maxCards; cardIdx++) {
      for (let seatIdx = 0; seatIdx < Math.min(orderedPlayers.length, playerCount); seatIdx++) {
        const player = orderedPlayers[seatIdx];
        if (!player || player.isEliminated) continue;
        const pCardCount = cardCountByPlayer.get(player.id) ?? 0;
        if (cardIdx >= pCardCount) continue;

        const isMe = player.id === myPlayerId;
        const card = isMe && cardIdx < myCardsList.length ? myCardsList[cardIdx] ?? null : null;

        seq.push({ seatIndex: seatIdx, playerId: player.id, card, cardIndex: cardIdx });
      }
    }

    return seq;
  }, [orderedPlayers, playerCount, myPlayerId, myCards]);

  // Run the dealing animation
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    timerRefs.current = timers;

    dealSequence.forEach((deal, i) => {
      const delay = i * CARD_DEAL_INTERVAL;
      // Only play the deal sound for the first card in each round-robin pass
      // (i.e. once per cardIndex) to avoid rapid-fire audio when many cards
      // are being dealt across multiple players simultaneously.
      const isFirstInPass = i === 0 || dealSequence[i - 1]?.cardIndex !== deal.cardIndex;
      const t = setTimeout(() => {
        if (isFirstInPass) {
          play('cardDeal');
        }
        setDealtCount(i + 1);
        setFlyingCards(prev => [
          ...prev,
          {
            id: i,
            seatIndex: deal.seatIndex,
            playerId: deal.playerId,
            card: deal.card,
            startTime: Date.now(),
            landed: false,
          },
        ]);

        // Mark card as landed after fly duration and notify parent
        const landTimer = setTimeout(() => {
          setFlyingCards(prev =>
            prev.map(c => c.id === i ? { ...c, landed: true } : c),
          );
          onCardDealt?.(deal.seatIndex);
        }, CARD_FLY_DURATION);
        timers.push(landTimer);
      }, delay);
      timers.push(t);
    });

    // After all cards dealt + fly + linger, fade deck and finish
    const totalDealTime = dealSequence.length * CARD_DEAL_INTERVAL + CARD_FLY_DURATION;
    const fadeTimer = setTimeout(() => setDeckVisible(false), totalDealTime + DECK_FADE_DELAY);
    timers.push(fadeTimer);

    const doneTimer = setTimeout(() => setDone(true), totalDealTime + DECK_FADE_DELAY + OVERLAY_LINGER);
    timers.push(doneTimer);

    return () => {
      for (const t of timers) clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount
  }, []);

  if (done) return null;

  return (
    <div
      className="rt-dealing-overlay"
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
    >
      {/* Deck in center of table */}
      <div
        className={`rt-dealing-deck ${deckVisible ? '' : 'rt-dealing-deck--fade'}`}
        style={{
          '--deck-shrink': Math.min(dealtCount / Math.max(dealSequence.length, 1), 1),
        } as React.CSSProperties}
      >
        {/* Stack of cards for visual depth — 6 layers with 3D offsets */}
        <div className="rt-dealing-deck-stack">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className="rt-card-back rt-dealing-deck-card"
              style={{
                transform: `translate(${-i * 0.5}px, ${-i * 1.2}px)`,
                zIndex: i,
              }}
            />
          ))}
        </div>
      </div>

      {/* Flying cards */}
      {flyingCards.map(fc => (
        <FlyingCardElement
          key={fc.id}
          flyingCard={fc}
          playerCount={playerCount}
        />
      ))}
    </div>
  );
});

/** Individual flying card that animates from deck center to seat position. */
const FlyingCardElement = memo(function FlyingCardElement({
  flyingCard,
  playerCount,
}: {
  flyingCard: FlyingCard;
  playerCount: number;
}) {
  const { seatIndex, card, landed } = flyingCard;
  const targetPos = getSeatPosition(playerCount, seatIndex);

  // Parse target position percentages
  const targetLeft = parseFloat(targetPos.left);
  const targetTop = parseFloat(targetPos.top);

  // The deck is at ~ center of the table (50%, 44%)
  // Cards start there and fly to the seat position
  const startLeft = 50;
  const startTop = 44;

  return (
    <div
      className={`rt-flying-card ${landed ? 'rt-flying-card--landed' : ''}`}
      style={{
        '--fly-start-x': `${startLeft}%`,
        '--fly-start-y': `${startTop}%`,
        '--fly-end-x': `${targetLeft}%`,
        '--fly-end-y': `${targetTop}%`,
        '--fly-duration': `${CARD_FLY_DURATION}ms`,
      } as React.CSSProperties}
    >
      {card ? (
        // Face-up card for local player
        <div className="rt-flying-card-face">
          <CardDisplay card={card} />
        </div>
      ) : (
        // Face-down card for opponents
        <div className="rt-card-back rt-flying-card-back" />
      )}
    </div>
  );
});
