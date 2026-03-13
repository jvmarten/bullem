import {
  GamePhase, STARTING_CARDS, DISCONNECT_TIMEOUT_MS, DEFAULT_ONLINE_GAME_SETTINGS,
  BotPlayer,
} from '@bull-em/shared';
import type {
  PlayerId, ServerPlayer, RoomState, ClientGameState, Player, GameSettings,
  SeriesState, AvatarId, AvatarBgColor, RoundResult,
} from '@bull-em/shared';
import { randomUUID } from 'crypto';
import { GameEngine, type TurnResult } from '../game/GameEngine.js';
import type { RoomSnapshot } from './RedisStore.js';

export class Room {
  readonly roomCode: string;
  players = new Map<PlayerId, ServerPlayer>();
  socketToPlayer = new Map<string, PlayerId>();
  playerToSocket = new Map<PlayerId, string>();
  /** Secret tokens per player for secure reconnection. Player IDs are visible
   *  to all clients in game state, so we need a separate secret that only the
   *  original player knows to prevent session hijacking during the disconnect
   *  window. */
  private reconnectTokens = new Map<PlayerId, string>();
  hostId: PlayerId = '';
  game: GameEngine | null = null;
  gamePhase = GamePhase.LOBBY;
  settings: GameSettings = { ...DEFAULT_ONLINE_GAME_SETTINGS };
  lastActivity = Date.now();
  private disconnectTimers = new Map<PlayerId, ReturnType<typeof setTimeout>>();

  private roundContinueReady = new Set<PlayerId>();
  private roundContinueTimer: ReturnType<typeof setTimeout> | null = null;
  /** Socket IDs of spectators watching this game */
  spectatorSockets = new Set<string>();
  /** Display names for spectator sockets (set when spectating or chatting). */
  spectatorNames = new Map<string, string>();
  /** When true, the room is exempt from stale-room cleanup (e.g., background bot game). */
  isBackgroundGame = false;
  /** Maps in-game player IDs to authenticated user IDs (null for guests). */
  playerUserIds = new Map<PlayerId, string>();
  /** Timestamp when the current game started (set by startGame/resetForRematch). */
  gameStartedAt: Date | null = null;
  /** Tracks elimination order for finish position calculation. First eliminated = last place. */
  eliminationOrder: PlayerId[] = [];
  /** O(1) lookup for eliminationOrder dedup — mirrors the array to avoid
   *  Array.includes() scans in recordEliminations(). */
  private _eliminationSet = new Set<PlayerId>();
  /** Series state for best-of matches. Null for single games. */
  seriesState: SeriesState | null = null;
  /** Initial turn order captured at game start, used for starting-position analytics. */
  initialTurnOrder: PlayerId[] = [];
  /** Unique ID for the current game instance. Used to scope bot memory so that
   *  reused room codes don't leak opponent profiles across separate games. */
  currentGameId: string | null = null;
  /** Cached round result for re-sending to reconnecting players during ROUND_RESULT phase. */
  lastRoundResult: RoundResult | null = null;
  /** Countdown state for re-sending to reconnecting players during the pre-game countdown.
   *  Stores the absolute deadline (Date.now() + seconds*1000) and optional label. */
  countdownDeadline: number | null = null;
  countdownLabel: string | undefined = undefined;

  constructor(roomCode: string) {
    this.roomCode = roomCode;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  /** O(1) host name lookup — avoids scanning the player map in room listings. */
  get hostName(): string {
    return this.players.get(this.hostId)?.name ?? '???';
  }

  addPlayer(socketId: string, playerId: PlayerId, name: string, opts?: { userId?: string; username?: string; avatar?: AvatarId | null; photoUrl?: string | null; avatarBgColor?: AvatarBgColor | null }): { player: ServerPlayer; reconnectToken: string } {
    const player: ServerPlayer = {
      id: playerId,
      name,
      cardCount: STARTING_CARDS,
      isConnected: true,
      isEliminated: false,
      isHost: this.players.size === 0,
      cards: [],
      userId: opts?.userId,
      username: opts?.username,
      avatar: opts?.avatar,
      photoUrl: opts?.photoUrl,
      avatarBgColor: opts?.avatarBgColor,
    };
    if (player.isHost) this.hostId = playerId;
    this.players.set(playerId, player);
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);
    const reconnectToken = randomUUID();
    this.reconnectTokens.set(playerId, reconnectToken);
    this.touch();
    return { player, reconnectToken };
  }

