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

// ── Information set key ──────────────────────────────────────────────

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
