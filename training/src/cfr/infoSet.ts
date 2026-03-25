/**
 * Information set abstraction for CFR training — supports 2-12 players.
 * V5: expanded for better strategic distinction. Larger info set count
 * is acceptable because training can run longer to converge.
 *
 * Uses 9 abstract actions that distinguish between truthful claims
 * (based on player's actual cards) and bluffs.
 *
 * V5 changes from V4:
 * - Fixed flush/high-tier plausibility thresholds (flush 10→18, etc.)
 * - Split total cards into 8 buckets (was 5) — 11-20 range was too coarse
 * - Phase-specific depth: calling phase vs bull phase counted separately
 * - Sentiment with vote count magnitude (b1 vs bN, t1 vs tN)
 * - Elimination pressure: myCards / maxCards ratio
 *
 * Info set key encodes:
 * - Round phase
 * - Player count bucket (critical: optimal play differs by table size)
 * - Card count (how many cards I hold)
 * - Elimination pressure (how close to max cards)
 * - Total cards in play (8 buckets)
 * - Hand strength (my best hand contribution)
 * - Hand vs claim (how my cards relate to the current claim)
 * - Claim height bucket (6 tiers)
 * - Claim plausibility (corrected thresholds)
 * - Phase-specific depth
 * - Bull/true sentiment with vote count
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
 * 4 buckets (refined from original 3):
 * - 'none': no claim yet (opening)
 * - 'has': player's cards strongly support or complete the claim
 * - 'close1': player has 1+ of the exact cards needed (strong partial)
 * - 'close0': player has related cards but not exact ones needed (weak partial)
 * - 'below': player's cards don't support the claim at all
 *
 * The close1/close0 split is critical: holding one of the exact called rank
 * means only 1 more needed from other players vs 2+ more needed.
 * MUST match shared/src/cfr/infoSet.ts exactly.
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
      if (count === 1) return 'close1';    // Have 1 of exact rank — only 1 more needed
      const hasSomePair = hasGroupOfSize(myCards, 2);
      return hasSomePair ? 'close0' : 'below';  // Have a different pair — weak support
    }

    case HandType.TWO_PAIR: {
      const hiCount = myCards.filter(c => c.rank === currentHand.highRank).length;
      const loCount = myCards.filter(c => c.rank === currentHand.lowRank).length;
      if (hiCount >= 2 && loCount >= 2) return 'has';
      if (hiCount >= 1 && loCount >= 1) return 'close1';  // Have 1 of each needed rank
      if (hiCount >= 1 || loCount >= 1) return 'close0';  // Have only 1 of the 2 needed ranks
      return 'below';
    }

    case HandType.FLUSH: {
      const suitCount = myCards.filter(c => c.suit === currentHand.suit).length;
      if (suitCount >= 3) return 'has';
      if (suitCount >= 2) return 'close1';  // Strong flush draw
      if (suitCount >= 1) return 'close0';  // Weak flush draw
      return 'below';
    }

    case HandType.THREE_OF_A_KIND: {
      const count = myCards.filter(c => c.rank === currentHand.rank).length;
      if (count >= 3) return 'has';
      if (count >= 2) return 'close1';  // Have 2 of 3 needed — very strong
      if (count >= 1) return 'close0';  // Have 1 of 3 needed — weak
      return 'below';
    }

    case HandType.STRAIGHT: {
      const highVal = RANK_VALUES[currentHand.highRank];
      const neededVals = [highVal, highVal - 1, highVal - 2, highVal - 3, highVal - 4];
      const myVals = new Set(myCards.map(c => RANK_VALUES[c.rank]));
      const overlap = neededVals.filter(v => myVals.has(v)).length;
      if (overlap >= 3) return 'has';
      if (overlap >= 2) return 'close1';
      if (overlap >= 1) return 'close0';
      return 'below';
    }

    case HandType.FULL_HOUSE: {
      const threeCount = myCards.filter(c => c.rank === currentHand.threeRank).length;
      const twoCount = myCards.filter(c => c.rank === currentHand.twoRank).length;
      if (threeCount >= 2 && twoCount >= 1) return 'has';
      if (threeCount >= 1 && twoCount >= 1) return 'close1';  // Have both needed ranks
      if (threeCount >= 1 || twoCount >= 1) return 'close0';  // Have only 1 needed rank
      return 'below';
    }

    case HandType.FOUR_OF_A_KIND: {
      const count = myCards.filter(c => c.rank === currentHand.rank).length;
      if (count >= 3) return 'has';
      if (count >= 2) return 'close1';  // Have 2 of 4 needed
      if (count >= 1) return 'close0';  // Have 1 of 4 needed — weak
      return 'below';
    }

    case HandType.STRAIGHT_FLUSH: {
      const highVal = RANK_VALUES[currentHand.highRank];
      const neededVals = [highVal, highVal - 1, highVal - 2, highVal - 3, highVal - 4];
      const myMatchingCards = myCards.filter(c =>
        c.suit === currentHand.suit && neededVals.includes(RANK_VALUES[c.rank])
      );
      if (myMatchingCards.length >= 2) return 'has';
      if (myMatchingCards.length >= 1) return 'close1';
      return 'below';
    }

    case HandType.ROYAL_FLUSH: {
      const royalRanks = new Set(['10', 'J', 'Q', 'K', 'A'] as const);
      const matching = myCards.filter(c =>
        c.suit === currentHand.suit && royalRanks.has(c.rank as '10' | 'J' | 'Q' | 'K' | 'A')
      );
      if (matching.length >= 2) return 'has';
      if (matching.length >= 1) return 'close1';
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
 * Bucket the current claim into 6 tiers (expanded from 4).
 * The old 'lo' bucket merged high card and pair, but these require
 * fundamentally different bull strategies. Similarly, the old 'mid'
 * merged two pair/flush with trips — trips is much harder to have.
 *
 * - hc: high card — almost always exists, rarely worth calling bull
 * - pr: pair — common but not guaranteed, depends on card count
 * - mid: two pair, flush — plausible but worth questioning
 * - tk: three of a kind — significantly harder, often bluffed
 * - hi: straight, full house — unusual, often bluffs
 * - vhi: four of a kind, straight flush, royal flush — almost always bluffs
 *
 * MUST match shared/src/cfr/infoSet.ts exactly.
 */
