import type { Server } from 'socket.io';
import {
  GamePhase, BOT_THINK_DELAY_MIN, BOT_THINK_DELAY_MAX, BOT_NAMES,
  MAX_PLAYERS, BotDifficulty,
} from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, PlayerId } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { TurnResult } from './GameEngine.js';
import { BotPlayer } from './BotPlayer.js';
import { handleTurnResult } from '../socket/turnTimer.js';

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

    // Fallback if bot made invalid move
    if (result.type === 'error' && room.game) {
      const currentId = room.game.currentPlayerId;
      const player = room.players.get(currentId);
      if (player?.isBot) {
        result = room.game.handleBull(currentId);
        if (result.type === 'error') {
          result = room.game.handleLastChancePass(currentId);
        }
      }
    }

    if (result.type !== 'error') {
      handleTurnResult(io, room, result, this);
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
