/**
 * Information set abstraction for CFR training.
 *
 * An information set captures everything a player knows at a decision point:
 * - Their own cards (abstracted to relevant features)
 * - What hand has been called (the current claim on the table)
 * - The round phase (calling, bull phase, last chance)
 * - Number of active players and total cards in play
 * - Turn history context (how many bulls/trues have been called)
 *
 * We bucket states aggressively to keep the state space manageable.
 * Bull 'Em's action space explodes with specific hand calls, so we abstract
 * hand calls into "strength buckets" rather than tracking exact hands.
 */

import type { Card, HandCall, Rank, Suit, ClientGameState } from '@bull-em/shared';
import { HandType, RoundPhase } from '@bull-em/shared';
import { RANK_VALUES } from '@bull-em/shared';

// ── Card abstraction ────────────────────────────────────────────────────

/** Summarize a player's hand into features relevant for decision-making. */
export interface HandFeatures {
  /** Number of cards the player holds. */
  cardCount: number;
  /** Number of distinct ranks in hand. */
  distinctRanks: number;
  /** Size of the largest rank group (e.g., 3 means a three-of-a-kind exists). */
  maxRankGroup: number;
  /** Number of distinct suits in hand. */
  distinctSuits: number;
  /** Size of the largest suit group (relevant for flush likelihood). */
  maxSuitGroup: number;
  /** Whether the hand contains a 2+ card straight run. */
  hasStraightDraw: boolean;
  /** Highest rank value in hand (2-14). */
  highCard: number;
}

export function extractHandFeatures(cards: Card[]): HandFeatures {
  if (cards.length === 0) {
    return {
      cardCount: 0, distinctRanks: 0, maxRankGroup: 0,
      distinctSuits: 0, maxSuitGroup: 0, hasStraightDraw: false, highCard: 0,
    };
  }

  const rankGroups = new Map<Rank, number>();
  const suitGroups = new Map<Suit, number>();
  let highCard = 0;

  for (const card of cards) {
    rankGroups.set(card.rank, (rankGroups.get(card.rank) ?? 0) + 1);
    suitGroups.set(card.suit, (suitGroups.get(card.suit) ?? 0) + 1);
    const val = RANK_VALUES[card.rank];
    if (val > highCard) highCard = val;
  }

  const rankValues = [...rankGroups.keys()].map(r => RANK_VALUES[r]).sort((a, b) => a - b);
  let hasStraightDraw = false;
  for (let i = 1; i < rankValues.length; i++) {
    if (rankValues[i]! - rankValues[i - 1]! <= 2) {
      hasStraightDraw = true;
      break;
    }
  }

  return {
    cardCount: cards.length,
    distinctRanks: rankGroups.size,
    maxRankGroup: Math.max(...rankGroups.values()),
    distinctSuits: suitGroups.size,
    maxSuitGroup: Math.max(...suitGroups.values()),
    hasStraightDraw,
    highCard,
  };
}

// ── Claim strength bucketing ────────────────────────────────────────────

/**
 * Map a HandCall to a coarse "strength bucket" (0-based).
 * This drastically reduces the information set space by not tracking
 * the exact rank/suit of each called hand.
 *
 * Buckets (0-9 map to hand types, with sub-buckets for rank tiers):
 * - 0: High card (low: 2-7, mid: 8-Q, high: K-A)
 * - 1: Pair (low/mid/high)
 * - 2: Two pair
 * - 3: Flush
 * - 4: Three of a kind
 * - 5: Straight (low/high)
 * - 6: Full house
 * - 7: Four of a kind
 * - 8: Straight flush
 * - 9: Royal flush
 */
export function handCallStrengthBucket(hand: HandCall): number {
  // Use hand type as the primary bucket (0-9)
  // For types with rank variation, add a sub-bucket tier
  switch (hand.type) {
    case HandType.HIGH_CARD:
      return rankTier(hand.rank) * 0.1; // 0.0, 0.1, 0.2
    case HandType.PAIR:
      return 1 + rankTier(hand.rank) * 0.1;
    case HandType.TWO_PAIR:
      return 2;
    case HandType.FLUSH:
      return 3;
    case HandType.THREE_OF_A_KIND:
      return 4 + rankTier(hand.rank) * 0.1;
    case HandType.STRAIGHT:
      return 5 + (RANK_VALUES[hand.highRank] >= 10 ? 0.1 : 0);
    case HandType.FULL_HOUSE:
      return 6;
    case HandType.FOUR_OF_A_KIND:
      return 7;
    case HandType.STRAIGHT_FLUSH:
      return 8;
    case HandType.ROYAL_FLUSH:
      return 9;
  }
}

function rankTier(rank: Rank): number {
  const v = RANK_VALUES[rank];
  if (v <= 7) return 0;  // low
  if (v <= 12) return 1; // mid
  return 2;              // high (K, A)
}

