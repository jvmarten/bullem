import { describe, it, expect } from 'vitest';
import {
  dealFiveDrawCards,
  getDealerAction,
  resolveFiveDraw,
  FIVE_DRAW_WIN_MULTIPLIER,
  FIVE_DRAW_MIN_WAGER,
  FIVE_DRAW_MAX_WAGER,
} from './fiveDraw.js';
import type { FiveDrawTurnEntry } from './fiveDraw.js';
import { HandType } from './types.js';
import type { Card, HandCall } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Deterministic RNG for testing (cycles through provided values). */
function seededRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

// ── dealFiveDrawCards ────────────────────────────────────────────────

describe('dealFiveDrawCards', () => {
  it('deals 5 cards to player and 5 to dealer', () => {
    const { playerCards, dealerCards } = dealFiveDrawCards();
    expect(playerCards).toHaveLength(5);
    expect(dealerCards).toHaveLength(5);
  });

  it('deals 10 unique cards total (no duplicates)', () => {
    const { playerCards, dealerCards } = dealFiveDrawCards();
    const allCards = [...playerCards, ...dealerCards];
    const serialized = allCards.map(c => `${c.rank}-${c.suit}`);
    const unique = new Set(serialized);
    expect(unique.size).toBe(10);
  });

  it('produces different deals with different RNG seeds', () => {
    const deal1 = dealFiveDrawCards(seededRng([0.1, 0.2, 0.3, 0.4, 0.5]));
    const deal2 = dealFiveDrawCards(seededRng([0.9, 0.8, 0.7, 0.6, 0.5]));
    const cards1 = deal1.playerCards.map(c => `${c.rank}-${c.suit}`).join(',');
    const cards2 = deal2.playerCards.map(c => `${c.rank}-${c.suit}`).join(',');
    expect(cards1).not.toBe(cards2);
  });

  it('produces deterministic results with the same RNG seed', () => {
    const rng1 = seededRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.15]);
    const rng2 = seededRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.15]);
    const deal1 = dealFiveDrawCards(rng1);
    const deal2 = dealFiveDrawCards(rng2);
    expect(deal1.playerCards).toEqual(deal2.playerCards);
    expect(deal1.dealerCards).toEqual(deal2.dealerCards);
  });
});

// ── getDealerAction ─────────────────────────────────────────────────

describe('getDealerAction', () => {
  const dealerCards: Card[] = [
    card('A', 'spades'),
    card('K', 'spades'),
    card('Q', 'spades'),
    card('J', 'spades'),
    card('10', 'spades'),
  ];

  it('returns a pass when the current hand cannot be raised (royal flush)', () => {
    const royalFlush: HandCall = { type: HandType.ROYAL_FLUSH, suit: 'hearts' };
    const result = getDealerAction(dealerCards, royalFlush, []);
    expect(result.participant).toBe('dealer');
    expect(result.action).toBe('pass');
  });

  it('returns a valid action when no hand has been called yet (opening)', () => {
    const result = getDealerAction(dealerCards, null, []);
    expect(result.participant).toBe('dealer');
    // Opening move must be a call with a hand
    expect(result.action).toBe('call');
    expect(result.hand).toBeDefined();
  });

  it('returns call or pass when there is a current hand', () => {
    const lowHand: HandCall = { type: HandType.HIGH_CARD, rank: '2' };
    const result = getDealerAction(dealerCards, lowHand, [
      { participant: 'player', action: 'call', hand: lowHand },
    ]);
    expect(result.participant).toBe('dealer');
    expect(['call', 'pass']).toContain(result.action);
  });

  it('returns a hand higher than current when calling', () => {
    const currentHand: HandCall = { type: HandType.PAIR, rank: '3' };
    const history: FiveDrawTurnEntry[] = [
      { participant: 'player', action: 'call', hand: currentHand },
    ];
    const result = getDealerAction(dealerCards, currentHand, history);
    if (result.action === 'call') {
      expect(result.hand).toBeDefined();
      // The returned hand should be of a type >= current
      expect(result.hand!.type).toBeGreaterThanOrEqual(currentHand.type);
    }
  });
});

// ── resolveFiveDraw ─────────────────────────────────────────────────

