import type { Server } from 'socket.io';
import {
  GamePhase, RoundPhase, HandType, BOT_THINK_DELAY_MIN, BOT_THINK_DELAY_MAX, BOT_NAMES,
  MAX_PLAYERS, BotDifficulty, BOT_BULL_DELAY_MIN, BOT_BULL_DELAY_MAX,
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
   * If the current player is human, schedule their turn timer (if enabled).
   */
  scheduleBotTurn(room: Room, io: TypedServer): void {
    if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;

    const currentId = room.game.currentPlayerId;
    const player = room.players.get(currentId);
    if (!player) return;

    if (player.isBot) {
      const state = room.game.getClientState(currentId);
      const inBullPhase = state.roundPhase === RoundPhase.BULL_PHASE
        || state.roundPhase === RoundPhase.LAST_CHANCE;
      const delay = inBullPhase
        ? this.computeBullDelay()
        : this.computeBotDelay(room);

      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        this.executeBotTurn(room, io, currentId);
      }, delay);
      this.pendingTimers.add(timer);
    } else {
      this.scheduleHumanTurnTimer(room, io, currentId);
    }
  }

  private scheduleHumanTurnTimer(room: Room, io: TypedServer, playerId: PlayerId): void {
    if (!room.game) return;
    const timerSeconds = room.settings.turnTimer;
    if (!timerSeconds || timerSeconds <= 0) {
      room.game.setTurnDeadline(null);
      return;
    }

    const deadline = Date.now() + timerSeconds * 1000;
    room.game.setTurnDeadline(deadline);

    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.executeAutoAction(room, io, playerId);
    }, timerSeconds * 1000);
    this.pendingTimers.add(timer);
  }

  private executeAutoAction(room: Room, io: TypedServer, playerId: PlayerId): void {
    if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;
    if (room.game.currentPlayerId !== playerId) return;

    const state = room.game.getClientState(playerId);
    let result: TurnResult;

    if (state.roundPhase === RoundPhase.LAST_CHANCE) {
      result = room.game.handleLastChancePass(playerId);
    } else if (state.roundPhase === RoundPhase.BULL_PHASE) {
      result = room.game.handleBull(playerId);
    } else if (state.roundPhase === RoundPhase.CALLING && state.currentHand) {
      result = room.game.handleBull(playerId);
    } else {
      result = room.game.handleCall(playerId, { type: HandType.HIGH_CARD, rank: '2' });
    }

    if (result.type !== 'error') {
      this.handleBotResult(io, room, result);
    }
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
    // For IMPOSSIBLE difficulty, bots see their own cards + human players' cards (not other bots')
    const visibleCards = this.difficulty === BotDifficulty.IMPOSSIBLE
      ? [...room.players.values()]
          .filter(p => !p.isEliminated && (!p.isBot || p.id === botId))
          .flatMap(p => p.cards)
      : undefined;
    const decision = BotPlayer.decideAction(state, botId, botPlayer.cards, this.difficulty, visibleCards);

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
        if (room.game) room.game.setTurnDeadline(null);
        // Schedule next turn first (sets deadline for human), then broadcast
        this.scheduleBotTurn(room, io);
        broadcastGameState(io, room);
        break;

      case 'resolve':
        if (room.game) room.game.setTurnDeadline(null);
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
            // Schedule before broadcast so deadline is included in state
            this.scheduleBotTurn(room, io);
            broadcastNewRound(io, room);
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

  private computeBullDelay(): number {
    return BOT_BULL_DELAY_MIN + Math.floor(Math.random() * (BOT_BULL_DELAY_MAX - BOT_BULL_DELAY_MIN));
  }

  private computeBotDelay(room: Room): number {
    if (!room.game) return BOT_THINK_DELAY_MIN;

    const state = room.game.getClientState('__delay_calc__');
    const activePlayers = state.players.filter(p => !p.isEliminated);
    const totalCards = activePlayers.reduce((sum, p) => sum + p.cardCount, 0);
    const turnCount = state.turnHistory.length;

    // Base: 2-3.5s random
    const base = 2000 + Math.floor(Math.random() * 1500);

    // More total cards = more to think about (+0-2s)
    const cardsFactor = Math.min(totalCards / 20, 1) * 2000;

    // Later in the round = more pressure, think longer (+0-1.5s)
    const roundDepth = Math.min(turnCount / (activePlayers.length * 2), 1) * 1500;

    // Some randomness so bots don't feel robotic (±500ms)
    const jitter = (Math.random() - 0.5) * 1000;

    const delay = Math.round(base + cardsFactor + roundDepth + jitter);
    return Math.max(BOT_THINK_DELAY_MIN, Math.min(delay, 7000));
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
