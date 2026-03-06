import type { PlayerId, RankedMode } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import { persistGameResult } from '../db/games.js';
import type { GameRecord } from '../db/games.js';
import { persistReplayRounds } from '../db/replays.js';
import { updateRatingsAfterGame } from '../db/ratings.js';

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