function claimHeightBucket(hand: HandCall | null): string {
  if (!hand) return 'x';
  if (hand.type === HandType.HIGH_CARD) return 'hc';
  if (hand.type === HandType.PAIR) return 'pr';
  if (hand.type <= HandType.FLUSH) return 'mid';        // two pair, flush
  if (hand.type === HandType.THREE_OF_A_KIND) return 'tk';
  if (hand.type <= HandType.FULL_HOUSE) return 'hi';    // straight, full house
  return 'vhi';                                          // 4oak, SF, RF
}

// ── My best hand type ────────────────────────────────────────────────

/**
 * Rough bucket for the best hand the player could contribute to.
 * 5 buckets (expanded from 3) — the distinction between trips and a pair
 * is massive for bull/true decisions.
 * MUST match shared/src/cfr/infoSet.ts exactly.
 *
 * - 'trips': three of a kind or better — strong evidence for high claims
 * - 'pair': exactly one pair — can support pair/two-pair claims
 * - 'suitd': 2+ cards of same suit — flush draw potential
 * - 'hcard': high card only (Q/K/A) but no pairs/draws
 * - 'weak': no pairs, no draws, no high cards
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

  if (maxGroup >= 3) return 'trips';    // Three of a kind+ — very strong
  if (maxGroup >= 2) return 'pair';     // Pair — solid
  if (maxSuit >= 2) return 'suitd';     // Suited draw — flush potential
  // Check for high cards (Q/K/A)
  let maxVal = 0;
  for (const c of cards) {
    const val = RANK_VALUES[c.rank];
    if (val > maxVal) maxVal = val;
  }
  if (maxVal >= 12) return 'hcard';     // High card only (Q/K/A)
  return 'weak';                         // Nothing useful
}


// ── Turn depth bucketing ─────────────────────────────────────────────

/**
 * V5: Phase-specific depth — counts actions within the CURRENT phase,
 * not total actions in the round. Being the 2nd person in bull phase
 * is very different from being the 5th, even if total turn count is similar.
 *
 * MUST match shared/src/cfr/infoSet.ts exactly.
 */
