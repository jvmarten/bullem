import { describe, it, expect } from 'vitest';
import { isHigherHand, handToString, getHandTypeName } from './hands.js';
import { HandType, GamePhase, RoundPhase, TurnAction } from './types.js';
import type { HandCall, Rank, Suit, Card, Player, ServerPlayer, ClientGameState, RoomState, TurnEntry, RoundResult } from './types.js';
import { RANK_VALUES, SUIT_ORDER, ALL_RANKS, ALL_SUITS, MIN_PLAYERS, MAX_PLAYERS, MAX_CARDS, STARTING_CARDS, DISCONNECT_TIMEOUT_MS, ROOM_CODE_LENGTH } from './constants.js';

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('STARTING_CARDS is 1', () => {
    expect(STARTING_CARDS).toBe(1);
  });

  it('MAX_CARDS is 5', () => {
    expect(MAX_CARDS).toBe(5);
  });

  it('MIN_PLAYERS is 2', () => {
    expect(MIN_PLAYERS).toBe(2);
  });

  it('MAX_PLAYERS is 12', () => {
    expect(MAX_PLAYERS).toBe(12);
  });

  it('DISCONNECT_TIMEOUT_MS is 30000', () => {
    expect(DISCONNECT_TIMEOUT_MS).toBe(30_000);
  });

  it('ROOM_CODE_LENGTH is 4', () => {
    expect(ROOM_CODE_LENGTH).toBe(4);
  });

  it('ALL_RANKS has 13 ranks from 2 through Ace', () => {
    expect(ALL_RANKS).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
    expect(ALL_RANKS).toHaveLength(13);
  });

  it('ALL_SUITS has 4 suits', () => {
    expect(ALL_SUITS).toEqual(['clubs', 'diamonds', 'hearts', 'spades']);
    expect(ALL_SUITS).toHaveLength(4);
  });

  it('RANK_VALUES maps all 13 ranks with Ace highest', () => {
    expect(Object.keys(RANK_VALUES)).toHaveLength(13);
    expect(RANK_VALUES['2']).toBe(2);
    expect(RANK_VALUES['A']).toBe(14);
    // Values are strictly increasing
    for (let i = 1; i < ALL_RANKS.length; i++) {
      expect(RANK_VALUES[ALL_RANKS[i]]).toBeGreaterThan(RANK_VALUES[ALL_RANKS[i - 1]]);
    }
  });

  it('SUIT_ORDER maps all 4 suits with spades highest', () => {
    expect(Object.keys(SUIT_ORDER)).toHaveLength(4);
    expect(SUIT_ORDER['clubs']).toBeLessThan(SUIT_ORDER['diamonds']);
    expect(SUIT_ORDER['diamonds']).toBeLessThan(SUIT_ORDER['hearts']);
    expect(SUIT_ORDER['hearts']).toBeLessThan(SUIT_ORDER['spades']);
  });
});

// ─── Enums ───────────────────────────────────────────────────────────────────

