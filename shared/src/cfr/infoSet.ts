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
      if (count >= 1) return 'close';
      return 'below';
    }

    case HandType.STRAIGHT: {
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

  if (maxGroup >= 2) return 'strong';
  if (maxSuit >= 2) return 'draw';
  return 'weak';
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

function turnDepthBucket(turnHistory: { action: string }[]): string {
  return turnHistory.length <= 2 ? 'early' : 'late';
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

function claimPlausibilityBucket(hand: HandCall | null, totalCards: number): string {
  if (!hand) return 'x';

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

  if (ratio >= 2.0) return 'pl';
  if (ratio >= 1.0) return 'mb';
  return 'im';
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
