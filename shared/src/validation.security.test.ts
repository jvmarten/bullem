import { describe, it, expect } from 'vitest';
import { validateGameSettings } from './validation.js';
import { validateHandCall, sanitizeHandCall } from './hands.js';
import { HandType } from './types.js';

/**
 * Security-focused tests for input validation functions.
 * Tests prototype pollution, type confusion, and boundary attacks.
 */

// ── sanitizeHandCall — prototype pollution prevention ────────────────

describe('sanitizeHandCall: strips extra properties', () => {
  it('strips extra properties from HIGH_CARD', () => {
    const dirty = { type: HandType.HIGH_CARD, rank: 'A', __proto__: { admin: true }, evil: 'payload' };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(Object.keys(clean)).toEqual(['type', 'rank']);
    expect(clean).toEqual({ type: HandType.HIGH_CARD, rank: 'A' });
  });

  it('strips extra properties from PAIR', () => {
    const dirty = { type: HandType.PAIR, rank: 'K', extraProp: 'hax' };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.PAIR, rank: 'K' });
    expect(Object.keys(clean)).toEqual(['type', 'rank']);
  });

  it('strips extra properties from TWO_PAIR', () => {
    const dirty = { type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K', secret: 'data' };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.TWO_PAIR, highRank: 'A', lowRank: 'K' });
  });

  it('strips extra properties from FLUSH', () => {
    const dirty = { type: HandType.FLUSH, suit: 'hearts', extraField: true };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.FLUSH, suit: 'hearts' });
  });

  it('strips extra properties from THREE_OF_A_KIND', () => {
    const dirty = { type: HandType.THREE_OF_A_KIND, rank: 'Q', toString: () => 'evil' };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.THREE_OF_A_KIND, rank: 'Q' });
  });

  it('strips extra properties from STRAIGHT', () => {
    const dirty = { type: HandType.STRAIGHT, highRank: '9', malicious: true };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.STRAIGHT, highRank: '9' });
  });

  it('strips extra properties from FULL_HOUSE', () => {
    const dirty = { type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: 'K', exploit: {} };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.FULL_HOUSE, threeRank: 'A', twoRank: 'K' });
  });

  it('strips extra properties from FOUR_OF_A_KIND', () => {
    const dirty = { type: HandType.FOUR_OF_A_KIND, rank: 'J', valueOf: () => 999 };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.FOUR_OF_A_KIND, rank: 'J' });
  });

  it('strips extra properties from STRAIGHT_FLUSH', () => {
    const dirty = { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9', injection: '<script>' };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' });
  });

  it('strips extra properties from ROYAL_FLUSH', () => {
    const dirty = { type: HandType.ROYAL_FLUSH, suit: 'diamonds', hack: 'test' };
    const clean = sanitizeHandCall(dirty as Record<string, unknown>);
    expect(clean).toEqual({ type: HandType.ROYAL_FLUSH, suit: 'diamonds' });
  });
});

// ── validateHandCall — type confusion attacks ────────────────────────

describe('validateHandCall: type confusion resistance', () => {
  it('rejects array as hand', () => {
    expect(validateHandCall([1, 2, 3])).not.toBeNull();
  });

  it('rejects boolean', () => {
    expect(validateHandCall(true)).toBe('Hand must be an object');
  });

  it('rejects type as NaN', () => {
    expect(validateHandCall({ type: NaN })).toBe('Invalid hand type');
  });

  it('rejects type as Infinity', () => {
    expect(validateHandCall({ type: Infinity })).toBe('Invalid hand type');
  });

  it('rejects type as negative Infinity', () => {
    expect(validateHandCall({ type: -Infinity })).toBe('Invalid hand type');
  });

  it('rejects rank with numeric value for HIGH_CARD', () => {
    expect(validateHandCall({ type: HandType.HIGH_CARD, rank: 14 })).toBe('Invalid rank');
  });

  it('rejects rank with empty string', () => {
    expect(validateHandCall({ type: HandType.PAIR, rank: '' })).toBe('Invalid rank');
  });

  it('rejects suit with numeric value', () => {
    expect(validateHandCall({ type: HandType.FLUSH, suit: 3 })).toBe('Invalid suit');
  });

  it('rejects suit with empty string', () => {
    expect(validateHandCall({ type: HandType.FLUSH, suit: '' })).toBe('Invalid suit');
  });

  it('rejects two pair with same ranks', () => {
    expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: 'K', lowRank: 'K' })).toBe('Two pair ranks must differ');
  });

  it('rejects two pair with highRank lower than lowRank', () => {
    expect(validateHandCall({ type: HandType.TWO_PAIR, highRank: '3', lowRank: 'K' })).toBe('highRank must be higher than lowRank');
  });

  it('rejects full house with same ranks', () => {
    expect(validateHandCall({ type: HandType.FULL_HOUSE, threeRank: 'Q', twoRank: 'Q' })).toBe('Full house ranks must differ');
  });

  it('rejects straight with highRank too low (below 5)', () => {
    expect(validateHandCall({ type: HandType.STRAIGHT, highRank: '4' })).toBe('Straight highRank must be 5 or above');
  });

  it('rejects straight flush with ace high (must be Royal Flush)', () => {
    expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: 'A' })).toBe('Ace-high straight flush must be called as Royal Flush');
  });

  it('rejects straight flush with highRank too low', () => {
    expect(validateHandCall({ type: HandType.STRAIGHT_FLUSH, suit: 'hearts', highRank: '4' })).toBe('Straight flush highRank must be 5 or above');
  });
});

// ── validateGameSettings — type coercion attacks ─────────────────────

describe('validateGameSettings: type coercion resistance', () => {
  it('rejects null maxCards', () => {
    expect(validateGameSettings({ maxCards: null, turnTimer: 30 }).ok).toBe(false);
  });

  it('rejects undefined maxCards explicitly passed', () => {
    expect(validateGameSettings({ maxCards: undefined, turnTimer: 30 }).ok).toBe(false);
  });

  it('rejects boolean maxCards', () => {
    expect(validateGameSettings({ maxCards: true, turnTimer: 30 }).ok).toBe(false);
  });

  it('rejects array maxCards', () => {
    expect(validateGameSettings({ maxCards: [5], turnTimer: 30 }).ok).toBe(false);
  });

  it('rejects object maxCards', () => {
    expect(validateGameSettings({ maxCards: { valueOf: () => 5 }, turnTimer: 30 }).ok).toBe(false);
  });

  it('rejects null turnTimer', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: null }).ok).toBe(false);
  });

  it('rejects string turnTimer', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: '30' }).ok).toBe(false);
  });

  it('rejects boolean turnTimer', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: true }).ok).toBe(false);
  });

  it('rejects NaN turnTimer', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: NaN }).ok).toBe(false);
  });

  it('rejects null botSpeed', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, botSpeed: null }).ok).toBe(false);
  });

  it('rejects numeric botSpeed', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, botSpeed: 1 }).ok).toBe(false);
  });

  it('rejects null for boolean field (isPublic)', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, isPublic: null }).ok).toBe(false);
  });

  it('accepts full valid settings object with all fields', () => {
    const result = validateGameSettings({
      maxCards: 3,
      turnTimer: 15,
      maxPlayers: 6,
      botSpeed: 'fast',
      lastChanceMode: 'strict',
      bestOf: 3,
      botLevelCategory: 'hard',
      jokerCount: 1,
      isPublic: true,
      ranked: false,
      allowSpectators: true,
      spectatorsCanSeeCards: false,
    });
    expect(result.ok).toBe(true);
  });
});
