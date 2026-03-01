import type { Server } from 'socket.io';
import { GamePhase, RoundPhase, HandType } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { TurnResult } from '../game/GameEngine.js';
import type { BotManager } from '../game/BotManager.js';
import { broadcastGameState, broadcastNewRound } from './broadcast.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/**
 * After any turn advances (human or bot), call this to set up the turn timer
 * for the next human player, or let BotManager handle bot turns.
 */
export function scheduleNextTurn(io: TypedServer, room: Room, botManager: BotManager): void {
  room.clearTurnTimer();
  room.touch();

  if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;

  const currentPlayer = room.players.get(room.game.currentPlayerId);
  if (currentPlayer?.isBot) {
    broadcastGameState(io, room);
    botManager.scheduleBotTurn(room, io);
    return;
  }

  // Human player: schedule turn timer before broadcasting (so deadline is in state)
  const seconds = room.settings.turnTimerSeconds;
  if (seconds) {
    room.scheduleTurnTimer(seconds, () => {
      autoActForCurrentPlayer(io, room, botManager);
    });
  }
  broadcastGameState(io, room);
}

/**
 * Handle the result of any turn action and advance the game.
 * Used by both player actions, bot actions, and auto-timeout actions.
 */
export function handleTurnResult(
  io: TypedServer,
  room: Room,
  result: TurnResult,
  botManager: BotManager,
  onError?: (msg: string) => void,
): void {
  switch (result.type) {
    case 'error':
      onError?.(result.message);
      break;

    case 'continue':
    case 'last_chance':
      scheduleNextTurn(io, room, botManager);
      break;

    case 'resolve':
      room.clearTurnTimer();
      room.gamePhase = GamePhase.ROUND_RESULT;
      io.to(room.roomCode).emit('game:roundResult', result.result);
      setTimeout(() => {
        if (!room.game) return;
        const nextResult = room.game.startNextRound();
        if (nextResult.type === 'game_over') {
          room.gamePhase = GamePhase.GAME_OVER;
          io.to(room.roomCode).emit('game:over', nextResult.winnerId);
        } else {
          room.gamePhase = GamePhase.PLAYING;
          broadcastNewRound(io, room);
          // After new round broadcast, schedule next turn
          scheduleNextTurn(io, room, botManager);
        }
      }, 3000);
      break;

    case 'game_over':
      room.clearTurnTimer();
      room.gamePhase = GamePhase.GAME_OVER;
      io.to(room.roomCode).emit('game:over', result.winnerId);
      break;
  }
}

function autoActForCurrentPlayer(io: TypedServer, room: Room, botManager: BotManager): void {
  if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;

  const playerId = room.game.currentPlayerId;
  const state = room.game.getClientState(playerId);
  let result: TurnResult;

  if (state.roundPhase === RoundPhase.LAST_CHANCE) {
    result = room.game.handleLastChancePass(playerId);
  } else if (!state.currentHand) {
    // First call of the round — auto-call the lowest possible hand
    result = room.game.handleCall(playerId, { type: HandType.HIGH_CARD, rank: '2' });
  } else {
    result = room.game.handleBull(playerId);
  }

  handleTurnResult(io, room, result, botManager);
}
