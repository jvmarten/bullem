import type { Server } from 'socket.io';
import { GamePhase, BotPlayer } from '@bull-em/shared';
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
  // broadcastNewRound already sends per-player game state — no need to also
  // call broadcastGameState which would duplicate the same data to every socket.
  // Schedule the bot turn first so the human turn deadline is set before broadcast.
  botManager.scheduleBotTurn(room, io, POST_RESOLVE_GRACE_MS);
  broadcastNewRound(io, room);
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

  // Update cross-round bot memory with round outcome, scoped to this room
  BotPlayer.updateMemory(result, room.roomCode);

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
  // Idempotent: skip if already marked (prevents wasted isRoundContinueComplete checks)
  if (!room.markRoundContinueReady(playerId)) return;
  if (room.isRoundContinueComplete) {
    startNextRound(io, room, botManager);
  }
}

/** Re-check whether all remaining active players have continued (e.g. after
 *  a player is eliminated mid-ROUND_RESULT). Starts the next round if so. */
export function checkRoundContinueComplete(
  io: TypedServer,
  room: Room,
  botManager: BotManager,
): void {
  if (room.gamePhase !== GamePhase.ROUND_RESULT) return;
  if (room.isRoundContinueComplete) {
    startNextRound(io, room, botManager);
  }
}