describe('enums', () => {
  it('HandType has custom ordering: flush < straight', () => {
    expect(HandType.HIGH_CARD).toBe(0);
    expect(HandType.PAIR).toBe(1);
    expect(HandType.TWO_PAIR).toBe(2);
    expect(HandType.THREE_OF_A_KIND).toBe(3);
    expect(HandType.FLUSH).toBe(4);
    expect(HandType.STRAIGHT).toBe(5);
    expect(HandType.FULL_HOUSE).toBe(6);
    expect(HandType.FOUR_OF_A_KIND).toBe(7);
    expect(HandType.STRAIGHT_FLUSH).toBe(8);
    expect(HandType.ROYAL_FLUSH).toBe(9);
  });

  it('GamePhase has lobby, playing, round_result, game_over, finished', () => {
    expect(GamePhase.LOBBY).toBe('lobby');
    expect(GamePhase.PLAYING).toBe('playing');
    expect(GamePhase.ROUND_RESULT).toBe('round_result');
    expect(GamePhase.GAME_OVER).toBe('game_over');
    expect(GamePhase.FINISHED).toBe('finished');
  });

  it('RoundPhase has calling, bull_phase, last_chance, resolving', () => {
    expect(RoundPhase.CALLING).toBe('calling');
    expect(RoundPhase.BULL_PHASE).toBe('bull_phase');
    expect(RoundPhase.LAST_CHANCE).toBe('last_chance');
    expect(RoundPhase.RESOLVING).toBe('resolving');
  });

  it('TurnAction has call, bull, true, last_chance_raise, last_chance_pass', () => {
    expect(TurnAction.CALL).toBe('call');
    expect(TurnAction.BULL).toBe('bull');
    expect(TurnAction.TRUE).toBe('true');
    expect(TurnAction.LAST_CHANCE_RAISE).toBe('last_chance_raise');
    expect(TurnAction.LAST_CHANCE_PASS).toBe('last_chance_pass');
  });
});

// ─── isHigherHand ────────────────────────────────────────────────────────────