describe('resolveFiveDraw', () => {
  it('player wins when player is last caller and hand exists', () => {
    // Player has a pair of Aces, dealer has random cards
    const playerCards: Card[] = [
      card('A', 'spades'), card('A', 'hearts'),
      card('3', 'clubs'), card('4', 'diamonds'), card('5', 'clubs'),
    ];
    const dealerCards: Card[] = [
      card('7', 'spades'), card('8', 'hearts'),
      card('9', 'clubs'), card('10', 'diamonds'), card('J', 'clubs'),
    ];

    const calledHand: HandCall = { type: HandType.PAIR, rank: 'A' };
    const history: FiveDrawTurnEntry[] = [
      { participant: 'player', action: 'call', hand: calledHand },
      { participant: 'dealer', action: 'pass' },
    ];

    const result = resolveFiveDraw(playerCards, dealerCards, history, 100);
    expect(result.handExists).toBe(true);
    expect(result.winner).toBe('player');
    expect(result.payout).toBe(100 * FIVE_DRAW_WIN_MULTIPLIER);
  });

  it('dealer wins when player is last caller and hand does not exist', () => {
    const playerCards: Card[] = [
      card('2', 'spades'), card('3', 'hearts'),
      card('4', 'clubs'), card('5', 'diamonds'), card('6', 'clubs'),
    ];
    const dealerCards: Card[] = [
      card('7', 'spades'), card('8', 'hearts'),
      card('9', 'clubs'), card('10', 'diamonds'), card('J', 'clubs'),
    ];

    // Calling four of a kind — impossible with these cards
    const calledHand: HandCall = { type: HandType.FOUR_OF_A_KIND, rank: 'A' };
    const history: FiveDrawTurnEntry[] = [
      { participant: 'player', action: 'call', hand: calledHand },
      { participant: 'dealer', action: 'pass' },
    ];

    const result = resolveFiveDraw(playerCards, dealerCards, history, 50);
    expect(result.handExists).toBe(false);
    expect(result.winner).toBe('dealer');
    expect(result.payout).toBe(0);
  });

  it('dealer wins when dealer is last caller and hand exists', () => {
    const playerCards: Card[] = [
      card('K', 'spades'), card('K', 'hearts'),
      card('3', 'clubs'), card('4', 'diamonds'), card('5', 'clubs'),
    ];
    const dealerCards: Card[] = [
      card('K', 'clubs'), card('K', 'diamonds'),
      card('9', 'clubs'), card('10', 'diamonds'), card('J', 'clubs'),
    ];

    const calledHand: HandCall = { type: HandType.FOUR_OF_A_KIND, rank: 'K' };
    const history: FiveDrawTurnEntry[] = [
      { participant: 'player', action: 'call', hand: { type: HandType.PAIR, rank: 'K' } },
      { participant: 'dealer', action: 'call', hand: calledHand },
      { participant: 'player', action: 'pass' },
    ];

    const result = resolveFiveDraw(playerCards, dealerCards, history, 200);
    expect(result.handExists).toBe(true);
    expect(result.winner).toBe('dealer');
    expect(result.payout).toBe(0);
  });

  it('player wins when dealer is last caller and hand does not exist', () => {
    const playerCards: Card[] = [
      card('2', 'spades'), card('3', 'hearts'),
      card('4', 'clubs'), card('5', 'diamonds'), card('6', 'clubs'),
    ];
    const dealerCards: Card[] = [
      card('7', 'spades'), card('8', 'hearts'),
      card('9', 'clubs'), card('10', 'diamonds'), card('J', 'clubs'),
    ];

    const calledHand: HandCall = { type: HandType.FOUR_OF_A_KIND, rank: 'Q' };
    const history: FiveDrawTurnEntry[] = [
      { participant: 'player', action: 'call', hand: { type: HandType.HIGH_CARD, rank: '6' } },
      { participant: 'dealer', action: 'call', hand: calledHand },
      { participant: 'player', action: 'pass' },
    ];

    const result = resolveFiveDraw(playerCards, dealerCards, history, 75);
    expect(result.handExists).toBe(false);
    expect(result.winner).toBe('player');
    expect(result.payout).toBe(75 * FIVE_DRAW_WIN_MULTIPLIER);
  });

  it('throws when turn history has no calls', () => {
    const playerCards: Card[] = [card('2', 'spades'), card('3', 'hearts'), card('4', 'clubs'), card('5', 'diamonds'), card('6', 'clubs')];
    const dealerCards: Card[] = [card('7', 'spades'), card('8', 'hearts'), card('9', 'clubs'), card('10', 'diamonds'), card('J', 'clubs')];

    expect(() => resolveFiveDraw(playerCards, dealerCards, [], 50)).toThrow('No call found');
  });

  it('correctly identifies the last call when multiple calls are in history', () => {
    const playerCards: Card[] = [
      card('A', 'spades'), card('A', 'hearts'),
      card('A', 'clubs'), card('5', 'diamonds'), card('6', 'clubs'),
    ];
    const dealerCards: Card[] = [
      card('7', 'spades'), card('8', 'hearts'),
      card('9', 'clubs'), card('10', 'diamonds'), card('J', 'clubs'),
    ];

    const history: FiveDrawTurnEntry[] = [
      { participant: 'player', action: 'call', hand: { type: HandType.PAIR, rank: 'A' } },
      { participant: 'dealer', action: 'call', hand: { type: HandType.THREE_OF_A_KIND, rank: 'A' } },
      { participant: 'player', action: 'pass' },
    ];

    const result = resolveFiveDraw(playerCards, dealerCards, history, 100);
    // Three As exist in player's hand — dealer's call is correct
    expect(result.lastCall).toEqual({ type: HandType.THREE_OF_A_KIND, rank: 'A' });
    expect(result.lastCaller).toBe('dealer');
    expect(result.handExists).toBe(true);
  });

  it('returns correct result fields', () => {
    const playerCards: Card[] = [
      card('2', 'spades'), card('3', 'hearts'),
      card('4', 'clubs'), card('5', 'diamonds'), card('6', 'clubs'),
    ];
    const dealerCards: Card[] = [
      card('7', 'spades'), card('8', 'hearts'),
      card('9', 'clubs'), card('10', 'diamonds'), card('J', 'clubs'),
    ];
    const calledHand: HandCall = { type: HandType.HIGH_CARD, rank: 'J' };
    const history: FiveDrawTurnEntry[] = [
      { participant: 'dealer', action: 'call', hand: calledHand },
      { participant: 'player', action: 'pass' },
    ];

    const result = resolveFiveDraw(playerCards, dealerCards, history, 25);
    expect(result.playerCards).toBe(playerCards);
    expect(result.dealerCards).toBe(dealerCards);
    expect(result.turnHistory).toBe(history);
    expect(result.wager).toBe(25);
    expect(result.lastCall).toEqual(calledHand);
    expect(result.lastCaller).toBe('dealer');
  });
});