  addBot(botId: PlayerId, name: string, opts?: { username?: string }): ServerPlayer {
    const player: ServerPlayer = {
      id: botId,
      name,
      cardCount: STARTING_CARDS,
      isConnected: true,
      isEliminated: false,
      isHost: false,
      isBot: true,
      cards: [],
      username: opts?.username,
    };
    this.players.set(botId, player);
    return player;
  }

  removeBot(botId: PlayerId): void {
    const player = this.players.get(botId);
    if (!player || !player.isBot) return;
    this.players.delete(botId);
  }

  removePlayer(socketId: string): PlayerId | null {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return null;
    this.socketToPlayer.delete(socketId);
    this.playerToSocket.delete(playerId);
    this.players.delete(playerId);
    this.reconnectTokens.delete(playerId);
    this.playerUserIds.delete(playerId);

    // Reassign host if needed
    if (playerId === this.hostId && this.players.size > 0) {
      const newHost = this.players.values().next().value!;
      newHost.isHost = true;
      this.hostId = newHost.id;
    }
    return playerId;
  }

  /** Detach a player's socket without removing them from the room's player
   *  list. Used when a player intentionally leaves during an active game —
   *  keeping them in the players Map ensures their stats and userId are
   *  available for game persistence and rating updates when the game ends. */
  detachPlayer(socketId: string): PlayerId | null {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return null;
    const player = this.players.get(playerId);
    if (player) {
      player.isConnected = false;
    }
    this.socketToPlayer.delete(socketId);
    this.playerToSocket.delete(playerId);
    this.reconnectTokens.delete(playerId);

    // Clear any pending disconnect timer
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }

