/**
 * Information set abstraction for CFR training — supports 2-12 players.
 *
 * Uses 9 abstract actions that distinguish between truthful claims
 * (based on player's actual cards) and bluffs.
 *
 * Info set key encodes:
 * - Round phase
 * - Player count bucket (critical: optimal play differs by table size)
 * - Hand strength relative to the current claim
 * - Claim height bucket (low/mid/high/very_high)
 * - Turn depth within the round
 * - Card count (how many cards I hold)
 */

import type { Card, HandCall, Rank, Suit, ClientGameState, JokerCount, LastChanceMode } from '@bull-em/shared';
import { HandType, RoundPhase } from '@bull-em/shared';
import { RANK_VALUES } from '@bull-em/shared';

// ── Abstract action space (9 actions) ────────────────────────────────

/**
 * Abstract actions for CFR. The key insight: truthful vs bluff is
 * determined by comparing the action to the player's actual cards,
 * not by the action itself. The action mapper handles this distinction.
 */
export enum AbstractAction {
  /** Call/raise something you actually have or close to it — low tier. */
  TRUTHFUL_LOW = 'truthful_low',
  /** Truthful claim — medium tier. */
  TRUTHFUL_MID = 'truthful_mid',
  /** Truthful claim — high tier. */
  TRUTHFUL_HIGH = 'truthful_high',
  /** Bluff just above current claim — hand you don't have. */
  BLUFF_SMALL = 'bluff_small',
  /** Moderate bluff jump. */
  BLUFF_MID = 'bluff_mid',
  /** Major tier jump bluff. */
  BLUFF_BIG = 'bluff_big',
  /** Challenge the current call (call "bull"). */
  BULL = 'bull',
  /** Believe the current call (bull phase only). */
  TRUE = 'true',
  /** Pass on last chance (don't raise). */
  PASS = 'pass',
}

/** All abstract actions in fixed order. */
export const ALL_ABSTRACT_ACTIONS: readonly AbstractAction[] = Object.values(AbstractAction);

// ── Legal action determination ───────────────────────────────────────

/**
 * Determine which abstract actions are legal at the current decision point.
 * Both truthful and bluff actions are always available when raising/opening —
 * the distinction is made at mapping time based on the player's cards.
 */
export function getLegalAbstractActions(
  state: ClientGameState,
): AbstractAction[] {
  const { roundPhase, currentHand } = state;

  if (roundPhase === RoundPhase.LAST_CHANCE) {
    // Last chance: pass or raise (truthful/bluff variants)
    return [
      AbstractAction.PASS,
      AbstractAction.TRUTHFUL_LOW,
      AbstractAction.TRUTHFUL_MID,
      AbstractAction.TRUTHFUL_HIGH,
      AbstractAction.BLUFF_SMALL,
      AbstractAction.BLUFF_MID,
      AbstractAction.BLUFF_BIG,
    ];
  }

  if (roundPhase === RoundPhase.BULL_PHASE) {
    // Bull phase: bull, true, or raise
    const actions: AbstractAction[] = [AbstractAction.BULL, AbstractAction.TRUE];
    if (currentHand) {
      actions.push(
        AbstractAction.TRUTHFUL_LOW,
        AbstractAction.TRUTHFUL_MID,
        AbstractAction.TRUTHFUL_HIGH,
        AbstractAction.BLUFF_SMALL,
        AbstractAction.BLUFF_MID,
        AbstractAction.BLUFF_BIG,
      );
    }
    return actions;
  }

  // CALLING phase
  if (!currentHand) {
    // Opening — all raise actions available
    return [
      AbstractAction.TRUTHFUL_LOW,
      AbstractAction.TRUTHFUL_MID,
      AbstractAction.TRUTHFUL_HIGH,
      AbstractAction.BLUFF_SMALL,
      AbstractAction.BLUFF_MID,
      AbstractAction.BLUFF_BIG,
    ];
  }

  // Subsequent call — must raise or call bull
  return [
    AbstractAction.BULL,
    AbstractAction.TRUTHFUL_LOW,
    AbstractAction.TRUTHFUL_MID,
    AbstractAction.TRUTHFUL_HIGH,
    AbstractAction.BLUFF_SMALL,
    AbstractAction.BLUFF_MID,
    AbstractAction.BLUFF_BIG,
  ];
}

// ── Hand strength relative to claim ──────────────────────────────────

/**
 * Evaluate how the player's hand relates to the current claim.
 * Returns a bucket string for the info set key.
 *
 * - 'none': no claim yet (opening)
 * - 'has': player's cards alone could form or contribute to the claim
 * - 'close': player has partial support (e.g., 1 of a pair)
 * - 'below': player's cards don't support the claim at all
 */
