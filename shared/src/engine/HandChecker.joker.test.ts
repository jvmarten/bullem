import { describe, it, expect } from 'vitest';
import { HandChecker } from './HandChecker.js';
import { HandType } from '../types.js';
import type { Card, HandCall, OwnedCard, Rank, Suit } from '../types.js';

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function joker(suit: Suit = 'hearts'): Card {
  return { rank: 'A', suit, isJoker: true };
}

function ownedCard(rank: Rank, suit: Suit, playerId: string, playerName: string): OwnedCard {
  return { rank, suit, playerId, playerName };
}

function ownedJoker(suit: Suit, playerId: string, playerName: string): OwnedCard {
  return { rank: 'A', suit, playerId, playerName, isJoker: true };
}

// ─── HandChecker.exists with jokers ──────────────────────────────────────────

describe('HandChecker.exists — joker wildcard support', () => {
  describe('no jokers (backwards compatibility)', () => {
    it('standard pair check still works', () => {
      const cards = [card('7', 'spades'), card('7', 'hearts'), card('3', 'clubs')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '7' })).toBe(true);
    });

    it('missing pair still fails', () => {
      const cards = [card('7', 'spades'), card('3', 'hearts'), card('4', 'clubs')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '7' })).toBe(false);
    });
  });

  describe('HIGH_CARD', () => {
    it('joker satisfies any high card', () => {
      const cards = [card('2', 'spades'), joker()];
      expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'K' })).toBe(true);
    });

    it('works without joker when card is present', () => {
      const cards = [card('K', 'spades'), joker()];
      expect(HandChecker.exists(cards, { type: HandType.HIGH_CARD, rank: 'K' })).toBe(true);
    });
  });

  describe('PAIR', () => {
    it('one natural + one joker = pair', () => {
      const cards = [card('7', 'spades'), joker(), card('3', 'clubs')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '7' })).toBe(true);
    });

    it('two jokers = pair of anything', () => {
      const cards = [card('2', 'spades'), joker('hearts'), joker('spades')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: 'A' })).toBe(true);
    });

    it('no match without enough jokers', () => {
      const cards = [card('3', 'clubs'), card('5', 'diamonds')];
      expect(HandChecker.exists(cards, { type: HandType.PAIR, rank: '7' })).toBe(false);
    });
  });

  describe('TWO_PAIR', () => {
    it('one joker fills a gap in one pair', () => {
      const cards = [
        card('J', 'spades'), card('J', 'hearts'), // natural pair of Jacks
        card('4', 'diamonds'), joker(), // 4 + joker = pair of 4s
      ];
      expect(HandChecker.exists(cards, { type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4' })).toBe(true);
    });

    it('two jokers fill both gaps', () => {
      const cards = [
        card('J', 'spades'), card('4', 'diamonds'),
        joker('hearts'), joker('spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4' })).toBe(true);
    });

    it('one joker not enough when both pairs need help', () => {
      const cards = [
        card('J', 'spades'), card('4', 'diamonds'), joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4' })).toBe(false);
    });
  });

  describe('THREE_OF_A_KIND', () => {
    it('two natural + one joker = three of a kind', () => {
      const cards = [card('9', 'spades'), card('9', 'hearts'), joker()];
      expect(HandChecker.exists(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe(true);
    });

    it('one natural + two jokers = three of a kind', () => {
      const cards = [card('9', 'spades'), joker('hearts'), joker('spades')];
      expect(HandChecker.exists(cards, { type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe(true);
    });
  });

  describe('FLUSH', () => {
    it('four suited cards + one joker = flush', () => {
      const cards = [
        card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'), card('J', 'hearts'),
        joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);
    });

    it('three suited cards + two jokers = flush', () => {
      const cards = [
        card('2', 'hearts'), card('5', 'hearts'), card('8', 'hearts'),
        joker('hearts'), joker('spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);
    });

    it('not enough even with jokers', () => {
      const cards = [
        card('2', 'hearts'), card('5', 'hearts'),
        joker('hearts'), joker('spades'),
      ];
      // 2 natural + 2 jokers = 4, need 5
      expect(HandChecker.exists(cards, { type: HandType.FLUSH, suit: 'hearts' })).toBe(false);
    });
  });

  describe('STRAIGHT', () => {
    it('one missing card in straight filled by joker', () => {
      // 5-6-?-8-9 with joker filling 7
      const cards = [
        card('5', 'spades'), card('6', 'hearts'), card('8', 'diamonds'), card('9', 'clubs'),
        joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '9' })).toBe(true);
    });

    it('two missing cards filled by two jokers', () => {
      // 5-?-?-8-9 with two jokers
      const cards = [
        card('5', 'spades'), card('8', 'diamonds'), card('9', 'clubs'),
        joker('hearts'), joker('spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '9' })).toBe(true);
    });

    it('ace-low straight with joker filling a gap', () => {
      // A-2-?-4-5
      const cards = [
        card('A', 'spades'), card('2', 'hearts'), card('4', 'clubs'), card('5', 'diamonds'),
        joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT, highRank: '5' })).toBe(true);
    });
  });

  describe('FULL_HOUSE', () => {
    it('joker completes the pair in a full house', () => {
      // Three 9s + one 5 + joker (fills second 5)
      const cards = [
        card('9', 'spades'), card('9', 'hearts'), card('9', 'diamonds'),
        card('5', 'clubs'), joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FULL_HOUSE, threeRank: '9', twoRank: '5' })).toBe(true);
    });

    it('joker completes the three in a full house', () => {
      // Two 9s + joker + two 5s
      const cards = [
        card('9', 'spades'), card('9', 'hearts'), joker(),
        card('5', 'clubs'), card('5', 'diamonds'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FULL_HOUSE, threeRank: '9', twoRank: '5' })).toBe(true);
    });

    it('two jokers complete a full house from minimal cards', () => {
      // One 9 + one 5 + two jokers
      const cards = [
        card('9', 'spades'), card('5', 'clubs'),
        joker('hearts'), joker('spades'),
      ];
      // Need 3 nines (have 1, need 2 more) + 2 fives (have 1, need 1 more) = need 3 jokers. Only have 2.
      expect(HandChecker.exists(cards, { type: HandType.FULL_HOUSE, threeRank: '9', twoRank: '5' })).toBe(false);
    });

    it('two jokers can fill 2 gaps', () => {
      // Two 9s + one 5 + two jokers → 3 nines (1 joker) + 2 fives (1 joker)
      const cards = [
        card('9', 'spades'), card('9', 'hearts'), card('5', 'clubs'),
        joker('hearts'), joker('spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FULL_HOUSE, threeRank: '9', twoRank: '5' })).toBe(true);
    });
  });

  describe('FOUR_OF_A_KIND', () => {
    it('three natural + one joker = four of a kind', () => {
      const cards = [
        card('2', 'spades'), card('2', 'hearts'), card('2', 'diamonds'), joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FOUR_OF_A_KIND, rank: '2' })).toBe(true);
    });

    it('two natural + two jokers = four of a kind', () => {
      const cards = [
        card('2', 'spades'), card('2', 'hearts'),
        joker('hearts'), joker('spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.FOUR_OF_A_KIND, rank: '2' })).toBe(true);
    });
  });

  describe('STRAIGHT_FLUSH', () => {
    it('one missing card filled by joker', () => {
      // 5♠-6♠-?-8♠-9♠ with joker
      const cards = [
        card('5', 'spades'), card('6', 'spades'), card('8', 'spades'), card('9', 'spades'),
        joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' })).toBe(true);
    });

    it('two missing cards in straight flush filled by two jokers', () => {
      const cards = [
        card('5', 'spades'), card('8', 'spades'), card('9', 'spades'),
        joker('hearts'), joker('spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' })).toBe(true);
    });

    it('wrong suit card not counted (only joker fills gap)', () => {
      // 5♠-6♥-7♠-8♠-9♠ — the 6♥ is wrong suit
      const cards = [
        card('5', 'spades'), card('6', 'hearts'), card('7', 'spades'), card('8', 'spades'), card('9', 'spades'),
        joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' })).toBe(true);
    });
  });

  describe('ROYAL_FLUSH', () => {
    it('four royal cards + one joker = royal flush', () => {
      const cards = [
        card('10', 'diamonds'), card('J', 'diamonds'), card('Q', 'diamonds'), card('K', 'diamonds'),
        joker(),
      ];
      expect(HandChecker.exists(cards, { type: HandType.ROYAL_FLUSH, suit: 'diamonds' })).toBe(true);
    });

    it('three royal cards + two jokers = royal flush', () => {
      const cards = [
        card('10', 'diamonds'), card('J', 'diamonds'), card('A', 'diamonds'),
        joker('hearts'), joker('spades'),
      ];
      expect(HandChecker.exists(cards, { type: HandType.ROYAL_FLUSH, suit: 'diamonds' })).toBe(true);
    });
  });
});

// ─── HandChecker.findMatchingCards with jokers ──────────────────────────────

describe('HandChecker.findMatchingCards — joker support', () => {
  it('returns joker card in the result when used as wildcard', () => {
    const j = joker();
    const cards = [card('7', 'spades'), j, card('3', 'clubs')];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: '7' });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result!.some(c => c.isJoker)).toBe(true);
    expect(result!.some(c => c.rank === '7' && !c.isJoker)).toBe(true);
  });

  it('prefers natural cards over jokers', () => {
    const j = joker();
    const cards = [card('7', 'spades'), card('7', 'hearts'), j];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.PAIR, rank: '7' });
    expect(result).toHaveLength(2);
    // Both should be natural 7s since we have enough
    expect(result!.every(c => c.rank === '7' && !c.isJoker)).toBe(true);
  });

  it('returns joker for straight gap fill', () => {
    const j = joker();
    const cards = [card('5', 'spades'), card('6', 'hearts'), card('8', 'diamonds'), card('9', 'clubs'), j];
    const result = HandChecker.findMatchingCards(cards, { type: HandType.STRAIGHT, highRank: '9' });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(5);
    expect(result!.some(c => c.isJoker)).toBe(true);
  });

  it('returns null when hand is impossible even with jokers', () => {
    const cards = [card('2', 'spades'), joker()];
    // Need 4 of a kind (4 cards) but only have 2 total
    const result = HandChecker.findMatchingCards(cards, { type: HandType.FOUR_OF_A_KIND, rank: '2' });
    expect(result).toBeNull();
  });
});

// ─── HandChecker.findAllRelevantCards with jokers ──────────────────────────

describe('HandChecker.findAllRelevantCards — joker support', () => {
  it('includes jokers in relevant cards when hand uses them', () => {
    const j = ownedJoker('hearts', 'p1', 'Alice');
    const allCards: OwnedCard[] = [
      ownedCard('7', 'spades', 'p1', 'Alice'),
      j,
      ownedCard('3', 'clubs', 'p2', 'Bob'),
    ];
    const result = HandChecker.findAllRelevantCards(allCards, { type: HandType.PAIR, rank: '7' });
    // Should include the 7 and the joker
    expect(result.some(c => c.rank === '7')).toBe(true);
    expect(result.some(c => c.isJoker)).toBe(true);
  });
});

// ─── Deck with jokers ──────────────────────────────────────────────────────

describe('Deck joker support', () => {
  // Import dynamically to avoid circular dependency issues in test
  it('creates 52-card deck with 0 jokers', async () => {
    const { Deck } = await import('./Deck.js');
    const deck = new Deck(0);
    expect(deck.remaining).toBe(52);
    const cards = deck.deal(52);
    expect(cards.some(c => c.isJoker)).toBe(false);
  });

  it('creates 53-card deck with 1 joker', async () => {
    const { Deck } = await import('./Deck.js');
    const deck = new Deck(1);
    expect(deck.remaining).toBe(53);
    const cards = deck.deal(53);
    const jokers = cards.filter(c => c.isJoker);
    expect(jokers).toHaveLength(1);
  });

  it('creates 54-card deck with 2 jokers', async () => {
    const { Deck } = await import('./Deck.js');
    const deck = new Deck(2);
    expect(deck.remaining).toBe(54);
    const cards = deck.deal(54);
    const jokers = cards.filter(c => c.isJoker);
    expect(jokers).toHaveLength(2);
  });

  it('reset rebuilds deck with jokers', async () => {
    const { Deck } = await import('./Deck.js');
    const deck = new Deck(2);
    deck.deal(54);
    expect(deck.remaining).toBe(0);
    deck.reset();
    expect(deck.remaining).toBe(54);
  });
});

// ─── Constants ──────────────────────────────────────────────────────────────

describe('getDeckSize and maxPlayersForMaxCards with jokers', () => {
  it('getDeckSize returns correct sizes', async () => {
    const { getDeckSize } = await import('../constants.js');
    expect(getDeckSize(0)).toBe(52);
    expect(getDeckSize(1)).toBe(53);
    expect(getDeckSize(2)).toBe(54);
  });

  it('maxPlayersForMaxCards accounts for jokers', async () => {
    const { maxPlayersForMaxCards } = await import('../constants.js');
    // Without jokers: 52/5 = 10
    expect(maxPlayersForMaxCards(5, 0)).toBe(10);
    // With 2 jokers: 54/5 = 10 (still 10 since floor)
    expect(maxPlayersForMaxCards(5, 2)).toBe(10);
    // With 2 jokers and 1 card: 54/1 = 54
    expect(maxPlayersForMaxCards(1, 2)).toBe(54);
    // With 1 joker and 1 card: 53/1 = 53
    expect(maxPlayersForMaxCards(1, 1)).toBe(53);
  });
});