function phaseDepthBucket(turnHistory: { action: string }[], roundPhase: string): string {
  if (roundPhase === 'last_chance') return 'd0';

  if (roundPhase === 'bull_phase') {
    let votes = 0;
    for (const entry of turnHistory) {
      if (entry.action === 'bull' || entry.action === 'true') votes++;
    }
    if (votes <= 1) return 'd0';
    if (votes <= 3) return 'd1';
    if (votes <= 5) return 'd2';
    return 'd3';
  }

  // Calling phase
  let calls = 0;
  for (const entry of turnHistory) {
    if (entry.action === 'call') calls++;
  }
  if (calls <= 1) return 'd0';
  if (calls <= 3) return 'd1';
  if (calls <= 5) return 'd2';
  return 'd3';
}


// ── Bull/true sentiment bucketing (multiplayer-critical) ────────────

/**
 * V5: Sentiment now encodes direction + magnitude.
 * 7 buckets: x/v0/b1/bN/t1/tN/mx
 *
 * MUST match shared/src/cfr/infoSet.ts exactly.
 */
function bullSentimentBucket(
  turnHistory: { action: string }[],
  roundPhase: string,
): string {
  if (roundPhase !== 'bull_phase' && roundPhase !== 'last_chance') return 'x';

  let bullCount = 0;
  let trueCount = 0;
  for (const entry of turnHistory) {
    if (entry.action === 'bull') bullCount++;
    if (entry.action === 'true') trueCount++;
  }

  const total = bullCount + trueCount;
  if (total === 0) return 'v0';

  if (trueCount === 0) {
    return bullCount === 1 ? 'b1' : 'bN';
  }
  if (bullCount === 0) {
    return trueCount === 1 ? 't1' : 'tN';
  }
  return 'mx';
}

/**
 * V5: Elimination pressure — how close to being eliminated.
 * MUST match shared/src/cfr/infoSet.ts exactly.
 */
function eliminationPressureBucket(myCardCount: number, maxCards: number): string {
  const ratio = myCardCount / maxCards;
  if (ratio >= 0.8) return 'crit';
  if (ratio >= 0.6) return 'near';
  return 'safe';
}

// ── Total cards bucketing ────────────────────────────────────────────

/**
 * V5: 8 buckets (was 5). The old tHi (11-20) was far too coarse —
 * at 11 cards a pair of a specific rank has ~22% probability while
 * at 20 cards it's ~54%. These require completely different strategies.
 *
 * MUST match shared/src/cfr/infoSet.ts exactly.
 */