/** Bucket a numeric high card value (2-14) into a tier number. */
function highCardTier(value: number): number {
  if (value <= 7) return 0;
  if (value <= 12) return 1;
  return 2;
}

// ── Game context bucketing ──────────────────────────────────────────────

/** Bucket for the player's position relative to total cards in play. */
function cardRatioBucket(myCards: number, totalCards: number): string {
  if (totalCards === 0) return 'x';
  const ratio = myCards / totalCards;
  if (ratio <= 0.15) return 'few';    // I hold few of the total cards
  if (ratio <= 0.35) return 'some';
  return 'many';                       // I hold a large fraction
}

/** Bucket for how many players remain. */
function playerCountBucket(activePlayers: number): string {
  if (activePlayers <= 2) return '2';
  if (activePlayers <= 4) return '3-4';
  return '5+';
}

// ── Action abstraction ──────────────────────────────────────────────────

/**
 * Abstract actions available at each decision point.
 * Instead of enumerating every possible HandCall, we group raises
 * into strength categories relative to the current claim.
 */
export enum AbstractAction {
  /** Call bull — claim the current hand doesn't exist. */
  BULL = 'bull',
  /** Call true — claim the current hand does exist. */
  TRUE = 'true',
  /** Raise to a hand in the same type category (small raise). */
  RAISE_SAME = 'raise_same',
  /** Raise to the next hand type category (medium raise). */
  RAISE_NEXT = 'raise_next',
  /** Raise to a hand 2+ categories above (big bluff/value raise). */
  RAISE_BIG = 'raise_big',
  /** Open with a low hand (high card or pair). */
  OPEN_LOW = 'open_low',
  /** Open with a medium hand (two pair through straight). */
  OPEN_MID = 'open_mid',
  /** Open with a high hand (full house or above). */
  OPEN_HIGH = 'open_high',
  /** Last chance: pass (don't raise). */
  LAST_CHANCE_PASS = 'lc_pass',
  /** Last chance: raise. */
  LAST_CHANCE_RAISE = 'lc_raise',
}

/** All possible abstract actions in a fixed order. */
export const ALL_ABSTRACT_ACTIONS: readonly AbstractAction[] = Object.values(AbstractAction);

/**
 * Determine which abstract actions are legal at the current decision point.
 */
export function getLegalAbstractActions(
  state: ClientGameState,
): AbstractAction[] {
  const { roundPhase, currentHand } = state;

  if (roundPhase === RoundPhase.LAST_CHANCE) {
    return [AbstractAction.LAST_CHANCE_PASS, AbstractAction.LAST_CHANCE_RAISE];
  }

  if (roundPhase === RoundPhase.BULL_PHASE) {
    // In bull phase: can bull, true, or raise
    const actions: AbstractAction[] = [AbstractAction.BULL, AbstractAction.TRUE];
    if (currentHand) {
      actions.push(AbstractAction.RAISE_SAME, AbstractAction.RAISE_NEXT, AbstractAction.RAISE_BIG);
    }
    return actions;
  }

  // CALLING phase
  if (!currentHand) {
    // Opening call — no hand on the table yet
    return [AbstractAction.OPEN_LOW, AbstractAction.OPEN_MID, AbstractAction.OPEN_HIGH];
  }

  // Subsequent call — must raise or call bull
  return [
    AbstractAction.BULL,
    AbstractAction.RAISE_SAME,
    AbstractAction.RAISE_NEXT,
    AbstractAction.RAISE_BIG,
  ];
}

// ── Information set key ─────────────────────────────────────────────────

/**
 * Generate a compact string key representing the information set.
 * This is what CFR uses to look up regret/strategy tables.
 *
 * Format: phase|players|cardRatio|handFeatures|claimBucket|bullCount
 */
export function getInfoSetKey(
  state: ClientGameState,
  myCards: Card[],
  totalCards: number,
): string {
  const features = extractHandFeatures(myCards);
  const activePlayers = state.players.filter(p => !p.isEliminated).length;

  const parts: string[] = [
    // Game context
    state.roundPhase.charAt(0), // c=calling, b=bull_phase, l=last_chance
    playerCountBucket(activePlayers),
    cardRatioBucket(myCards.length, totalCards),

    // My hand features (bucketed)
    `${features.cardCount}`,
    `g${features.maxRankGroup}`,  // max rank group size
    `s${features.maxSuitGroup}`,  // max suit group size
    features.hasStraightDraw ? 'd1' : 'd0',
    `h${highCardTier(features.highCard)}`,

    // Current claim on the table
    state.currentHand ? `cl${handCallStrengthBucket(state.currentHand).toFixed(1)}` : 'cl-',

    // Turn history context
    `bc${countBullCalls(state)}`,
  ];

  return parts.join('|');
}

function countBullCalls(state: ClientGameState): number {
  let count = 0;
  for (const entry of state.turnHistory) {
    if (entry.action === 'bull') count++;
  }
  // Bucket: 0, 1, 2+
  return Math.min(count, 2);
}