    // Reassign host if needed — prefer non-bot, non-eliminated players
    if (playerId === this.hostId) {
      let newHostId: PlayerId | null = null;
      for (const p of this.players.values()) {
        if (p.id !== playerId && !p.isBot && !p.isEliminated && p.isConnected) {
          newHostId = p.id;
          break;
        }
      }
      if (newHostId) {
        const newHost = this.players.get(newHostId)!;
        if (player) player.isHost = false;
        newHost.isHost = true;
        this.hostId = newHostId;
      }
    }
    return playerId;
  }

  handleDisconnect(socketId: string, onTimeout?: (playerId: PlayerId) => void): PlayerId | null {
    const playerId = this.socketToPlayer.get(socketId);
    if (!playerId) return null;

    const player = this.players.get(playerId);
    if (!player) return null;

    if (this.gamePhase === GamePhase.LOBBY) {
      return this.removePlayer(socketId);
    }

    // During game: mark disconnected, start timer
    player.isConnected = false;
    this.socketToPlayer.delete(socketId);
    this.playerToSocket.delete(playerId);

    // Clear any existing disconnect timer for this player before starting a
    // new one. Without this, a rapid reconnect → disconnect cycle could
    // overwrite the Map entry without clearing the old setTimeout, leaking a
    // timer that later fires a spurious elimination.
    const existing = this.disconnectTimers.get(playerId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      if (onTimeout) {
        onTimeout(playerId);
      } else {
        player.isEliminated = true;
      }
    }, DISCONNECT_TIMEOUT_MS);
    this.disconnectTimers.set(playerId, timer);

    return playerId;
  }

  /** Attempt to reconnect a player. Returns the new rotated reconnect token
   *  on success, or null on failure. Token rotation limits the window for
   *  a stolen token to be reused. */
  handleReconnect(socketId: string, playerId: PlayerId, reconnectToken?: string): string | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    // Only allow reconnection for actually disconnected players.
    if (player.isConnected) return null;

    // Verify the reconnect token to prevent session hijacking. Player IDs are
    // visible to all clients, so anyone could try to reconnect as a
    // disconnected player. The reconnect token is a secret shared only with
    // the original player at join time.
    const storedToken = this.reconnectTokens.get(playerId);
    if (!storedToken || storedToken !== reconnectToken) return null;

    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }

    player.isConnected = true;
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);

    // Rotate the reconnect token — the old token is now invalid, limiting
    // the window for a stolen token to be reused.
    const newToken = randomUUID();
    this.reconnectTokens.set(playerId, newToken);
    this.touch();
    return newToken;
  }

  /** Force-reconnect a player who still appears connected (stale socket).
   *  This handles the case where a browser is fully closed and reopened before
   *  Socket.io's ping timeout detects the stale connection. The reconnect token
   *  is validated to prevent hijacking. Returns the old socket ID and new token
   *  on success, or null if the token is invalid or the player is not found. */
  handleStaleSocketReconnect(newSocketId: string, playerId: PlayerId, reconnectToken?: string): { oldSocketId: string; reconnectToken: string } | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    // Only applies when the player appears connected (stale socket scenario).
    if (!player.isConnected) return null;

    // Verify the reconnect token — same security requirement as normal reconnect.
    const storedToken = this.reconnectTokens.get(playerId);
    if (!storedToken || storedToken !== reconnectToken) return null;

    const oldSocketId = this.playerToSocket.get(playerId);
    if (!oldSocketId || oldSocketId === newSocketId) return null;

    // Clear any pending disconnect timer for the old socket
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }

    // Swap to the new socket
    this.socketToPlayer.delete(oldSocketId);
    this.socketToPlayer.set(newSocketId, playerId);
    this.playerToSocket.set(playerId, newSocketId);

    // Rotate the reconnect token
    const newToken = randomUUID();
    this.reconnectTokens.set(playerId, newToken);
    this.touch();
    return { oldSocketId, reconnectToken: newToken };
  }


  /** Transfer an existing player's session to a new socket. Used when an
   *  authenticated user connects from a different device/tab while they already
   *  have an active connection in this room. Returns the old socket ID and a new
   *  rotated reconnect token on success, or null if no matching player found.
   *  The caller is responsible for notifying and disconnecting the old socket. */
  handleSessionTransfer(newSocketId: string, userId: string): { oldSocketId: string; playerId: PlayerId; reconnectToken: string } | null {
    // Find the player entry with the matching userId
    let targetPlayerId: PlayerId | null = null;
    for (const [pid, uid] of this.playerUserIds) {
      if (uid === userId) {
        targetPlayerId = pid;
        break;
      }
    }
    if (!targetPlayerId) return null;

    const player = this.players.get(targetPlayerId);
    if (!player) return null;

    const oldSocketId = this.playerToSocket.get(targetPlayerId);
    if (!oldSocketId) return null;

    // Player must be currently connected (otherwise normal reconnect handles it)
    if (!player.isConnected) return null;

    // Swap socket mappings: remove old, set new
    this.socketToPlayer.delete(oldSocketId);
    this.socketToPlayer.set(newSocketId, targetPlayerId);
    this.playerToSocket.set(targetPlayerId, newSocketId);

    // Clear any existing disconnect timer (shouldn't be one if connected, but be safe)
    const timer = this.disconnectTimers.get(targetPlayerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(targetPlayerId);
    }

    // Rotate reconnect token
    const newToken = randomUUID();
    this.reconnectTokens.set(targetPlayerId, newToken);
    this.touch();
    return { oldSocketId, playerId: targetPlayerId, reconnectToken: newToken };
  }

  beginRoundContinueWindow(timeoutMs: number, onTimeout: () => void): void {
    this.cancelRoundContinueWindow();
    this.roundContinueReady.clear();

    // Bots are ready instantly; humans can press Continue or auto-timeout.
    for (const p of this.players.values()) {
      if (!p.isEliminated && p.isBot) this.roundContinueReady.add(p.id);
    }

    this.roundContinueTimer = setTimeout(() => {
      this.roundContinueTimer = null;
      onTimeout();
    }, timeoutMs);
  }

  /** Mark a player as ready to continue. Returns false if already marked (idempotent). */
  markRoundContinueReady(playerId: PlayerId): boolean {
    const p = this.players.get(playerId);
    if (!p || p.isEliminated) return false;
    if (this.roundContinueReady.has(playerId)) return false;
    this.roundContinueReady.add(playerId);
    return true;
  }

  get isRoundContinueComplete(): boolean {
    let hasActive = false;
    for (const p of this.players.values()) {
      if (p.isEliminated) continue;
      hasActive = true;
      // Disconnected players can't press Continue — don't stall the round
      // waiting for them. The 3-minute disconnect timer handles their
      // elimination separately.
      if (p.isConnected && !p.isBot && !this.roundContinueReady.has(p.id)) return false;
    }
    return hasActive;
  }

  cancelRoundContinueWindow(): void {
    if (this.roundContinueTimer) {
      clearTimeout(this.roundContinueTimer);
      this.roundContinueTimer = null;
    }
    this.roundContinueReady.clear();
  }

  /** Clear all timers (disconnect, round continue) and bot memory. Call when the room is being destroyed. */
  cleanup(): void {
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    this.cancelRoundContinueWindow();
    // Free bot memory scoped to this game instance
    BotPlayer.resetMemory(this.currentGameId ?? this.roomCode);
  }

  /** Serialize the room to a JSON-safe snapshot for Redis persistence.
   *  Socket mappings and timers are NOT included — they are ephemeral.
   *  After restore, players will be marked disconnected and must reconnect. */
  serialize(): RoomSnapshot {
    return {
      roomCode: this.roomCode,
      players: [...this.players.values()].map(p => ({ ...p, cards: [...p.cards] })),
      hostId: this.hostId,
      gamePhase: this.gamePhase,
      settings: { ...this.settings },
      lastActivity: this.lastActivity,
      isBackgroundGame: this.isBackgroundGame,
      reconnectTokens: Object.fromEntries(this.reconnectTokens),
      gameSnapshot: this.game ? this.game.serialize() : null,
      playerUserIds: Object.fromEntries(this.playerUserIds),
      gameStartedAt: this.gameStartedAt?.toISOString() ?? null,
      eliminationOrder: [...this.eliminationOrder],
      seriesState: this.seriesState ? { ...this.seriesState, wins: { ...this.seriesState.wins } } : null,
      currentGameId: this.currentGameId,
    };
  }

  /** Restore a Room from a serialized snapshot. All human players are marked
   *  disconnected since sockets are ephemeral — they must reconnect via the
   *  normal reconnect flow (which validates their reconnect token). */
  static restore(snapshot: RoomSnapshot): Room {
    const room = new Room(snapshot.roomCode);
    room.hostId = snapshot.hostId;
    room.gamePhase = snapshot.gamePhase;
    room.settings = { ...snapshot.settings };
    room.lastActivity = snapshot.lastActivity;
    room.isBackgroundGame = snapshot.isBackgroundGame;

    // Restore players — mark all humans as disconnected (sockets are gone)
    for (const p of snapshot.players) {
      const player: ServerPlayer = { ...p, cards: [...p.cards] };
      if (!player.isBot) {
        player.isConnected = false;
      }
      room.players.set(player.id, player);
    }

    // Restore reconnect tokens so players can rejoin
    for (const [playerId, token] of Object.entries(snapshot.reconnectTokens)) {
      room.reconnectTokens.set(playerId, token);
    }

    // Restore player-to-user mappings
    if (snapshot.playerUserIds) {
      for (const [playerId, userId] of Object.entries(snapshot.playerUserIds)) {
        room.playerUserIds.set(playerId, userId);
        // Also restore userId on the player object for client state
        const player = room.players.get(playerId);
        if (player) {
          player.userId = userId;
        }
      }
    }
    room.gameStartedAt = snapshot.gameStartedAt ? new Date(snapshot.gameStartedAt) : null;
    room.eliminationOrder = snapshot.eliminationOrder ? [...snapshot.eliminationOrder] : [];
    room._eliminationSet = new Set(room.eliminationOrder);
    room.seriesState = snapshot.seriesState ?? null;
    room.currentGameId = snapshot.currentGameId ?? null;

    // Restore game engine if a game was in progress
    if (snapshot.gameSnapshot) {
      try {
        room.game = GameEngine.restore(snapshot.gameSnapshot);
      } catch {
        // If the game snapshot is corrupted, reset to lobby.
        // Players can start a new game rather than losing the room entirely.
        room.game = null;
        room.gamePhase = GamePhase.LOBBY;
      }
    }

    return room;
  }

  getSocketId(playerId: PlayerId): string | undefined {
    return this.playerToSocket.get(playerId);
  }

  getPlayerId(socketId: string): PlayerId | undefined {
    return this.socketToPlayer.get(socketId);
  }

  startGame(): GameEngine {
    this.gamePhase = GamePhase.PLAYING;
    this.gameStartedAt = new Date();
    this.currentGameId = randomUUID();
    this.eliminationOrder = [];
    this._eliminationSet.clear();
    this.lastRoundResult = null;
    const activePlayers = [...this.players.values()].filter(p => !p.isEliminated);
    // Shuffle seating order — positions stay fixed for the entire game
    for (let i = activePlayers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = activePlayers[i]!;
      activePlayers[i] = activePlayers[j]!;
      activePlayers[j] = temp;
    }
    this.cancelRoundContinueWindow();
    this.game = new GameEngine(activePlayers, this.settings);
    this.game.startRound();
    this.touch();
    return this.game;
  }

  /** Reset the room for a rematch: keep players and settings, create a fresh GameEngine.
   *  All players are un-eliminated and reset to starting card count. */
  resetForRematch(): GameEngine {
    // Reset all players to starting state
    for (const player of this.players.values()) {
      player.cardCount = STARTING_CARDS;
      player.isEliminated = false;
      player.cards = [];
    }

    // Remove disconnected players (they missed the rematch)
    const disconnected: PlayerId[] = [];
    for (const [id, player] of this.players) {
      if (!player.isConnected && !player.isBot) {
        disconnected.push(id);
      }
    }
    for (const id of disconnected) {
      // Clean up both sides of the socket↔player mapping
      const socketId = this.playerToSocket.get(id);
      if (socketId) this.socketToPlayer.delete(socketId);
      this.playerToSocket.delete(id);
      this.players.delete(id);
      this.reconnectTokens.delete(id);
      // Clear any pending disconnect timer for the removed player
      const timer = this.disconnectTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.disconnectTimers.delete(id);
      }
    }

    // Reassign host if the current host was disconnected
    if (!this.players.has(this.hostId) && this.players.size > 0) {
      for (const p of this.players.values()) {
        if (!p.isBot) {
          p.isHost = true;
          this.hostId = p.id;
          break;
        }
      }
      // If only bots remain, pick the first one
      if (!this.players.has(this.hostId)) {
        const first = this.players.values().next().value!;
        first.isHost = true;
        this.hostId = first.id;
      }
    }

    return this.startGame();
  }

  updateSettings(settings: GameSettings): void {
    if (this.gamePhase !== GamePhase.LOBBY) return;
    this.settings = { ...settings };
    this.touch();
  }

  getRoomState(): RoomState {
    return {
      roomCode: this.roomCode,
      players: [...this.players.values()].map(toPublicPlayer),
      hostId: this.hostId,
      gamePhase: this.gamePhase,
      settings: { ...this.settings },
      spectatorCount: this.spectatorSockets.size,
    };
  }

  getClientGameState(playerId: PlayerId): ClientGameState | null {
    if (!this.game) return null;
    return this.game.getClientState(playerId);
  }

  /** Build a spectator view: game state with no hand info unless spectatorsCanSeeCards is true */
  getSpectatorGameState(): ClientGameState | null {
    if (!this.game) return null;
    // Use an empty player ID to get a base state (no myCards)
    const state = this.game.getClientState('__spectator__');
    if (this.settings.spectatorsCanSeeCards) {
      state.spectatorCards = this.game.getActivePlayers().map(p => ({
        playerId: p.id,
        playerName: p.name,
        cards: [...p.cards],
      }));
    }
    state.myCards = [];
    return state;
  }

  /** Record players as eliminated for finish position tracking.
   *  Called from socket handlers when a round result includes eliminations. */
  recordEliminations(playerIds: PlayerId[]): void {
    for (const id of playerIds) {
      if (!this._eliminationSet.has(id)) {
        this._eliminationSet.add(id);
        this.eliminationOrder.push(id);
      }
    }
  }

  /** Associate an in-game player ID with an authenticated user ID. */
  setPlayerUserId(playerId: PlayerId, userId: string): void {
    this.playerUserIds.set(playerId, userId);
    // Also set on the player object so it's included in client state
    const player = this.players.get(playerId);
    if (player) {
      player.userId = userId;
    }
  }

  get playerCount(): number {
    return this.players.size;
  }

  /** True if any non-bot player besides the host has joined */
  get hasOtherHumanPlayers(): boolean {
    return [...this.players.values()].some(p => !p.isBot && p.id !== this.hostId);
  }

  get isEmpty(): boolean {
    // Only count human players — bots alone don't keep a room alive.
    // However, during an active game, disconnected humans with pending
    // reconnect timers still count — don't delete the room while they
    // can still rejoin (e.g., player vs bots who closed the browser).
    return [...this.players.values()].every(p => p.isBot || (
      !p.isConnected && !this.disconnectTimers.has(p.id)
    ));
  }
}

function toPublicPlayer(p: ServerPlayer): Player {
  return {
    id: p.id,
    name: p.name,
    cardCount: p.cardCount,
    isConnected: p.isConnected,
    isEliminated: p.isEliminated,
    isHost: p.isHost,
    isBot: p.isBot,
    isAdmin: p.isAdmin,
    userId: p.userId,
    username: p.username,
    avatar: p.avatar,
    photoUrl: p.photoUrl,
    avatarBgColor: p.avatarBgColor,
  };
}