function totalCardsBucket(totalCards: number): string {
  if (totalCards <= 4) return 'tLo';     // tiny pool — most hands unlikely
  if (totalCards <= 7) return 'tMd1';    // small pool — pairs possible
  if (totalCards <= 10) return 'tMd2';   // growing pool — pairs likely
  if (totalCards <= 14) return 'tMd3';   // medium pool — two pair emerging
  if (totalCards <= 18) return 'tMd4';   // medium-large — flushes becoming plausible
  if (totalCards <= 24) return 'tHi1';   // large pool — most pair/flush hands exist
  if (totalCards <= 34) return 'tHi2';   // very large — trips/straights plausible
  return 'tVHi';                          // massive pool — almost all hands exist
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
 * Canonical minimum cards for each hand type to be plausible.
 * MUST match shared/src/cfr/infoSet.ts MIN_CARDS_FOR_PLAUSIBLE exactly.
 *
 * V5: Recalibrated using actual probabilities. The V4 thresholds were
 * wrong for flush and higher hands — flush was set at 10 cards but a
 * specific suit flush with 10 cards is only ~3-5%, not "15-25%."
 *
 * New calibration: minimum cards where P(hand exists) ≈ 10-20%.
 */
export const MIN_CARDS_FOR_PLAUSIBLE: Record<number, number> = {
  [HandType.HIGH_CARD]: 1,
  [HandType.PAIR]: 6,
  [HandType.TWO_PAIR]: 12,
  [HandType.FLUSH]: 18,
  [HandType.THREE_OF_A_KIND]: 16,
  [HandType.STRAIGHT]: 20,
  [HandType.FULL_HOUSE]: 22,
  [HandType.FOUR_OF_A_KIND]: 30,
  [HandType.STRAIGHT_FLUSH]: 35,
  [HandType.ROYAL_FLUSH]: 40,
};

/**
 * 6 buckets (expanded from 4): vPl/pl/lk/mb/uLk/im.
 * The top and bottom of the range needed splitting:
 * - 'vPl' (≥3.0): claim is near-certain to exist — rarely worth calling bull
 * - 'pl' (≥2.0): plausible, but not guaranteed — worth considering context
 * - 'lk' (≥1.5): likely exists but risky to assume
 * - 'mb' (≥1.0): coin flip — borderline plausible
 * - 'uLk' (≥0.5): unlikely — need luck for this to exist
 * - 'im' (<0.5): absurd — virtually impossible with this many cards
 *
 * The vPl/pl split matters because at 3x+ ratio, bull is almost never correct,
 * while at 2x ratio it's still worth considering. The uLk/im split captures
 * the difference between "long shot" and "no chance" — the latter should
 * almost always trigger bull.
 *
 * MUST match shared/src/cfr/infoSet.ts exactly.
 */
function claimPlausibilityBucket(hand: HandCall | null, totalCards: number): string {
  if (!hand) return 'x';

  const needed = MIN_CARDS_FOR_PLAUSIBLE[hand.type] ?? 10;
  const ratio = totalCards / needed;

  if (ratio >= 3.0) return 'vPl';   // very plausible — near-certain to exist
  if (ratio >= 2.0) return 'pl';    // plausible — enough cards for the claim
  if (ratio >= 1.5) return 'lk';    // likely — solid chance it exists
  if (ratio >= 1.0) return 'mb';    // maybe — borderline, could exist
  if (ratio >= 0.5) return 'uLk';   // unlikely — long shot
  return 'im';                       // implausible — virtually impossible
}

// ── Fine-grained 2P info set helpers ────────────────────────────────

/** Exact hand type for 2P. MUST match shared/src/cfr/infoSet.ts. */
function myExactHandType2P(cards: Card[]): string {
  if (cards.length === 0) return 'x';
  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<Suit, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  const groups = [...rankCounts.values()].sort((a, b) => b - a);
  const maxSuit = Math.max(...suitCounts.values());
  if (groups[0]! >= 4) return '4k';
  if (groups[0]! >= 3 && groups[1]! >= 2) return 'fh';
  if (maxSuit >= 5) return 'fl';
  if (groups[0]! >= 3) return '3k';
  if (groups[0]! >= 2 && groups[1]! >= 2) return '2p';
  if (groups[0]! >= 2) return 'pr';
  return 'hc';
}

/** Best rank within hand type for 2P. MUST match shared/. */
function myBestRank2P(cards: Card[]): string {
  if (cards.length === 0) return 'x';
  const rankCounts = new Map<Rank, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  }
  let bestRank = 0;
  let bestGroupSize = 0;
  for (const [rank, count] of rankCounts) {
    const val = RANK_VALUES[rank];
    if (count > bestGroupSize || (count === bestGroupSize && val > bestRank)) {
      bestGroupSize = count;
      bestRank = val;
    }
  }
  if (bestGroupSize <= 1) {
    bestRank = 0;
    for (const c of cards) {
      const val = RANK_VALUES[c.rank];
      if (val > bestRank) bestRank = val;
    }
  }
  if (bestRank >= 14) return 'rA';
  if (bestRank >= 13) return 'rK';
  if (bestRank >= 12) return 'rQ';
  if (bestRank >= 10) return 'rH';
  if (bestRank >= 8) return 'rM2';
  if (bestRank >= 5) return 'rM1';
  return 'rL';
}

/** Dominant suit count for 2P. MUST match shared/. */
function dominantSuitCount2P(cards: Card[]): string {
  if (cards.length === 0) return 's0';
  const suitCounts = new Map<Suit, number>();
  for (const c of cards) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  return `s${Math.max(...suitCounts.values())}`;
}

/** Longest consecutive rank run for 2P. MUST match shared/. */
function longestRun2P(cards: Card[]): string {
  if (cards.length === 0) return 'n0';
  const vals = [...new Set(cards.map(c => RANK_VALUES[c.rank]))].sort((a, b) => a - b);
  let maxRun = 1;
  let run = 1;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i]! - vals[i - 1]! === 1) {
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      run = 1;
    }
  }
  return `n${maxRun}`;
}

/** Exact claim type for 2P. MUST match shared/. */
function exactClaimType2P(hand: HandCall | null): string {
  if (!hand) return 'cx';
  const typeMap: Record<number, string> = {
    [HandType.HIGH_CARD]: 'cH',
    [HandType.PAIR]: 'cP',
    [HandType.TWO_PAIR]: 'c2',
    [HandType.FLUSH]: 'cF',
    [HandType.THREE_OF_A_KIND]: 'c3',
    [HandType.STRAIGHT]: 'cS',
    [HandType.FULL_HOUSE]: 'cU',
    [HandType.FOUR_OF_A_KIND]: 'c4',
    [HandType.STRAIGHT_FLUSH]: 'cT',
    [HandType.ROYAL_FLUSH]: 'cR',
  };
  return typeMap[hand.type] ?? 'cx';
}

