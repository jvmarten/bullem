import type { Server } from 'socket.io';
import {
  GamePhase, RoundPhase, HandType, BOT_THINK_DELAY_MIN, BOT_THINK_DELAY_MAX,
  MAX_PLAYERS, BotDifficulty, BOT_BULL_DELAY_MIN, BOT_BULL_DELAY_MAX, DEFAULT_BOT_DIFFICULTY,
  maxPlayersForMaxCards, BOT_SPEED_MULTIPLIERS, BotSpeed, DEFAULT_BOT_SPEED,
  pickRandomBot, IMPOSSIBLE_BOT, CFR_BOT_MAP, BOT_NAME_TO_USER_ID,
} from '@bull-em/shared';
import type { BotLevelCategory } from '@bull-em/shared';
import type { ClientToServerEvents, ServerToClientEvents, PlayerId, BotProfileConfig } from '@bull-em/shared';
import type { Room } from '../rooms/Room.js';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { TurnResult } from './GameEngine.js';
import { BotPlayer } from './BotPlayer.js';
import { broadcastGameState, broadcastGameReplay } from '../socket/broadcast.js';
import { beginRoundResultPhase, handleSetOver } from '../socket/roundTransition.js';
import { persistCompletedGame } from '../socket/persistGame.js';

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
  /** Per-room generation counter. Incremented on every scheduleBotTurn /
   *  clearTurnTimer call so that stale timer callbacks (from a previous
   *  scheduling cycle) can detect they're outdated and bail out. Prevents
   *  race conditions when two rapid events both trigger scheduling. */
  private roomTimerGeneration = new Map<string, number>();
  private difficulty: BotDifficulty = DEFAULT_BOT_DIFFICULTY as BotDifficulty;
  private roomManager!: RoomManager;
  /** Profile configs for ranked bots, keyed by in-game player ID.
   *  Only populated for bots added via addRankedBot. */
  private botProfileConfigs = new Map<string, BotProfileConfig>();
  /** Database user IDs for ranked bots, keyed by in-game player ID. */
  private botUserIds = new Map<string, string>();
  /** Set of bot IDs that use CFR strategy instead of heuristic logic. */
  private cfrBotIds = new Set<string>();

  /** Attach a RoomManager reference for Redis persistence after bot actions.
   *  Must be called before any bot actions are processed. */
  setRoomManager(rm: RoomManager): void {
    this.roomManager = rm;
  }

  clearTurnTimer(roomCode: string): void {
    // Bump generation so any in-flight timer callbacks for this room become stale
    this.bumpGeneration(roomCode);

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

  /** Increment and return the generation counter for a room. */
  private bumpGeneration(roomCode: string): number {
    const next = (this.roomTimerGeneration.get(roomCode) ?? 0) + 1;
    this.roomTimerGeneration.set(roomCode, next);
    return next;
  }

  setDifficulty(difficulty: BotDifficulty): void {
    this.difficulty = difficulty;
  }

  addBot(room: Room, botName?: string, opts?: { username?: string }): string {
    const cardBased = maxPlayersForMaxCards(room.settings.maxCards, room.settings.jokerCount ?? 0);
    const userCap = room.settings.maxPlayers ?? MAX_PLAYERS;
    const effectiveMax = Math.min(MAX_PLAYERS, cardBased, userCap);
    if (room.playerCount >= effectiveMax) {
      throw new Error('Room is full');
    }
    if (room.gamePhase !== GamePhase.LOBBY) {
      throw new Error('Cannot add bots during a game');
    }

    const name = botName || this.pickBotName(room);

    // Only one Oracle allowed per match
    if (name === IMPOSSIBLE_BOT.name) {
      const hasOracle = [...room.players.values()].some(p => p.name === IMPOSSIBLE_BOT.name);
      if (hasOracle) {
        throw new Error('Only one Oracle allowed per match');
      }
    }

    const botId = `bot-${++botCounter}`;
    room.addBot(botId, name, { username: opts?.username });

    // Always link the bot's database user ID so clients can fetch lifetime stats
    const dbUserId = BOT_NAME_TO_USER_ID.get(name);
    if (dbUserId) {
      room.setPlayerUserId(botId, dbUserId);
    }

    // Track CFR bots by checking if the name matches a CFR profile
    for (const [, profile] of CFR_BOT_MAP) {
      if (profile.name === name) {
        this.cfrBotIds.add(botId);
        break;
      }
    }

    return botId;
  }

  /**
   * Add a ranked bot with a persistent database identity and profile config.
   * Used by matchmaking to fill slots with rated bot profiles.
   *
   * @param room - The room to add the bot to
   * @param userId - The bot's database user ID (from the users table)
   * @param botName - Display name for the bot
   * @param profileConfig - Profile config that tunes BotPlayer decision logic
   * @param username - The bot's DB username (e.g., "cfr_phantom") for profile linking
   * @returns The in-game player ID assigned to the bot
   */
  addRankedBot(room: Room, userId: string, botName: string, profileConfig: BotProfileConfig, username?: string): string {
    const botId = this.addBot(room, botName, { username });
    this.botProfileConfigs.set(botId, profileConfig);
    this.botUserIds.set(botId, userId);
    // Link the bot's in-game ID to its database user ID for rating updates
    room.setPlayerUserId(botId, userId);
    return botId;
  }

  /** Get the profile config for a ranked bot, if one was set. */
  getBotProfileConfig(botId: string): BotProfileConfig | undefined {
    return this.botProfileConfigs.get(botId);
  }

  /** Get the database user ID for a ranked bot, if one was set. */
  getBotUserId(botId: string): string | undefined {
    return this.botUserIds.get(botId);
  }

  removeBot(room: Room, botId: string): void {
    room.removeBot(botId);
    this.botProfileConfigs.delete(botId);
    this.botUserIds.delete(botId);
    this.cfrBotIds.delete(botId);
  }

  /** Clean up all bot profile configs and user IDs for bots in a room.
   *  Call when a room is being deleted to prevent unbounded memory growth
   *  from ranked bot entries that are never reused. */
  cleanupRoomBots(room: Room): void {
    for (const [playerId, player] of room.players) {
      if (player.isBot) {
        this.botProfileConfigs.delete(playerId);
        this.botUserIds.delete(playerId);
        this.cfrBotIds.delete(playerId);
      }
    }
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

    // Capture the current generation — timer callbacks check this to detect
    // if a newer scheduling cycle has superseded them.
    const generation = this.roomTimerGeneration.get(room.roomCode) ?? 0;

    if (player.isBot) {
      // Use lightweight currentRoundPhase instead of building full client state
      // just to check the phase — avoids O(players) map + history copy.
      const phase = room.game.currentRoundPhase;
      const inBullPhase = phase === RoundPhase.BULL_PHASE
        || phase === RoundPhase.LAST_CHANCE;
      const speedMultiplier = BOT_SPEED_MULTIPLIERS[room.settings.botSpeed ?? (DEFAULT_BOT_SPEED as BotSpeed)];
      const delay = inBullPhase
        ? this.computeBullDelay(speedMultiplier)
        : this.computeBotDelay(room, speedMultiplier);

      // Only show TileMeter countdown on bot tiles when a turn timer is
      // configured — if the timer is off, there's nothing to count down.
      const timerSeconds = room.settings.turnTimer;
      if (timerSeconds && timerSeconds > 0) {
        room.game.setTurnDeadline(Date.now() + delay + graceMs, timerSeconds * 1000);
      }

      const timer = setTimeout(() => {
        this.pendingTimers.delete(timer);
        this.roomTurnTimers.delete(room.roomCode);
        // Stale check: if generation has advanced, a newer schedule superseded this one
        if (this.roomTimerGeneration.get(room.roomCode) !== generation) return;
        this.executeBotTurn(room, io, currentId);
      }, delay + graceMs);
      this.pendingTimers.add(timer);
      this.roomTurnTimers.set(room.roomCode, timer);
    } else {
      this.scheduleHumanTurnTimer(room, io, currentId, graceMs, generation);
      // If the player is disconnected and no turn timer is configured,
      // scheduleHumanTurnTimer is a no-op. Schedule an auto-action so the
      // game doesn't stall waiting for a player who may never return.
      if (!player.isConnected && !room.settings.turnTimer) {
        this.scheduleDisconnectAutoAction(room, io, currentId, generation);
      }
    }
  }

  /** Schedule an auto-action for a disconnected player who has no turn timer.
   *  Tracked per-room so clearTurnTimer cancels it if the turn advances. */
  scheduleDisconnectAutoAction(room: Room, io: TypedServer, playerId: PlayerId, generation?: number): void {
    // Cancel any existing disconnect timer for this room first
    const existing = this.roomDisconnectTimers.get(room.roomCode);
    if (existing) {
      clearTimeout(existing);
      this.pendingTimers.delete(existing);
    }
    const gen = generation ?? (this.roomTimerGeneration.get(room.roomCode) ?? 0);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.roomDisconnectTimers.delete(room.roomCode);
      if (this.roomTimerGeneration.get(room.roomCode) !== gen) return;
      this.executeAutoAction(room, io, playerId);
    }, DISCONNECT_AUTO_ACTION_MS);
    this.pendingTimers.add(timer);
    this.roomDisconnectTimers.set(room.roomCode, timer);
  }

  private scheduleHumanTurnTimer(room: Room, io: TypedServer, playerId: PlayerId, graceMs = 0, generation?: number): void {
    if (!room.game) return;
    const timerSeconds = room.settings.turnTimer;
    if (!timerSeconds || timerSeconds <= 0) {
      room.game.setTurnDeadline(null);
      return;
    }

    const totalMs = timerSeconds * 1000 + graceMs;
    const fullDurationMs = timerSeconds * 1000;
    const deadline = Date.now() + totalMs;
    room.game.setTurnDeadline(deadline, fullDurationMs);

    const gen = generation ?? (this.roomTimerGeneration.get(room.roomCode) ?? 0);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(timer);
      this.roomTurnTimers.delete(room.roomCode);
      if (this.roomTimerGeneration.get(room.roomCode) !== gen) return;
      this.executeAutoAction(room, io, playerId, true);
    }, totalMs);
    this.pendingTimers.add(timer);
    this.roomTurnTimers.set(room.roomCode, timer);
  }

  private executeAutoAction(room: Room, io: TypedServer, playerId: PlayerId, isTimerExpiry = false): void {
    this.clearTurnTimer(room.roomCode);
    if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;

    // If this is a disconnect auto-action (not a turn timer expiry) and the
    // player reconnected since it was scheduled, don't force a move on a
    // connected player who is actively playing.  Turn timer expiries always
    // execute — the player ran out of time regardless of connection status.
    const player = room.players.get(playerId);
    if (!isTimerExpiry && player?.isConnected && !player.isBot) return;

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
    this.roomTimerGeneration.clear();
    this.botProfileConfigs.clear();
    this.botUserIds.clear();
    this.cfrBotIds.clear();
  }

  private executeBotTurn(room: Room, io: TypedServer, botId: PlayerId): void {
    if (!room.game || room.gamePhase !== GamePhase.PLAYING) return;

    // Verify it's still this bot's turn
    if (room.game.currentPlayerId !== botId) return;

    const botPlayer = room.players.get(botId);
    if (!botPlayer || !botPlayer.isBot) return;

    const state = room.game.getClientState(botId);
    // Use IMPOSSIBLE difficulty if this bot is The Oracle (by name) or if global difficulty is IMPOSSIBLE
    const effectiveDifficulty = botPlayer.name === IMPOSSIBLE_BOT.name
      ? BotDifficulty.IMPOSSIBLE
      : this.difficulty;
    // The Oracle sees ALL cards — every player's hand including other bots'
    const visibleCards = effectiveDifficulty === BotDifficulty.IMPOSSIBLE
      ? [...room.players.values()]
          .filter(p => !p.isEliminated)
          .flatMap(p => p.cards)
      : undefined;
    // Use profile config for ranked bots, undefined for casual bots (preserves default behavior)
    const profileConfig = this.botProfileConfigs.get(botId);
    const isCFR = this.cfrBotIds.has(botId);
    const memoryScope = room.currentGameId ?? room.roomCode;
    const decision = BotPlayer.decideAction(state, botId, botPlayer.cards, effectiveDifficulty, visibleCards, memoryScope, profileConfig, isCFR, room.settings);

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
        beginRoundResultPhase(io, room, this, result.result, this.roomManager);
        break;
      }

      case 'game_over':
        if (result.finalRoundResult) {
          // Show the final round result before ending the game
          if (room.game) room.game.setTurnDeadline(null);
          broadcastGameState(io, room);
          room.lastRoundResult = result.finalRoundResult;
          io.to(room.roomCode).emit('game:roundResult', result.finalRoundResult);
          room.recordEliminations(result.finalRoundResult.eliminatedPlayerIds);
        }
        room.cancelRoundContinueWindow();
        // Use series-aware handler which checks if the match continues
        handleSetOver(io, room, this.roomManager, this, result.winnerId);
        break;
    }
    // Persist after every bot action that mutated game state
    if (result.type !== 'error') {
      this.roomManager.persistRoom(room);
    }
  }

  private computeBullDelay(speedMultiplier: number): number {
    const base = BOT_BULL_DELAY_MIN + Math.floor(Math.random() * (BOT_BULL_DELAY_MAX - BOT_BULL_DELAY_MIN));
    return Math.round(base * speedMultiplier);
  }

  private computeBotDelay(room: Room, speedMultiplier: number): number {
    if (!room.game) return Math.round(BOT_THINK_DELAY_MIN * speedMultiplier);

    // Use lightweight summary instead of building a full ClientGameState
    const { activePlayerCount, totalCards, turnCount } = room.game.getRoundSummary();

    // Base: 2-3.5s random
    const base = 2000 + Math.floor(Math.random() * 1500);

    // More total cards = more to think about (+0-2s)
    const cardsFactor = Math.min(totalCards / 20, 1) * 2000;

    // Later in the round = more pressure, think longer (+0-1.5s)
    const roundDepth = Math.min(turnCount / (activePlayerCount * 2), 1) * 1500;

    // Some randomness so bots don't feel robotic (±500ms)
    const jitter = (Math.random() - 0.5) * 1000;

    const raw = Math.round(base + cardsFactor + roundDepth + jitter);
    const delay = Math.round(raw * speedMultiplier);
    return Math.max(Math.round(BOT_THINK_DELAY_MIN * speedMultiplier), Math.min(delay, Math.round(7000 * speedMultiplier)));
  }

  private pickBotName(room: Room): string {
    const usedNames = new Set(
      [...room.players.values()].map(p => p.name)
    );
    const category: BotLevelCategory = room.settings.botLevelCategory ?? 'normal';
    const bot = pickRandomBot(category, usedNames);
    if (bot) return bot.name;
    // Fallback: try any category if the specific one is exhausted
    const anyBot = pickRandomBot('mixed', usedNames);
    if (anyBot) return anyBot.name;
    return `Bot ${botCounter + 1}`;
  }
}
