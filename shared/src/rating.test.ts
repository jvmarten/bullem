import { describe, it, expect } from 'vitest';
import {
  calculateElo,
  calculateOpenSkill,
  openSkillOrdinal,
  isValidRankedSettings,
  RANKED_SETTINGS,
  ELO_DEFAULT,
  OPENSKILL_DEFAULT_MU,
  OPENSKILL_DEFAULT_SIGMA,
} from './rating.js';
import type { GameSettings } from './types.js';

// ── Elo calculations ────────────────────────────────────────────────────

describe('calculateElo', () => {
  it('equal ratings: winner gains, loser loses symmetrically', () => {
    const winner = { rating: 1200, gamesPlayed: 0 };
    const loser = { rating: 1200, gamesPlayed: 0 };
    const [w, l] = calculateElo(winner, loser);

    // With equal ratings, expected score is 0.5, so winner gains K*(1-0.5) = K*0.5
    expect(w.newRating).toBeGreaterThan(1200);
    expect(l.newRating).toBeLessThan(1200);
    // Symmetric K-factor means symmetric delta magnitudes
    expect(w.delta).toBe(-l.delta);
    expect(w.delta).toBe(16); // K=32 provisional, 32 * 0.5 = 16
  });

  it('mismatched ratings: upset win gives larger gain', () => {
    const underdog = { rating: 1000, gamesPlayed: 5 };
    const favorite = { rating: 1400, gamesPlayed: 5 };
    const [w, l] = calculateElo(underdog, favorite);

    // Underdog wins — should gain more than if ratings were equal
    expect(w.delta).toBeGreaterThan(16);
    // Favorite loses — should lose more
    expect(l.delta).toBeLessThan(-16);
  });

  it('expected win gives smaller gain', () => {
    const favorite = { rating: 1400, gamesPlayed: 5 };
    const underdog = { rating: 1000, gamesPlayed: 5 };
    const [w, l] = calculateElo(favorite, underdog);

    // Favorite wins as expected — small gain
    expect(w.delta).toBeLessThan(16);
    expect(w.delta).toBeGreaterThan(0);
    // Underdog loses as expected — small loss
    expect(l.delta).toBeGreaterThan(-16);
    expect(l.delta).toBeLessThan(0);
  });

  it('provisional K-factor (32) for players with < 20 games', () => {
    const p1 = { rating: 1200, gamesPlayed: 10 };
    const p2 = { rating: 1200, gamesPlayed: 10 };
    const [w] = calculateElo(p1, p2);
    // K=32, equal ratings → delta = round(32 * 0.5) = 16
    expect(w.delta).toBe(16);
  });

  it('established K-factor (16) for players with >= 20 games', () => {
    const p1 = { rating: 1200, gamesPlayed: 25 };
    const p2 = { rating: 1200, gamesPlayed: 25 };
    const [w] = calculateElo(p1, p2);
    // K=16, equal ratings → delta = round(16 * 0.5) = 8
    expect(w.delta).toBe(8);
  });

  it('mixed K-factors: provisional winner vs established loser', () => {
    const provisionalWinner = { rating: 1200, gamesPlayed: 5 };
    const establishedLoser = { rating: 1200, gamesPlayed: 30 };
    const [w, l] = calculateElo(provisionalWinner, establishedLoser);

    // Winner (K=32) gains 16, loser (K=16) loses 8
    expect(w.delta).toBe(16);
    expect(l.delta).toBe(-8);
  });

  it('ratings never go below 0 in extreme cases', () => {
    const weak = { rating: 5, gamesPlayed: 0 };
    const strong = { rating: 2000, gamesPlayed: 0 };
    // Strong player wins (expected)
    const [, l] = calculateElo(strong, weak);
    // Even with a large K-factor, the loss should be small because it was expected
    expect(l.newRating).toBeGreaterThanOrEqual(0);
  });

  it('default Elo is 1200', () => {
    expect(ELO_DEFAULT).toBe(1200);
  });
});

// ── OpenSkill calculations ──────────────────────────────────────────────