function handVsClaimBucket(myCards: Card[], currentHand: HandCall | null): string {
  if (!currentHand) return 'none';

  switch (currentHand.type) {
    case HandType.HIGH_CARD: {
      const hasRank = myCards.some(c => c.rank === currentHand.rank);
      const hasHigher = myCards.some(c => RANK_VALUES[c.rank] > RANK_VALUES[currentHand.rank]);
      if (hasRank || hasHigher) return 'has';
      return 'below';
    }

    case HandType.PAIR: {
      const count = myCards.filter(c => c.rank === currentHand.rank).length;
      if (count >= 2) return 'has';
      if (count === 1) return 'close';
      // Check if we have a pair of anything
      const hasSomePair = hasGroupOfSize(myCards, 2);
      return hasSomePair ? 'close' : 'below';
    }

    case HandType.TWO_PAIR: {
      const hiCount = myCards.filter(c => c.rank === currentHand.highRank).length;
      const loCount = myCards.filter(c => c.rank === currentHand.lowRank).length;
      if (hiCount >= 2 && loCount >= 2) return 'has';
      if (hiCount >= 1 && loCount >= 1) return 'close';
      return 'below';
    }

    case HandType.FLUSH: {
      const suitCount = myCards.filter(c => c.suit === currentHand.suit).length;
      if (suitCount >= 3) return 'has';
      if (suitCount >= 2) return 'close';
      return 'below';
    }

    case HandType.THREE_OF_A_KIND: {
      const count = myCards.filter(c => c.rank === currentHand.rank).length;
      if (count >= 3) return 'has';
      if (count >= 2) return 'close';
      if (count >= 1) return 'close';
      return 'below';
    }

    case HandType.STRAIGHT: {
      // Check how many of the needed ranks we have
      const highVal = RANK_VALUES[currentHand.highRank];
      const neededVals = [highVal, highVal - 1, highVal - 2, highVal - 3, highVal - 4];
      const myVals = new Set(myCards.map(c => RANK_VALUES[c.rank]));
      const overlap = neededVals.filter(v => myVals.has(v)).length;
      if (overlap >= 3) return 'has';
      if (overlap >= 2) return 'close';
      return 'below';
    }

    case HandType.FULL_HOUSE: {
      const threeCount = myCards.filter(c => c.rank === currentHand.threeRank).length;
      const twoCount = myCards.filter(c => c.rank === currentHand.twoRank).length;
      if (threeCount >= 2 && twoCount >= 1) return 'has';
      if (threeCount >= 1 || twoCount >= 1) return 'close';
      return 'below';
    }

    case HandType.FOUR_OF_A_KIND: {
      const count = myCards.filter(c => c.rank === currentHand.rank).length;
      if (count >= 3) return 'has';
      if (count >= 2) return 'close';
      if (count >= 1) return 'close';
      return 'below';
    }

    case HandType.STRAIGHT_FLUSH: {
      const highVal = RANK_VALUES[currentHand.highRank];
      const neededVals = [highVal, highVal - 1, highVal - 2, highVal - 3, highVal - 4];
      const myMatchingCards = myCards.filter(c =>
        c.suit === currentHand.suit && neededVals.includes(RANK_VALUES[c.rank])
      );
      if (myMatchingCards.length >= 2) return 'has';
      if (myMatchingCards.length >= 1) return 'close';
      return 'below';
    }

    case HandType.ROYAL_FLUSH: {
      const royalRanks = new Set(['10', 'J', 'Q', 'K', 'A'] as const);
      const matching = myCards.filter(c =>
        c.suit === currentHand.suit && royalRanks.has(c.rank as '10' | 'J' | 'Q' | 'K' | 'A')
      );
      if (matching.length >= 2) return 'has';
      if (matching.length >= 1) return 'close';
      return 'below';
    }
  }
}

