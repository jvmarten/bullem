/**
 * Information set abstraction for CFR strategy evaluation.
 * V5: expanded for better strategic distinction — larger info set count
 * is acceptable because training can run longer to converge.
 *
 * Ported from training/src/cfr/infoSet.ts — evaluation-only subset.
 * Uses 9 abstract actions that distinguish between truthful claims
 * (based on player's actual cards) and bluffs.
 *
 * V5 changes from V4:
 * - Fixed flush/high-tier plausibility thresholds (flush 10→18, etc.)
 * - Split total cards into 8 buckets (was 5) — 11-20 range was too coarse
 * - Phase-specific depth: calling phase vs bull phase counted separately
 * - Position within bull phase: how many votes before me
 * - Elimination pressure: myCards / maxCards ratio
 *
 * Info set key encodes:
 * - Round phase
 * - Player count bucket
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

import type { Card, HandCall, Rank, Suit, ClientGameState, JokerCount, LastChanceMode } from '../types.js';
import { HandType, RoundPhase } from '../types.js';
import { RANK_VALUES } from '../constants.js';

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

// ── Legal action determination ───────────────────────────────────────

/**
 * Determine which abstract actions are legal at the current decision point.
 */
export function getLegalAbstractActions(
  state: ClientGameState,
): AbstractAction[] {
  const { roundPhase, currentHand } = state;

  if (roundPhase === RoundPhase.LAST_CHANCE) {
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
 * 6 tiers (expanded from 4): hc/pr/mid/tk/hi/vhi.
 * High card vs pair requires different bull strategies; trips is much
 * harder to have than two pair/flush. MUST match training exactly.
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


// ── Phase-specific depth bucketing ───────────────────────────────────

/**
 * V5: Phase-specific depth — counts actions within the CURRENT phase,
 * not total actions in the round. Being the 2nd person in bull phase
 * is very different from being the 5th, even if total turn count is similar.
 *
 * For calling phase: how many calls/raises have been made
 * For bull phase: how many bull/true votes have been cast
 * For last chance: always 'd0' (single decision point)
 */
function phaseDepthBucket(turnHistory: { action: string }[], roundPhase: string): string {
  if (roundPhase === 'last_chance') return 'd0';

  if (roundPhase === 'bull_phase') {
    // Count only bull/true votes (the bull phase actions)
    let votes = 0;
    for (const entry of turnHistory) {
      if (entry.action === 'bull' || entry.action === 'true') votes++;
    }
    if (votes <= 1) return 'd0';  // First or second responder — little info
    if (votes <= 3) return 'd1';  // Some votes visible
    if (votes <= 5) return 'd2';  // Strong social signal
    return 'd3';                   // Late in bull phase — very strong signal
  }

  // Calling phase: count raise actions (calls)
  let calls = 0;
  for (const entry of turnHistory) {
    if (entry.action === 'call') calls++;
  }
  if (calls <= 1) return 'd0';   // Opening or first response
  if (calls <= 3) return 'd1';   // Early calling
  if (calls <= 5) return 'd2';   // Mid calling — escalation building
  return 'd3';                    // Deep calling — high claims likely
}

// ── Turn position bucketing ──────────────────────────────────────────


// ── Bull/true sentiment bucketing ────────────────────────────────────

/**
 * V5: Sentiment now encodes direction + magnitude.
 * 7 buckets: x/v0/b1/bN/t1/tN/mx
 *
 * Key insight: "1 bull" vs "4 bulls" carry very different weight.
 * The old aB/aT buckets merged these. Now we distinguish
 * single-vote signals from strong consensus.
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
  if (total === 0) return 'v0';              // No votes yet

  if (trueCount === 0) {
    return bullCount === 1 ? 'b1' : 'bN';   // All bull: single vs consensus
  }
  if (bullCount === 0) {
    return trueCount === 1 ? 't1' : 'tN';   // All true: single vs consensus
  }
  return 'mx';                                // Mixed — both directions present
}

/**
 * V5: Elimination pressure — how close to being eliminated.
 * A player with 4/5 cards plays very differently from 2/5 cards.
 * 3 buckets: safe/near/crit.
 */
function eliminationPressureBucket(myCardCount: number, maxCards: number): string {
  const ratio = myCardCount / maxCards;
  if (ratio >= 0.8) return 'crit';   // 4/5 or 5/5 — one loss from elimination
  if (ratio >= 0.6) return 'near';   // 3/5 — getting dangerous
  return 'safe';                      // 1/5 or 2/5 — plenty of room
}

// ── Total cards bucketing ────────────────────────────────────────────

/**
 * V5: 8 buckets (was 5). The old tHi (11-20) was far too coarse —
 * at 11 cards a pair of a specific rank has ~22% probability while
 * at 20 cards it's ~54%. These require completely different strategies.
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

function playerCountBucket(activePlayers: number): string {
  if (activePlayers <= 2) return 'p2';
  if (activePlayers <= 4) return 'p34';
  return 'p5+';
}

// ── Claim plausibility ────────────────────────────────────────────────

/**
 * Canonical minimum cards for each hand type to be plausible.
 * MUST match training/src/cfr/infoSet.ts — these thresholds affect
 * which info set key is generated, so training/eval must agree.
 *
 * V5: Recalibrated using actual probabilities. The V4 thresholds were
 * wrong for flush and higher hands — flush was set at 10 cards but a
 * specific suit flush with 10 cards is only ~3-5%, not the claimed
 * "15-25% base chance."
 *
 * New calibration: minimum cards where P(hand exists) ≈ 10-20%.
 * - HIGH_CARD "specific rank": P ≈ 1-(48/52)^N. N=3 → 22%
 * - PAIR "specific rank": needs 2 of 4. N=8 → ~11%
 * - TWO_PAIR: needs 2 pairs. N=12 → ~15%
 * - FLUSH "specific suit": needs 5 of 13. N=18 → ~15%
 * - THREE_OF_A_KIND: needs 3 of 4. N=16 → ~10%
 * - STRAIGHT: needs 5 consecutive. N=20 → ~12%
 * - FULL_HOUSE: needs 3+2. N=22 → ~10%
 * - FOUR_OF_A_KIND: needs 4 of 4. N=30 → ~10%
 * - STRAIGHT_FLUSH: needs 5 consecutive same suit. N=35 → ~5%
 * - ROYAL_FLUSH: needs 5 specific same suit. N=40 → ~5%
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
 * The vPl/pl split matters because at 3x+ ratio, bull is almost never
 * correct, while at 2x ratio it's still worth considering. The uLk/im
 * split captures "long shot" vs "no chance". MUST match training exactly.
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

/**
 * Exact hand type the player can make from their own cards.
 * 7 reachable buckets (with 1-5 cards):
 * - 'hc': high card only
 * - 'pr': one pair
 * - '2p': two pair (needs 4+ cards)
 * - 'fl': flush (needs 5 suited, rare)
 * - '3k': three of a kind
 * - '4k': four of a kind (needs 4+ cards)
 * - 'fh': full house (needs 5 cards, trips + pair)
 */
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

  // Check from strongest to weakest
  if (groups[0]! >= 4) return '4k';
  if (groups[0]! >= 3 && groups[1]! >= 2) return 'fh';
  if (maxSuit >= 5) return 'fl';
  if (groups[0]! >= 3) return '3k';
  if (groups[0]! >= 2 && groups[1]! >= 2) return '2p';
  if (groups[0]! >= 2) return 'pr';
  return 'hc';
}

/**
 * Best rank within my hand type. 7 buckets:
 * For pairs/trips/quads: rank of the group.
 * For high card: highest card rank.
 * For two pair: rank of the higher pair.
 */
function myBestRank2P(cards: Card[]): string {
  if (cards.length === 0) return 'x';

  const rankCounts = new Map<Rank, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  }

  // Find the rank of the best group (largest group, highest rank for ties)
  let bestRank = 0;
  let bestGroupSize = 0;
  for (const [rank, count] of rankCounts) {
    const val = RANK_VALUES[rank];
    if (count > bestGroupSize || (count === bestGroupSize && val > bestRank)) {
      bestGroupSize = count;
      bestRank = val;
    }
  }

  // If no group > 1, use highest card
  if (bestGroupSize <= 1) {
    bestRank = 0;
    for (const c of cards) {
      const val = RANK_VALUES[c.rank];
      if (val > bestRank) bestRank = val;
    }
  }

  // 7 rank buckets
  if (bestRank >= 14) return 'rA';   // Ace
  if (bestRank >= 13) return 'rK';   // King
  if (bestRank >= 12) return 'rQ';   // Queen
  if (bestRank >= 10) return 'rH';   // 10-J (high)
  if (bestRank >= 8) return 'rM2';   // 8-9
  if (bestRank >= 5) return 'rM1';   // 5-7
  return 'rL';                        // 2-4
}

