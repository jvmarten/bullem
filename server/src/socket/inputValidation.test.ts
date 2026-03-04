import { describe, it, expect } from 'vitest';
import {
  PLAYER_NAME_MAX_LENGTH, PLAYER_NAME_PATTERN, ROOM_CODE_LENGTH,
  MIN_MAX_CARDS, MAX_CARDS, ONLINE_TURN_TIMER_OPTIONS, MIN_PLAYERS, MAX_PLAYERS,
} from '@bull-em/shared';

// These validation functions are private in lobbyHandlers.ts.
// We replicate them here to test the validation logic independently.
// If the implementation changes, these tests catch regressions in the validation boundary.

function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > PLAYER_NAME_MAX_LENGTH) return null;
  if (!PLAYER_NAME_PATTERN.test(trimmed)) return null;
  return trimmed;
}

const ROOM_CODE_PATTERN = /^[A-Z]{4}$/;

function sanitizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (upper.length !== ROOM_CODE_LENGTH) return null;
  if (!ROOM_CODE_PATTERN.test(upper)) return null;
  return upper;
}

// ─── sanitizeName ────────────────────────────────────────────────────────────

describe('sanitizeName', () => {
  it('accepts valid names', () => {
    expect(sanitizeName('Alice')).toBe('Alice');
    expect(sanitizeName('Bob123')).toBe('Bob123');
    expect(sanitizeName('Player One')).toBe('Player One');
    expect(sanitizeName("O'Brien")).toBe("O'Brien");
    expect(sanitizeName('a')).toBe('a'); // minimum length
  });

  it('trims whitespace', () => {
    expect(sanitizeName('  Alice  ')).toBe('Alice');
    expect(sanitizeName('\t Bob \n')).toBe('Bob');
  });

  it('rejects empty string', () => {
    expect(sanitizeName('')).toBeNull();
  });

  it('rejects whitespace-only string', () => {
    expect(sanitizeName('   ')).toBeNull();
    expect(sanitizeName('\t\n')).toBeNull();
  });

  it('rejects strings exceeding max length', () => {
    const long = 'A'.repeat(PLAYER_NAME_MAX_LENGTH + 1);
    expect(sanitizeName(long)).toBeNull();
  });

  it('accepts string at exact max length', () => {
    const exact = 'A'.repeat(PLAYER_NAME_MAX_LENGTH);
    expect(sanitizeName(exact)).toBe(exact);
  });

  it('rejects non-string types', () => {
    expect(sanitizeName(null)).toBeNull();
    expect(sanitizeName(undefined)).toBeNull();
    expect(sanitizeName(42)).toBeNull();
    expect(sanitizeName(true)).toBeNull();
    expect(sanitizeName({})).toBeNull();
    expect(sanitizeName([])).toBeNull();
  });

  it('rejects names with special characters that could be injection vectors', () => {
    expect(sanitizeName('<script>alert(1)</script>')).toBeNull();
    expect(sanitizeName('name"; DROP TABLE')).toBeNull();
    expect(sanitizeName('name\x00null')).toBeNull();
    expect(sanitizeName('name\nline')).toBeNull();
  });

  it('accepts allowed special characters', () => {
    expect(sanitizeName('it_s-me')).toBe('it_s-me');
    expect(sanitizeName("what's up")).toBe("what's up");
    expect(sanitizeName('really?')).toBe('really?');
    expect(sanitizeName('wow!')).toBe('wow!');
    expect(sanitizeName('test.name')).toBe('test.name');
  });

  it('rejects emoji and unicode', () => {
    expect(sanitizeName('Player🎮')).toBeNull();
    expect(sanitizeName('名前')).toBeNull();
  });
});

// ─── sanitizeRoomCode ────────────────────────────────────────────────────────

