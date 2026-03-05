import { describe, it, expect } from 'vitest';
import { HandChecker } from './HandChecker.js';
import { GameEngine } from './GameEngine.js';
import { HandType, RoundPhase } from '../types.js';
import type { Card, HandCall, OwnedCard, Rank, Suit, ServerPlayer } from '../types.js';
import { ALL_RANKS, ALL_SUITS, STARTING_CARDS, MAX_CARDS } from '../constants.js';
import { isHigherHand } from '../hands.js';

function card(rank: Rank, suit: Suit): Card {
  return { rank, suit };
}

function makePlayer(id: string, name: string, cardCount = STARTING_CARDS): ServerPlayer {
  return {
    id,
    name,
    cardCount,
    isConnected: true,
    isEliminated: false,
    isHost: false,
    cards: [],
  };
}

// ─── HandChecker.exists: every hand type with full 52-card deck ──────────────

describe('HandChecker.exists with full 52-card deck', () => {
  const fullDeck: Card[] = [];
  for (const suit of ALL_SUITS) {
    for (const rank of ALL_RANKS) {
      fullDeck.push(card(rank, suit));
    }
  }

  it('finds every rank as high card in full deck', () => {
    for (const rank of ALL_RANKS) {
      expect(HandChecker.exists(fullDeck, { type: HandType.HIGH_CARD, rank })).toBe(true);
    }
  });

  it('finds every rank as pair in full deck (4 suits = always at least 2)', () => {
    for (const rank of ALL_RANKS) {
      expect(HandChecker.exists(fullDeck, { type: HandType.PAIR, rank })).toBe(true);
    }
  });

  it('finds every rank as three of a kind in full deck', () => {
    for (const rank of ALL_RANKS) {
      expect(HandChecker.exists(fullDeck, { type: HandType.THREE_OF_A_KIND, rank })).toBe(true);
    }
  });

  it('finds every rank as four of a kind in full deck', () => {
    for (const rank of ALL_RANKS) {
      expect(HandChecker.exists(fullDeck, { type: HandType.FOUR_OF_A_KIND, rank })).toBe(true);
    }
  });

  it('finds flush in every suit in full deck (13 cards per suit >= 5)', () => {
    for (const suit of ALL_SUITS) {
      expect(HandChecker.exists(fullDeck, { type: HandType.FLUSH, suit })).toBe(true);
    }
  });

  it('finds royal flush in every suit in full deck', () => {
    for (const suit of ALL_SUITS) {
      expect(HandChecker.exists(fullDeck, { type: HandType.ROYAL_FLUSH, suit })).toBe(true);
    }
  });

  it('finds every valid straight in full deck', () => {
    const validHighRanks: Rank[] = ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
    for (const highRank of validHighRanks) {
      expect(HandChecker.exists(fullDeck, { type: HandType.STRAIGHT, highRank })).toBe(true);
    }
  });

  it('finds every valid straight flush in full deck', () => {
    const validHighRanks: Rank[] = ['5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    for (const suit of ALL_SUITS) {
      for (const highRank of validHighRanks) {
        expect(HandChecker.exists(fullDeck, {
          type: HandType.STRAIGHT_FLUSH, suit, highRank,
        })).toBe(true);
      }
    }
  });
});

// ─── HandChecker.exists: minimum card pool size for each hand type ───────────