/**
 * Dominant suit count — max cards of one suit.
 * In 2P this matters for flush bluff credibility and claim assessment.
 * Range 1-5, directly encoded.
 */
function dominantSuitCount2P(cards: Card[]): string {
  if (cards.length === 0) return 's0';
  const suitCounts = new Map<Suit, number>();
  for (const c of cards) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
  }
  return `s${Math.max(...suitCounts.values())}`;
}

/**
 * Longest consecutive rank run in my hand.
 * Matters for straight bluff credibility.
 * Range 1-5, directly encoded.
 */
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

/**
 * Exact claim type for 2P — all 10 hand types distinguished.
 * Unlike the coarse 6-bucket claimHeightBucket, this separates every type
 * because in 2P with few total cards, each type has very different plausibility.
 */
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

/**
 * Claim rank bucket for 2P — 7 buckets for the rank within the claim.
 * For flush/straight flush/royal flush the rank is less meaningful,
 * so we encode 'rx' for those.
 */
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
      rankVal = RANK_VALUES[hand.highRank]; // Use the higher pair's rank
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
      return 'rx'; // No meaningful rank dimension
    default:
      return 'rx';
  }

  if (rankVal >= 14) return 'qA';   // Ace
  if (rankVal >= 13) return 'qK';   // King
  if (rankVal >= 12) return 'qQ';   // Queen
  if (rankVal >= 10) return 'qH';   // 10-J
  if (rankVal >= 8) return 'qM2';   // 8-9
  if (rankVal >= 5) return 'qM1';   // 5-7
  return 'qL';                       // 2-4
}

