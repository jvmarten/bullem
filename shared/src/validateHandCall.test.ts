import { describe, it, expect } from 'vitest';
import { validateHandCall, getMinimumRaise, isHigherHand } from './hands.js';
import { HandType } from './types.js';
import type { HandCall, Rank } from './types.js';

// ─── validateHandCall ────────────────────────────────────────────────────────

describe('validateHandCall', () => {
  describe('rejects malformed input', () => {
    it('rejects null', () => {
      expect(validateHandCall(null)).toBe('Hand must be an object');
    });

    it('rejects undefined', () => {
      expect(validateHandCall(undefined)).toBe('Hand must be an object');
    });

    it('rejects a string', () => {
      expect(validateHandCall('pair of 7s')).toBe('Hand must be an object');
    });

    it('rejects a number', () => {
      expect(validateHandCall(42)).toBe('Hand must be an object');
    });

    it('rejects empty object (missing type)', () => {
      expect(validateHandCall({})).toBe('Invalid hand type');
    });

    it('rejects non-integer type', () => {
      expect(validateHandCall({ type: 1.5 })).toBe('Invalid hand type');
    });

    it('rejects negative type', () => {
      expect(validateHandCall({ type: -1 })).toBe('Invalid hand type');
    });

    it('rejects type > 9', () => {
      expect(validateHandCall({ type: 10 })).toBe('Invalid hand type');
    });

    it('rejects string type', () => {
      expect(validateHandCall({ type: 'pair' })).toBe('Invalid hand type');
    });
  });

  describe('HIGH_CARD validation', () => {
    it('accepts valid high card', () => {
      expect(validateHandCall({ type: HandType.HIGH_CARD, rank: 'A' })).toBeNull();
    });

    it('rejects missing rank', () => {
      expect(validateHandCall({ type: HandType.HIGH_CARD })).toBe('Invalid rank');
    });

    it('rejects invalid rank string', () => {
      expect(validateHandCall({ type: HandType.HIGH_CARD, rank: '1' })).toBe('Invalid rank');
    });

    it('rejects numeric rank', () => {
      expect(validateHandCall({ type: HandType.HIGH_CARD, rank: 7 })).toBe('Invalid rank');
    });
  });

  describe('PAIR validation', () => {
    it('accepts valid pair', () => {
      expect(validateHandCall({ type: HandType.PAIR, rank: '7' })).toBeNull();
    });

    it('rejects missing rank', () => {
      expect(validateHandCall({ type: HandType.PAIR })).toBe('Invalid rank');
    });
  });

  describe('TWO_PAIR validation', () => {
    it('accepts valid two pair', () => {
      expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: 'K', lowRank: '3' })).toBeNull();
    });

    it('rejects same ranks', () => {
      expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: 'K', lowRank: 'K' })).toBe('Two pair ranks must differ');
    });

    it('rejects highRank <= lowRank', () => {
      expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: '3', lowRank: 'K' })).toBe('highRank must be higher than lowRank');
    });

    it('rejects equal but different looking ranks (e.g., highRank == lowRank in value)', () => {
      // highRank: '5', lowRank: '5' — caught by "must differ"
      expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: '5', lowRank: '5' })).toBe('Two pair ranks must differ');
    });

    it('rejects missing highRank', () => {
      expect(validateHandCall({ type: HandType.TWO_PAIR, lowRank: '3' })).toBe('Invalid ranks');
    });

    it('rejects missing lowRank', () => {
      expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: 'K' })).toBe('Invalid ranks');
    });
  });

  describe('THREE_OF_A_KIND validation', () => {
    it('accepts valid three of a kind', () => {
      expect(validateHandCall({ type: HandType.THREE_OF_A_KIND, rank: '9' })).toBeNull();
    });
  });

  describe('FOUR_OF_A_KIND validation', () => {
    it('accepts valid four of a kind', () => {
      expect(validateHandCall({ type: HandType.FOUR_OF_A_KIND, rank: 'A' })).toBeNull();
    });
  });

  describe('FLUSH validation', () => {
    it('accepts valid flush', () => {
      expect(validateHandCall({ type: HandType.FLUSH, suit: 'hearts' })).toBeNull();
    });

    it('rejects invalid suit', () => {
      expect(validateHandCall({ type: HandType.FLUSH, suit: 'heart' })).toBe('Invalid suit');
    });

    it('rejects missing suit', () => {
      expect(validateHandCall({ type: HandType.FLUSH })).toBe('Invalid suit');
    });
  });

  describe('STRAIGHT validation', () => {
    it('accepts valid straight (5 high = ace-low)', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '5' })).toBeNull();
    });

    it('accepts valid straight (A high)', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT, highRank: 'A' })).toBeNull();
    });

    it('rejects highRank below 5 (impossible straight)', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '4' })).toBe('Straight highRank must be 5 or above');
    });

    it('rejects highRank of 3', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '3' })).toBe('Straight highRank must be 5 or above');
    });

    it('rejects highRank of 2', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '2' })).toBe('Straight highRank must be 5 or above');
    });

    it('accepts 6 high straight', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '6' })).toBeNull();
    });
  });

  describe('FULL_HOUSE validation', () => {
    it('accepts valid full house', () => {
      expect(validateHandCall({ type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: '3' })).toBeNull();
    });

    it('rejects same ranks', () => {
      expect(validateHandCall({ type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: 'Q' })).toBe('Full house ranks must differ');
    });

    it('allows twoRank > threeRank (valid: threes over aces is legal)', () => {
      expect(validateHandCall({ type: HandType.FULL_HOUSE, threeRank: '3', twoRank: 'A' })).toBeNull();
    });
  });

  describe('STRAIGHT_FLUSH validation', () => {
    it('accepts valid straight flush', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' })).toBeNull();
    });

    it('rejects invalid suit', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'invalid', highRank: '9' })).toBe('Invalid suit');
    });

    it('rejects highRank below 5', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '4' })).toBe('Straight flush highRank must be 5 or above');
    });

    it('accepts ace-low straight flush (5 high)', () => {
      expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '5' })).toBeNull();
    });
  });

  describe('ROYAL_FLUSH validation', () => {
    it('accepts valid royal flush', () => {
      expect(validateHandCall({ type: HandType.ROYAL_FLUSH, suit: 'diamonds' })).toBeNull();
    });

    it('rejects invalid suit', () => {
      expect(validateHandCall({ type: HandType.ROYAL_FLUSH, suit: 'diamond' })).toBe('Invalid suit');
    });

    it('accepts all four suits', () => {
      for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) {
        expect(validateHandCall({ type: HandType.ROYAL_FLUSH, suit })).toBeNull();
      }
    });
  });

  describe('prototype pollution / injection resistance', () => {
    it('rejects __proto__ as type', () => {
      expect(validateHandCall({ type: '__proto__' })).toBe('Invalid hand type');
    });

    it('rejects NaN type', () => {
      expect(validateHandCall({ type: NaN })).toBe('Invalid hand type');
    });

    it('rejects Infinity type', () => {
      expect(validateHandCall({ type: Infinity })).toBe('Invalid hand type');
    });
  });
});

