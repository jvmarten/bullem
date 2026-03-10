import type { Server, Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import {
  MATCHMAKING_INTERVAL_MS,
  MATCHMAKING_ELO_WINDOW,
  MATCHMAKING_WIDEN_AFTER_SECONDS,
  MATCHMAKING_BOT_BACKFILL_SECONDS,
  MATCHMAKING_MULTIPLAYER_TARGET,
  MATCHMAKING_MULTIPLAYER_MIN,
  MATCHMAKING_MULTIPLAYER_MAX,
  MATCHMAKING_FOUND_COUNTDOWN_MS,
  MATCHMAKING_STATUS_INTERVAL_MS,
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
  BOT_PROFILES,
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
  BotProfileConfig,
} from '@bull-em/shared';
import { RoomManager } from '../rooms/RoomManager.js';
import { BotManager } from '../game/BotManager.js';
import { getRating } from '../db/ratings.js';
import { getUserAvatarAndPhoto } from '../db/users.js';
import { getRankedBotPool, pickClosestRatedBot } from '../db/botPool.js';
import type { RankedBotEntry } from '../db/botPool.js';
import { broadcastRoomState, broadcastGameState } from '../socket/broadcast.js';
import { recordRoundStart } from '../socket/roundTransition.js';
import logger from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

// ── Redis key helpers ────────────────────────────────────────────────────

const QUEUE_KEY_PREFIX = 'matchmaking:';
function queueKey(mode: RankedMode): string {
  return `${QUEUE_KEY_PREFIX}${mode}`;
}

// ── Queue entry (stored as JSON string in Redis sorted set) ─────────────

export interface QueueEntry {
  userId: string;
  username: string;
  socketId: string;
  rating: number;
  joinedAt: number;
  displayName: string;
  avatar?: AvatarId | null;
  photoUrl?: string | null;
}

function serializeEntry(entry: QueueEntry): string {
  return JSON.stringify(entry);
}

function deserializeEntry(raw: string): QueueEntry {
  return JSON.parse(raw) as QueueEntry;
}

/**
 * Matchmaking queue manager. Manages two Redis sorted sets (heads_up and
 * multiplayer) and runs a matching loop on an interval.
 *
 * Design:
 * - Queue state lives in Redis sorted sets, scored by rating.
 * - The matching loop runs every ~2.5s and checks both queues.
 * - When a match is found, a ranked room is created automatically and
 *   players are joined via their socket.
 * - Only authenticated users can join (guests are rejected).
 */
export class MatchmakingQueue {
  private io: TypedServer;
  private redis: Redis;
  private roomManager: RoomManager;
  private botManager: BotManager;
  private matchingTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  /** In-memory index: userId → socketId for fast lookup. Kept in sync with
   *  Redis on add/remove. Stale entries are cleaned on server restart. */
  private userSockets = new Map<string, string>();
  /** Reverse index: socketId → { userId, mode } for cleanup on disconnect. */
  private socketUsers = new Map<string, { userId: string; mode: RankedMode }>();

  constructor(
    io: TypedServer,
    redis: Redis,
    roomManager: RoomManager,
    botManager: BotManager,
  ) {
    this.io = io;
    this.redis = redis;
    this.roomManager = roomManager;
    this.botManager = botManager;
  }

  /** Start the matching loop and status broadcast interval. */
  start(): void {
    if (this.matchingTimer) return;
    // Clear stale queue entries on startup — sockets from a previous process
    // are gone, so these entries would never match.
    void this.clearQueues();
    this.matchingTimer = setInterval(() => {
      void this.runMatchingPass();
    }, MATCHMAKING_INTERVAL_MS);
    this.statusTimer = setInterval(() => {
      void this.broadcastQueueStatus();
    }, MATCHMAKING_STATUS_INTERVAL_MS);
    logger.info('Matchmaking queue started');
  }

  /** Stop the matching loop. */
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

  /** Clear both queues (called on server startup to remove stale entries). */
  private async clearQueues(): Promise<void> {
    try {
      await this.redis.del(queueKey('heads_up'), queueKey('multiplayer'));
      this.userSockets.clear();
      this.socketUsers.clear();
      logger.info('Matchmaking queues cleared on startup');
    } catch (err) {
      logger.error({ err }, 'Failed to clear matchmaking queues');
    }
  }

  /**
   * Add a player to the matchmaking queue.
   * @returns Error message if the join is rejected, or null on success.
   */
  async joinQueue(
    socket: TypedSocket,
    mode: RankedMode,
  ): Promise<string | null> {
    const userId = socket.data.userId as string | undefined;
    const username = socket.data.username as string | undefined;

    // Only authenticated users can join ranked matchmaking
    if (!userId || !username) {
      return 'You must be logged in to play ranked matchmaking';
    }

    // Check if already in queue
    if (this.userSockets.has(userId)) {
      return 'Already in matchmaking queue';
    }

    // Check if already in a game
    const existingRoom = this.roomManager.getRoomForSocket(socket.id);
    if (existingRoom) {
      return 'Already in a game — leave your current room first';
    }

    // Fetch the player's rating, avatar, and photo URL in parallel
    const [rating, avatarAndPhoto] = await Promise.all([
      this.getPlayerRating(userId, mode),
      getUserAvatarAndPhoto(userId),
    ]);

    const entry: QueueEntry = {
      userId,
      username,
      socketId: socket.id,
      rating,
      joinedAt: Date.now(),
      displayName: username,
      avatar: avatarAndPhoto.avatar,
      photoUrl: avatarAndPhoto.photoUrl,
    };

    try {
      await this.redis.zadd(queueKey(mode), rating, serializeEntry(entry));
      this.userSockets.set(userId, socket.id);
      this.socketUsers.set(socket.id, { userId, mode });
      logger.info({ userId, mode, rating }, 'Player joined matchmaking queue');
      return null;
    } catch (err) {
      logger.error({ err, userId, mode }, 'Failed to add player to matchmaking queue');
      return 'Failed to join queue — please try again';
    }
  }

  /** Remove a player from the queue (voluntary leave or disconnect). */
  async leaveQueue(socketId: string): Promise<boolean> {
    const mapping = this.socketUsers.get(socketId);
    if (!mapping) return false;

    const { userId, mode } = mapping;
    try {
      // Find and remove the entry from the sorted set. Since the value contains
      // the socketId, we need to scan members to find the right one.
      const members = await this.redis.zrange(queueKey(mode), 0, -1);
      for (const raw of members) {
        const entry = deserializeEntry(raw);
        if (entry.userId === userId) {
          await this.redis.zrem(queueKey(mode), raw);
          break;
        }
      }
      this.userSockets.delete(userId);
      this.socketUsers.delete(socketId);
      logger.info({ userId, mode }, 'Player left matchmaking queue');
      return true;
    } catch (err) {
      logger.error({ err, userId, mode }, 'Failed to remove player from matchmaking queue');
      return false;
    }
  }

  /** Handle socket disconnect — remove from queue immediately. */
  async handleDisconnect(socketId: string): Promise<void> {
    if (this.socketUsers.has(socketId)) {
      const left = await this.leaveQueue(socketId);
      if (left) {
        // No need to emit matchmaking:cancelled — socket is already gone
        logger.debug({ socketId }, 'Disconnected player removed from matchmaking queue');
      }
    }
  }

  /** Check if a user is currently in a matchmaking queue. */
  isInQueue(userId: string): boolean {
    return this.userSockets.has(userId);
  }

  // ── Matching algorithm ────────────────────────────────────────────────

  private async runMatchingPass(): Promise<void> {
    try {
      await Promise.all([
        this.matchHeadsUp(),
        this.matchMultiplayer(),
      ]);
    } catch (err) {
      logger.error({ err }, 'Matching pass failed');
    }
  }

  /**
   * Heads-up matching: find the two closest-rated players within the Elo window.
   * Window widens after MATCHMAKING_WIDEN_AFTER_SECONDS. After
   * MATCHMAKING_BOT_BACKFILL_SECONDS, match with a bot.
   */
  private async matchHeadsUp(): Promise<void> {
    const key = queueKey('heads_up');
    // WITHSCORES returns [value, score, value, score, ...] so 1 entry = length 2
    const members = await this.redis.zrange(key, 0, -1, 'WITHSCORES');
    if (members.length === 0) return;

    // Parse entries with their ratings
    const entries: QueueEntry[] = [];
    for (let i = 0; i < members.length; i += 2) {
      entries.push(deserializeEntry(members[i]!));
    }
    // entries are sorted by rating (ascending) since Redis ZRANGE is ascending

    if (entries.length < 2) {
      // Only 1 player — check for bot backfill after wait threshold
      const entry = entries[0]!;
      const waitSeconds = (Date.now() - entry.joinedAt) / 1000;
      if (waitSeconds >= MATCHMAKING_BOT_BACKFILL_SECONDS) {
        await this.createHeadsUpBotMatch(entry, key);
      }
      return;
    }

    const now = Date.now();
    let bestPair: [QueueEntry, QueueEntry] | null = null;
    let bestDiff = Infinity;

    // Find the closest pair within the Elo window
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i]!;
      const b = entries[i + 1]!;
      const diff = Math.abs(a.rating - b.rating);

      // Calculate effective window for each player (widens over time)
      const windowA = this.getEffectiveWindow(a, now);
      const windowB = this.getEffectiveWindow(b, now);
      const maxWindow = Math.max(windowA, windowB);

      if (diff <= maxWindow && diff < bestDiff) {
        bestDiff = diff;
        bestPair = [a, b];
      }
    }

    if (bestPair) {
      await this.createMatch('heads_up', bestPair, key);
    } else {
      // Check for bot backfill on long-waiting players
      for (const entry of entries) {
        const waitSeconds = (now - entry.joinedAt) / 1000;
        if (waitSeconds >= MATCHMAKING_BOT_BACKFILL_SECONDS) {
          await this.createHeadsUpBotMatch(entry, key);
          return; // One backfill per pass
        }
      }
    }
  }

  /**
   * Multiplayer matching: find 3+ players within a compatible rating spread.
   * Target is 4 players. Fill remaining slots with bots if needed.
   */
  private async matchMultiplayer(): Promise<void> {
    const key = queueKey('multiplayer');
    const members = await this.redis.zrange(key, 0, -1, 'WITHSCORES');

    // Parse entries
    const entries: QueueEntry[] = [];
    for (let i = 0; i < members.length; i += 2) {
      entries.push(deserializeEntry(members[i]!));
    }

    if (entries.length < MATCHMAKING_MULTIPLAYER_MIN) {
      // Not enough players — check for bot backfill on long-waiters
      if (entries.length > 0) {
        const now = Date.now();
        const longestWaiter = entries.reduce((a, b) => a.joinedAt < b.joinedAt ? a : b);
        const waitSeconds = (now - longestWaiter.joinedAt) / 1000;
        if (waitSeconds >= MATCHMAKING_BOT_BACKFILL_SECONDS && entries.length >= 1) {
          // Create a match with all waiting players + bot backfill
          await this.createMultiplayerMatch(entries, key);
        }
      }
      return;
    }

    // Find the largest compatible group
    const now = Date.now();
    const group = this.findCompatibleGroup(entries, now);

    if (group.length >= MATCHMAKING_MULTIPLAYER_MIN) {
      await this.createMultiplayerMatch(group, key);
    }
  }

  /**
   * Find the largest group of players within a compatible rating spread.
   * Entries are sorted by rating (ascending from Redis ZRANGE).
   */
  private findCompatibleGroup(entries: QueueEntry[], now: number): QueueEntry[] {
    if (entries.length < MATCHMAKING_MULTIPLAYER_MIN) return [];

    let bestGroup: QueueEntry[] = [];

    // Sliding window: for each starting player, extend the window as far as
    // the rating spread allows
    for (let start = 0; start < entries.length; start++) {
      const group: QueueEntry[] = [entries[start]!];

      for (let end = start + 1; end < entries.length && group.length < MATCHMAKING_MULTIPLAYER_MAX; end++) {
        const candidate = entries[end]!;
        const spread = candidate.rating - entries[start]!.rating;

        // Use the widened spread if any player in the group has been waiting long enough
        const maxSpread = this.getEffectiveMultiplayerSpread(group, now);
        if (spread <= maxSpread) {
          group.push(candidate);
        } else {
          break; // Sorted by rating, so no further entries will be closer
        }
      }

      if (group.length > bestGroup.length && group.length >= MATCHMAKING_MULTIPLAYER_MIN) {
        bestGroup = group;
      }

      // Cap at target if we have enough
      if (bestGroup.length >= MATCHMAKING_MULTIPLAYER_TARGET) break;
    }

    // Cap at target for now (can go higher if queue is deep)
    return bestGroup.slice(0, MATCHMAKING_MULTIPLAYER_MAX);
  }

  private getEffectiveWindow(entry: QueueEntry, now: number): number {
    const waitSeconds = (now - entry.joinedAt) / 1000;
    let window = MATCHMAKING_ELO_WINDOW;
    if (waitSeconds >= MATCHMAKING_WIDEN_AFTER_SECONDS) {
      window = Math.floor(window * 1.5);
    }
    return window;
  }

  private getEffectiveMultiplayerSpread(group: QueueEntry[], now: number): number {
    let spread = MATCHMAKING_MULTIPLAYER_ELO_SPREAD;
    const hasLongWaiter = group.some(e => (now - e.joinedAt) / 1000 >= MATCHMAKING_WIDEN_AFTER_SECONDS);
    if (hasLongWaiter) {
      spread = Math.floor(spread * 1.5);
    }
    return spread;
  }

  // ── Match creation ────────────────────────────────────────────────────

  private async createMatch(
    mode: RankedMode,
    players: QueueEntry[],
    redisKey: string,
  ): Promise<void> {
    // Remove matched players from the queue
    for (const entry of players) {
      const members = await this.redis.zrange(redisKey, 0, -1);
      for (const raw of members) {
        const parsed = deserializeEntry(raw);
        if (parsed.userId === entry.userId) {
          await this.redis.zrem(redisKey, raw);
          break;
        }
      }
      this.userSockets.delete(entry.userId);
      this.socketUsers.delete(entry.socketId);
    }

    // Create the ranked room
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

    // Add all players to the room
    const matchedInfo: MatchmakingFound[] = [];
    const playerIds: string[] = [];

    for (const entry of players) {
      const playerId = randomUUID();
      playerIds.push(playerId);
      const { player, reconnectToken } = room.addPlayer(entry.socketId, playerId, entry.displayName, { userId: entry.userId, username: entry.username, avatar: entry.avatar, photoUrl: entry.photoUrl });
      room.setPlayerUserId(playerId, entry.userId);
      this.roomManager.assignSocketToRoom(entry.socketId, room.roomCode);
      this.roomManager.assignPlayerToRoom(playerId, room.roomCode);

      // Join the socket to the room and propagate admin status
      const socket = this.io.sockets.sockets.get(entry.socketId);
      if (socket) {
        socket.join(room.roomCode);
        if (socket.data.role === 'admin') player.isAdmin = true;
      }

      // Build the opponent list for this player
      const opponents = players
        .filter(p => p.userId !== entry.userId)
        .map(p => ({ name: p.displayName, rating: p.rating, tier: getRankTier(p.rating) }));

      matchedInfo.push({
        roomCode: room.roomCode,
        opponents,
        reconnectToken,
        playerId,
      });
    }

    // Notify all matched players
    for (let i = 0; i < players.length; i++) {
      const socket = this.io.sockets.sockets.get(players[i]!.socketId);
      if (socket) {
        socket.emit('matchmaking:found', matchedInfo[i]!);
      }
    }

    logger.info(
      { roomCode: room.roomCode, mode, playerCount: players.length, ratings: players.map(p => p.rating) },
      'Match found — creating ranked room',
    );

    // Start the game after a short countdown
    setTimeout(() => {
      this.startMatchedGame(room.roomCode);
    }, MATCHMAKING_FOUND_COUNTDOWN_MS);
  }

  private async createHeadsUpBotMatch(
    player: QueueEntry,
    redisKey: string,
  ): Promise<void> {
    // Remove the player from the queue
    const members = await this.redis.zrange(redisKey, 0, -1);
    for (const raw of members) {
      const parsed = deserializeEntry(raw);
      if (parsed.userId === player.userId) {
        await this.redis.zrem(redisKey, raw);
        break;
      }
    }
    this.userSockets.delete(player.userId);
    this.socketUsers.delete(player.socketId);

    // Create room
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

    // Add the human player
    const playerId = randomUUID();
    const { player: addedPlayer, reconnectToken } = room.addPlayer(player.socketId, playerId, player.displayName, { userId: player.userId, username: player.username, avatar: player.avatar, photoUrl: player.photoUrl });
    room.setPlayerUserId(playerId, player.userId);
    this.roomManager.assignSocketToRoom(player.socketId, room.roomCode);
    this.roomManager.assignPlayerToRoom(playerId, room.roomCode);

    const socket = this.io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.join(room.roomCode);
      if (socket.data.role === 'admin') addedPlayer.isAdmin = true;
    }

    // Add a ranked bot with a persistent profile if available, fallback to anonymous bot
    const botPool = await getRankedBotPool('heads_up');
    const rankedBot = pickClosestRatedBot(botPool, player.rating);

    let botId: string;
    let botDisplayName: string;
    let botRating: number;

    if (rankedBot) {
      botId = this.botManager.addRankedBot(room, rankedBot.userId, rankedBot.displayName, rankedBot.profileConfig, rankedBot.username);
      botDisplayName = rankedBot.displayName;
      botRating = rankedBot.rating;
    } else {
      // Fallback: use a real bot profile from BOT_PROFILES instead of a generic name
      const fallbackBot = this.pickFallbackBot(new Set());
      botId = this.botManager.addRankedBot(room, `fallback-bot-${randomUUID()}`, fallbackBot.name, fallbackBot.config);
      botDisplayName = fallbackBot.name;
      botRating = player.rating;
    }
    this.roomManager.assignPlayerToRoom(botId, room.roomCode);

    // Notify the player
    if (socket) {
      socket.emit('matchmaking:found', {
        roomCode: room.roomCode,
        opponents: [{ name: botDisplayName, rating: botRating, tier: getRankTier(botRating) }],
        reconnectToken,
        playerId,
      });
    }

    logger.info(
      { roomCode: room.roomCode, mode: 'heads_up', botBackfill: true, playerRating: player.rating, botProfile: rankedBot?.botProfile },
      'Bot backfill match created for heads-up',
    );

    setTimeout(() => {
      this.startMatchedGame(room.roomCode);
    }, MATCHMAKING_FOUND_COUNTDOWN_MS);
  }

  private async createMultiplayerMatch(
    humanPlayers: QueueEntry[],
    redisKey: string,
  ): Promise<void> {
    // Remove all matched players from the queue
    for (const entry of humanPlayers) {
      const members = await this.redis.zrange(redisKey, 0, -1);
      for (const raw of members) {
        const parsed = deserializeEntry(raw);
        if (parsed.userId === entry.userId) {
          await this.redis.zrem(redisKey, raw);
          break;
        }
      }
      this.userSockets.delete(entry.userId);
      this.socketUsers.delete(entry.socketId);
    }

    // Create room
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

    // Add all human players
    const allPlayerInfo: { entry: QueueEntry; playerId: string; reconnectToken: string }[] = [];

    for (const entry of humanPlayers) {
      const playerId = randomUUID();
      const { player: addedPlayer, reconnectToken } = room.addPlayer(entry.socketId, playerId, entry.displayName, { userId: entry.userId, username: entry.username, avatar: entry.avatar, photoUrl: entry.photoUrl });
      room.setPlayerUserId(playerId, entry.userId);
      this.roomManager.assignSocketToRoom(entry.socketId, room.roomCode);
      this.roomManager.assignPlayerToRoom(playerId, room.roomCode);

      const socket = this.io.sockets.sockets.get(entry.socketId);
      if (socket) {
        socket.join(room.roomCode);
        if (socket.data.role === 'admin') addedPlayer.isAdmin = true;
      }

      allPlayerInfo.push({ entry, playerId, reconnectToken });
    }

    // Random total player count between 3 and 9 for multiplayer bot backfill
    const targetPlayers = Math.max(
      MATCHMAKING_MULTIPLAYER_MIN,
      Math.min(MATCHMAKING_MULTIPLAYER_MAX, 3 + Math.floor(Math.random() * 7)),
    );
    const botsNeeded = Math.max(0, targetPlayers - humanPlayers.length);
    const avgRating = humanPlayers.reduce((sum, p) => sum + p.rating, 0) / humanPlayers.length;
    const botEntries: { name: string; rating: number; tier: import('@bull-em/shared').RankTier }[] = [];

    const botPool = await getRankedBotPool('multiplayer');
    const usedBotUserIds = new Set<string>();
    const usedFallbackNames = new Set<string>();

    for (let i = 0; i < botsNeeded; i++) {
      const rankedBot = pickClosestRatedBot(botPool, avgRating, usedBotUserIds);

      let botId: string;
      let botDisplayName: string;
      let botRating: number;

      if (rankedBot) {
        botId = this.botManager.addRankedBot(room, rankedBot.userId, rankedBot.displayName, rankedBot.profileConfig, rankedBot.username);
        usedBotUserIds.add(rankedBot.userId);
        botDisplayName = rankedBot.displayName;
        botRating = rankedBot.rating;
      } else {
        // Fallback: use a real bot profile from BOT_PROFILES instead of a generic name
        const fallbackBot = this.pickFallbackBot(usedFallbackNames);
        botId = this.botManager.addRankedBot(room, `fallback-bot-${randomUUID()}`, fallbackBot.name, fallbackBot.config);
        usedFallbackNames.add(fallbackBot.name);
        botDisplayName = fallbackBot.name;
        botRating = Math.round(avgRating);
      }
      this.roomManager.assignPlayerToRoom(botId, room.roomCode);
      botEntries.push({ name: botDisplayName, rating: botRating, tier: getRankTier(botRating) });
    }

    // Notify all human players
    for (const info of allPlayerInfo) {
      const opponents = [
        ...humanPlayers
          .filter(p => p.userId !== info.entry.userId)
          .map(p => ({ name: p.displayName, rating: p.rating, tier: getRankTier(p.rating) })),
        ...botEntries,
      ];

      const socket = this.io.sockets.sockets.get(info.entry.socketId);
      if (socket) {
        socket.emit('matchmaking:found', {
          roomCode: room.roomCode,
          opponents,
          reconnectToken: info.reconnectToken,
          playerId: info.playerId,
        });
      }
    }

    logger.info(
      {
        roomCode: room.roomCode,
        mode: 'multiplayer',
        humanCount: humanPlayers.length,
        botCount: botsNeeded,
        totalPlayers: humanPlayers.length + botsNeeded,
      },
      'Multiplayer match created',
    );

    setTimeout(() => {
      this.startMatchedGame(room.roomCode);
    }, MATCHMAKING_FOUND_COUNTDOWN_MS);
  }

  /** Start the game in a matched room. Called after the countdown. */
  private startMatchedGame(roomCode: string): void {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;
    if (room.gamePhase !== GamePhase.LOBBY) return;

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

    // Clear cross-round bot memory
    BotPlayer.resetMemory(room.roomCode);

    // Schedule turn first (sets deadline for human), then broadcast
    this.botManager.scheduleBotTurn(room, this.io);
    broadcastRoomState(this.io, room);
    broadcastGameState(this.io, room);
    this.roomManager.persistRoom(room);

    logger.info({ roomCode, playerCount: room.playerCount }, 'Matched game started');
  }

  // ── Queue status broadcasts ───────────────────────────────────────────

  private async broadcastQueueStatus(): Promise<void> {
    try {
      await Promise.all([
        this.broadcastModeStatus('heads_up'),
        this.broadcastModeStatus('multiplayer'),
      ]);
    } catch (err) {
      logger.error({ err }, 'Failed to broadcast queue status');
    }
  }

  private async broadcastModeStatus(mode: RankedMode): Promise<void> {
    const key = queueKey(mode);
    const members = await this.redis.zrange(key, 0, -1);
    if (members.length === 0) return;

    const entries = members.map(deserializeEntry);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const socket = this.io.sockets.sockets.get(entry.socketId);
      if (!socket) continue;

      // Rough estimate: position in queue based on index
      const status: MatchmakingStatus = {
        position: i + 1,
        estimatedWaitSeconds: this.estimateWait(entries.length, mode),
        mode,
      };
      socket.emit('matchmaking:queued', status);
    }
  }

  private estimateWait(queueSize: number, mode: RankedMode): number {
    if (mode === 'heads_up') {
      return queueSize >= 2 ? 3 : 15;
    }
    // Multiplayer
    if (queueSize >= MATCHMAKING_MULTIPLAYER_TARGET) return 3;
    if (queueSize >= MATCHMAKING_MULTIPLAYER_MIN) return 10;
    return 30;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private async getPlayerRating(userId: string, mode: RankedMode): Promise<number> {
    try {
      const rating = await getRating(userId, mode);
      if (!rating) {
        return mode === 'heads_up' ? ELO_DEFAULT : Math.round(openSkillOrdinal(OPENSKILL_DEFAULT_MU, OPENSKILL_DEFAULT_SIGMA));
      }
      if (rating.mode === 'heads_up') return rating.elo;
      return Math.round(openSkillOrdinal(rating.mu, rating.sigma));
    } catch {
      return mode === 'heads_up' ? ELO_DEFAULT : Math.round(openSkillOrdinal(OPENSKILL_DEFAULT_MU, OPENSKILL_DEFAULT_SIGMA));
    }
  }

  /**
   * Pick a random bot profile from BOT_PROFILES, excluding names already in use.
   * Used as a fallback when the database bot pool is unavailable (e.g., dev mode).
   */
  private pickFallbackBot(usedNames: Set<string>): { name: string; config: BotProfileConfig } {
    const candidates = BOT_PROFILES.filter(p => !usedNames.has(p.name));
    const pick = candidates.length > 0
      ? candidates[Math.floor(Math.random() * candidates.length)]!
      : BOT_PROFILES[Math.floor(Math.random() * BOT_PROFILES.length)]!;
    return { name: pick.name, config: pick.config };
  }
}