/** Check if there's a group of `size` cards with the same rank. */
function hasGroupOfSize(cards: Card[], size: number): boolean {
  const counts = new Map<Rank, number>();
  for (const c of cards) {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  for (const count of counts.values()) {
    if (count >= size) return true;
  }
  return false;
}

// ── Claim height bucketing ───────────────────────────────────────────

/**
 * Bucket the current claim into low/mid/high/vhi.
 * 4 real buckets provide finer strategic distinction:
 * - lo: high card, pair — almost always exist with enough cards
 * - mid: two pair, flush, trips — plausible but worth questioning
 * - hi: straight, full house — unusual, often bluffs
 * - vhi: four of a kind, straight flush, royal flush — almost always bluffs
 */
function claimHeightBucket(hand: HandCall | null): string {
  if (!hand) return 'x';
  if (hand.type <= HandType.PAIR) return 'lo';
  if (hand.type <= HandType.THREE_OF_A_KIND) return 'mid';
  if (hand.type <= HandType.FULL_HOUSE) return 'hi';
  return 'vhi';
}

// ── My best hand type ────────────────────────────────────────────────

/**
 * Rough bucket for the best hand the player could contribute to.
 * Coarsened from 6 buckets to 3 — keeps the essential distinction
 * between strong hands (pairs/trips), draws, and nothing.
 */
function myHandStrengthBucket(cards: Card[]): string {
  if (cards.length === 0) return 'x';

  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<Suit, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }

  const maxGroup = Math.max(...rankCounts.values());
  const maxSuit = Math.max(...suitCounts.values());

  // 3 buckets: strong (pair+), draw (suited/connected), weak (nothing)
  if (maxGroup >= 2) return 'strong';  // pair, trips, or better
  if (maxSuit >= 2) return 'draw';     // flush draw or suited
  return 'weak';                       // nothing notable
}

// ── Turn depth bucketing ─────────────────────────────────────────────

/**
 * Coarsened from 4 buckets to 2 — opening vs subsequent.
 * The key distinction is whether this is the first call or a response.
 */
function turnDepthBucket(turnHistory: { action: string }[]): string {
  return turnHistory.length <= 2 ? 'early' : 'late';
}

// ── Bull/true sentiment bucketing (multiplayer-critical) ────────────

/**
 * Encode the bull/true voting distribution in the current round.
 * Coarsened from 11 buckets to 5 — keeps the critical distinction
 * between first responder, all-bull, all-true, and mixed consensus.
 * Drops position depth (early/mid/late) to reduce info set space.
 */
function bullSentimentBucket(
  turnHistory: { action: string }[],
  roundPhase: string,
): string {
  // Only relevant in bull_phase and last_chance
  if (roundPhase !== 'bull_phase' && roundPhase !== 'last_chance') return 'x';

  // Count bull/true votes in the history
  let bullCount = 0;
  let trueCount = 0;
  for (const entry of turnHistory) {
    if (entry.action === 'bull') bullCount++;
    if (entry.action === 'true') trueCount++;
  }

  const total = bullCount + trueCount;
  if (total === 0) return 'v0';              // First responder — no votes yet
  if (trueCount === 0) return 'aB';          // All bull so far
  if (bullCount === 0) return 'aT';          // All true so far
  return 'mix';                               // Mixed responses
}

// ── Total cards bucketing ────────────────────────────────────────────

/**
 * Bucket total cards in play across all players.
 * Coarsened from 6 buckets to 3 — keeps the essential plausibility
 * distinction (few cards = bluffs likely, many cards = claims likely true).
 */
function totalCardsBucket(totalCards: number): string {
  if (totalCards <= 4) return 'tLo';    // small pool — most hands unlikely
  if (totalCards <= 8) return 'tMid';   // medium pool — pairs/trips possible
  return 'tHi';                          // large pool — most hands likely exist
}

// ── Player count bucketing ───────────────────────────────────────────

/**
 * Bucket the number of active players.
 * Coarsened from 5 buckets to 3 — heads-up is fundamentally different
 * from small multiplayer (3-4) which differs from large multiplayer (5+).
 */
function playerCountBucket(activePlayers: number): string {
  if (activePlayers <= 2) return 'p2';     // Heads-up: aggressive bull is correct
  if (activePlayers <= 4) return 'p34';    // Small multiplayer: transitional dynamics
  return 'p5+';                             // Large multiplayer: claims very likely true
}

// ── Claim plausibility ────────────────────────────────────────────────

/**
 * Assess how plausible the current claim is given total cards in play.
 * A "pair" with 2 total cards is very different from a "pair" with 20 cards.
 * This cross-feature captures what claimHeight + totalCards alone miss.
 */