// ─── getMinimumRaise ────────────────────────────────────────────────────────

describe('getMinimumRaise', () => {
  it('raises high card 2 to high card 3', () => {
    const result = getMinimumRaise({ type: HandType.HIGH_CARD, rank: '2' });
    expect(result).toEqual({ type: HandType.HIGH_CARD, rank: '3' });
  });

  it('raises high card Ace to pair of 2s', () => {
    const result = getMinimumRaise({ type: HandType.HIGH_CARD, rank: 'A' });
    expect(result).toEqual({ type: HandType.PAIR, rank: '2' });
  });

  it('raises pair of Aces to lowest two pair', () => {
    const result = getMinimumRaise({ type: HandType.PAIR, rank: 'A' });
    expect(result).toEqual({ type: HandType.TWO_PAIR, highRank: '3', lowRank: '2' });
  });

  it('raises two pair Aces & Kings to flush (top of two pair)', () => {
    const result = getMinimumRaise({ type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' });
    expect(result).toEqual({ type: HandType.FLUSH, suit: 'clubs' });
  });

  it('raises two pair with room in lowRank', () => {
    const result = getMinimumRaise({ type: HandType.TWO_PAIR, highRank: 'K', lowRank: '3' });
    expect(result).toEqual({ type: HandType.TWO_PAIR, highRank: 'K', lowRank: '4' });
  });

  it('raises flush to three of a kind 2s (all flushes equal)', () => {
    const result = getMinimumRaise({ type: HandType.FLUSH, suit: 'spades' });
    expect(result).toEqual({ type: HandType.THREE_OF_A_KIND, rank: '2' });
  });

  it('raises three of a kind Aces to lowest straight', () => {
    const result = getMinimumRaise({ type: HandType.THREE_OF_A_KIND, rank: 'A' });
    expect(result).toEqual({ type: HandType.STRAIGHT, highRank: '5' });
  });

  it('raises straight Ace-high to lowest full house', () => {
    const result = getMinimumRaise({ type: HandType.STRAIGHT, highRank: 'A' });
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' });
  });

  it('raises full house Aces over Kings to four of a kind 2s', () => {
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: 'K' });
    expect(result).toEqual({ type: HandType.FOUR_OF_A_KIND, rank: '2' });
  });

  it('raises four of a kind Aces to lowest straight flush', () => {
    const result = getMinimumRaise({ type: HandType.FOUR_OF_A_KIND, rank: 'A' });
    expect(result).toEqual({ type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' });
  });

  it('raises straight flush king-high to next suit', () => {
    // King-high straight flush is the highest in a suit (A would be royal flush)
    const result = getMinimumRaise({ type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: 'K' });
    expect(result).toEqual({ type: HandType.STRAIGHT_FLUSH, suit: 'diamonds', highRank: '5' });
  });

  it('raises highest straight flush (spades K-high) to royal flush', () => {
    const result = getMinimumRaise({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' });
    expect(result).toEqual({ type: HandType.ROYAL_FLUSH, suit: 'clubs' });
  });

  it('returns null for royal flush (nothing beats it)', () => {
    expect(getMinimumRaise({ type: HandType.ROYAL_FLUSH, suit: 'spades' })).toBeNull();
  });

  it('every minimum raise is strictly higher than the current hand', () => {
    const testHands: HandCall[] = [
      { type: HandType.HIGH_CARD, rank: '2' },
      { type: HandType.HIGH_CARD, rank: 'A' },
      { type: HandType.PAIR, rank: '2' },
      { type: HandType.PAIR, rank: 'A' },
      { type: HandType.TWO_PAIR, highRank: '4', lowRank: '3' },
      { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' },
      { type: HandType.FLUSH, suit: 'clubs' },
      { type: HandType.THREE_OF_A_KIND, rank: '2' },
      { type: HandType.THREE_OF_A_KIND, rank: 'A' },
      { type: HandType.STRAIGHT, highRank: '5' },
      { type: HandType.STRAIGHT, highRank: 'A' },
      { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '3' },
      { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: 'K' },
      { type: HandType.FOUR_OF_A_KIND, rank: '2' },
      { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: '5' },
      { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'K' },
    ];

    for (const hand of testHands) {
      const raise = getMinimumRaise(hand);
      expect(raise).not.toBeNull();
      expect(isHigherHand(raise!, hand)).toBe(true);
    }
  });

  it('full house twoRank progression skips threeRank', () => {
    // Full house 3s over 2s → next twoRank should be 4 (skip 3, which is threeRank)
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: '3', twoRank: '2' });
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: '3', twoRank: '4' });
  });

  it('full house wraps threeRank correctly', () => {
    // Full house 2s over Ace → next threeRank = 3, twoRank = 2
    const result = getMinimumRaise({ type: HandType.FULL_HOUSE, threeRank: '2', twoRank: 'A' });
    expect(result).toEqual({ type: HandType.FULL_HOUSE, threeRank: '3', twoRank: '2' });
  });

  it('straight flush within same suit advances rank', () => {
    const result = getMinimumRaise({ type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '7' });
    expect(result).toEqual({ type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '8' });
  });
});
