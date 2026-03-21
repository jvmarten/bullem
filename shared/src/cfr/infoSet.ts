/**
 * Information set abstraction for CFR strategy evaluation.
 *
 * Ported from training/src/cfr/infoSet.ts — evaluation-only subset.
 * Uses 9 abstract actions that distinguish between truthful claims
 * (based on player's actual cards) and bluffs.
 *
 * Info set key encodes:
 * - Round phase
 * - Player count bucket (critical: optimal play differs by table size)
 * - Hand strength relative to the current claim
 * - Claim height bucket (low/high)
 * - Turn depth within the round
 * - Card count (how many cards I hold)
 * - Bull/true sentiment
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

function highCardBucket(cards: Card[]): string {
  if (cards.length === 0) return 'x';
  let maxVal = 0;
  for (const c of cards) {
    const val = RANK_VALUES[c.rank];
    if (val > maxVal) maxVal = val;
  }
  if (maxVal >= 12) return 'hHi';   // Q, K, A
  if (maxVal >= 8) return 'hMid';   // 8, 9, 10, J
  return 'hLo';                      // 2-7
}

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
  if (total === 0) return 'oX';
  if (oppRaises > oppChallenges) return 'oAg';
  return 'oPa';
}

// ── Turn depth bucketing ─────────────────────────────────────────────

/**
 * 3 buckets (expanded from 2): early/mid/late.
 * By action 6+ you have significantly more information about opponent
 * behavior than at action 3. The binary split was too coarse.
 */
function turnDepthBucket(turnHistory: { action: string }[]): string {
  const len = turnHistory.length;
  if (len <= 2) return 'early';
  if (len <= 5) return 'mid';
  return 'late';
}

// ── Turn position bucketing ──────────────────────────────────────────

/**
 * Position in the current action cycle relative to other players.
 * Acting first vs last in a cycle requires very different strategies.
 */
function turnPositionBucket(turnHistory: { action: string }[], activePlayers: number): string {
  if (activePlayers <= 2) return 'x'; // Heads-up: position is always 1v1
  const posInCycle = turnHistory.length % activePlayers;
  if (posInCycle === 0) return 'pos0';    // First to act — no info
  if (posInCycle >= activePlayers - 1) return 'posL';  // Last to act — full info
  return 'posM';                           // Middle — partial info
}

// ── Bull/true sentiment bucketing ────────────────────────────────────

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
  if (trueCount === 0) return 'aB';
  if (bullCount === 0) return 'aT';
  return 'mix';
}

// ── Total cards bucketing ────────────────────────────────────────────

function totalCardsBucket(totalCards: number): string {
  if (totalCards <= 4) return 'tLo';     // tiny pool — most hands unlikely
  if (totalCards <= 7) return 'tMid1';   // small pool — pairs possible
  if (totalCards <= 10) return 'tMid2';  // growing pool — two pair/flush emerging
  if (totalCards <= 20) return 'tHi';    // medium pool — pairs/flushes likely
  return 'tVHi';                          // large pool — almost all hands exist
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
 * 4 buckets (expanded from 3): pl/lk/mb/im.
 * The old 'mb' bucket spanned ratio 1.0-2.0 which is an enormous
 * strategic range (coin flip to very likely). Split into 'lk' (likely)
 * and 'mb' (marginal) at 1.5x threshold.
 */
function claimPlausibilityBucket(hand: HandCall | null, totalCards: number): string {
  if (!hand) return 'x';

  const needed = MIN_CARDS_FOR_PLAUSIBLE[hand.type] ?? 10;
  const ratio = totalCards / needed;

  if (ratio >= 2.0) return 'pl';    // plausible — enough cards for the claim
  if (ratio >= 1.5) return 'lk';    // likely — solid chance it exists
  if (ratio >= 1.0) return 'mb';    // maybe — borderline, could exist
  return 'im';                       // implausible — not enough cards
}

// ── Information set key ──────────────────────────────────────────────

/**
 * Generate a compact info set key for CFR evaluation.
 * Must match the format used during training.
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
    state.roundPhase.charAt(0),
    playerCountBucket(activePlayers),
    // Card count — 5 individual buckets for finer strategic distinction
    myCards.length <= 1 ? 'c1' : myCards.length === 2 ? 'c2' : myCards.length === 3 ? 'c3' : myCards.length === 4 ? 'c4' : 'c5',
    totalCardsBucket(totalCards),
    myHandStrengthBucket(myCards),
    highCardBucket(myCards),
    handVsClaimBucket(myCards, state.currentHand),
    claimHeightBucket(state.currentHand),
    claimPlausibilityBucket(state.currentHand, totalCards),
    turnDepthBucket(state.turnHistory),
    // Position in current action cycle (first/mid/last to act)
    turnPositionBucket(state.turnHistory, activePlayers),
    bullSentimentBucket(state.turnHistory, state.roundPhase),
  ];

  if (wasPenalizedLastRound) {
    parts.push('pen');
  }

  if (activePlayers > 2) {
    parts.push(opponentAggressionBucket(state.turnHistory, myPlayerId));
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
