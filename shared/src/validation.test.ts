import { describe, it, expect } from 'vitest';
import { validateGameSettings } from './validation.js';

/**
 * Tests for validateGameSettings — covers edge cases in server-side
 * settings validation that could allow invalid game configurations.
 */

describe('validateGameSettings: required fields', () => {
  it('accepts valid minimal settings', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 30 });
    expect(result.ok).toBe(true);
  });

  it('rejects missing maxCards', () => {
    const result = validateGameSettings({ turnTimer: 30 });
    expect(result.ok).toBe(false);
  });

  it('rejects missing turnTimer', () => {
    const result = validateGameSettings({ maxCards: 5 });
    expect(result.ok).toBe(false);
  });

  it('rejects non-integer maxCards', () => {
    const result = validateGameSettings({ maxCards: 2.5, turnTimer: 30 });
    expect(result.ok).toBe(false);
  });

  it('rejects maxCards below minimum (1)', () => {
    const result = validateGameSettings({ maxCards: 0, turnTimer: 30 });
    expect(result.ok).toBe(false);
  });

  it('rejects maxCards above maximum (5)', () => {
    const result = validateGameSettings({ maxCards: 6, turnTimer: 30 });
    expect(result.ok).toBe(false);
  });

  it('rejects NaN maxCards', () => {
    const result = validateGameSettings({ maxCards: NaN, turnTimer: 30 });
    expect(result.ok).toBe(false);
  });

  it('rejects string maxCards', () => {
    const result = validateGameSettings({ maxCards: '5', turnTimer: 30 });
    expect(result.ok).toBe(false);
  });

  it('rejects invalid turnTimer value', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 10 });
    expect(result.ok).toBe(false);
  });

  it('rejects turnTimer=0 (offline-only value)', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 0 });
    expect(result.ok).toBe(false);
  });

  it('accepts all valid turnTimer values (15, 30, 60)', () => {
    for (const timer of [15, 30, 60]) {
      const result = validateGameSettings({ maxCards: 5, turnTimer: timer });
      expect(result.ok, `turnTimer=${timer}`).toBe(true);
    }
  });

  it('accepts all valid maxCards values (1-5)', () => {
    for (let i = 1; i <= 5; i++) {
      const result = validateGameSettings({ maxCards: i, turnTimer: 30 });
      expect(result.ok, `maxCards=${i}`).toBe(true);
    }
  });
});

describe('validateGameSettings: optional fields', () => {
  it('accepts valid maxPlayers', () => {
    for (const mp of [2, 3, 4, 5, 6, 8, 10, 12]) {
      const result = validateGameSettings({ maxCards: 5, turnTimer: 30, maxPlayers: mp });
      expect(result.ok, `maxPlayers=${mp}`).toBe(true);
    }
  });

  it('rejects invalid maxPlayers', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 30, maxPlayers: 7 });
    expect(result.ok).toBe(false);
  });

  it('rejects non-number maxPlayers', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 30, maxPlayers: '6' });
    expect(result.ok).toBe(false);
  });

  it('accepts valid botSpeed values', () => {
    for (const speed of ['slow', 'normal', 'fast']) {
      const result = validateGameSettings({ maxCards: 5, turnTimer: 30, botSpeed: speed });
      expect(result.ok, `botSpeed=${speed}`).toBe(true);
    }
  });

  it('rejects invalid botSpeed', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 30, botSpeed: 'turbo' });
    expect(result.ok).toBe(false);
  });

  it('accepts valid lastChanceMode values', () => {
    for (const mode of ['classic', 'strict']) {
      const result = validateGameSettings({ maxCards: 5, turnTimer: 30, lastChanceMode: mode });
      expect(result.ok, `lastChanceMode=${mode}`).toBe(true);
    }
  });

  it('rejects invalid lastChanceMode', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 30, lastChanceMode: 'yolo' });
    expect(result.ok).toBe(false);
  });

  it('accepts valid bestOf values', () => {
    for (const bo of [1, 3, 5]) {
      const result = validateGameSettings({ maxCards: 5, turnTimer: 30, bestOf: bo });
      expect(result.ok, `bestOf=${bo}`).toBe(true);
    }
  });

  it('rejects invalid bestOf', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 30, bestOf: 7 });
    expect(result.ok).toBe(false);
  });

  it('accepts valid botLevelCategory values', () => {
    for (const cat of ['easy', 'normal', 'hard', 'mixed']) {
      const result = validateGameSettings({ maxCards: 5, turnTimer: 30, botLevelCategory: cat });
      expect(result.ok, `botLevelCategory=${cat}`).toBe(true);
    }
  });

  it('rejects invalid botLevelCategory', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 30, botLevelCategory: 'extreme' });
    expect(result.ok).toBe(false);
  });

  it('accepts valid jokerCount values (0, 1, 2)', () => {
    for (const jc of [0, 1, 2]) {
      const result = validateGameSettings({ maxCards: 5, turnTimer: 30, jokerCount: jc });
      expect(result.ok, `jokerCount=${jc}`).toBe(true);
    }
  });

  it('rejects invalid jokerCount', () => {
    const result = validateGameSettings({ maxCards: 5, turnTimer: 30, jokerCount: 3 });
    expect(result.ok).toBe(false);
  });
});

describe('validateGameSettings: boolean fields', () => {
  it('accepts boolean isPublic', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, isPublic: true }).ok).toBe(true);
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, isPublic: false }).ok).toBe(true);
  });

  it('rejects non-boolean isPublic', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, isPublic: 'yes' }).ok).toBe(false);
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, isPublic: 1 }).ok).toBe(false);
  });

  it('accepts boolean ranked', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, ranked: true }).ok).toBe(true);
  });

  it('rejects non-boolean ranked', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, ranked: 'true' }).ok).toBe(false);
  });

  it('accepts boolean allowSpectators', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, allowSpectators: true }).ok).toBe(true);
  });

  it('rejects non-boolean allowSpectators', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, allowSpectators: 1 }).ok).toBe(false);
  });

  it('accepts boolean spectatorsCanSeeCards', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, spectatorsCanSeeCards: false }).ok).toBe(true);
  });

  it('rejects non-boolean spectatorsCanSeeCards', () => {
    expect(validateGameSettings({ maxCards: 5, turnTimer: 30, spectatorsCanSeeCards: 0 }).ok).toBe(false);
  });
});

describe('validateGameSettings: injection resistance', () => {
  it('ignores extra unknown properties (no crash)', () => {
    const result = validateGameSettings({
      maxCards: 5,
      turnTimer: 30,
      __proto__: { admin: true },
      constructor: 'hax',
      toString: 42,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects Infinity for maxCards', () => {
    const result = validateGameSettings({ maxCards: Infinity, turnTimer: 30 });
    expect(result.ok).toBe(false);
  });

  it('rejects negative maxCards', () => {
    const result = validateGameSettings({ maxCards: -1, turnTimer: 30 });
    expect(result.ok).toBe(false);
  });
});
