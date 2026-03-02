import type { Server } from 'socket.io';
import { GamePhase } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, RoundResult, PlayerId } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { BotManager } from '../game/BotManager.js';
import { broadcastGameState, broadcastNewRound } from './broadcast.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
const ROUND_CONTINUE_TIMEOUT_MS = 30_000;
const POST_RESOLVE_GRACE_MS = 5_000;

function startNextRound(io: TypedServer, room: Room, botManager: BotManager): void {
  // Guard against double execution — the timeout and the last player's
  // "continue" can both fire startNextRound if they race.
  if (room.gamePhase !== GamePhase.ROUND_RESULT) return;
  room.cancelRoundContinueWindow();
  const nextResult = room.game!.startNextRound();
  if (nextResult.type === 'game_over') {
    room.gamePhase = GamePhase.GAME_OVER;
    io.to(room.roomCode).emit('game:over', nextResult.winnerId, room.game!.getGameStats());
    return;
  }

  room.gamePhase = GamePhase.PLAYING;
  broadcastNewRound(io, room);
  botManager.scheduleBotTurn(room, io, POST_RESOLVE_GRACE_MS);
  broadcastGameState(io, room);
}

export function beginRoundResultPhase(
  io: TypedServer,
  room: Room,
  botManager: BotManager,
  result: RoundResult,
): void {
  if (!room.game) return;

  room.game.setTurnDeadline(null);
  broadcastGameState(io, room);

  room.gamePhase = GamePhase.ROUND_RESULT;
  io.to(room.roomCode).emit('game:roundResult', result);

  room.beginRoundContinueWindow(ROUND_CONTINUE_TIMEOUT_MS, () => {
    startNextRound(io, room, botManager);
  });

  if (room.isRoundContinueComplete) {
    startNextRound(io, room, botManager);
  }
}

export function markContinueReady(
  io: TypedServer,
  room: Room,
  botManager: BotManager,
  playerId: PlayerId,
): void {
  if (room.gamePhase !== GamePhase.ROUND_RESULT) return;
  room.markRoundContinueReady(playerId);
  if (room.isRoundContinueComplete) {
    startNextRound(io, room, botManager);
  }
}