describe('isHigherHand', () => {
  describe('different hand types', () => {
    it('pair beats high card', () => {
      const pair: HandCall = { type: HandType.PAIR, rank: '2' };
      const high: HandCall = { type: HandType.HIGH_CARD, rank: 'A' };
      expect(isHigherHand(pair, high)).toBe(true);
      expect(isHigherHand(high, pair)).toBe(false);
    });

    it('flush beats three of a kind (custom ranking)', () => {
      const flush: HandCall = { type: HandType.FLUSH, suit: 'clubs' };
      const three: HandCall = { type: HandType.THREE_OF_A_KIND, rank: 'A' };
      expect(isHigherHand(flush, three)).toBe(true);
      expect(isHigherHand(three, flush)).toBe(false);
    });

    it('straight beats flush (custom ranking)', () => {
      const straight: HandCall = { type: HandType.STRAIGHT, highRank: '6' };
      const flush: HandCall = { type: HandType.FLUSH, suit: 'spades' };
      expect(isHigherHand(straight, flush)).toBe(true);
      expect(isHigherHand(flush, straight)).toBe(false);
    });

    it('royal flush beats straight flush', () => {
      const royal: HandCall = { type: HandType.ROYAL_FLUSH, suit: 'clubs' };
      const sf: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' };
      expect(isHigherHand(royal, sf)).toBe(true);
      expect(isHigherHand(sf, royal)).toBe(false);
    });

    it('full ranking order is respected (each type beats the previous)', () => {
      const hands: HandCall[] = [
        { type: HandType.HIGH_CARD, rank: 'A' },
        { type: HandType.PAIR, rank: '2' },
        { type: HandType.TWO_PAIR, highRank: '3', lowRank: '2' },
        { type: HandType.THREE_OF_A_KIND, rank: '2' },
        { type: HandType.FLUSH, suit: 'clubs' },
        { type: HandType.STRAIGHT, highRank: '6' },
        { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' },
        { type: HandType.FOUR_OF_A_KIND, rank: '2' },
        { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '6' },
        { type: HandType.ROYAL_FLUSH, suit: 'clubs' },
      ];
      for (let i = 0; i < hands.length - 1; i++) {
        expect(isHigherHand(hands[i + 1], hands[i])).toBe(true);
        expect(isHigherHand(hands[i], hands[i + 1])).toBe(false);
      }
    });

    it('no hand type beats itself across different category', () => {
      // same type, same values should not be higher
      const hand: HandCall = { type: HandType.PAIR, rank: '7' };
      expect(isHigherHand(hand, hand)).toBe(false);
    });
  });

  describe('same hand type comparisons', () => {
    it('high card: higher rank wins', () => {
      const aceHigh: HandCall = { type: HandType.HIGH_CARD, rank: 'A' };
      const kingHigh: HandCall = { type: HandType.HIGH_CARD, rank: 'K' };
      expect(isHigherHand(aceHigh, kingHigh)).toBe(true);
      expect(isHigherHand(kingHigh, aceHigh)).toBe(false);
    });

    it('high card: same rank is not higher', () => {
      const a: HandCall = { type: HandType.HIGH_CARD, rank: '7' };
      const b: HandCall = { type: HandType.HIGH_CARD, rank: '7' };
      expect(isHigherHand(a, b)).toBe(false);
    });

    it('pair: higher rank wins', () => {
      expect(isHigherHand(
        { type: HandType.PAIR, rank: 'Q' },
        { type: HandType.PAIR, rank: 'J' },
      )).toBe(true);
      expect(isHigherHand(
        { type: HandType.PAIR, rank: 'J' },
        { type: HandType.PAIR, rank: 'Q' },
      )).toBe(false);
    });

    it('pair: same rank is not higher', () => {
      expect(isHigherHand(
        { type: HandType.PAIR, rank: '5' },
        { type: HandType.PAIR, rank: '5' },
      )).toBe(false);
    });

    it('two pair: higher high pair wins', () => {
      expect(isHigherHand(
        { type: HandType.TWO_PAIR, highRank: 'K', lowRank: '3' },
        { type: HandType.TWO_PAIR, highRank: 'Q', lowRank: 'J' },
      )).toBe(true);
    });

    it('two pair: same high pair, higher low pair wins', () => {
      expect(isHigherHand(
        { type: HandType.TWO_PAIR, highRank: 'K', lowRank: '5' },
        { type: HandType.TWO_PAIR, highRank: 'K', lowRank: '3' },
      )).toBe(true);
    });

    it('two pair: identical is not higher', () => {
      expect(isHigherHand(
        { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' },
        { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' },
      )).toBe(false);
    });

    it('three of a kind: higher rank wins', () => {
      expect(isHigherHand(
        { type: HandType.THREE_OF_A_KIND, rank: 'A' },
        { type: HandType.THREE_OF_A_KIND, rank: 'K' },
      )).toBe(true);
      expect(isHigherHand(
        { type: HandType.THREE_OF_A_KIND, rank: 'K' },
        { type: HandType.THREE_OF_A_KIND, rank: 'A' },
      )).toBe(false);
    });

    it('three of a kind: same rank is not higher', () => {
      expect(isHigherHand(
        { type: HandType.THREE_OF_A_KIND, rank: '9' },
        { type: HandType.THREE_OF_A_KIND, rank: '9' },
      )).toBe(false);
    });

    it('flush: higher suit wins', () => {
      expect(isHigherHand(
        { type: HandType.FLUSH, suit: 'spades' },
        { type: HandType.FLUSH, suit: 'hearts' },
      )).toBe(true);
      expect(isHigherHand(
        { type: HandType.FLUSH, suit: 'diamonds' },
        { type: HandType.FLUSH, suit: 'clubs' },
      )).toBe(true);
    });

    it('flush: same suit is not higher', () => {
      expect(isHigherHand(
        { type: HandType.FLUSH, suit: 'hearts' },
        { type: HandType.FLUSH, suit: 'hearts' },
      )).toBe(false);
    });

    it('flush: lower suit is not higher', () => {
      expect(isHigherHand(
        { type: HandType.FLUSH, suit: 'clubs' },
        { type: HandType.FLUSH, suit: 'spades' },
      )).toBe(false);
    });

    it('straight: higher top card wins', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT, highRank: '9' },
        { type: HandType.STRAIGHT, highRank: '8' },
      )).toBe(true);
    });

    it('straight: same top card is not higher', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT, highRank: 'A' },
        { type: HandType.STRAIGHT, highRank: 'A' },
      )).toBe(false);
    });

    it('straight: ace-high beats king-high', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT, highRank: 'A' },
        { type: HandType.STRAIGHT, highRank: 'K' },
      )).toBe(true);
    });

    it('full house: higher three-rank wins', () => {
      expect(isHigherHand(
        { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: '2' },
        { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'Q' },
      )).toBe(true);
    });

    it('full house: same three-rank, higher two-rank wins', () => {
      expect(isHigherHand(
        { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'Q' },
        { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'J' },
      )).toBe(true);
    });

    it('full house: identical is not higher', () => {
      expect(isHigherHand(
        { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'Q' },
        { type: HandType.FULL_HOUSE, threeRank: 'K', twoRank: 'Q' },
      )).toBe(false);
    });

    it('four of a kind: higher rank wins', () => {
      expect(isHigherHand(
        { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
        { type: HandType.FOUR_OF_A_KIND, rank: '2' },
      )).toBe(true);
      expect(isHigherHand(
        { type: HandType.FOUR_OF_A_KIND, rank: '2' },
        { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
      )).toBe(false);
    });

    it('four of a kind: same rank is not higher', () => {
      expect(isHigherHand(
        { type: HandType.FOUR_OF_A_KIND, rank: 'J' },
        { type: HandType.FOUR_OF_A_KIND, rank: 'J' },
      )).toBe(false);
    });

    it('straight flush: higher suit wins regardless of rank', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '6' },
        { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9' },
      )).toBe(true);
    });

    it('straight flush: same suit, higher rank wins', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9' },
        { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '8' },
      )).toBe(true);
    });

    it('straight flush: identical is not higher', () => {
      expect(isHigherHand(
        { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9' },
        { type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '9' },
      )).toBe(false);
    });

    it('royal flush: higher suit wins', () => {
      expect(isHigherHand(
        { type: HandType.ROYAL_FLUSH, suit: 'spades' },
        { type: HandType.ROYAL_FLUSH, suit: 'diamonds' },
      )).toBe(true);
    });

    it('royal flush: same suit is not higher', () => {
      expect(isHigherHand(
        { type: HandType.ROYAL_FLUSH, suit: 'spades' },
        { type: HandType.ROYAL_FLUSH, suit: 'spades' },
      )).toBe(false);
    });

    it('royal flush: full suit ordering (clubs < diamonds < hearts < spades)', () => {
      const suits: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
      for (let i = 0; i < suits.length - 1; i++) {
        expect(isHigherHand(
          { type: HandType.ROYAL_FLUSH, suit: suits[i + 1] },
          { type: HandType.ROYAL_FLUSH, suit: suits[i] },
        )).toBe(true);
        expect(isHigherHand(
          { type: HandType.ROYAL_FLUSH, suit: suits[i] },
          { type: HandType.ROYAL_FLUSH, suit: suits[i + 1] },
        )).toBe(false);
      }
    });
  });
});