function claimPlausibilityBucket(hand: HandCall | null, totalCards: number): string {
  if (!hand) return 'x';

  // Approximate minimum cards needed for each hand type to be likely
  const minCardsForType: Record<number, number> = {
    [HandType.HIGH_CARD]: 1,
    [HandType.PAIR]: 4,
    [HandType.TWO_PAIR]: 7,
    [HandType.FLUSH]: 8,
    [HandType.THREE_OF_A_KIND]: 8,
    [HandType.STRAIGHT]: 10,
    [HandType.FULL_HOUSE]: 12,
    [HandType.FOUR_OF_A_KIND]: 16,
    [HandType.STRAIGHT_FLUSH]: 20,
    [HandType.ROYAL_FLUSH]: 25,
  };

  const needed = minCardsForType[hand.type] ?? 10;
  const ratio = totalCards / needed;

  if (ratio >= 2.0) return 'pl';   // plausible — enough cards for the claim
  if (ratio >= 1.0) return 'mb';   // maybe — borderline, could exist
  return 'im';                      // implausible — not enough cards
}

// ── Information set key ──────────────────────────────────────────────

/**
 * Generate a compact info set key for CFR.
 *
 * Enhanced abstraction designed to produce ~15-25K unique keys, enabling
 * finer strategic decisions with 500K+ iterations.
 * Format: phase|playerCount|cardCount|totalCards|myStrength|handVsClaim|claimHeight|plausibility|turnDepth|bullSentiment
 *
 * Key improvements over previous version:
 * - 4 claim height buckets (lo/mid/hi/vhi) instead of 3
 * - Cross-feature plausibility bucket (claim type vs total cards)
 * - Better strategic differentiation for detecting bluffs
 */
export function getInfoSetKey(
  state: ClientGameState,
  myCards: Card[],
  totalCards: number,
  activePlayers: number = 2,
  jokerCount: JokerCount = 0,
  lastChanceMode: LastChanceMode = 'classic',
): string {
  const parts: string[] = [
    // Phase: c=calling, b=bull_phase, l=last_chance
    state.roundPhase.charAt(0),
    // Player count bucket — determines bull/true calibration
    playerCountBucket(activePlayers),
    // How many cards I hold — 3 buckets for better calibration
    myCards.length <= 1 ? 'n1' : myCards.length <= 3 ? 'nMid' : 'nHi',
    // Total cards in play
    totalCardsBucket(totalCards),
    // My hand quality
    myHandStrengthBucket(myCards),
    // How my cards relate to the current claim
    handVsClaimBucket(myCards, state.currentHand),
    // Claim height — 4 buckets for finer strategic distinction
    claimHeightBucket(state.currentHand),
    // Claim plausibility — cross-feature: claim type vs total cards in play
    claimPlausibilityBucket(state.currentHand, totalCards),
    // How deep are we in this round
    turnDepthBucket(state.turnHistory),
    // Bull/true voting sentiment — multiplayer-critical context
    bullSentimentBucket(state.turnHistory, state.roundPhase),
  ];

  // 2P refinement: distinguish high card claims (trivially true) from
  // pair+ claims (may be bluffs). This is the biggest abstraction error
  // in 1v1 — the optimal bull rate for "high card" is ~0% while for
  // "pair" it's ~94% with 2 cards. Merging them produces bad strategy.
  // Only appended for p2 so multiplayer keys stay identical.
  if (activePlayers <= 2 && state.currentHand) {
    parts.push(state.currentHand.type === HandType.HIGH_CARD ? 'hc' : 'rh');
  }

  // Joker context — jokers fundamentally change hand plausibility
  // (wildcards make high hands much more likely to exist).
  if (jokerCount > 0) {
    parts.push(`j${jokerCount}`);
  }

  // Last chance mode context — 'strict' changes the game tree after a
  // last-chance raise (returns to CALLING instead of BULL_PHASE), which
  // affects optimal raise/pass decisions.
  if (lastChanceMode === 'strict') {
    parts.push('lcS');
  }

  return parts.join('|');
}

// ── Exported helpers used by actionMapper ────────────────────────────

/**
 * Map a HandCall to a coarse strength bucket (0-9).
 * Used by the action mapper to determine raise tiers.
 */
export function handCallStrengthBucket(hand: HandCall): number {
  switch (hand.type) {
    case HandType.HIGH_CARD: return 0;
    case HandType.PAIR: return 1;
    case HandType.TWO_PAIR: return 2;
    case HandType.FLUSH: return 3;
    case HandType.THREE_OF_A_KIND: return 4;
    case HandType.STRAIGHT: return 5;
    case HandType.FULL_HOUSE: return 6;
    case HandType.FOUR_OF_A_KIND: return 7;
    case HandType.STRAIGHT_FLUSH: return 8;
    case HandType.ROYAL_FLUSH: return 9;
  }
}

/** Extract hand features used by the action mapper. */
export interface HandFeatures {
  cardCount: number;
  distinctRanks: number;
  maxRankGroup: number;
  distinctSuits: number;
  maxSuitGroup: number;
  hasStraightDraw: boolean;
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
