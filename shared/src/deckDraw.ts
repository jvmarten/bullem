/**
 * Deck Draw Minigame — shared types and pure logic.
 *
 * Players wager play-money points, draw 5 cards, and get paid out based
 * on the hand they draw. The payout table targets 100% RTP (fair game).
 */
import { HandType } from './types.js';
import type { Card, HandCall, Rank, Suit } from './types.js';
import { ALL_RANKS, ALL_SUITS, RANK_VALUES } from './constants.js';
import { handToString } from './hands.js';

// ── Payout table ─────────────────────────────────────────────────────────
// Based on exact 5-card poker combination counts from a 52-card deck.
// Total combinations = C(52,5) = 2,598,960.
//
// Hand              | Combos  | Probability       | Payout (1/p rounded)
// Royal flush       |       4 | 1 in 649,740      | 250,000
// Straight flush    |      36 | 1 in 72,193       | 50,000
// Four of a kind    |     624 | 1 in 4,165        | 4,000
// Full house        |   3,744 | 1 in 694          | 600
// Straight          |  10,200 | 1 in 255          | 200
// Three of a kind   |  54,912 | 1 in 47.3         | 40
// Flush             |   5,108 | 1 in 509          | 400
// Two pair          | 123,552 | 1 in 21.0         | 15
// Pair              |1,098,240| 1 in 2.37         | 1
// High card         |1,302,540| 1 in 2.00         | 0
//
// Note: In Bull 'Em's custom ordering, flush ranks below three of a kind,
// but payouts are based on actual rarity (flush is rarer than three of a kind).

export const DECK_DRAW_PAYOUTS: Record<HandType, number> = {
  [HandType.ROYAL_FLUSH]:     250_000,
  [HandType.STRAIGHT_FLUSH]:   50_000,
  [HandType.FOUR_OF_A_KIND]:    4_000,
  [HandType.FULL_HOUSE]:          600,
  [HandType.STRAIGHT]:            200,
  [HandType.THREE_OF_A_KIND]:      40,
  [HandType.FLUSH]:               400,
  [HandType.TWO_PAIR]:             15,
  [HandType.PAIR]:                  1,
  [HandType.HIGH_CARD]:             0,
};

/** Minimum and maximum wager for the deck draw minigame. */
export const DECK_DRAW_MIN_WAGER = 1;
export const DECK_DRAW_MAX_WAGER = 10_000;
export const DECK_DRAW_DEFAULT_WAGER = 1;

/** Starting balance for new players. */
export const DECK_DRAW_STARTING_BALANCE = 100;

/** Free draw cooldown: 24 hours in milliseconds. */
export const DECK_DRAW_FREE_DRAW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Points awarded for a free daily draw (no wager required). */
export const DECK_DRAW_FREE_DRAW_BONUS = 100;

// ── Types ────────────────────────────────────────────────────────────────

/** Result of a single deck draw. */
export interface DeckDrawResult {
  cards: Card[];
  hand: HandCall;
  handLabel: string;
  /** The wager placed (0 for free draws). */
  wager: number;
  /** Net gain/loss: (payout * wager) - wager. For free draws: payout * DECK_DRAW_FREE_DRAW_BONUS. */
  payout: number;
  /** Whether this was a free daily draw. */
  isFreeDraw: boolean;
  timestamp: number;
}

/** Lifetime stats tracked for the deck draw minigame. */
export interface DeckDrawStats {
  totalDraws: number;
  totalWagered: number;
  totalWon: number;
  biggestWin: number;
  bestHandType: HandType | null;
  /** Balance of play-money points. */
  balance: number;
  /** ISO timestamp of last free draw (null if never used). */
  lastFreeDrawAt: string | null;
  /** Count of each hand type drawn (indexed by HandType enum value). */
  handCounts: Record<number, number>;
}

