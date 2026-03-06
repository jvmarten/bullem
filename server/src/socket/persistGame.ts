import type { PlayerId, RankedMode, RatingChange } from '@bull-em/shared';
import {
  ELO_DEFAULT,
  OPENSKILL_DEFAULT_MU,
  OPENSKILL_DEFAULT_SIGMA,
  calculateElo,
  calculateOpenSkill,
  openSkillDisplayRating,
} from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import { persistGameResult } from '../db/games.js';
import type { GameRecord } from '../db/games.js';
import { persistReplayRounds } from '../db/replays.js';
import { updateRatingsAfterGame, getRating } from '../db/ratings.js';
import { track } from '../analytics/track.js';
import logger from '../logger.js';

/**
 * Build a GameRecord from room state and persist it to the database.
 * Called when a game ends (game_over). Runs async — does not block gameplay.
 */
export function persistCompletedGame(room: Room, winnerId: PlayerId): void {
  if (!room.game || !room.gameStartedAt) return;

  const stats = room.game.getGameStats();
  const playerCount = room.players.size;
  const winnerPlayer = room.players.get(winnerId);

  // Calculate finish positions:
  // Winner = 1, others based on reverse elimination order
  // (last eliminated = 2nd place, first eliminated = last place)
  const totalPlayers = room.players.size;
  const positionMap = new Map<PlayerId, number>();
  positionMap.set(winnerId, 1);

  // Reverse elimination order: last eliminated is 2nd place
  for (let i = room.eliminationOrder.length - 1; i >= 0; i--) {
    const playerId = room.eliminationOrder[i]!;
    // Position 2 for last eliminated, 3 for second-to-last, etc.
    const position = room.eliminationOrder.length - i + 1;
    positionMap.set(playerId, position);
  }

  // Any players not in elimination order and not the winner get the last positions
  let nextPosition = positionMap.size + 1;
  for (const [playerId] of room.players) {
    if (!positionMap.has(playerId)) {
      positionMap.set(playerId, nextPosition++);
    }
  }

  const record: GameRecord = {
    roomCode: room.roomCode,
    winnerId,
    winnerUserId: room.playerUserIds.get(winnerId) ?? null,
    winnerName: winnerPlayer?.name ?? 'Unknown',
    playerCount,
    settings: { ...room.settings },
    startedAt: room.gameStartedAt,
    players: [...room.players.values()].map(p => ({
      playerId: p.id,
      userId: room.playerUserIds.get(p.id) ?? null,
      playerName: p.name,
      finishPosition: positionMap.get(p.id) ?? totalPlayers,
      finalCardCount: p.cardCount,
      stats: stats.playerStats[p.id] ?? {
        bullsCalled: 0,
        truesCalled: 0,
        callsMade: 0,
        correctBulls: 0,
        correctTrues: 0,
        bluffsSuccessful: 0,
        roundsSurvived: 0,
      },
    })),
  };

  const durationSeconds = Math.round((Date.now() - room.gameStartedAt.getTime()) / 1000);
  track('game:completed', {
    roomCode: room.roomCode,
    playerCount,
    winnerId,
    durationSeconds,
    ranked: room.settings.ranked ?? false,
  }, room.playerUserIds.get(winnerId) ?? null);

  // Fire-and-forget — game persistence must never block or crash the game
  persistGameResult(record)
    .then((gameId) => {
      if (!gameId || !room.game) return;
      // Persist round snapshots for replay after the game row exists (FK constraint)
      const snapshots = room.game.getRoundSnapshots();
      return persistReplayRounds(gameId, snapshots);
    })
    .catch(() => {
      // Error already logged inside persistGameResult / persistReplayRounds
    });

  // Update ranked ratings if this was a ranked game with authenticated players
  if (room.settings.ranked && room.settings.rankedMode) {
    const rankedMode: RankedMode = room.settings.rankedMode;
    // Only include authenticated (non-guest) players in rating updates
    const rankedPlayers = record.players
      .filter(p => p.userId !== null)
      .map(p => ({ userId: p.userId!, finishPosition: p.finishPosition }));

    if (rankedPlayers.length >= 2) {
      updateRatingsAfterGame(rankedMode, rankedPlayers).catch(() => {
        // Error already logged inside updateRatingsAfterGame
      });
    }
  }
}

