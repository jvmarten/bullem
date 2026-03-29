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
import { updateRatingsAfterGame, getRating, BOT_MATCH_WEIGHT } from '../db/ratings.js';
import { persistRankedMatch } from '../db/rankedMatches.js';
import type { RankedMatchPlayerData } from '../db/rankedMatches.js';
import { track } from '../analytics/track.js';
import logger from '../logger.js';

/**
 * Calculate finish positions from elimination order:
 * Winner = 1, last eliminated = 2nd, first eliminated = last.
 * Players not in the elimination order (and not the winner) get the trailing positions.
 */
function calculateFinishPositions(
  winnerId: PlayerId,
  eliminationOrder: PlayerId[],
  playerIds: Iterable<PlayerId>,
): Map<PlayerId, number> {
  const positionMap = new Map<PlayerId, number>();
  positionMap.set(winnerId, 1);

  // Reverse elimination order: last eliminated is 2nd place
  for (let i = eliminationOrder.length - 1; i >= 0; i--) {
    const playerId = eliminationOrder[i]!;
    const position = eliminationOrder.length - i + 1;
    positionMap.set(playerId, position);
  }

  // Any players not in elimination order and not the winner get trailing positions
  let nextPosition = positionMap.size + 1;
  for (const playerId of playerIds) {
    if (!positionMap.has(playerId)) {
      positionMap.set(playerId, nextPosition++);
    }
  }

  return positionMap;
}

/**
 * Build a GameRecord from room state and persist it to the database.
 * Called when a game ends (game_over). Runs async — does not block gameplay.
 */