/** Claim rank bucket for 2P. MUST match shared/. */
function claimRankBucket2P(hand: HandCall | null): string {
  if (!hand) return 'rx';
  let rankVal: number;
  switch (hand.type) {
    case HandType.HIGH_CARD:
    case HandType.PAIR:
    case HandType.THREE_OF_A_KIND:
    case HandType.FOUR_OF_A_KIND:
      rankVal = RANK_VALUES[hand.rank];
      break;
    case HandType.TWO_PAIR:
      rankVal = RANK_VALUES[hand.highRank];
      break;
    case HandType.STRAIGHT:
      rankVal = RANK_VALUES[hand.highRank];
      break;
    case HandType.FULL_HOUSE:
      rankVal = RANK_VALUES[hand.threeRank];
      break;
    case HandType.STRAIGHT_FLUSH:
      rankVal = RANK_VALUES[hand.highRank];
      break;
    case HandType.FLUSH:
    case HandType.ROYAL_FLUSH:
      return 'rx';
    default:
      return 'rx';
  }
  if (rankVal >= 14) return 'qA';
  if (rankVal >= 13) return 'qK';
  if (rankVal >= 12) return 'qQ';
  if (rankVal >= 10) return 'qH';
  if (rankVal >= 8) return 'qM2';
  if (rankVal >= 5) return 'qM1';
  return 'qL';
}

/** Exact cards matching claim count for 2P. MUST match shared/. */
function cardsMatchingClaim2P(myCards: Card[], currentHand: HandCall | null): string {
  if (!currentHand) return 'mx';
  let matching = 0;
  switch (currentHand.type) {
    case HandType.HIGH_CARD:
      matching = myCards.filter(c => RANK_VALUES[c.rank] >= RANK_VALUES[currentHand.rank]).length;
      break;
    case HandType.PAIR:
    case HandType.THREE_OF_A_KIND:
    case HandType.FOUR_OF_A_KIND:
      matching = myCards.filter(c => c.rank === currentHand.rank).length;
      break;
    case HandType.TWO_PAIR:
      matching = myCards.filter(c =>
        c.rank === currentHand.highRank || c.rank === currentHand.lowRank
      ).length;
      break;
    case HandType.FLUSH:
      matching = myCards.filter(c => c.suit === currentHand.suit).length;
      break;
    case HandType.STRAIGHT: {
      const highVal = RANK_VALUES[currentHand.highRank];
      const neededVals = new Set([highVal, highVal - 1, highVal - 2, highVal - 3, highVal - 4]);
      matching = myCards.filter(c => neededVals.has(RANK_VALUES[c.rank])).length;
      break;
    }
    case HandType.FULL_HOUSE:
      matching = myCards.filter(c =>
        c.rank === currentHand.threeRank || c.rank === currentHand.twoRank
      ).length;
      break;
    case HandType.STRAIGHT_FLUSH: {
      const highVal = RANK_VALUES[currentHand.highRank];
      const neededVals = new Set([highVal, highVal - 1, highVal - 2, highVal - 3, highVal - 4]);
      matching = myCards.filter(c =>
        c.suit === currentHand.suit && neededVals.has(RANK_VALUES[c.rank])
      ).length;
      break;
    }
    case HandType.ROYAL_FLUSH: {
      const royalRanks = new Set<string>(['10', 'J', 'Q', 'K', 'A']);
      matching = myCards.filter(c =>
        c.suit === currentHand.suit && royalRanks.has(c.rank)
      ).length;
      break;
    }
  }
  return `m${Math.min(matching, 5)}`;
}

/** Position for 2P. MUST match shared/. */
function position2P(state: ClientGameState, myPlayerId: string): string {
  if (!state.currentHand) {
    return state.startingPlayerId === myPlayerId ? 'O' : 'R';
  }
  return state.lastCallerId === myPlayerId ? 'O' : 'R';
}

