/**
 * In-memory matchmaking queue for dev mode (no Redis). Bare-bones implementation
 * that mirrors the real MatchmakingQueue interface but uses simple arrays instead
 * of Redis sorted sets. Dev-only — never used in production.
 */

import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import {
  MATCHMAKING_INTERVAL_MS,
  MATCHMAKING_ELO_WINDOW,
  MATCHMAKING_WIDEN_AFTER_SECONDS,
  MATCHMAKING_BOT_BACKFILL_SECONDS,
  MATCHMAKING_FOUND_COUNTDOWN_MS,
  MATCHMAKING_STATUS_INTERVAL_MS,
  MATCHMAKING_MULTIPLAYER_TARGET,
  MATCHMAKING_MULTIPLAYER_MIN,
  MATCHMAKING_MULTIPLAYER_MAX,
  MATCHMAKING_MULTIPLAYER_ELO_SPREAD,
  ELO_DEFAULT,
  OPENSKILL_DEFAULT_MU,
  OPENSKILL_DEFAULT_SIGMA,
  RANKED_SETTINGS,
  RANKED_BEST_OF,
  openSkillOrdinal,
  GamePhase,
  BotPlayer,
  getRankTier,
} from '@bull-em/shared';
import type {
  RankedMode,
  PlayerId,
  BestOf,
  AvatarId,
  ClientToServerEvents,
  ServerToClientEvents,
  MatchmakingStatus,
  MatchmakingFound,
} from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { broadcastRoomState, broadcastGameState } from '../socket/broadcast.js';
import { recordRoundStart } from '../socket/roundTransition.js';
import { getUserAvatarAndPhoto } from '../db/users.js';
import logger from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

interface QueueEntry {
  userId: string;
  socketId: string;
  rating: number;
  joinedAt: number;
  displayName: string;
  avatar?: AvatarId | null;
  photoUrl?: string | null;
}

/**
 * Minimal in-memory matchmaking queue for local development without Redis.
 * Only implements the subset of MatchmakingQueue's interface that the socket
 * handlers actually use.
 */
export class InMemoryMatchmakingQueue {
  private io: TypedServer;
  private roomManager: RoomManager;
  private botManager: BotManager;
  private matchingTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  private headsUpQueue: QueueEntry[] = [];
  private multiplayerQueue: QueueEntry[] = [];

  private userSockets = new Map<string, string>();
  private socketUsers = new Map<string, { userId: string; mode: RankedMode }>();

  constructor(
    io: TypedServer,
    roomManager: RoomManager,
    botManager: BotManager,
  ) {
    this.io = io;
    this.roomManager = roomManager;
    this.botManager = botManager;
  }

  start(): void {
    if (this.matchingTimer) return;
    this.matchingTimer = setInterval(() => {
      this.runMatchingPass();
    }, MATCHMAKING_INTERVAL_MS);
    this.statusTimer = setInterval(() => {
      this.broadcastQueueStatus();
    }, MATCHMAKING_STATUS_INTERVAL_MS);
    logger.info('In-memory matchmaking queue started (dev mode, no Redis)');
  }

  stop(): void {
    if (this.matchingTimer) {
      clearInterval(this.matchingTimer);
      this.matchingTimer = null;
    }
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
  }

  async joinQueue(
    socket: TypedSocket,
    mode: RankedMode,
  ): Promise<string | null> {
    const userId = socket.data.userId as string | undefined;
    const username = socket.data.username as string | undefined;

    if (!userId || !username) {
      return 'You must be logged in to play ranked matchmaking';
    }

    if (this.userSockets.has(userId)) {
      return 'Already in matchmaking queue';
    }

    const existingRoom = this.roomManager.getRoomForSocket(socket.id);
    if (existingRoom) {
      return 'Already in a game — leave your current room first';
    }

    const rating = mode === 'heads_up'
      ? ELO_DEFAULT
      : Math.round(openSkillOrdinal(OPENSKILL_DEFAULT_MU, OPENSKILL_DEFAULT_SIGMA));

    const avatarAndPhoto = await getUserAvatarAndPhoto(userId);

    const entry: QueueEntry = {
      userId,
      socketId: socket.id,
      rating,
      joinedAt: Date.now(),
      displayName: username,
      avatar: avatarAndPhoto.avatar,
      photoUrl: avatarAndPhoto.photoUrl,
    };

    const queue = mode === 'heads_up' ? this.headsUpQueue : this.multiplayerQueue;
    queue.push(entry);
    queue.sort((a, b) => a.rating - b.rating);

    this.userSockets.set(userId, socket.id);
    this.socketUsers.set(socket.id, { userId, mode });

    logger.info({ userId, mode, rating }, 'Player joined in-memory matchmaking queue');
    return null;
  }

