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

// ── High card value bucketing ─────────────────────────────────────────

/**
 * Bucket the highest card value in the player's hand.
 * 4 buckets (expanded from 3) — Ace is uniquely powerful.
 * An Ace enables high-card claims that are nearly impossible to beat,
 * anchors the top of straights, and is the strongest bluff foundation.
 * Splitting it from K/Q gives CFR finer opening and bull strategies.
 *
 * MUST match shared/src/cfr/infoSet.ts exactly.
 */
function highCardBucket(cards: Card[]): string {
  if (cards.length === 0) return 'x';
  let maxVal = 0;
  for (const c of cards) {
    const val = RANK_VALUES[c.rank];
    if (val > maxVal) maxVal = val;
  }
  if (maxVal >= 14) return 'hAce';   // Ace — uniquely powerful for claims
  if (maxVal >= 12) return 'hHi';    // Q, K — premium holdings
  if (maxVal >= 8) return 'hMid';    // 8, 9, 10, J — decent
  return 'hLo';                       // 2-7 — weak holdings
}

// ── Opponent aggression bucketing ─────────────────────────────────────

/**
 * Track opponent aggression from the turn history this round.
 * Counts raises vs bull/true calls from other players to infer style.
 * Aggressive opponents raise often; passive ones call bull/true quickly.
 */
function opponentAggressionBucket(
  turnHistory: { action: string; playerId: string }[],
  myId: string,
): string {
  let oppRaises = 0;
  let oppChallenges = 0;
  for (const entry of turnHistory) {
    if (entry.playerId === myId) continue;
    if (entry.action === 'call' || entry.action === 'lastChanceRaise') oppRaises++;
    if (entry.action === 'bull' || entry.action === 'true') oppChallenges++;
  }
  const total = oppRaises + oppChallenges;
  if (total === 0) return 'oX';        // No opponent actions yet
  if (oppRaises > oppChallenges) return 'oAg';  // Opponents are raising more (aggressive)
  return 'oPa';                          // Opponents are challenging more (passive)
}

// ── Turn depth bucketing ─────────────────────────────────────────────

/**
 * 4 buckets (expanded from 3): early/mid/late/vLate.
 * The old 'late' bucket merged actions 6-15+, but by action 8+ you have
 * dramatically more opponent information than at action 6. Very late rounds
 * are also disproportionately high-stakes (claim escalation is extreme).
 *
 * MUST match shared/src/cfr/infoSet.ts exactly.
 */
function turnDepthBucket(turnHistory: { action: string }[]): string {
  const len = turnHistory.length;
  if (len <= 2) return 'early';
  if (len <= 5) return 'mid';
  if (len <= 7) return 'late';
  return 'vLate';                    // 8+ actions — extreme information, high stakes
}

// ── Turn position bucketing ──────────────────────────────────────────

/**
 * Position in the current action cycle relative to other players.
 * Acting first vs last in a cycle requires very different strategies:
 * - First: no information from others' actions this cycle
 * - Last: full information, can exploit others' decisions
 */
function turnPositionBucket(turnHistory: { action: string }[], activePlayers: number): string {
  if (activePlayers <= 2) return 'x'; // Heads-up: position is always 1v1
  const posInCycle = turnHistory.length % activePlayers;
  if (posInCycle === 0) return 'pos0';    // First to act — no info
  if (posInCycle >= activePlayers - 1) return 'posL';  // Last to act — full info
  return 'posM';                           // Middle — partial info
}

// ── Bull/true sentiment bucketing (multiplayer-critical) ────────────

/**
 * Encode the bull/true voting distribution in the current round.
 * 5 non-x buckets (expanded from 4): v0/aB/aT/mxB/mxT.
 * The old 'mix' bucket merged "3 bull + 1 true" with "1 bull + 3 true"
 * which carry opposite strategic implications. When most players call
 * bull, following with bull is safer; when most call true, the claim
 * is likely genuine.
 *
 * MUST match shared/src/cfr/infoSet.ts exactly.
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
  if (bullCount > trueCount) return 'mxB';   // Mixed, leaning bull — skeptical majority
  return 'mxT';                               // Mixed, leaning true — believing majority
}

// ── Total cards bucketing ────────────────────────────────────────────

/**
 * Bucket total cards in play across all players.
 * Coarsened from 6 buckets to 3 — keeps the essential plausibility
 * distinction (few cards = bluffs likely, many cards = claims likely true).
 */