export function persistCompletedGame(room: Room, winnerId: PlayerId, preGeneratedGameId?: string): void {
  if (!room.game || !room.gameStartedAt) return;

  const stats = room.game.getGameStats();
  const playerCount = room.players.size;
  const winnerPlayer = room.players.get(winnerId);

  const totalPlayers = room.players.size;
  const positionMap = calculateFinishPositions(winnerId, room.eliminationOrder, room.players.keys());

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

  // Track each player's starting position vs outcome for balance analysis.
  // initialTurnOrder was captured at game start; we now know who won.
  if (room.initialTurnOrder.length > 0) {
    for (let i = 0; i < room.initialTurnOrder.length; i++) {
      const pid = room.initialTurnOrder[i]!;
      track('game:player_starting_position', {
        playerId: pid,
        playerCount: room.initialTurnOrder.length,
        startingIndex: i,
        won: pid === winnerId,
        roomCode: room.roomCode,
      }, room.playerUserIds.get(pid) ?? null);
    }
  }

  // Capture round snapshots synchronously before the async chain — a rematch
  // can replace room.game before the .then() callback fires, which would cause
  // us to read snapshots from the new (empty) engine instead of the completed game.
  const replaySnapshots = room.game ? room.game.getRoundSnapshots() : [];

  // Fire-and-forget — game persistence must never block or crash the game
  persistGameResult(record, preGeneratedGameId)
    .then((gameId) => {
      if (!gameId) return;

      // Persist round snapshots for replay after the game row exists (FK constraint)
      if (replaySnapshots.length > 0) {
        persistReplayRounds(gameId, replaySnapshots).catch(() => {
          // Error already logged inside persistReplayRounds
        });
      }

      // Update ranked ratings and persist ranked match record if this was a
      // ranked game with authenticated players. Chained after persistGameResult
      // so we have the gameId for rating_history and ranked_matches FKs.
      if (room.settings.ranked && room.settings.rankedMode) {
        const rankedMode: RankedMode = room.settings.rankedMode;
        const rankedPlayers = record.players
          .filter(p => p.userId !== null)
          .map(p => ({ userId: p.userId!, finishPosition: p.finishPosition }));

        if (rankedPlayers.length >= 2) {
          // Calculate bot fraction: proportion of opponents that are bots.
          // Only count non-authenticated players as bots for weighting purposes.
          const totalPlayers = record.players.length;
          const humanPlayers = rankedPlayers.length;
          const botCount = totalPlayers - humanPlayers;
          // Each human's opponents = totalPlayers - 1; botFraction = bots / opponents
          const botFraction = totalPlayers > 1 ? botCount / (totalPlayers - 1) : 0;

          // Snapshot ratings before the update so we can store before/after in ranked_match_players
          const ratingsBefore = new Map<string, { elo?: number; mu?: number; sigma?: number }>();
          Promise.all(
            rankedPlayers.map(async (p) => {
              const rating = await getRating(p.userId, rankedMode);
              if (rating) {
                if (rating.mode === 'heads_up') {
                  ratingsBefore.set(p.userId, { elo: rating.elo });
                } else {
                  ratingsBefore.set(p.userId, { mu: rating.mu, sigma: rating.sigma });
                }
              }
            }),
          )
            .then(() => updateRatingsAfterGame(rankedMode, rankedPlayers, gameId, botFraction))
            .then(async () => {
              // Read post-update ratings for the "after" snapshot
              const ratingsAfter = new Map<string, { elo?: number; mu?: number; sigma?: number }>();
              await Promise.all(
                rankedPlayers.map(async (p) => {
                  const rating = await getRating(p.userId, rankedMode);
                  if (rating) {
                    if (rating.mode === 'heads_up') {
                      ratingsAfter.set(p.userId, { elo: rating.elo });
                    } else {
                      ratingsAfter.set(p.userId, { mu: rating.mu, sigma: rating.sigma });
                    }
                  }
                }),
              );

              // Build player data for all players (including bots)
              const matchPlayers: RankedMatchPlayerData[] = record.players.map(p => {
                const isBot = !rankedPlayers.some(rp => rp.userId === p.userId);
                const userId = p.userId ?? p.playerId;
                const before = p.userId ? ratingsBefore.get(p.userId) : undefined;
                const after = p.userId ? ratingsAfter.get(p.userId) : undefined;
                return {
                  userId,
                  displayName: p.playerName,
                  finishPosition: p.finishPosition,
                  isBot,
                  eloBefore: before?.elo,
                  eloAfter: after?.elo,
                  muBefore: before?.mu,
                  sigmaBefore: before?.sigma,
                  muAfter: after?.mu,
                  sigmaAfter: after?.sigma,
                };
              });

              await persistRankedMatch({
                gameId,
                mode: rankedMode,
                playerCount: record.players.length,
                humanPlayerCount: humanPlayers,
                fromMatchmaking: false, // TODO(scale): wire up when matchmaking is implemented
                settings: record.settings,
                startedAt: record.startedAt,
                players: matchPlayers,
              });
            })
            .catch((err: unknown) => {
              logger.error({ err, gameId }, 'Failed to update ratings or persist ranked match');
            });
        }
      }
    })
    .catch(() => {
      // Error already logged inside persistGameResult
    });
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

  // Calculate bot weight for preview deltas (same formula as updateRatingsAfterGame)
  const totalPlayerCount = room.players.size;
  const authenticatedCount = [...room.players.keys()].filter(pid => room.playerUserIds.get(pid)).length;
  const botCount = totalPlayerCount - authenticatedCount;
  const botFraction = totalPlayerCount > 1 ? botCount / (totalPlayerCount - 1) : 0;
  const weight = botFraction > 0 ? 1 - botFraction * (1 - BOT_MATCH_WEIGHT) : 1;

  try {
    const positionMap = calculateFinishPositions(winnerId, room.eliminationOrder, room.players.keys());

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

      const weightedWinDelta = Math.round(winResult.delta * weight);
      const weightedLoseDelta = Math.round(loseResult.delta * weight);
      result[winner.playerId] = { mode: 'heads_up', before: winnerElo, after: winnerElo + weightedWinDelta, delta: weightedWinDelta };
      result[loser.playerId] = { mode: 'heads_up', before: loserElo, after: loserElo + weightedLoseDelta, delta: weightedLoseDelta };
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
        const beforeMu = p.rating?.mode === 'multiplayer' ? p.rating.mu : OPENSKILL_DEFAULT_MU;
        const before = openSkillDisplayRating(beforeMu);
        const osResult = openSkillResults.find(r => r.userId === p.userId);
        // Apply bot weight to the mu delta
        const rawDelta = osResult ? osResult.mu - beforeMu : 0;
        const weightedMu = beforeMu + rawDelta * weight;
        const after = openSkillDisplayRating(weightedMu);
        result[p.playerId] = { mode: 'multiplayer', before, after, delta: after - before };
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  } catch (err) {
    logger.error({ err }, 'Failed to compute rating changes for game:over');
    return undefined;
  }
}