/**
 * Exact cards matching claim count for 2P.
 * More granular than handVsClaimBucket — encodes exact overlap count.
 * Returns 'm0'-'m5' for how many of my cards contribute to the claim.
 */
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

/**
 * Position in 2P — opener vs responder.
 * The first player to act in calling phase has fundamentally different strategy.
 */
function position2P(state: ClientGameState, myPlayerId: string): string {
  // If no claim yet, check if I'm the starting player
  if (!state.currentHand) {
    return state.startingPlayerId === myPlayerId ? 'O' : 'R';
  }
  // If there's a claim, the lastCallerId made it — I'm the responder
  return state.lastCallerId === myPlayerId ? 'O' : 'R';
}

/**
 * Exact phase depth for 2P — 0-5+ encoded directly.
 * In 2P the calling phase alternates, so depth directly tells us
 * how many raises have happened. More precise than the 4-bucket version.
 */
function phaseDepthExact2P(turnHistory: { action: string }[], roundPhase: string): string {
  if (roundPhase === 'last_chance') return 'e0';

  if (roundPhase === 'bull_phase') {
    // In 2P bull phase, there's only 1 vote before resolution
    let votes = 0;
    for (const entry of turnHistory) {
      if (entry.action === 'bull' || entry.action === 'true') votes++;
    }
    return `e${Math.min(votes, 5)}`;
  }

  // Calling phase: count raises
  let calls = 0;
  for (const entry of turnHistory) {
    if (entry.action === 'call') calls++;
  }
  return `e${Math.min(calls, 5)}`;
}