function totalCardsBucket(totalCards: number): string {
  if (totalCards <= 4) return 'tLo';     // tiny pool — most hands unlikely
  if (totalCards <= 7) return 'tMid1';   // small pool — pairs possible
  if (totalCards <= 10) return 'tMid2';  // growing pool — two pair/flush emerging
  if (totalCards <= 20) return 'tHi';    // medium pool — pairs/flushes likely
  return 'tVHi';                          // large pool — almost all hands exist
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
 * Calibrated as the card count where the hand type has roughly a
 * 15-25% base chance of existing for any specific rank/suit.
 */
export const MIN_CARDS_FOR_PLAUSIBLE: Record<number, number> = {
  [HandType.HIGH_CARD]: 1,
  [HandType.PAIR]: 4,
  [HandType.TWO_PAIR]: 8,
  [HandType.FLUSH]: 10,
  [HandType.THREE_OF_A_KIND]: 10,
  [HandType.STRAIGHT]: 12,
  [HandType.FULL_HOUSE]: 14,
  [HandType.FOUR_OF_A_KIND]: 18,
  [HandType.STRAIGHT_FLUSH]: 22,
  [HandType.ROYAL_FLUSH]: 26,
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
/**
 * Generate a compact info set key for CFR.
 *
 * V3 abstraction with richer features for stronger play:
 * - Individual card counts (1-5) instead of 3 buckets
 * - High card value bucket (holding an Ace vs a 3 matters)
 * - Opponent aggression tracking (aggressive vs passive opponents)
 * - Round memory (was penalized last round — affects risk appetite)
 * - All previous features retained (plausibility, claim height, sentiment)
 *
 * @param myPlayerId - Required for opponent aggression tracking
 * @param wasPenalizedLastRound - Whether this player lost the previous round
 */
export function getInfoSetKey(
  state: ClientGameState,
  myCards: Card[],
  totalCards: number,
  activePlayers: number = 2,
  jokerCount: JokerCount = 0,
  lastChanceMode: LastChanceMode = 'classic',
  myPlayerId: string = '',
  wasPenalizedLastRound: boolean = false,
): string {
  const parts: string[] = [
    // Phase: c=calling, b=bull_phase, l=last_chance
    state.roundPhase.charAt(0),
    // Player count bucket
    playerCountBucket(activePlayers),
    // Card count — 5 individual buckets for finer strategic distinction
    myCards.length <= 1 ? 'c1' : myCards.length === 2 ? 'c2' : myCards.length === 3 ? 'c3' : myCards.length === 4 ? 'c4' : 'c5',
    // Total cards in play
    totalCardsBucket(totalCards),
    // My hand quality
    myHandStrengthBucket(myCards),
    // My highest card value — holding an Ace vs 3 matters for opening strategy
    highCardBucket(myCards),
    // How my cards relate to the current claim
    handVsClaimBucket(myCards, state.currentHand),
    // Claim height — 4 buckets
    claimHeightBucket(state.currentHand),
    // Claim plausibility — cross-feature: claim type vs total cards
    claimPlausibilityBucket(state.currentHand, totalCards),
    // How deep are we in this round
    turnDepthBucket(state.turnHistory),
    // Position in current action cycle (first/mid/last to act)
    turnPositionBucket(state.turnHistory, activePlayers),
    // Bull/true voting sentiment
    bullSentimentBucket(state.turnHistory, state.roundPhase),
  ];

  // Round memory: were we penalized last round?
  if (wasPenalizedLastRound) {
    parts.push('pen');
  }

  // Opponent aggression — only for multiplayer where it's most impactful
  if (activePlayers > 2) {
    parts.push(opponentAggressionBucket(state.turnHistory, myPlayerId));
  }

  // 2P refinement: distinguish high card claims from pair+ claims
  if (activePlayers <= 2 && state.currentHand) {
    parts.push(state.currentHand.type === HandType.HIGH_CARD ? 'hc' : 'rh');
  }

  // Variant suffixes
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
