import type { Server } from 'socket.io';
import {
  GamePhase, RoundPhase, HandType, BOT_THINK_DELAY_MIN, BOT_THINK_DELAY_MAX, BOT_NAMES,
  MAX_PLAYERS, BotDifficulty, BOT_BULL_DELAY_MIN, BOT_BULL_DELAY_MAX, DEFAULT_BOT_DIFFICULTY,
  maxPlayersForMaxCards,
} from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, PlayerId } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { TurnResult } from './GameEngine.js';
import { BotPlayer } from './BotPlayer.js';
import { broadcastGameState } from '../socket/broadcast.js';
import { beginRoundResultPhase } from '../socket/roundTransition.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** Timeout for disconnected players when no turn timer is configured */
const DISCONNECT_AUTO_ACTION_MS = 10_000;

let botCounter = 0;

export class BotManager {
  private pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private roomTurnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Separate timers for disconnected-player auto-actions, keyed by roomCode.
   *  Tracked separately so clearTurnTimer cancels them alongside the main turn timer. */
  private roomDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private difficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY as BotDifficulty;

  clearTurnTimer(roomCode: string): void {
    const existing = this.roomTurnTimers.get(roomCode);
    if (existing) {
      clearTimeout(existing);
      this.pendingTimers.delete(existing);
      this.roomTurnTimers.delete(roomCode);
    }
    // Also cancel any pending disconnect auto-action for this room
    const disconnectTimer = this.roomDisconnectTimers.get(roomCode);
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      this.pendingTimers.delete(disconnectTimer);
      this.roomDisconnectTimers.delete(roomCode);
    }
  }

  setDifficulty(difficulty: BotDifficulty): void {
    this.difficulty = difficulty;
  }

  addBot(room: Room, botName?: string): string {
    const cardBased = maxPlayersForMaxCards(room.settings.maxCards);
    const userCap = room.settings.maxPlayers ?? MAX_PLAYERS;
    const effectiveMax = Math.min(MAX_PLAYERS, cardBased, userCap);
    if (room.playerCount >= effectiveMax) {
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
  scheduleBotTurn(room: Room, io: TypedServer, graceMs = 0): void {
    if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;
    this.clearTurnTimer(room.roomCode);

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
        this.roomTurnTimers.delete(room.roomCode);
        this.executeBotTurn(room, io, currentId);
      }, delay + graceMs);
      this.pendingTimers.add(timer);
      this.roomTurnTimers.set(room.roomCode, timer);
    } else {
      this.scheduleHumanTurnTimer(room, io, currentId, graceMs);
      // If the player is disconnected and no turn timer is configured,
      // scheduleHumanTurnTimer is a no-op. Schedule an auto-action so the
      // game doesn't stall waiting for a player who may never return.
      if (!player.isConnected && !room.settings.turnTimer) {
        this.scheduleDisconnectAutoAction(room, io, currentId);
      }
    }
  }

  /** Schedule an auto-action for a disconnected player who has no turn timer.
   *  Tracked per-room so clearTurnTimer cancels it if the turn advances. */
  scheduleDisconnectAutoAction(room: Room, io: TypedServer, playerId: PlayerId): void {
    // Cancel any existing disconnect timer for this room first
    const existing = this.roomDisconnectTimers.get(room.roomCode);
    if (existing) {
      clearTimeout(existing);
      this.pendingTimers.delete(existing);
    }
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.roomDisconnectTimers.delete(room.roomCode);
      this.executeAutoAction(room, io, playerId);
    }, DISCONNECT_AUTO_ACTION_MS);
    this.pendingTimers.add(timer);
    this.roomDisconnectTimers.set(room.roomCode, timer);
  }

  private scheduleHumanTurnTimer(room: Room, io: TypedServer, playerId: PlayerId, graceMs = 0): void {
    if (!room.game) return;
    const timerSeconds = room.settings.turnTimer;
    if (!timerSeconds || timerSeconds <= 0) {
      room.game.setTurnDeadline(null);
      return;
    }

    const totalMs = timerSeconds * 1000 + graceMs;
    const deadline = Date.now() + totalMs;
    room.game.setTurnDeadline(deadline);

    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.roomTurnTimers.delete(room.roomCode);
      this.executeAutoAction(room, io, playerId);
    }, totalMs);
    this.pendingTimers.add(timer);
    this.roomTurnTimers.set(room.roomCode, timer);
  }

  private executeAutoAction(room: Room, io: TypedServer, playerId: PlayerId): void {
    this.clearTurnTimer(room.roomCode);
    if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;

    // If the player reconnected since this auto-action was scheduled (e.g. a
    // disconnect auto-action timer that wasn't cancelled), don't force a move
    // on a connected player who is actively playing.
    const player = room.players.get(playerId);
    if (player?.isConnected && !player.isBot) return;

    if (room.game.currentPlayerId !== playerId) {
      // The player was already eliminated (e.g., by the disconnect timer) and
      // the turn moved on. Re-schedule for the new current player so the game
      // doesn't stall.
      this.scheduleBotTurn(room, io);
      broadcastGameState(io, room);
      return;
    }

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
    this.roomTurnTimers.clear();
    this.roomDisconnectTimers.clear();
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

      case 'resolve': {
        beginRoundResultPhase(io, room, this, result.result);
        break;
      }

      case 'game_over':
        if (result.finalRoundResult) {
          // Show the final round result before ending the game
          if (room.game) room.game.setTurnDeadline(null);
          broadcastGameState(io, room);
          io.to(room.roomCode).emit('game:roundResult', result.finalRoundResult);
        }
        room.gamePhase = GamePhase.GAME_OVER;
        room.cancelRoundContinueWindow();
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