// ─── handToString ────────────────────────────────────────────────────────────

describe('handToString', () => {
  it('formats high card', () => {
    expect(handToString({ type: HandType.HIGH_CARD, rank: 'K' })).toBe('King High');
  });

  it('formats high card with numeric rank', () => {
    expect(handToString({ type: HandType.HIGH_CARD, rank: '7' })).toBe('7 High');
  });

  it('formats high card with ace', () => {
    expect(handToString({ type: HandType.HIGH_CARD, rank: 'A' })).toBe('Ace High');
  });

  it('formats pair', () => {
    expect(handToString({ type: HandType.PAIR, rank: '7' })).toBe('Pair of 7s');
  });

  it('formats pair of face cards', () => {
    expect(handToString({ type: HandType.PAIR, rank: 'A' })).toBe('Pair of Aces');
  });

  it('formats two pair', () => {
    expect(handToString({ type: HandType.TWO_PAIR, highRank: 'J', lowRank: '4' }))
      .toBe('Two Pair, Jacks and 4s');
  });

  it('formats three of a kind', () => {
    expect(handToString({ type: HandType.THREE_OF_A_KIND, rank: '9' })).toBe('Three 9s');
  });

  it('formats three of a kind with face cards', () => {
    expect(handToString({ type: HandType.THREE_OF_A_KIND, rank: 'K' })).toBe('Three Kings');
  });

  it('formats flush', () => {
    expect(handToString({ type: HandType.FLUSH, suit: 'hearts' })).toBe('Flush in hearts');
  });

  it('formats flush with all suits', () => {
    expect(handToString({ type: HandType.FLUSH, suit: 'clubs' })).toBe('Flush in clubs');
    expect(handToString({ type: HandType.FLUSH, suit: 'diamonds' })).toBe('Flush in diamonds');
    expect(handToString({ type: HandType.FLUSH, suit: 'spades' })).toBe('Flush in spades');
  });

  it('formats straight', () => {
    expect(handToString({ type: HandType.STRAIGHT, highRank: '9' })).toBe('Straight, 5 to 9');
  });

  it('formats lowest possible straight (6 high = 2-6)', () => {
    expect(handToString({ type: HandType.STRAIGHT, highRank: '6' })).toBe('Straight, 2 to 6');
  });

  it('formats ace-high straight (10-A)', () => {
    expect(handToString({ type: HandType.STRAIGHT, highRank: 'A' })).toBe('Straight, 10 to Ace');
  });

  it('formats ace-low straight (A-2-3-4-5)', () => {
    expect(handToString({ type: HandType.STRAIGHT, highRank: '5' })).toBe('Straight, Ace to 5');
  });

  it('formats ace-low straight flush (A-2-3-4-5)', () => {
    expect(handToString({ type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '5' }))
      .toBe('Straight Flush in hearts, Ace to 5');
  });

  it('formats full house', () => {
    expect(handToString({ type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '3' }))
      .toBe('Full House, Queens over 3s');
  });

  it('formats four of a kind', () => {
    expect(handToString({ type: HandType.FOUR_OF_A_KIND, rank: '2' })).toBe('Four 2s');
  });

  it('formats four of a kind with face cards', () => {
    expect(handToString({ type: HandType.FOUR_OF_A_KIND, rank: 'A' })).toBe('Four Aces');
  });

  it('formats straight flush', () => {
    expect(handToString({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' }))
      .toBe('Straight Flush in spades, 5 to 9');
  });

  it('formats lowest straight flush (6 high)', () => {
    expect(handToString({ type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '6' }))
      .toBe('Straight Flush in clubs, 2 to 6');
  });

  it('formats royal flush', () => {
    expect(handToString({ type: HandType.ROYAL_FLUSH, suit: 'diamonds' }))
      .toBe('Royal Flush in diamonds');
  });
});

// ─── getHandTypeName ─────────────────────────────────────────────────────────

describe('getHandTypeName', () => {
  it('returns correct names for all hand types', () => {
    expect(getHandTypeName(HandType.HIGH_CARD)).toBe('High Card');
    expect(getHandTypeName(HandType.PAIR)).toBe('Pair');
    expect(getHandTypeName(HandType.TWO_PAIR)).toBe('Two Pair');
    expect(getHandTypeName(HandType.THREE_OF_A_KIND)).toBe('Three of a Kind');
    expect(getHandTypeName(HandType.FLUSH)).toBe('Flush');
    expect(getHandTypeName(HandType.STRAIGHT)).toBe('Straight');
    expect(getHandTypeName(HandType.FULL_HOUSE)).toBe('Full House');
    expect(getHandTypeName(HandType.FOUR_OF_A_KIND)).toBe('Four of a Kind');
    expect(getHandTypeName(HandType.STRAIGHT_FLUSH)).toBe('Straight Flush');
    expect(getHandTypeName(HandType.ROYAL_FLUSH)).toBe('Royal Flush');
  });
});
