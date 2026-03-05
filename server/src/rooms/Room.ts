import {
  GamePhase, STARTING_CARDS, DISCONNECT_TIMEOUT_MS, DEFAULT_ONLINE_GAME_SETTINGS,
  BotPlayer,
} from '@bull-em/shared';
import type {
  PlayerId, ServerPlayer, RoomState, ClientGameState, Player, GameSettings,
} from '@bull-em/shared';
import { randomUUID } from 'crypto';
import { GameEngine, type TurnResult } from '../game/GameEngine.js';

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

  addPlayer(socketId: string, playerId: PlayerId, name: string): { player: ServerPlayer; reconnectToken: string } {
    const player: ServerPlayer = {
      id: playerId,
      name,
      cardCount: STARTING_CARDS,
      isConnected: true,
      isEliminated: false,
      isHost: this.players.size === 0,
      cards: [],
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

  addBot(botId: PlayerId, name: string): ServerPlayer {
    const player: ServerPlayer = {
      id: botId,
      name,
      cardCount: STARTING_CARDS,
      isConnected: true,
      isEliminated: false,
      isHost: false,
      isBot: true,
      cards: [],
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

    // Reassign host if needed
    if (playerId === this.hostId && this.players.size > 0) {
      const newHost = this.players.values().next().value!;
      newHost.isHost = true;
      this.hostId = newHost.id;
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
      if (!this.roundContinueReady.has(p.id)) return false;
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
    // Free bot memory scoped to this room
    BotPlayer.resetMemory(this.roomCode);
  }

  getSocketId(playerId: PlayerId): string | undefined {
    return this.playerToSocket.get(playerId);
  }

  getPlayerId(socketId: string): PlayerId | undefined {
    return this.socketToPlayer.get(socketId);
  }

  startGame(): GameEngine {
    this.gamePhase = GamePhase.PLAYING;
    const activePlayers = [...this.players.values()].filter(p => !p.isEliminated);
    // Shuffle seating order — positions stay fixed for the entire game
    for (let i = activePlayers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [activePlayers[i], activePlayers[j]] = [activePlayers[j], activePlayers[i]];
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
      this.players.delete(id);
      this.reconnectTokens.delete(id);
      this.playerToSocket.delete(id);
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

  get playerCount(): number {
    return this.players.size;
  }

  /** True if any non-bot player besides the host has joined */
  get hasOtherHumanPlayers(): boolean {
    return [...this.players.values()].some(p => !p.isBot && p.id !== this.hostId);
  }

  get isEmpty(): boolean {
    // Only count human players — bots alone don't keep a room alive
    return [...this.players.values()].every(p => p.isBot);
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
  };
}