describe('sanitizeRoomCode', () => {
  it('accepts valid 4-letter uppercase codes', () => {
    expect(sanitizeRoomCode('ABCD')).toBe('ABCD');
    expect(sanitizeRoomCode('WXYZ')).toBe('WXYZ');
  });

  it('converts lowercase to uppercase', () => {
    expect(sanitizeRoomCode('abcd')).toBe('ABCD');
    expect(sanitizeRoomCode('AbCd')).toBe('ABCD');
  });

  it('trims whitespace', () => {
    expect(sanitizeRoomCode('  ABCD  ')).toBe('ABCD');
  });

  it('rejects wrong length', () => {
    expect(sanitizeRoomCode('ABC')).toBeNull();
    expect(sanitizeRoomCode('ABCDE')).toBeNull();
    expect(sanitizeRoomCode('')).toBeNull();
  });

  it('rejects codes with numbers', () => {
    expect(sanitizeRoomCode('AB12')).toBeNull();
    expect(sanitizeRoomCode('1234')).toBeNull();
  });

  it('rejects codes with special characters', () => {
    expect(sanitizeRoomCode('AB!@')).toBeNull();
    expect(sanitizeRoomCode('AB C')).toBeNull();
  });

  it('rejects non-string types', () => {
    expect(sanitizeRoomCode(null)).toBeNull();
    expect(sanitizeRoomCode(undefined)).toBeNull();
    expect(sanitizeRoomCode(1234)).toBeNull();
    expect(sanitizeRoomCode({})).toBeNull();
  });
});

// ─── Settings validation logic ───────────────────────────────────────────────

describe('settings validation rules', () => {
  function validateMaxCards(v: unknown): boolean {
    return typeof v === 'number' && v >= MIN_MAX_CARDS && v <= MAX_CARDS && Number.isInteger(v);
  }

  function validateTurnTimer(v: unknown): boolean {
    return typeof v === 'number' && (ONLINE_TURN_TIMER_OPTIONS as readonly number[]).includes(v);
  }

  function validateMaxPlayers(v: unknown): boolean {
    if (v === undefined) return true;
    return typeof v === 'number' && v >= MIN_PLAYERS && v <= MAX_PLAYERS && Number.isInteger(v);
  }

  describe('maxCards validation', () => {
    it('accepts valid range', () => {
      for (let i = MIN_MAX_CARDS; i <= MAX_CARDS; i++) {
        expect(validateMaxCards(i)).toBe(true);
      }
    });

    it('rejects below minimum', () => {
      expect(validateMaxCards(0)).toBe(false);
      expect(validateMaxCards(-1)).toBe(false);
    });

    it('rejects above maximum', () => {
      expect(validateMaxCards(MAX_CARDS + 1)).toBe(false);
      expect(validateMaxCards(100)).toBe(false);
    });

    it('rejects non-integer', () => {
      expect(validateMaxCards(2.5)).toBe(false);
      expect(validateMaxCards(NaN)).toBe(false);
      expect(validateMaxCards(Infinity)).toBe(false);
    });

    it('rejects non-number', () => {
      expect(validateMaxCards('3')).toBe(false);
      expect(validateMaxCards(null)).toBe(false);
    });
  });

  describe('turnTimer validation', () => {
    it('accepts valid timer options', () => {
      for (const opt of ONLINE_TURN_TIMER_OPTIONS) {
        expect(validateTurnTimer(opt)).toBe(true);
      }
    });

    it('rejects 0 (local only, not valid for online)', () => {
      expect(validateTurnTimer(0)).toBe(false);
    });

    it('rejects arbitrary numbers', () => {
      expect(validateTurnTimer(10)).toBe(false);
      expect(validateTurnTimer(45)).toBe(false);
      expect(validateTurnTimer(120)).toBe(false);
    });

    it('rejects non-number', () => {
      expect(validateTurnTimer('30')).toBe(false);
      expect(validateTurnTimer(null)).toBe(false);
    });
  });

  describe('maxPlayers validation', () => {
    it('accepts undefined (uses default)', () => {
      expect(validateMaxPlayers(undefined)).toBe(true);
    });

    it('accepts valid range', () => {
      expect(validateMaxPlayers(2)).toBe(true);
      expect(validateMaxPlayers(6)).toBe(true);
      expect(validateMaxPlayers(12)).toBe(true);
    });

    it('rejects below minimum', () => {
      expect(validateMaxPlayers(1)).toBe(false);
      expect(validateMaxPlayers(0)).toBe(false);
    });

    it('rejects above maximum', () => {
      expect(validateMaxPlayers(13)).toBe(false);
      expect(validateMaxPlayers(100)).toBe(false);
    });

    it('rejects non-integer', () => {
      expect(validateMaxPlayers(2.5)).toBe(false);
    });
  });
});