describe('HandChecker.exists: minimum card requirements', () => {
  it('high card needs exactly 1 card', () => {
    expect(HandChecker.exists([card('A', 'spades')], { type: HandType.HIGH_CARD, rank: 'A' })).toBe(true);
    expect(HandChecker.exists([], { type: HandType.HIGH_CARD, rank: 'A' })).toBe(false);
  });

  it('pair needs exactly 2 cards of same rank', () => {
    expect(HandChecker.exists(
      [card('7', 'spades'), card('7', 'hearts')],
      { type: HandType.PAIR, rank: '7' }
    )).toBe(true);
    expect(HandChecker.exists(
      [card('7', 'spades')],
      { type: HandType.PAIR, rank: '7' }
    )).toBe(false);
  });

  it('three of a kind needs exactly 3 cards of same rank', () => {
    expect(HandChecker.exists(
      [card('9', 'spades'), card('9', 'hearts'), card('9', 'diamonds')],
      { type: HandType.THREE_OF_A_KIND, rank: '9' }
    )).toBe(true);
    expect(HandChecker.exists(
      [card('9', 'spades'), card('9', 'hearts')],
      { type: HandType.THREE_OF_A_KIND, rank: '9' }
    )).toBe(false);
  });

  it('four of a kind needs exactly 4 cards of same rank', () => {
    expect(HandChecker.exists(
      [card('J', 'spades'), card('J', 'hearts'), card('J', 'diamonds'), card('J', 'clubs')],
      { type: HandType.FOUR_OF_A_KIND, rank: 'J' }
    )).toBe(true);
    expect(HandChecker.exists(
      [card('J', 'spades'), card('J', 'hearts'), card('J', 'diamonds')],
      { type: HandType.FOUR_OF_A_KIND, rank: 'J' }
    )).toBe(false);
  });

  it('flush needs exactly 5 cards of same suit', () => {
    const fiveHearts = [
      card('2', 'hearts'), card('4', 'hearts'), card('6', 'hearts'),
      card('8', 'hearts'), card('10', 'hearts'),
    ];
    expect(HandChecker.exists(fiveHearts, { type: HandType.FLUSH, suit: 'hearts' })).toBe(true);

    const fourHearts = fiveHearts.slice(0, 4);
    expect(HandChecker.exists(fourHearts, { type: HandType.FLUSH, suit: 'hearts' })).toBe(false);
  });

  it('straight needs 5 sequential ranks (any suits)', () => {
    const straightCards = [
      card('5', 'clubs'), card('6', 'hearts'), card('7', 'diamonds'),
      card('8', 'spades'), card('9', 'clubs'),
    ];
    expect(HandChecker.exists(straightCards, { type: HandType.STRAIGHT, highRank: '9' })).toBe(true);

    // Missing one rank
    const incomplete = straightCards.slice(0, 4);
    expect(HandChecker.exists(incomplete, { type: HandType.STRAIGHT, highRank: '9' })).toBe(false);
  });
});

// ─── Integration: HandChecker + GameEngine resolution correctness ────────────

