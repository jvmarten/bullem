/**
 * Recent players tracker — stores players you've played with in localStorage.
 * Used to show a "Recent Players" section on the home page for social reconnection.
 */

const STORAGE_KEY = 'bull-em-recent-players';
const MAX_RECENT_PLAYERS = 20;

export interface RecentPlayer {
  /** Player display name */
  name: string;
  /** Last room code played together */
  lastRoomCode: string;
  /** Unix timestamp (ms) of the last game together */
  lastPlayedAt: number;
}

/** Load recent players from localStorage, sorted by most recent first. */
export function getRecentPlayers(): RecentPlayer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Basic shape validation
    return parsed.filter(
      (p): p is RecentPlayer =>
        typeof p === 'object' &&
        p !== null &&
        typeof p.name === 'string' &&
        typeof p.lastRoomCode === 'string' &&
        typeof p.lastPlayedAt === 'number',
    );
  } catch {
    return [];
  }
}

/** Save recent players to localStorage. */
function saveRecentPlayers(players: RecentPlayer[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

/**
 * Record players from a completed game. Call this when a game ends.
 * Filters out the current player and bots. Updates existing entries
 * or adds new ones, keeping the list capped at MAX_RECENT_PLAYERS.
 */
export function recordRecentPlayers(
  playerNames: string[],
  myName: string,
  roomCode: string,
): void {
  const now = Date.now();
  const existing = getRecentPlayers();

  // Build a map for O(1) lookups by name (case-insensitive)
  const byName = new Map<string, RecentPlayer>();
  for (const p of existing) {
    byName.set(p.name.toLowerCase(), p);
  }

  // Update or add each player from the game
  for (const name of playerNames) {
    // Skip self
    if (name.toLowerCase() === myName.toLowerCase()) continue;

    const key = name.toLowerCase();
    byName.set(key, {
      name,
      lastRoomCode: roomCode,
      lastPlayedAt: now,
    });
  }

  // Sort by most recent first, cap at limit
  const updated = [...byName.values()]
    .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, MAX_RECENT_PLAYERS);

  saveRecentPlayers(updated);
}

/** Clear all recent players (e.g., for a "clear history" action). */
export function clearRecentPlayers(): void {
  localStorage.removeItem(STORAGE_KEY);
}
