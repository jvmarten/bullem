/**
 * Edge case tests for the rating system — Elo and OpenSkill.
 * Tests extreme scenarios that could corrupt player ratings:
 * high K-factor swings, extreme rating gaps, large player counts.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateElo, calculateOpenSkill, openSkillOrdinal,
  isValidRankedSettings, RANKED_SETTINGS,
  ELO_DEFAULT, OPENSKILL_DEFAULT_MU, OPENSKILL_DEFAULT_SIGMA,
  type EloPlayer, type OpenSkillPlayer,
} from './rating.js';

describe('calculateElo edge cases', () => {
  it('never produces negative ratings', () => {
    // Very low-rated player loses to very high-rated player
    const winner: EloPlayer = { rating: 2400, gamesPlayed: 100 };
    const loser: EloPlayer = { rating: 100, gamesPlayed: 100 };

    const [, loserResult] = calculateElo(winner, loser);
    expect(loserResult.newRating).toBeGreaterThanOrEqual(0);
  });

  it('upset win gives larger delta', () => {
    const lowRated: EloPlayer = { rating: 800, gamesPlayed: 50 };
    const highRated: EloPlayer = { rating: 1600, gamesPlayed: 50 };

    // Low-rated player wins (upset)
    const [upsetWinnerResult] = calculateElo(lowRated, highRated);

    // Expected win by high-rated
    const [normalWinnerResult] = calculateElo(highRated, lowRated);

    // Upset should give bigger delta to winner
    expect(upsetWinnerResult.delta).toBeGreaterThan(normalWinnerResult.delta);
  });

  it('provisional player (< 20 games) uses higher K-factor', () => {
    const provisional: EloPlayer = { rating: 1200, gamesPlayed: 5 };
    const established: EloPlayer = { rating: 1200, gamesPlayed: 50 };

    const [provisionalWin] = calculateElo(provisional, established);
    const [establishedWin] = calculateElo(established, provisional);

    // Provisional K=32, Established K=16 → provisional should swing more
    expect(Math.abs(provisionalWin.delta)).toBeGreaterThan(Math.abs(establishedWin.delta));
  });

  it('equal ratings produce symmetric results', () => {
    const p1: EloPlayer = { rating: 1200, gamesPlayed: 30 };
    const p2: EloPlayer = { rating: 1200, gamesPlayed: 30 };

    const [winResult, loseResult] = calculateElo(p1, p2);

    // Winner gains approximately what loser loses
    expect(Math.abs(winResult.delta + loseResult.delta)).toBeLessThanOrEqual(1);
  });

  it('handles extreme rating difference (3000 vs 100)', () => {
    const god: EloPlayer = { rating: 3000, gamesPlayed: 200 };
    const newbie: EloPlayer = { rating: 100, gamesPlayed: 0 };

    const [winResult, loseResult] = calculateElo(god, newbie);

    // Should not produce NaN or Infinity
    expect(Number.isFinite(winResult.newRating)).toBe(true);
    expect(Number.isFinite(loseResult.newRating)).toBe(true);
    // Expected win gives minimal points
    expect(winResult.delta).toBeLessThanOrEqual(1);
  });

  it('default rating is 1200', () => {
    expect(ELO_DEFAULT).toBe(1200);
  });
});

describe('calculateOpenSkill edge cases', () => {
  it('handles 2-player game', () => {
    const players: OpenSkillPlayer[] = [
      { userId: 'a', mu: OPENSKILL_DEFAULT_MU, sigma: OPENSKILL_DEFAULT_SIGMA, finishPosition: 1 },
      { userId: 'b', mu: OPENSKILL_DEFAULT_MU, sigma: OPENSKILL_DEFAULT_SIGMA, finishPosition: 2 },
    ];

    const results = calculateOpenSkill(players);
    expect(results.length).toBe(2);

    const winner = results.find(r => r.userId === 'a')!;
    const loser = results.find(r => r.userId === 'b')!;

    // Winner's mu should increase, loser's should decrease
    expect(winner.mu).toBeGreaterThan(OPENSKILL_DEFAULT_MU);
    expect(loser.mu).toBeLessThan(OPENSKILL_DEFAULT_MU);
  });

  it('handles 9-player game (max multiplayer)', () => {
    const players: OpenSkillPlayer[] = [];
    for (let i = 0; i < 9; i++) {
      players.push({
        userId: `p${i}`,
        mu: OPENSKILL_DEFAULT_MU,
        sigma: OPENSKILL_DEFAULT_SIGMA,
        finishPosition: i + 1,
      });
    }

    const results = calculateOpenSkill(players);
    expect(results.length).toBe(9);

    // First place should gain, last place should lose
    const first = results.find(r => r.userId === 'p0')!;
    const last = results.find(r => r.userId === 'p8')!;

    expect(first.mu).toBeGreaterThan(OPENSKILL_DEFAULT_MU);
    expect(last.mu).toBeLessThan(OPENSKILL_DEFAULT_MU);
  });

  it('sigma decreases after each game (confidence increases)', () => {
    const players: OpenSkillPlayer[] = [
      { userId: 'a', mu: OPENSKILL_DEFAULT_MU, sigma: OPENSKILL_DEFAULT_SIGMA, finishPosition: 1 },
      { userId: 'b', mu: OPENSKILL_DEFAULT_MU, sigma: OPENSKILL_DEFAULT_SIGMA, finishPosition: 2 },
    ];

    const results = calculateOpenSkill(players);
    for (const r of results) {
      expect(r.sigma).toBeLessThan(OPENSKILL_DEFAULT_SIGMA);
    }
  });

  it('preserves finish ordering in results', () => {
    const players: OpenSkillPlayer[] = [
      { userId: 'last', mu: 25, sigma: 8, finishPosition: 4 },
      { userId: 'first', mu: 25, sigma: 8, finishPosition: 1 },
      { userId: 'third', mu: 25, sigma: 8, finishPosition: 3 },
      { userId: 'second', mu: 25, sigma: 8, finishPosition: 2 },
    ];

    const results = calculateOpenSkill(players);
    const firstResult = results.find(r => r.userId === 'first')!;
    const lastResult = results.find(r => r.userId === 'last')!;

    expect(firstResult.mu).toBeGreaterThan(lastResult.mu);
  });

  it('all results have finite mu and sigma', () => {
    const players: OpenSkillPlayer[] = [
      { userId: 'a', mu: 0, sigma: 0.001, finishPosition: 1 },
      { userId: 'b', mu: 100, sigma: 50, finishPosition: 2 },
    ];

    const results = calculateOpenSkill(players);
    for (const r of results) {
      expect(Number.isFinite(r.mu)).toBe(true);
      expect(Number.isFinite(r.sigma)).toBe(true);
      expect(r.sigma).toBeGreaterThan(0);
    }
  });
});

describe('openSkillOrdinal', () => {
  it('returns conservative estimate (mu - 3*sigma)', () => {
    // ordinal = mu - 3*sigma for default openskill
    const result = openSkillOrdinal(25, 8.333);
    expect(result).toBeLessThan(25);
    expect(result).toBeCloseTo(25 - 3 * 8.333, 0);
  });

  it('higher mu produces higher ordinal (same sigma)', () => {
    expect(openSkillOrdinal(30, 5)).toBeGreaterThan(openSkillOrdinal(20, 5));
  });

  it('higher sigma produces lower ordinal (same mu)', () => {
    expect(openSkillOrdinal(25, 10)).toBeLessThan(openSkillOrdinal(25, 3));
  });

  it('new player starts with low ordinal', () => {
    const ord = openSkillOrdinal(OPENSKILL_DEFAULT_MU, OPENSKILL_DEFAULT_SIGMA);
    // Conservative estimate: mu - 3*sigma ≈ 25 - 25 = 0 or slightly above
    expect(ord).toBeLessThanOrEqual(OPENSKILL_DEFAULT_MU);
  });
});

describe('isValidRankedSettings', () => {
  it('rejects settings with wrong maxCards', () => {
    expect(isValidRankedSettings({
      maxCards: 3, turnTimer: 30, botLevelCategory: 'mixed',
    })).toBe(false);
  });

  it('rejects settings with wrong turnTimer', () => {
    expect(isValidRankedSettings({
      maxCards: 5, turnTimer: 60, botLevelCategory: 'mixed',
    })).toBe(false);
  });

  it('rejects strict lastChanceMode', () => {
    expect(isValidRankedSettings({
      maxCards: 5, turnTimer: 30, lastChanceMode: 'strict', botLevelCategory: 'mixed',
    })).toBe(false);
  });

  it('rejects too many maxPlayers', () => {
    expect(isValidRankedSettings({
      maxCards: 5, turnTimer: 30, maxPlayers: 12, botLevelCategory: 'mixed',
    })).toBe(false);
  });

  it('accepts exact ranked settings', () => {
    expect(isValidRankedSettings({
      maxCards: RANKED_SETTINGS.maxCards,
      turnTimer: RANKED_SETTINGS.turnTimer,
      lastChanceMode: RANKED_SETTINGS.lastChanceMode,
      maxPlayers: RANKED_SETTINGS.maxPlayers,
      botLevelCategory: 'mixed',
    })).toBe(true);
  });

  it('accepts fewer maxPlayers than ranked limit', () => {
    expect(isValidRankedSettings({
      maxCards: 5, turnTimer: 30, maxPlayers: 4, botLevelCategory: 'mixed',
    })).toBe(true);
  });

  it('accepts missing lastChanceMode (defaults to classic)', () => {
    expect(isValidRankedSettings({
      maxCards: 5, turnTimer: 30, botLevelCategory: 'mixed',
    })).toBe(true);
  });
});