/**
 * Compute rating changes for a ranked game BEFORE emitting game:over.
 * Returns a map of playerId → RatingChange, or null if not a ranked game.
 * This reads current ratings from the DB and calculates deltas without persisting.
 */
export async function computeRatingChanges(
  room: Room,
  winnerId: PlayerId,
): Promise<Record<PlayerId, RatingChange> | undefined> {
  if (!room.settings.ranked || !room.settings.rankedMode || !room.game) return undefined;

  const rankedMode = room.settings.rankedMode;
  const result: Record<PlayerId, RatingChange> = {};

  try {
    // Build finish positions
    const positionMap = new Map<PlayerId, number>();
    positionMap.set(winnerId, 1);
    for (let i = room.eliminationOrder.length - 1; i >= 0; i--) {
      positionMap.set(room.eliminationOrder[i]!, room.eliminationOrder.length - i + 1);
    }
    let nextPos = positionMap.size + 1;
    for (const [pid] of room.players) {
      if (!positionMap.has(pid)) positionMap.set(pid, nextPos++);
    }

    // Only authenticated players
    const rankedPlayers = [...room.players.entries()]
      .filter(([pid]) => room.playerUserIds.get(pid))
      .map(([pid]) => ({
        playerId: pid,
        userId: room.playerUserIds.get(pid)!,
        finishPosition: positionMap.get(pid) ?? room.players.size,
      }));

    if (rankedPlayers.length < 2) return undefined;

    if (rankedMode === 'heads_up') {
      const winner = rankedPlayers.find(p => p.finishPosition === 1);
      const loser = rankedPlayers.find(p => p.finishPosition === 2);
      if (!winner || !loser) return undefined;

      const [winnerRating, loserRating] = await Promise.all([
        getRating(winner.userId, 'heads_up'),
        getRating(loser.userId, 'heads_up'),
      ]);

      const winnerElo = winnerRating?.mode === 'heads_up' ? winnerRating.elo : ELO_DEFAULT;
      const loserElo = loserRating?.mode === 'heads_up' ? loserRating.elo : ELO_DEFAULT;
      const winnerGames = winnerRating?.gamesPlayed ?? 0;
      const loserGames = loserRating?.gamesPlayed ?? 0;

      const [winResult, loseResult] = calculateElo(
        { rating: winnerElo, gamesPlayed: winnerGames },
        { rating: loserElo, gamesPlayed: loserGames },
      );

      result[winner.playerId] = { mode: 'heads_up', before: winnerElo, after: winResult.newRating, delta: winResult.delta };
      result[loser.playerId] = { mode: 'heads_up', before: loserElo, after: loseResult.newRating, delta: loseResult.delta };
    } else {
      // Multiplayer — OpenSkill
      const ratingsData = await Promise.all(
        rankedPlayers.map(async (p) => {
          const rating = await getRating(p.userId, 'multiplayer');
          return { ...p, rating };
        }),
      );

      const openSkillInput = ratingsData.map(p => ({
        userId: p.userId,
        mu: p.rating?.mode === 'multiplayer' ? p.rating.mu : OPENSKILL_DEFAULT_MU,
        sigma: p.rating?.mode === 'multiplayer' ? p.rating.sigma : OPENSKILL_DEFAULT_SIGMA,
        finishPosition: p.finishPosition,
      }));

      const openSkillResults = calculateOpenSkill(openSkillInput);

      for (const p of ratingsData) {
        const before = p.rating?.mode === 'multiplayer'
          ? openSkillDisplayRating(p.rating.mu)
          : openSkillDisplayRating(OPENSKILL_DEFAULT_MU);
        const osResult = openSkillResults.find(r => r.userId === p.userId);
        const after = osResult ? openSkillDisplayRating(osResult.mu) : before;
        result[p.playerId] = { mode: 'multiplayer', before, after, delta: after - before };
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  } catch (err) {
    logger.error({ err }, 'Failed to compute rating changes for game:over');
    return undefined;
  }
}