/**
 * Exact elimination gap for 2P — how many cards until elimination.
 * Range 0-4 directly encoded (maxCards - myCards).
 */
function elimGap2P(myCardCount: number, maxCards: number): string {
  return `g${Math.max(0, maxCards - myCardCount)}`;
}

/**
 * Opponent elimination gap for 2P — how close opponent is to elimination.
 * Range 0-4 directly encoded.
 */
function oppElimGap2P(oppCardCount: number, maxCards: number): string {
  return `og${Math.max(0, maxCards - oppCardCount)}`;
}

// ── Information set key ──────────────────────────────────────────────

/**
 * Fine-grained info set key for 2-player (heads-up) games.
 * Uses much more granular features than the multiplayer getInfoSetKey()
 * since 2P has a smaller state space that can be trained thoroughly.
 *
 * Key structure (17 core segments):
 * phase | myCards | oppCards | elimGap | oppElimGap | handType |
 * bestRank | suitCount | runLength | claimType | claimRank |
 * matchingCards | vsClaim | position | depth | sentiment | plausibility
 *
 * Expected reachable info sets: ~500K-2M (trainable in 1-3 days).
 * MUST match training/src/cfr/infoSet.ts getInfoSetKey2P exactly.
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
    // Phase (3 values)
    state.roundPhase.charAt(0),
    // My card count — exact (5 values: c1-c5)
    `c${myCards.length || 1}`,
    // Opponent card count — exact (5 values: o1-o5)
    `o${opponentCardCount}`,
    // My elimination gap — exact distance from max (5 values: g0-g4)
    elimGap2P(myCards.length, maxCards),
    // Opponent elimination gap (5 values: og0-og4)
    oppElimGap2P(opponentCardCount, maxCards),
    // My exact hand type (7 values)
    myExactHandType2P(myCards),
    // My best rank — 7 buckets
    myBestRank2P(myCards),
    // Dominant suit count (5 values: s1-s5)
    dominantSuitCount2P(myCards),
    // Longest consecutive run (5 values: n1-n5)
    longestRun2P(myCards),
    // Exact claim type (11 values)
    exactClaimType2P(state.currentHand),
    // Claim rank — 7 buckets
    claimRankBucket2P(state.currentHand),
    // Exact matching cards count (6 values: m0-m5)
    cardsMatchingClaim2P(myCards, state.currentHand),
    // Coarse hand vs claim (5 values — keep this too for strategic bucketing)
    handVsClaimBucket(myCards, state.currentHand),
    // Position — opener vs responder (2 values)
    position2P(state, myPlayerId),
    // Exact phase depth (6 values: e0-e5)
    phaseDepthExact2P(state.turnHistory, state.roundPhase),
    // Bull/true sentiment (7 values — same as V5)
    bullSentimentBucket(state.turnHistory, state.roundPhase),
    // Claim plausibility (6 values — same as V5, recalibrated for 2P card range)
    claimPlausibilityBucket(state.currentHand, totalCards),
  ];

  // Optional suffixes
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

/**
 * Generate a compact info set key for CFR evaluation.
 * Must match the format used during training (V5 abstraction).
 *
 * V5 key structure (12 core segments + optional suffixes):
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
    // Card count — 5 individual buckets
    myCards.length <= 1 ? 'c1' : myCards.length === 2 ? 'c2' : myCards.length === 3 ? 'c3' : myCards.length === 4 ? 'c4' : 'c5',
    // V5: Elimination pressure — how close to being eliminated
    eliminationPressureBucket(myCards.length, maxCards),
    totalCardsBucket(totalCards),
    myHandStrengthBucket(myCards),
    handVsClaimBucket(myCards, state.currentHand),
    claimHeightBucket(state.currentHand),
    claimPlausibilityBucket(state.currentHand, totalCards),
    // V5: Phase-specific depth instead of total turn count
    phaseDepthBucket(state.turnHistory, state.roundPhase),
    // V5: Sentiment with vote count magnitude
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