/** Initial stats for a new player. */
export function createInitialDeckDrawStats(): DeckDrawStats {
  return {
    totalDraws: 0,
    totalWagered: 0,
    totalWon: 0,
    biggestWin: 0,
    bestHandType: null,
    balance: DECK_DRAW_STARTING_BALANCE,
    lastFreeDrawAt: null,
    handCounts: {},
  };
}

// ── Pure functions ───────────────────────────────────────────────────────

/** Build a standard 52-card deck. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** Fisher-Yates shuffle (returns new array). */
export function shuffleDeck(deck: Card[], rng: () => number = Math.random): Card[] {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

/** Draw 5 cards from a shuffled deck. */
export function drawFiveCards(rng: () => number = Math.random): Card[] {
  return shuffleDeck(buildDeck(), rng).slice(0, 5);
}

/**
 * Classify a 5-card hand into a HandCall.
 * Pure function — mirrors the logic in HomePage but uses shared types directly.
 */
export function classifyFiveCardHand(cards: Card[]): HandCall {
  if (cards.length !== 5) {
    throw new Error(`classifyFiveCardHand requires exactly 5 cards, got ${cards.length}`);
  }

  const rankCounts = new Map<Rank, number>();
  for (const c of cards) {
    rankCounts.set(c.rank, (rankCounts.get(c.rank) ?? 0) + 1);
  }

  const isFlush = cards.every(c => c.suit === cards[0]!.suit);
  const values = cards.map(c => RANK_VALUES[c.rank]).sort((a, b) => a - b);
  const isSequential = values.every((v, i) => i === 0 || v === values[i - 1]! + 1);
  // A-2-3-4-5 (wheel/low straight)
  const isWheel = values[0] === 2 && values[1] === 3 && values[2] === 4 && values[3] === 5 && values[4] === 14;
  const isStraight = isSequential || isWheel;
  const highVal = isWheel ? 5 : values[4]!;
  const highRank = ALL_RANKS[highVal - 2]!;

  const groups = [...rankCounts.entries()]
    .sort((a, b) => b[1] - a[1] || RANK_VALUES[b[0]] - RANK_VALUES[a[0]]);

  if (isFlush && isStraight && values[4] === 14 && values[0] === 10) {
    return { type: HandType.ROYAL_FLUSH, suit: cards[0]!.suit };
  }
  if (isFlush && isStraight) {
    return { type: HandType.STRAIGHT_FLUSH, suit: cards[0]!.suit, highRank };
  }
  if (groups[0]![1] === 4) {
    return { type: HandType.FOUR_OF_A_KIND, rank: groups[0]![0] };
  }
  if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    return { type: HandType.FULL_HOUSE, threeRank: groups[0]![0], twoRank: groups[1]![0] };
  }
  if (isStraight) {
    return { type: HandType.STRAIGHT, highRank };
  }
  if (groups[0]![1] === 3) {
    return { type: HandType.THREE_OF_A_KIND, rank: groups[0]![0] };
  }
  if (isFlush) {
    return { type: HandType.FLUSH, suit: cards[0]!.suit };
  }
  if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    const [a, b] = [groups[0]![0], groups[1]![0]];
    const [highPair, lowPair] = RANK_VALUES[a] > RANK_VALUES[b] ? [a, b] : [b, a];
    return { type: HandType.TWO_PAIR, highRank: highPair, lowRank: lowPair };
  }
  if (groups[0]![1] === 2) {
    return { type: HandType.PAIR, rank: groups[0]![0] };
  }
  return { type: HandType.HIGH_CARD, rank: groups[0]![0] };
}

/** Calculate the payout for a hand given a wager. */
export function calculatePayout(hand: HandCall, wager: number): number {
  const multiplier = DECK_DRAW_PAYOUTS[hand.type];
  return multiplier * wager;
}

/** Check if a free draw is available based on the last free draw timestamp. */
export function isFreeDrawAvailable(lastFreeDrawAt: string | null, now: number = Date.now()): boolean {
  if (!lastFreeDrawAt) return true;
  const lastDraw = new Date(lastFreeDrawAt).getTime();
  return now - lastDraw >= DECK_DRAW_FREE_DRAW_COOLDOWN_MS;
}

