/**
 * Dev seed data generator — creates random but realistic data at server startup.
 * Generated fresh each time (not persisted). Uses the exact same types and
 * response shapes as the real DB queries so the client needs zero changes.
 *
 * Guarded behind `isDevAuthActive()` — must never activate in production.
 */

import crypto from 'node:crypto';
import type {
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardNearbyResponse,
  LeaderboardPeriod,
  PlayerStatsResponse,
  GameHistoryEntry,
  PlayerGameStats,
  AdvancedStatsResponse,
  HandTypeBreakdown,
  RatingHistoryEntry,
  PerformanceByPlayerCount,
  TodaySession,
  OpponentRecord,
  UserRatings,
  EloRating,
  OpenSkillRating,
  AvatarId,
  RankedMode,
  GameSettings,
  PublicProfile,
} from '@bull-em/shared';
import { getRankTier, ELO_DEFAULT, AVATAR_OPTIONS } from '@bull-em/shared';
import logger from '../logger.js';

// ── Random helpers ────────────────────────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function deterministicId(name: string): string {
  return crypto.createHash('sha256').update(name).digest('hex').slice(0, 32);
}

function uuidFromSeed(seed: string): string {
  const hash = crypto.createHash('md5').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

const FAKE_NAMES = [
  'CardShark', 'BluffMaster', 'PokerFace', 'LuckyDraw', 'AceHigh',
  'RoyalFlush', 'WildCard', 'BigBluff', 'SteelNerves', 'CoolHand',
  'HighRoller', 'DeadEye', 'SilverTongue', 'NightOwl', 'ThunderBolt',
  'IronWill', 'GhostPlayer', 'ShadowAce', 'FireStarter', 'IceQueen',
];

const AVATARS: (AvatarId | null)[] = [
  ...AVATAR_OPTIONS,
  null, null, // some players have no avatar
];

// ── Leaderboard seed data ─────────────────────────────────────────────────

interface SeedPlayer {
  userId: string;
  username: string;
  displayName: string;
  avatar: AvatarId | null;
  rating: number;
  gamesPlayed: number;
}

let seedPlayers: SeedPlayer[] | null = null;

function generateSeedPlayers(): SeedPlayer[] {
  if (seedPlayers) return seedPlayers;

  const players: SeedPlayer[] = [];
  // Ratings spread across tiers: Bronze (<1000), Silver (1000-1199),
  // Gold (1200-1399), Platinum (1400-1599), Diamond (1600+)
  const ratingRanges = [
    { min: 800, max: 950, count: 3 },   // Bronze
    { min: 1000, max: 1180, count: 4 },  // Silver
    { min: 1200, max: 1380, count: 4 },  // Gold
    { min: 1400, max: 1580, count: 3 },  // Platinum
    { min: 1600, max: 1800, count: 3 },  // Diamond
  ];

  let nameIdx = 0;
  for (const range of ratingRanges) {
    for (let i = 0; i < range.count && nameIdx < FAKE_NAMES.length; i++) {
      const name = FAKE_NAMES[nameIdx]!;
      nameIdx++;
      players.push({
        userId: uuidFromSeed(`seed-player-${name}`),
        username: name.toLowerCase(),
        displayName: name,
        avatar: pick(AVATARS),
        rating: rand(range.min, range.max),
        gamesPlayed: rand(8, 120),
      });
    }
  }

  // Sort by rating descending for leaderboard
  players.sort((a, b) => b.rating - a.rating);
  seedPlayers = players;
  return players;
}

/**
 * Insert a dev user into the leaderboard at a reasonable position.
 * Returns the enriched player list.
 */
function getLeaderboardWithUser(
  userId: string,
  username: string,
): SeedPlayer[] {
  const players = [...generateSeedPlayers()];

  // Check if user is already in the list
  if (players.some(p => p.userId === userId)) return players;

  // Insert the user at a reasonable position (Gold tier)
  const userPlayer: SeedPlayer = {
    userId,
    username,
    displayName: username,
    avatar: null,
    rating: rand(1180, 1320),
    gamesPlayed: rand(12, 45),
  };

  players.push(userPlayer);
  players.sort((a, b) => b.rating - a.rating);
  return players;
}

export function getDevLeaderboard(
  mode: RankedMode,
  period: LeaderboardPeriod,
  limit: number,
  offset: number,
  currentUserId?: string,
  currentUsername?: string,
): LeaderboardResponse {
  const allPlayers = currentUserId && currentUsername
    ? getLeaderboardWithUser(currentUserId, currentUsername)
    : generateSeedPlayers();

  const entries: LeaderboardEntry[] = allPlayers
    .slice(offset, offset + limit)
    .map((p, idx) => ({
      rank: offset + idx + 1,
      userId: p.userId,
      username: p.username,
      displayName: p.displayName,
      avatar: p.avatar,
      rating: p.rating,
      gamesPlayed: p.gamesPlayed,
      tier: getRankTier(p.rating),
    }));

  let currentUser: LeaderboardEntry | null = null;
  if (currentUserId) {
    const userIdx = allPlayers.findIndex(p => p.userId === currentUserId);
    if (userIdx >= 0) {
      const p = allPlayers[userIdx]!;
      currentUser = {
        rank: userIdx + 1,
        userId: p.userId,
        username: p.username,
        displayName: p.displayName,
        avatar: p.avatar,
        rating: p.rating,
        gamesPlayed: p.gamesPlayed,
        tier: getRankTier(p.rating),
      };
    }
  }

  return {
    mode,
    period,
    entries,
    totalCount: allPlayers.length,
    currentUser,
  };
}

export function getDevLeaderboardNearby(
  mode: RankedMode,
  userId: string,
  username: string,
): LeaderboardNearbyResponse | null {
  const allPlayers = getLeaderboardWithUser(userId, username);
  const userIdx = allPlayers.findIndex(p => p.userId === userId);
  if (userIdx < 0) return null;

  const start = Math.max(0, userIdx - 5);
  const end = Math.min(allPlayers.length, userIdx + 6);
  const nearby = allPlayers.slice(start, end);

  const entries: LeaderboardEntry[] = nearby.map((p, idx) => ({
    rank: start + idx + 1,
    userId: p.userId,
    username: p.username,
    displayName: p.displayName,
    avatar: p.avatar,
    rating: p.rating,
    gamesPlayed: p.gamesPlayed,
    tier: getRankTier(p.rating),
  }));

  const userEntry = entries.find(e => e.userId === userId)!;

  return {
    mode,
    entries,
    currentUser: userEntry,
  };
}

// ── Stats seed data ───────────────────────────────────────────────────────

/** Cache stats per userId so repeated calls return consistent data. */
const statsCache = new Map<string, PlayerStatsResponse>();

export function getDevPlayerStats(userId: string): PlayerStatsResponse {
  const cached = statsCache.get(userId);
  if (cached) return cached;

  const gamesPlayed = rand(15, 80);
  const wins = rand(Math.floor(gamesPlayed * 0.15), Math.floor(gamesPlayed * 0.45));
  const bullsCalled = rand(gamesPlayed * 2, gamesPlayed * 5);
  const correctBulls = Math.floor(bullsCalled * (0.4 + Math.random() * 0.3));
  const truesCalled = rand(gamesPlayed, gamesPlayed * 3);
  const correctTrues = Math.floor(truesCalled * (0.45 + Math.random() * 0.3));
  const callsMade = rand(gamesPlayed * 3, gamesPlayed * 8);
  const bluffsSuccessful = Math.floor(callsMade * (0.3 + Math.random() * 0.35));

  const recentGames = generateRecentGames(userId, Math.min(gamesPlayed, 10));

  const stats: PlayerStatsResponse = {
    userId,
    gamesPlayed,
    wins,
    winRate: Math.round((wins / gamesPlayed) * 100),
    avgFinishPosition: parseFloat((1 + Math.random() * 2.5).toFixed(1)),
    avgFinishPercentile: rand(40, 85),
    bullAccuracy: Math.round((correctBulls / bullsCalled) * 100),
    trueAccuracy: Math.round((correctTrues / truesCalled) * 100),
    bluffSuccessRate: Math.round((bluffsSuccessful / callsMade) * 100),
    rankedGamesPlayed: rand(0, Math.floor(gamesPlayed * 0.6)),
    gamesByPlayerCount: {
      '2': rand(3, 15),
      '3': rand(2, 12),
      '4': rand(5, 20),
      '5': rand(2, 10),
    },
    recentGames,
  };

  statsCache.set(userId, stats);
  return stats;
}

// ── Game history seed data ────────────────────────────────────────────────

function generateRecentGames(userId: string, count: number): GameHistoryEntry[] {
  const games: GameHistoryEntry[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const playerCount = rand(2, 6);
    const finishPosition = rand(1, playerCount);
    const durationSeconds = rand(120, 600);
    const startTime = now - rand(3600_000, 7 * 24 * 3600_000); // past week
    const endTime = startTime + durationSeconds * 1000;
    const winnerName = finishPosition === 1 ? 'You' : pick(FAKE_NAMES);

    const gameStats: PlayerGameStats = {
      bullsCalled: rand(1, 8),
      truesCalled: rand(0, 5),
      callsMade: rand(3, 12),
      correctBulls: rand(0, 5),
      correctTrues: rand(0, 3),
      bluffsSuccessful: rand(1, 6),
      roundsSurvived: rand(2, 10),
    };

    const settings: GameSettings = {
      maxCards: 5,
      turnTimer: 30,
      maxPlayers: 9,
      ranked: true,
      rankedMode: playerCount === 2 ? 'heads_up' : 'multiplayer',
    };

    games.push({
      id: uuidFromSeed(`dev-game-${userId}-${i}`),
      roomCode: `DEV${rand(1000, 9999)}`,
      winnerName,
      playerCount,
      settings,
      startedAt: new Date(startTime).toISOString(),
      endedAt: new Date(endTime).toISOString(),
      durationSeconds,
      finishPosition,
      playerName: 'You',
      finalCardCount: finishPosition === 1 ? rand(1, 3) : 5,
      stats: gameStats,
    });
  }

  // Sort by most recent first
  games.sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
  return games;
}

export function getDevGameHistory(
  userId: string,
  limit: number,
  offset: number,
): { games: GameHistoryEntry[]; total: number } {
  const allGames = generateRecentGames(userId, 10);
  return {
    games: allGames.slice(offset, offset + limit),
    total: allGames.length,
  };
}

// ── Advanced stats seed data ──────────────────────────────────────────────

const advancedStatsCache = new Map<string, AdvancedStatsResponse>();

export function getDevAdvancedStats(userId: string): AdvancedStatsResponse {
  const cached = advancedStatsCache.get(userId);
  if (cached) return cached;

  const handBreakdown: HandTypeBreakdown[] = [];
  for (let ht = 0; ht <= 9; ht++) {
    const timesCalled = rand(0, 30);
    handBreakdown.push({
      handType: ht,
      timesCalled,
      timesExisted: Math.floor(timesCalled * (0.3 + Math.random() * 0.5)),
      bullsAgainstCorrect: rand(0, 5),
      bullsAgainstTotal: rand(0, 10),
    });
  }

  // Rating history: ~15 points showing a believable progression
  const ratingHistory: RatingHistoryEntry[] = [];
  let currentRating = ELO_DEFAULT;
  const now = Date.now();
  for (let i = 0; i < 15; i++) {
    const delta = rand(-25, 30);
    const newRating = Math.max(800, currentRating + delta);
    const createdAt = new Date(now - (15 - i) * 12 * 3600_000).toISOString();

    ratingHistory.push({
      gameId: uuidFromSeed(`dev-rating-${userId}-${i}`),
      mode: 'heads_up',
      ratingBefore: currentRating,
      ratingAfter: newRating,
      delta: newRating - currentRating,
      createdAt,
    });
    currentRating = newRating;
  }

  const performanceByPlayerCount: PerformanceByPlayerCount[] = [
    { playerCount: 2, gamesPlayed: rand(5, 20), wins: rand(2, 10), winRate: rand(30, 65), avgFinish: 1.5 },
    { playerCount: 3, gamesPlayed: rand(3, 15), wins: rand(1, 7), winRate: rand(20, 50), avgFinish: 1.8 },
    { playerCount: 4, gamesPlayed: rand(5, 25), wins: rand(2, 8), winRate: rand(15, 40), avgFinish: 2.1 },
  ];

  const todaySession: TodaySession = {
    gamesPlayed: rand(2, 8),
    wins: rand(0, 3),
    netRatingChange: rand(-30, 45),
    bullAccuracy: rand(40, 75),
  };

  const opponents: OpponentRecord[] = [];
  for (let i = 0; i < 5; i++) {
    const name = FAKE_NAMES[i]!;
    const gp = rand(3, 15);
    const w = rand(0, gp);
    opponents.push({
      opponentId: uuidFromSeed(`seed-player-${name}`),
      opponentName: name,
      opponentUsername: name.toLowerCase().replace(/\s+/g, '_'),
      opponentAvatar: pick(AVATARS),
      gamesPlayed: gp,
      wins: w,
      losses: gp - w,
    });
  }

  const result: AdvancedStatsResponse = {
    userId,
    handBreakdown,
    ratingHistory,
    performanceByPlayerCount,
    todaySession,
    opponentRecords: opponents,
    bluffHeatMap: [],
    winProbabilityTimeline: [],
    rivalries: [],
    careerTrajectory: [],
  };

  advancedStatsCache.set(userId, result);
  return result;
}

// ── Ratings seed data ─────────────────────────────────────────────────────

const ratingsCache = new Map<string, UserRatings>();

export function getDevUserRatings(userId: string): UserRatings {
  const cached = ratingsCache.get(userId);
  if (cached) return cached;

  const eloRating = rand(1100, 1400);
  const mu = 25 + (Math.random() - 0.5) * 10;
  const sigma = 8.333 - Math.random() * 2;
  const now = new Date().toISOString();

  const headsUp: EloRating = {
    mode: 'heads_up',
    elo: eloRating,
    gamesPlayed: rand(10, 50),
    peakRating: eloRating + rand(0, 100),
    lastUpdated: now,
  };

  const multiplayer: OpenSkillRating = {
    mode: 'multiplayer',
    mu,
    sigma,
    gamesPlayed: rand(5, 30),
    peakRating: Math.round(mu * 48) + rand(0, 80),
    lastUpdated: now,
  };

  const ratings: UserRatings = { userId, headsUp, multiplayer };
  ratingsCache.set(userId, ratings);
  return ratings;
}

// ── Profile seed data (for GET /auth/me) ──────────────────────────────────

export function getDevPublicProfile(userId: string, username: string): PublicProfile {
  const stats = getDevPlayerStats(userId);
  return {
    id: userId,
    username,
    displayName: username,
    avatar: null,
    photoUrl: null,
    createdAt: new Date(Date.now() - 30 * 24 * 3600_000).toISOString(),
    gamesPlayed: stats.gamesPlayed,
    gamesWon: stats.wins,
    bullAccuracy: stats.bullAccuracy,
    bluffSuccessRate: stats.bluffSuccessRate,
  };
}

export function logDevSeedDataActive(): void {
  logger.info(
    '🎲 Dev seed data active — serving generated leaderboard, stats, match history, and ratings',
  );
}