describe('HandChecker + GameEngine: resolution correctness for each hand type', () => {
  function resolveWithHand(
    cards: { p1: Card[]; p2: Card[]; p3: Card[] },
    hand: HandCall,
  ): { handExists: boolean; penalizedIds: string[] } {
    const p1 = makePlayer('p1', 'Alice', cards.p1.length);
    const p2 = makePlayer('p2', 'Bob', cards.p2.length);
    const p3 = makePlayer('p3', 'Charlie', cards.p3.length);
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = cards.p1;
    p2.cards = cards.p2;
    p3.cards = cards.p3;

    engine.handleCall('p1', hand);
    engine.handleBull('p2');
    const result = engine.handleTrue('p3');

    if (result.type === 'resolve') {
      return { handExists: result.result.handExists, penalizedIds: result.result.penalizedPlayerIds };
    }
    if (result.type === 'game_over' && result.finalRoundResult) {
      return { handExists: result.finalRoundResult.handExists, penalizedIds: result.finalRoundResult.penalizedPlayerIds };
    }
    return { handExists: false, penalizedIds: [] };
  }

  it('HIGH_CARD: resolves correctly when hand exists', () => {
    const result = resolveWithHand(
      {
        p1: [{ rank: 'A', suit: 'spades' }],
        p2: [{ rank: '2', suit: 'hearts' }],
        p3: [{ rank: '3', suit: 'clubs' }],
      },
      { type: HandType.HIGH_CARD, rank: 'A' },
    );
    expect(result.handExists).toBe(true);
    expect(result.penalizedIds).toContain('p2'); // bull was wrong
    expect(result.penalizedIds).not.toContain('p1'); // caller correct
    expect(result.penalizedIds).not.toContain('p3'); // true was correct
  });

  it('PAIR: resolves correctly when pair spans two players', () => {
    const result = resolveWithHand(
      {
        p1: [{ rank: '7', suit: 'spades' }],
        p2: [{ rank: '7', suit: 'hearts' }],
        p3: [{ rank: '3', suit: 'clubs' }],
      },
      { type: HandType.PAIR, rank: '7' },
    );
    expect(result.handExists).toBe(true);
    expect(result.penalizedIds).toContain('p2'); // bull was wrong
  });

  it('TWO_PAIR: resolves correctly when two pairs span players', () => {
    const result = resolveWithHand(
      {
        p1: [{ rank: 'K', suit: 'spades' }, { rank: '5', suit: 'clubs' }],
        p2: [{ rank: 'K', suit: 'hearts' }, { rank: '5', suit: 'diamonds' }],
        p3: [{ rank: '2', suit: 'clubs' }],
      },
      { type: HandType.TWO_PAIR, highRank: 'K', lowRank: '5' },
    );
    expect(result.handExists).toBe(true);
  });

  it('FLUSH: resolves correctly when flush exists across players', () => {
    const result = resolveWithHand(
      {
        p1: [{ rank: '2', suit: 'hearts' }, { rank: '5', suit: 'hearts' }],
        p2: [{ rank: '8', suit: 'hearts' }, { rank: 'J', suit: 'hearts' }],
        p3: [{ rank: 'A', suit: 'hearts' }],
      },
      { type: HandType.FLUSH, suit: 'hearts' },
    );
    expect(result.handExists).toBe(true);
  });

  it('THREE_OF_A_KIND: resolves correctly when three span players', () => {
    const result = resolveWithHand(
      {
        p1: [{ rank: '9', suit: 'spades' }],
        p2: [{ rank: '9', suit: 'hearts' }],
        p3: [{ rank: '9', suit: 'diamonds' }],
      },
      { type: HandType.THREE_OF_A_KIND, rank: '9' },
    );
    expect(result.handExists).toBe(true);
  });

  it('STRAIGHT: resolves correctly when straight spans 5 players worth of cards', () => {
    const result = resolveWithHand(
      {
        p1: [{ rank: '5', suit: 'clubs' }, { rank: '6', suit: 'hearts' }],
        p2: [{ rank: '7', suit: 'diamonds' }, { rank: '8', suit: 'spades' }],
        p3: [{ rank: '9', suit: 'clubs' }],
      },
      { type: HandType.STRAIGHT, highRank: '9' },
    );
    expect(result.handExists).toBe(true);
  });

  it('FULL_HOUSE: resolves correctly when distributed across players', () => {
    const result = resolveWithHand(
      {
        p1: [{ rank: 'K', suit: 'spades' }, { rank: 'K', suit: 'hearts' }],
        p2: [{ rank: 'K', suit: 'diamonds' }, { rank: '5', suit: 'clubs' }],
        p3: [{ rank: '5', suit: 'spades' }],
      },
      { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: '5' },
    );
    expect(result.handExists).toBe(true);
  });

  it('ROYAL_FLUSH: resolves correctly when hand does NOT exist', () => {
    const result = resolveWithHand(
      {
        p1: [{ rank: '2', suit: 'clubs' }],
        p2: [{ rank: '3', suit: 'hearts' }],
        p3: [{ rank: '4', suit: 'diamonds' }],
      },
      { type: HandType.ROYAL_FLUSH, suit: 'spades' },
    );
    expect(result.handExists).toBe(false);
    expect(result.penalizedIds).toContain('p1'); // caller wrong
    expect(result.penalizedIds).toContain('p3'); // true wrong
    expect(result.penalizedIds).not.toContain('p2'); // bull correct
  });
});

// ─── isHigherHand: transitivity property ─────────────────────────────────────