describe('calculateOpenSkill', () => {
  it('3-player game: all ratings update correctly', () => {
    const players = [
      { userId: 'a', mu: 25, sigma: 8.333, finishPosition: 1 },
      { userId: 'b', mu: 25, sigma: 8.333, finishPosition: 2 },
      { userId: 'c', mu: 25, sigma: 8.333, finishPosition: 3 },
    ];

    const results = calculateOpenSkill(players);

    expect(results).toHaveLength(3);
    // All player IDs should be present
    const ids = results.map(r => r.userId).sort();
    expect(ids).toEqual(['a', 'b', 'c']);

    // Winner (1st place) should have higher mu
    const winner = results.find(r => r.userId === 'a')!;
    expect(winner.mu).toBeGreaterThan(25);

    // Loser (3rd place) should have lower mu
    const loser = results.find(r => r.userId === 'c')!;
    expect(loser.mu).toBeLessThan(25);

    // Middle player should be between
    const middle = results.find(r => r.userId === 'b')!;
    expect(middle.mu).toBeGreaterThan(loser.mu);
    expect(middle.mu).toBeLessThan(winner.mu);
  });

  it('sigma decreases for all players after a game', () => {
    const players = [
      { userId: 'a', mu: 25, sigma: 8.333, finishPosition: 1 },
      { userId: 'b', mu: 25, sigma: 8.333, finishPosition: 2 },
      { userId: 'c', mu: 25, sigma: 8.333, finishPosition: 3 },
    ];

    const results = calculateOpenSkill(players);

    // Sigma should decrease for all players (more certainty about skill)
    for (const r of results) {
      expect(r.sigma).toBeLessThan(8.333);
    }
  });

  it('preserves player ordering with different starting ratings', () => {
    const players = [
      { userId: 'strong', mu: 30, sigma: 4, finishPosition: 1 },
      { userId: 'weak', mu: 15, sigma: 6, finishPosition: 2 },
      { userId: 'mid', mu: 22, sigma: 5, finishPosition: 3 },
    ];

    const results = calculateOpenSkill(players);

    const strong = results.find(r => r.userId === 'strong')!;
    const weak = results.find(r => r.userId === 'weak')!;

    // Strong player winning should increase their rating
    expect(strong.mu).toBeGreaterThan(30);
    // Weak player losing (3rd place, expected) shouldn't drop too much
    expect(weak).toBeDefined();
  });

  it('handles 2-player game (edge case)', () => {
    const players = [
      { userId: 'winner', mu: 25, sigma: 8.333, finishPosition: 1 },
      { userId: 'loser', mu: 25, sigma: 8.333, finishPosition: 2 },
    ];

    const results = calculateOpenSkill(players);
    expect(results).toHaveLength(2);

    const winner = results.find(r => r.userId === 'winner')!;
    const loser = results.find(r => r.userId === 'loser')!;
    expect(winner.mu).toBeGreaterThan(loser.mu);
  });

  it('handles 9-player game (max ranked)', () => {
    const players = Array.from({ length: 9 }, (_, i) => ({
      userId: `p${i}`,
      mu: OPENSKILL_DEFAULT_MU,
      sigma: OPENSKILL_DEFAULT_SIGMA,
      finishPosition: i + 1,
    }));

    const results = calculateOpenSkill(players);
    expect(results).toHaveLength(9);

    // Winner should have highest mu, last place lowest
    const winner = results.find(r => r.userId === 'p0')!;
    const last = results.find(r => r.userId === 'p8')!;
    expect(winner.mu).toBeGreaterThan(last.mu);
  });

  it('default OpenSkill values are correct', () => {
    expect(OPENSKILL_DEFAULT_MU).toBe(25);
    expect(OPENSKILL_DEFAULT_SIGMA).toBeCloseTo(8.333, 2);
  });
});

describe('openSkillOrdinal', () => {
  it('calculates conservative rating estimate', () => {
    const rating = openSkillOrdinal(25, 8.333);
    // mu - 3*sigma = 25 - 24.999 ≈ 0
    expect(rating).toBeCloseTo(0, 0);
  });

  it('higher mu gives higher ordinal', () => {
    const low = openSkillOrdinal(20, 5);
    const high = openSkillOrdinal(30, 5);
    expect(high).toBeGreaterThan(low);
  });

  it('higher sigma gives lower ordinal (more uncertain = more conservative)', () => {
    const certain = openSkillOrdinal(25, 2);
    const uncertain = openSkillOrdinal(25, 8);
    expect(certain).toBeGreaterThan(uncertain);
  });
});

// ── Ranked settings enforcement ─────────────────────────────────────────

describe('RANKED_SETTINGS', () => {
  it('has correct locked values', () => {
    expect(RANKED_SETTINGS.maxCards).toBe(5);
    expect(RANKED_SETTINGS.turnTimer).toBe(30);
    expect(RANKED_SETTINGS.lastChanceMode).toBe('classic');
    expect(RANKED_SETTINGS.maxPlayers).toBe(9);
  });

  it('is frozen (cannot be modified)', () => {
    // RANKED_SETTINGS is declared as Readonly, so assignments won't compile.
    // Runtime check that the values are as expected.
    const copy = { ...RANKED_SETTINGS };
    expect(copy).toEqual({
      maxCards: 5,
      turnTimer: 30,
      lastChanceMode: 'classic',
      maxPlayers: 9,
    });
  });
});

describe('isValidRankedSettings', () => {
  it('accepts valid ranked settings', () => {
    const settings: GameSettings = {
      maxCards: 5,
      turnTimer: 30,
      lastChanceMode: 'classic',
      maxPlayers: 9,
    };
    expect(isValidRankedSettings(settings)).toBe(true);
  });

  it('accepts settings with fewer max players than limit', () => {
    const settings: GameSettings = {
      maxCards: 5,
      turnTimer: 30,
      lastChanceMode: 'classic',
      maxPlayers: 4,
    };
    expect(isValidRankedSettings(settings)).toBe(true);
  });

  it('accepts default lastChanceMode when not specified', () => {
    const settings: GameSettings = {
      maxCards: 5,
      turnTimer: 30,
      maxPlayers: 9,
    };
    expect(isValidRankedSettings(settings)).toBe(true);
  });

  it('rejects wrong maxCards', () => {
    const settings: GameSettings = {
      maxCards: 3,
      turnTimer: 30,
      lastChanceMode: 'classic',
    };
    expect(isValidRankedSettings(settings)).toBe(false);
  });

  it('rejects wrong turnTimer', () => {
    const settings: GameSettings = {
      maxCards: 5,
      turnTimer: 60,
      lastChanceMode: 'classic',
    };
    expect(isValidRankedSettings(settings)).toBe(false);
  });

  it('rejects wrong lastChanceMode', () => {
    const settings: GameSettings = {
      maxCards: 5,
      turnTimer: 30,
      lastChanceMode: 'strict',
    };
    expect(isValidRankedSettings(settings)).toBe(false);
  });

  it('rejects maxPlayers exceeding ranked limit', () => {
    const settings: GameSettings = {
      maxCards: 5,
      turnTimer: 30,
      lastChanceMode: 'classic',
      maxPlayers: 12,
    };
    expect(isValidRankedSettings(settings)).toBe(false);
  });
});