  async leaveQueue(socketId: string): Promise<boolean> {
    const mapping = this.socketUsers.get(socketId);
    if (!mapping) return false;

    const { userId, mode } = mapping;
    const queue = mode === 'heads_up' ? this.headsUpQueue : this.multiplayerQueue;
    const idx = queue.findIndex(e => e.userId === userId);
    if (idx >= 0) queue.splice(idx, 1);

    this.userSockets.delete(userId);
    this.socketUsers.delete(socketId);
    logger.info({ userId, mode }, 'Player left in-memory matchmaking queue');
    return true;
  }

  async handleDisconnect(socketId: string): Promise<void> {
    if (this.socketUsers.has(socketId)) {
      await this.leaveQueue(socketId);
    }
  }

  isInQueue(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  // ── Matching ────────────────────────────────────────────────────────────

  private runMatchingPass(): void {
    this.matchHeadsUp();
    this.matchMultiplayer();
  }

  private matchHeadsUp(): void {
    if (this.headsUpQueue.length === 0) return;

    const now = Date.now();

    // Try to match two players
    if (this.headsUpQueue.length >= 2) {
      for (let i = 0; i < this.headsUpQueue.length - 1; i++) {
        const a = this.headsUpQueue[i]!;
        const b = this.headsUpQueue[i + 1]!;
        const diff = Math.abs(a.rating - b.rating);
        const windowA = this.getEffectiveWindow(a, now);
        const windowB = this.getEffectiveWindow(b, now);
        if (diff <= Math.max(windowA, windowB)) {
          this.removeFromQueue(a);
          this.removeFromQueue(b);
          this.createMatch('heads_up', [a, b]);
          return;
        }
      }
    }

    // Bot backfill for long waiters
    for (const entry of this.headsUpQueue) {
      const waitSeconds = (now - entry.joinedAt) / 1000;
      if (waitSeconds >= MATCHMAKING_BOT_BACKFILL_SECONDS) {
        this.removeFromQueue(entry);
        this.createBotMatch(entry);
        return;
      }
    }
  }

  private matchMultiplayer(): void {
    if (this.multiplayerQueue.length === 0) return;

    const now = Date.now();

    // Try to find a compatible group of players
    if (this.multiplayerQueue.length >= MATCHMAKING_MULTIPLAYER_MIN) {
      const group = this.findCompatibleGroup(this.multiplayerQueue, now);
      if (group.length >= MATCHMAKING_MULTIPLAYER_MIN) {
        for (const entry of group) this.removeFromQueue(entry);
        this.createMultiplayerMatch(group);
        return;
      }
    }

    // Bot backfill for long-waiting players (even a single player)
    if (this.multiplayerQueue.length >= 1) {
      const longestWaiter = this.multiplayerQueue.reduce((a, b) => a.joinedAt < b.joinedAt ? a : b);
      const waitSeconds = (now - longestWaiter.joinedAt) / 1000;
      if (waitSeconds >= MATCHMAKING_BOT_BACKFILL_SECONDS) {
        // Take all waiting players and fill the rest with bots
        const players = [...this.multiplayerQueue];
        for (const entry of players) this.removeFromQueue(entry);
        this.createMultiplayerMatch(players);
      }
    }
  }

  private findCompatibleGroup(entries: QueueEntry[], now: number): QueueEntry[] {
    if (entries.length < MATCHMAKING_MULTIPLAYER_MIN) return [];

    let bestGroup: QueueEntry[] = [];

    for (let start = 0; start < entries.length; start++) {
      const group: QueueEntry[] = [entries[start]!];

      for (let end = start + 1; end < entries.length && group.length < MATCHMAKING_MULTIPLAYER_MAX; end++) {
        const candidate = entries[end]!;
        const spread = candidate.rating - entries[start]!.rating;
        const hasLongWaiter = group.some(e => (now - e.joinedAt) / 1000 >= MATCHMAKING_WIDEN_AFTER_SECONDS);
        const maxSpread = hasLongWaiter
          ? Math.floor(MATCHMAKING_MULTIPLAYER_ELO_SPREAD * 1.5)
          : MATCHMAKING_MULTIPLAYER_ELO_SPREAD;
        if (spread <= maxSpread) {
          group.push(candidate);
        } else {
          break;
        }
      }

      if (group.length > bestGroup.length && group.length >= MATCHMAKING_MULTIPLAYER_MIN) {
        bestGroup = group;
      }
      if (bestGroup.length >= MATCHMAKING_MULTIPLAYER_TARGET) break;
    }

    return bestGroup.slice(0, MATCHMAKING_MULTIPLAYER_MAX);
  }

  private createMultiplayerMatch(humanPlayers: QueueEntry[]): void {
    const room = this.roomManager.createRoom();
    room.settings = {
      maxCards: RANKED_SETTINGS.maxCards,
      turnTimer: RANKED_SETTINGS.turnTimer,
      lastChanceMode: RANKED_SETTINGS.lastChanceMode,
      maxPlayers: RANKED_SETTINGS.maxPlayers,
      ranked: true,
      rankedMode: 'multiplayer',
      allowSpectators: true,
      spectatorsCanSeeCards: false,
    };

    const matchedInfo: MatchmakingFound[] = [];

    for (const entry of humanPlayers) {
      const playerId = randomUUID();
      const { player, reconnectToken } = room.addPlayer(entry.socketId, playerId, entry.displayName, { userId: entry.userId, avatar: entry.avatar, photoUrl: entry.photoUrl });
      room.setPlayerUserId(playerId, entry.userId);
      this.roomManager.assignSocketToRoom(entry.socketId, room.roomCode);
      this.roomManager.assignPlayerToRoom(playerId, room.roomCode);

      const socket = this.io.sockets.sockets.get(entry.socketId);
      if (socket) {
        socket.join(room.roomCode);
        if (socket.data.role === 'admin') player.isAdmin = true;
      }

      matchedInfo.push({ roomCode: room.roomCode, opponents: [], reconnectToken, playerId });
    }

    // Random total player count between 3 and 9 for multiplayer bot backfill
    const targetPlayers = Math.max(
      MATCHMAKING_MULTIPLAYER_MIN,
      Math.min(MATCHMAKING_MULTIPLAYER_MAX, 3 + Math.floor(Math.random() * 7)),
    );
    const botsNeeded = Math.max(0, targetPlayers - humanPlayers.length);
    const avgRating = humanPlayers.reduce((sum, p) => sum + p.rating, 0) / humanPlayers.length;
    const botEntries: { name: string; rating: number; tier: import('@bull-em/shared').RankTier }[] = [];

    for (let i = 0; i < botsNeeded; i++) {
      const botId = this.botManager.addBot(room, 'Ranked Bot');
      this.roomManager.assignPlayerToRoom(botId, room.roomCode);
      const botName = room.players.get(botId)!.name;
      botEntries.push({ name: botName, rating: Math.round(avgRating), tier: getRankTier(Math.round(avgRating)) });
    }

    // Build opponent lists and notify players
    for (let i = 0; i < humanPlayers.length; i++) {
      const opponents = [
        ...humanPlayers
          .filter((_, j) => j !== i)
          .map(p => ({ name: p.displayName, rating: p.rating, tier: getRankTier(p.rating) })),
        ...botEntries,
      ];
      matchedInfo[i]!.opponents = opponents;

      const socket = this.io.sockets.sockets.get(humanPlayers[i]!.socketId);
      if (socket) socket.emit('matchmaking:found', matchedInfo[i]!);
    }

    logger.info(
      { roomCode: room.roomCode, mode: 'multiplayer', humanCount: humanPlayers.length, botCount: botsNeeded },
      'In-memory multiplayer match created',
    );

    setTimeout(() => this.startMatchedGame(room.roomCode), MATCHMAKING_FOUND_COUNTDOWN_MS);
  }

  private getEffectiveWindow(entry: QueueEntry, now: number): number {
    const waitSeconds = (now - entry.joinedAt) / 1000;
    let window = MATCHMAKING_ELO_WINDOW;
    if (waitSeconds >= MATCHMAKING_WIDEN_AFTER_SECONDS) {
      window = Math.floor(window * 1.5);
    }
    return window;
  }

  private removeFromQueue(entry: QueueEntry): void {
    const huIdx = this.headsUpQueue.findIndex(e => e.userId === entry.userId);
    if (huIdx >= 0) this.headsUpQueue.splice(huIdx, 1);

    const mpIdx = this.multiplayerQueue.findIndex(e => e.userId === entry.userId);
    if (mpIdx >= 0) this.multiplayerQueue.splice(mpIdx, 1);

    this.userSockets.delete(entry.userId);
    this.socketUsers.delete(entry.socketId);
  }

  private createMatch(mode: RankedMode, players: QueueEntry[]): void {
    const room = this.roomManager.createRoom();
    room.settings = {
      maxCards: RANKED_SETTINGS.maxCards,
      turnTimer: RANKED_SETTINGS.turnTimer,
      lastChanceMode: RANKED_SETTINGS.lastChanceMode,
      maxPlayers: RANKED_SETTINGS.maxPlayers,
      ranked: true,
      rankedMode: mode,
      allowSpectators: true,
      spectatorsCanSeeCards: false,
    };

    const matchedInfo: MatchmakingFound[] = [];

    for (const entry of players) {
      const playerId = randomUUID();
      const { player, reconnectToken } = room.addPlayer(entry.socketId, playerId, entry.displayName, { userId: entry.userId, avatar: entry.avatar, photoUrl: entry.photoUrl });
      room.setPlayerUserId(playerId, entry.userId);
      this.roomManager.assignSocketToRoom(entry.socketId, room.roomCode);
      this.roomManager.assignPlayerToRoom(playerId, room.roomCode);

      const socket = this.io.sockets.sockets.get(entry.socketId);
      if (socket) {
        socket.join(room.roomCode);
        if (socket.data.role === 'admin') player.isAdmin = true;
      }

      const opponents = players
        .filter(p => p.userId !== entry.userId)
        .map(p => ({ name: p.displayName, rating: p.rating, tier: getRankTier(p.rating) }));

      matchedInfo.push({ roomCode: room.roomCode, opponents, reconnectToken, playerId });
    }

    for (let i = 0; i < players.length; i++) {
      const socket = this.io.sockets.sockets.get(players[i]!.socketId);
      if (socket) socket.emit('matchmaking:found', matchedInfo[i]!);
    }

    logger.info({ roomCode: room.roomCode, mode, playerCount: players.length }, 'In-memory match found');

    setTimeout(() => this.startMatchedGame(room.roomCode), MATCHMAKING_FOUND_COUNTDOWN_MS);
  }

  private createBotMatch(player: QueueEntry): void {
    const room = this.roomManager.createRoom();
    room.settings = {
      maxCards: RANKED_SETTINGS.maxCards,
      turnTimer: RANKED_SETTINGS.turnTimer,
      lastChanceMode: RANKED_SETTINGS.lastChanceMode,
      maxPlayers: RANKED_SETTINGS.maxPlayers,
      ranked: true,
      rankedMode: 'heads_up',
      allowSpectators: true,
      spectatorsCanSeeCards: false,
    };

    const playerId = randomUUID();
    const { player: addedPlayer, reconnectToken } = room.addPlayer(player.socketId, playerId, player.displayName, { userId: player.userId, avatar: player.avatar, photoUrl: player.photoUrl });
    room.setPlayerUserId(playerId, player.userId);
    this.roomManager.assignSocketToRoom(player.socketId, room.roomCode);
    this.roomManager.assignPlayerToRoom(playerId, room.roomCode);

    const socket = this.io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.join(room.roomCode);
      if (socket.data.role === 'admin') addedPlayer.isAdmin = true;
    }

    const botId = this.botManager.addBot(room, 'Ranked Bot');
    this.roomManager.assignPlayerToRoom(botId, room.roomCode);
    const botName = room.players.get(botId)!.name;

    if (socket) {
      socket.emit('matchmaking:found', {
        roomCode: room.roomCode,
        opponents: [{ name: botName, rating: player.rating, tier: getRankTier(player.rating) }],
        reconnectToken,
        playerId,
      });
    }

    logger.info({ roomCode: room.roomCode, botBackfill: true }, 'In-memory bot backfill match');

    setTimeout(() => this.startMatchedGame(room.roomCode), MATCHMAKING_FOUND_COUNTDOWN_MS);
  }

