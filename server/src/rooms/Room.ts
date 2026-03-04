import {
  GamePhase, STARTING_CARDS, DISCONNECT_TIMEOUT_MS, DEFAULT_ONLINE_GAME_SETTINGS,
} from '@bull-em/shared';
import type {
  PlayerId, ServerPlayer, RoomState, ClientGameState, Player, GameSettings,
} from '@bull-em/shared';
import { GameEngine, type TurnResult } from '../game/GameEngine.js';

export class Room {
  readonly roomCode: string;
  players = new Map<PlayerId, ServerPlayer>();
  socketToPlayer = new Map<string, PlayerId>();
  playerToSocket = new Map<PlayerId, string>();
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

  addPlayer(socketId: string, playerId: PlayerId, name: string): ServerPlayer {
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
    this.touch();
    return player;
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

  handleReconnect(socketId: string, playerId: PlayerId): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;

    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }

    player.isConnected = true;
    this.socketToPlayer.set(socketId, playerId);
    this.playerToSocket.set(playerId, socketId);
    this.touch();
    return true;
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

  markRoundContinueReady(playerId: PlayerId): void {
    const p = this.players.get(playerId);
    if (!p || p.isEliminated) return;
    this.roundContinueReady.add(playerId);
  }

  get isRoundContinueComplete(): boolean {
    const active = [...this.players.values()].filter(p => !p.isEliminated);
    if (active.length === 0) return true;
    return active.every(p => this.roundContinueReady.has(p.id));
  }

  cancelRoundContinueWindow(): void {
    if (this.roundContinueTimer) {
      clearTimeout(this.roundContinueTimer);
      this.roundContinueTimer = null;
    }
    this.roundContinueReady.clear();
  }

  /** Clear all timers (disconnect, round continue). Call when the room is being destroyed. */
  cleanup(): void {
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
    this.cancelRoundContinueWindow();
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