/** Time remaining until next free draw (ms). Returns 0 if available now. */
export function timeUntilFreeDraw(lastFreeDrawAt: string | null, now: number = Date.now()): number {
  if (!lastFreeDrawAt) return 0;
  const lastDraw = new Date(lastFreeDrawAt).getTime();
  const elapsed = now - lastDraw;
  return Math.max(0, DECK_DRAW_FREE_DRAW_COOLDOWN_MS - elapsed);
}

/**
 * Execute a deck draw and return the result + updated stats.
 * Pure function — no side effects.
 */
export function executeDraw(
  stats: DeckDrawStats,
  wager: number,
  isFreeDraw: boolean,
  rng: () => number = Math.random,
  now: number = Date.now(),
): { result: DeckDrawResult; updatedStats: DeckDrawStats } {
  const cards = drawFiveCards(rng);
  const hand = classifyFiveCardHand(cards);
  const handLabel = handToString(hand);

  let payout: number;
  if (isFreeDraw) {
    payout = calculatePayout(hand, DECK_DRAW_FREE_DRAW_BONUS);
  } else {
    payout = calculatePayout(hand, wager);
  }

  const result: DeckDrawResult = {
    cards,
    hand,
    handLabel,
    wager: isFreeDraw ? 0 : wager,
    payout,
    isFreeDraw,
    timestamp: now,
  };

  const newBestHand = stats.bestHandType === null || hand.type > stats.bestHandType
    ? hand.type : stats.bestHandType;

  const netGain = isFreeDraw ? payout : payout - wager;
  const newBalance = stats.balance + netGain;

  const newHandCounts = { ...stats.handCounts };
  newHandCounts[hand.type] = (newHandCounts[hand.type] ?? 0) + 1;

  const updatedStats: DeckDrawStats = {
    totalDraws: stats.totalDraws + 1,
    totalWagered: stats.totalWagered + (isFreeDraw ? 0 : wager),
    totalWon: stats.totalWon + payout,
    biggestWin: Math.max(stats.biggestWin, payout),
    bestHandType: newBestHand,
    balance: newBalance,
    lastFreeDrawAt: isFreeDraw ? new Date(now).toISOString() : stats.lastFreeDrawAt,
    handCounts: newHandCounts,
  };

  return { result, updatedStats };
}

/** Format a payout table entry for display. */
export function getPayoutTableEntries(): { handType: HandType; label: string; multiplier: number }[] {
  // Display in descending rarity order (not Bull 'Em game order)
  const order: HandType[] = [
    HandType.ROYAL_FLUSH,
    HandType.STRAIGHT_FLUSH,
    HandType.FOUR_OF_A_KIND,
    HandType.FULL_HOUSE,
    HandType.FLUSH,
    HandType.STRAIGHT,
    HandType.THREE_OF_A_KIND,
    HandType.TWO_PAIR,
    HandType.PAIR,
    HandType.HIGH_CARD,
  ];

  const labels: Record<HandType, string> = {
    [HandType.ROYAL_FLUSH]: 'Royal Flush',
    [HandType.STRAIGHT_FLUSH]: 'Straight Flush',
    [HandType.FOUR_OF_A_KIND]: 'Four of a Kind',
    [HandType.FULL_HOUSE]: 'Full House',
    [HandType.FLUSH]: 'Flush',
    [HandType.STRAIGHT]: 'Straight',
    [HandType.THREE_OF_A_KIND]: 'Three of a Kind',
    [HandType.TWO_PAIR]: 'Two Pair',
    [HandType.PAIR]: 'Pair',
    [HandType.HIGH_CARD]: 'High Card',
  };

  return order.map(handType => ({
    handType,
    label: labels[handType],
    multiplier: DECK_DRAW_PAYOUTS[handType],
  }));
}