  private startMatchedGame(roomCode: string): void {
    const room = this.roomManager.getRoom(roomCode);
    if (!room || room.gamePhase !== GamePhase.LOBBY) return;

    // Ranked 1v1 is always Bo3
    if (room.settings.rankedMode === 'heads_up' && room.playerCount === 2) {
      const bestOf = RANKED_BEST_OF as BestOf;
      room.settings.bestOf = bestOf;
      const playerIds = [...room.players.keys()] as [PlayerId, PlayerId];
      room.seriesState = {
        bestOf,
        currentSet: 1,
        wins: { [playerIds[0]]: 0, [playerIds[1]]: 0 },
        winsNeeded: Math.ceil(bestOf / 2),
        seriesWinnerId: null,
        playerIds,
      };
    }

    room.startGame();
    recordRoundStart(room.roomCode);
    BotPlayer.resetMemory(room.roomCode);

    this.botManager.scheduleBotTurn(room, this.io);
    broadcastRoomState(this.io, room);
    broadcastGameState(this.io, room);
    this.roomManager.persistRoom(room);

    logger.info({ roomCode, playerCount: room.playerCount }, 'In-memory matched game started');
  }

  // ── Status broadcasts ───────────────────────────────────────────────────

  private broadcastQueueStatus(): void {
    this.broadcastModeStatus('heads_up', this.headsUpQueue);
    this.broadcastModeStatus('multiplayer', this.multiplayerQueue);
  }

  private broadcastModeStatus(mode: RankedMode, queue: QueueEntry[]): void {
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i]!;
      const socket = this.io.sockets.sockets.get(entry.socketId);
      if (!socket) continue;

      const status: MatchmakingStatus = {
        position: i + 1,
        estimatedWaitSeconds: queue.length >= 2 ? 3 : 15,
        mode,
      };
      socket.emit('matchmaking:queued', status);
    }
  }
}