/** Exact phase depth for 2P. MUST match shared/. */
function phaseDepthExact2P(turnHistory: { action: string }[], roundPhase: string): string {
  if (roundPhase === 'last_chance') return 'e0';
  if (roundPhase === 'bull_phase') {
    let votes = 0;
    for (const entry of turnHistory) {
      if (entry.action === 'bull' || entry.action === 'true') votes++;
    }
    return `e${Math.min(votes, 5)}`;
  }
  let calls = 0;
  for (const entry of turnHistory) {
    if (entry.action === 'call') calls++;
  }
  return `e${Math.min(calls, 5)}`;
}

function elimGap2P(myCardCount: number, maxCards: number): string {
  return `g${Math.max(0, maxCards - myCardCount)}`;
}

function oppElimGap2P(oppCardCount: number, maxCards: number): string {
  return `og${Math.max(0, maxCards - oppCardCount)}`;
}

/**
 * Fine-grained info set key for 2-player (heads-up) games.
 * MUST match shared/src/cfr/infoSet.ts getInfoSetKey2P exactly.
 */
export function getInfoSetKey2P(
  state: ClientGameState,
  myCards: Card[],
  totalCards: number,
  myPlayerId: string = '',
  maxCards: number = 5,
  opponentCardCount: number = 1,
  jokerCount: JokerCount = 0,
  lastChanceMode: LastChanceMode = 'classic',
  wasPenalizedLastRound: boolean = false,
): string {
  const parts: string[] = [
    state.roundPhase.charAt(0),
    `c${myCards.length || 1}`,
    `o${opponentCardCount}`,
    elimGap2P(myCards.length, maxCards),
    oppElimGap2P(opponentCardCount, maxCards),
    myExactHandType2P(myCards),
    myBestRank2P(myCards),
    dominantSuitCount2P(myCards),
    longestRun2P(myCards),
    exactClaimType2P(state.currentHand),
    claimRankBucket2P(state.currentHand),
    cardsMatchingClaim2P(myCards, state.currentHand),
    handVsClaimBucket(myCards, state.currentHand),
    position2P(state, myPlayerId),
    phaseDepthExact2P(state.turnHistory, state.roundPhase),
    bullSentimentBucket(state.turnHistory, state.roundPhase),
    claimPlausibilityBucket(state.currentHand, totalCards),
  ];

  if (wasPenalizedLastRound) {
    parts.push('pen');
  }
  if (jokerCount > 0) {
    parts.push(`j${jokerCount}`);
  }
  if (lastChanceMode === 'strict') {
    parts.push('lcS');
  }

  return parts.join('|');
}

// ── Information set key ──────────────────────────────────────────────

/**
 * Generate a compact info set key for CFR.
 *
 * V5 abstraction — expanded for better strategic distinction.
 * MUST match shared/src/cfr/infoSet.ts exactly.
 *
 * V5 key structure (11 core segments + optional suffixes):
 * phase | players | cardCount | elimPressure | totalCards | strength |
 * vsClaim | claimHeight | plausibility | phaseDepth | sentiment |
 * [pen] | [hc/rh] | [jokers] | [lcS]
 */
export function getInfoSetKey(
  state: ClientGameState,
  myCards: Card[],
  totalCards: number,
  activePlayers: number = 2,
  jokerCount: JokerCount = 0,
  lastChanceMode: LastChanceMode = 'classic',
  _myPlayerId: string = '',
  wasPenalizedLastRound: boolean = false,
  maxCards: number = 5,
): string {
  const parts: string[] = [
    state.roundPhase.charAt(0),
    playerCountBucket(activePlayers),
    myCards.length <= 1 ? 'c1' : myCards.length === 2 ? 'c2' : myCards.length === 3 ? 'c3' : myCards.length === 4 ? 'c4' : 'c5',
    // V5: Elimination pressure
    eliminationPressureBucket(myCards.length, maxCards),
    totalCardsBucket(totalCards),
    myHandStrengthBucket(myCards),
    handVsClaimBucket(myCards, state.currentHand),
    claimHeightBucket(state.currentHand),
    claimPlausibilityBucket(state.currentHand, totalCards),
    // V5: Phase-specific depth
    phaseDepthBucket(state.turnHistory, state.roundPhase),
    // V5: Sentiment with vote count
    bullSentimentBucket(state.turnHistory, state.roundPhase),
  ];

  if (wasPenalizedLastRound) {
    parts.push('pen');
  }

  if (activePlayers <= 2 && state.currentHand) {
    parts.push(state.currentHand.type === HandType.HIGH_CARD ? 'hc' : 'rh');
  }

  if (jokerCount > 0) {
    parts.push(`j${jokerCount}`);
  }
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