describe('isHigherHand: transitivity across hand types', () => {
  it('if A > B and B > C then A > C (transitive across different types)', () => {
    const highCard: HandCall = { type: HandType.HIGH_CARD, rank: 'A' };
    const pair: HandCall = { type: HandType.PAIR, rank: '2' };
    const threek: HandCall = { type: HandType.THREE_OF_A_KIND, rank: '2' };

    // pair > highCard
    expect(isHigherHand(pair, highCard)).toBe(true);
    // threek > pair (flush is between, but threek > pair directly since type 4 > type 1)
    expect(isHigherHand(threek, pair)).toBe(true);
    // transitivity: threek > highCard
    expect(isHigherHand(threek, highCard)).toBe(true);
  });

  it('if A > B and B > C within same type (pair ranks)', () => {
    const pair2: HandCall = { type: HandType.PAIR, rank: '2' };
    const pair7: HandCall = { type: HandType.PAIR, rank: '7' };
    const pairA: HandCall = { type: HandType.PAIR, rank: 'A' };

    expect(isHigherHand(pair7, pair2)).toBe(true);
    expect(isHigherHand(pairA, pair7)).toBe(true);
    expect(isHigherHand(pairA, pair2)).toBe(true);
  });

  it('isHigherHand is irreflexive (A is never > A)', () => {
    const hands: HandCall[] = [
      { type: HandType.HIGH_CARD, rank: '7' },
      { type: HandType.PAIR, rank: 'A' },
      { type: HandType.TWO_PAIR, highRank: 'K', lowRank: '3' },
      { type: HandType.FLUSH, suit: 'hearts' },
      { type: HandType.THREE_OF_A_KIND, rank: '9' },
      { type: HandType.STRAIGHT, highRank: '10' },
      { type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '5' },
      { type: HandType.FOUR_OF_A_KIND, rank: 'J' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' },
      { type: HandType.ROYAL_FLUSH, suit: 'diamonds' },
    ];

    for (const hand of hands) {
      expect(isHigherHand(hand, hand)).toBe(false);
    }
  });

  it('isHigherHand is asymmetric (if A > B then B is not > A)', () => {
    const testPairs: [HandCall, HandCall][] = [
      [{ type: HandType.PAIR, rank: 'A' }, { type: HandType.HIGH_CARD, rank: 'A' }],
      [{ type: HandType.THREE_OF_A_KIND, rank: '2' }, { type: HandType.FLUSH, suit: 'spades' }],
      [{ type: HandType.STRAIGHT, highRank: '5' }, { type: HandType.THREE_OF_A_KIND, rank: 'A' }],
      [{ type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' }, { type: HandType.STRAIGHT, highRank: 'A' }],
      [{ type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' }, { type: HandType.FOUR_OF_A_KIND, rank: 'A' }],
    ];

    for (const [higher, lower] of testPairs) {
      expect(isHigherHand(higher, lower)).toBe(true);
      expect(isHigherHand(lower, higher)).toBe(false);
    }
  });
});

// ─── Straight flush: suit tiebreaker correctness ─────────────────────────────

describe('isHigherHand: straight flush suit tiebreaker', () => {
  it('same rank: spades > hearts > diamonds > clubs', () => {
    const clubs: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '9' };
    const diamonds: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'diamonds', highRank: '9' };
    const hearts: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9' };
    const spades: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' };

    expect(isHigherHand(diamonds, clubs)).toBe(true);
    expect(isHigherHand(hearts, diamonds)).toBe(true);
    expect(isHigherHand(spades, hearts)).toBe(true);

    // Reverse
    expect(isHigherHand(clubs, diamonds)).toBe(false);
    expect(isHigherHand(diamonds, hearts)).toBe(false);
    expect(isHigherHand(hearts, spades)).toBe(false);
  });

  it('higher rank always beats lower rank regardless of suit', () => {
    // 10-high in clubs beats 9-high in spades (rank > suit for comparison)
    expect(isHigherHand(
      { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '10' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' },
    )).toBe(true);

    // 5-high (ace-low) in spades does NOT beat K-high in clubs
    expect(isHigherHand(
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '5' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: 'K' },
    )).toBe(false);
  });
});

// ─── Custom ranking order enforcement ────────────────────────────────────────

describe('Custom hand ranking: flush < three of a kind < straight', () => {
  it('three of a kind (2s) beats any flush', () => {
    for (const suit of ALL_SUITS) {
      expect(isHigherHand(
        { type: HandType.THREE_OF_A_KIND, rank: '2' },
        { type: HandType.FLUSH, suit },
      )).toBe(true);
    }
  });

  it('straight (5-high, lowest) beats three of a kind (Aces, highest)', () => {
    expect(isHigherHand(
      { type: HandType.STRAIGHT, highRank: '5' },
      { type: HandType.THREE_OF_A_KIND, rank: 'A' },
    )).toBe(true);
  });

  it('flush does NOT beat pair (even flush is lower in custom ranking, flush > pair)', () => {
    // In the custom ranking: HIGH_CARD(0) < PAIR(1) < TWO_PAIR(2) < FLUSH(3)
    // So flush DOES beat pair
    expect(isHigherHand(
      { type: HandType.FLUSH, suit: 'clubs' },
      { type: HandType.PAIR, rank: 'A' },
    )).toBe(true);
  });

  it('two pair (Aces & Kings) does NOT beat flush (any suit)', () => {
    // TWO_PAIR(2) < FLUSH(3) in custom ranking
    expect(isHigherHand(
      { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' },
      { type: HandType.FLUSH, suit: 'clubs' },
    )).toBe(false);
  });
});
