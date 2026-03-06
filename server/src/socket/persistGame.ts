import type { PlayerId } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import { persistGameResult } from '../db/games.js';
import type { GameRecord } from '../db/games.js';

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
  persistGameResult(record).catch(() => {
    // Error already logged inside persistGameResult
  });
}
