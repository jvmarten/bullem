import type { GameReplay, ReplayListEntry } from '@bull-em/shared';

// Vite proxies /auth and /api to the server in dev — relative URLs work from any device.
const API_BASE = '';

/**
 * Fetch the replay list from the server API.
 * Authenticated users get their own replays; guests get recent public replays.
 */
export async function fetchReplayList(
  limit = 20,
  offset = 0,
): Promise<{ replays: ReplayListEntry[]; total: number }> {
  const res = await fetch(`${API_BASE}/api/replays?limit=${limit}&offset=${offset}`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch replays: ${res.status}`);
  }
  return res.json() as Promise<{ replays: ReplayListEntry[]; total: number }>;
}

/**
 * Fetch a full game replay by game ID from the server API.
 * Returns null if the replay is not found or the server is unavailable.
 */
export async function fetchReplay(gameId: string): Promise<GameReplay | null> {
  try {
    const res = await fetch(`${API_BASE}/api/replays/${encodeURIComponent(gameId)}`, {
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json() as { replay: GameReplay };
    return data.replay;
  } catch {
    return null;
  }
}
