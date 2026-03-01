import type { Server } from 'socket.io';
import {
  GamePhase, BOT_THINK_DELAY_MIN, BOT_THINK_DELAY_MAX, BOT_NAMES,
  MAX_PLAYERS, BotDifficulty,
} from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, PlayerId } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { TurnResult } from './GameEngine.js';
import { BotPlayer } from './BotPlayer.js';
import { broadcastGameState, broadcastNewRound } from '../socket/broadcast.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

let botCounter = 0;

export class BotManager {
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private difficulty: BotDifficulty = BotDifficulty.EASY;

  setDifficulty(difficulty: BotDifficulty): void {
    this.difficulty = difficulty;
  }

  addBot(room: Room, botName?: string): string {
    if (room.playerCount >= MAX_PLAYERS) {
      throw new Error('Room is full');
    }
    if (room.gamePhase !== GamePhase.LOBBY) {
      throw new Error('Cannot add bots during a game');
    }

    const name = botName || this.pickBotName(room);
    const botId = `bot-${++botCounter}`;
    room.addBot(botId, name);
    return botId;
  }

  removeBot(room: Room, botId: string): void {
    room.removeBot(botId);
  }

  /**
   * Check if the current player is a bot, and if so schedule their turn.
   */
  scheduleBotTurn(room: Room, io: TypedServer): void {
    if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;

    const currentId = room.game.currentPlayerId;
    const player = room.players.get(currentId);
    if (!player || !player.isBot) return;

    const delay = BOT_THINK_DELAY_MIN +
      Math.floor(Math.random() * (BOT_THINK_DELAY_MAX - BOT_THINK_DELAY_MIN));

    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.executeBotTurn(room, io, currentId);
    }, delay);
    this.pendingTimers.add(timer);
  }

  clearTimers(): void {
    for (const t of this.pendingTimers) clearTimeout(t);
    this.pendingTimers.clear();
  }

  private executeBotTurn(room: Room, io: TypedServer, botId: PlayerId): void {
    if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;

    // Verify it's still this bot's turn
    if (room.game.currentPlayerId !== botId) return;

    const botPlayer = room.players.get(botId);
    if (!botPlayer || !botPlayer.isBot) return;

    const state = room.game.getClientState(botId);
    const decision = BotPlayer.decideAction(state, botId, botPlayer.cards, this.difficulty);

    let result: TurnResult;
    switch (decision.action) {
      case 'call':
        result = room.game.handleCall(botId, decision.hand);
        break;
      case 'bull':
        result = room.game.handleBull(botId);
        break;
      case 'true':
        result = room.game.handleTrue(botId);
        break;
      case 'lastChanceRaise':
        result = room.game.handleLastChanceRaise(botId, decision.hand);
        break;
      case 'lastChancePass':
        result = room.game.handleLastChancePass(botId);
        break;
    }

    this.handleBotResult(io, room, result);
  }

  private handleBotResult(io: TypedServer, room: Room, result: TurnResult): void {
    switch (result.type) {
      case 'error':
        // Bot made an invalid move — try bull as fallback
        if (room.game) {
          const currentId = room.game.currentPlayerId;
          const player = room.players.get(currentId);
          if (player?.isBot) {
            const fallback = room.game.handleBull(currentId);
            if (fallback.type !== 'error') {
              this.handleBotResult(io, room, fallback);
              return;
            }
            // Try pass for last chance
            const passFallback = room.game.handleLastChancePass(currentId);
            if (passFallback.type !== 'error') {
              this.handleBotResult(io, room, passFallback);
              return;
            }
          }
        }
        break;

      case 'continue':
      case 'last_chance':
        broadcastGameState(io, room);
        // Check if the next player is also a bot
        this.scheduleBotTurn(room, io);
        break;

      case 'resolve':
        room.gamePhase = GamePhase.ROUND_RESULT;
        io.to(room.roomCode).emit('game:roundResult', result.result);
        // Start next round after a delay
        const resolveTimer = setTimeout(() => {
          this.pendingTimers.delete(resolveTimer);
          const nextResult = room.game!.startNextRound();
          if (nextResult.type === 'game_over') {
            room.gamePhase = GamePhase.GAME_OVER;
            io.to(room.roomCode).emit('game:over', nextResult.winnerId, room.game!.getGameStats());
          } else {
            room.gamePhase = GamePhase.PLAYING;
            broadcastNewRound(io, room);
            // Check if first player of new round is a bot
            this.scheduleBotTurn(room, io);
          }
        }, 3000);
        this.pendingTimers.add(resolveTimer);
        break;

      case 'game_over':
        room.gamePhase = GamePhase.GAME_OVER;
        io.to(room.roomCode).emit('game:over', result.winnerId, room.game!.getGameStats());
        break;
    }
  }

  private pickBotName(room: Room): string {
    const usedNames = new Set(
      [...room.players.values()].map(p => p.name)
    );
    for (const name of BOT_NAMES) {
      if (!usedNames.has(name)) return name;
    }
    return `Bot ${botCounter + 1}`;
  }
}
