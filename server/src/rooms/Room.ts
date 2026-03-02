import {
  GamePhase, STARTING_CARDS, DISCONNECT_TIMEOUT_MS, DEFAULT_GAME_SETTINGS,
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
  settings: GameSettings = { ...DEFAULT_GAME_SETTINGS };
  lastActivity = Date.now();
  private disconnectTimers = new Map<PlayerId, ReturnType<typeof setTimeout>>();

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

  handleDisconnect(socketId: string): PlayerId | null {
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
      player.isEliminated = true;
      this.disconnectTimers.delete(playerId);
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

  getSocketId(playerId: PlayerId): string | undefined {
    return this.playerToSocket.get(playerId);
  }

  getPlayerId(socketId: string): PlayerId | undefined {
    return this.socketToPlayer.get(socketId);
  }

  startGame(): GameEngine {
    this.gamePhase = GamePhase.PLAYING;
    const activePlayers = [...this.players.values()].filter(p => !p.isEliminated);
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

  get playerCount(): number {
    return this.players.size;
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
