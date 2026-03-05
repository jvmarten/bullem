import { Router } from 'express';
import type { User, AuthResponse, PublicProfile } from '@bull-em/shared';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { requireAuth, AUTH_COOKIE_NAME } from './middleware.js';
import { query } from '../db/index.js';
import logger from '../logger.js';

const router = Router();

/** Max length constraints for user input. */
const MAX_USERNAME_LENGTH = 20;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/** Regex: alphanumeric + underscores, starts with a letter. */
const USERNAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_]{1,19}$/;

/** Basic email format check. Not exhaustive — the DB UNIQUE constraint is the real guard. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cookie options for the auth JWT. */
function cookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };
}

// ── POST /auth/register ─────────────────────────────────────────────────

router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body as {
      username?: string;
      email?: string;
      password?: string;
    };

    // Validate inputs
    if (!username || !email || !password) {
      res.status(400).json({ error: 'Username, email, and password are required' });
      return;
    }

    const trimmedUsername = username.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!USERNAME_REGEX.test(trimmedUsername)) {
      res.status(400).json({
        error: 'Username must be 2–20 characters, start with a letter, and contain only letters, numbers, and underscores',
      });
      return;
    }

    if (trimmedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(trimmedEmail)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      res.status(400).json({
        error: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters`,
      });
      return;
    }

    const passwordHash = await hashPassword(password);

    const result = await query<{
      id: string;
      username: string;
      display_name: string;
      email: string;
      auth_provider: string;
      created_at: string;
      last_seen_at: string;
    }>(
      `INSERT INTO users (username, display_name, email, password_hash, auth_provider)
       VALUES ($1, $2, $3, $4, 'email')
       RETURNING id, username, display_name, email, auth_provider, created_at, last_seen_at`,
      [trimmedUsername, trimmedUsername, trimmedEmail, passwordHash],
    );

    if (!result || result.rows.length === 0) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    const row = result.rows[0]!;
    const user: User = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      authProvider: 'email',
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };

    const token = signToken({ userId: user.id, username: user.username });
    const response: AuthResponse = { user };

    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    res.status(201).json(response);
  } catch (err: unknown) {
    // Handle unique constraint violations (duplicate username/email)
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      const detail = 'detail' in err ? String((err as { detail: string }).detail) : '';
      if (detail.includes('username')) {
        res.status(409).json({ error: 'Username already taken' });
      } else if (detail.includes('email')) {
        res.status(409).json({ error: 'Email already registered' });
      } else {
        res.status(409).json({ error: 'Username or email already in use' });
      }
      return;
    }
    logger.error({ err }, 'Registration failed');
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ── POST /auth/login ────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    const result = await query<{
      id: string;
      username: string;
      display_name: string;
      email: string;
      password_hash: string | null;
      auth_provider: string;
      created_at: string;
      last_seen_at: string;
    }>(
      'SELECT id, username, display_name, email, password_hash, auth_provider, created_at, last_seen_at FROM users WHERE email = $1',
      [trimmedEmail],
    );

    if (!result || result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const row = result.rows[0]!;

    if (!row.password_hash) {
      res.status(401).json({ error: 'This account uses a different sign-in method' });
      return;
    }

    const valid = await verifyPassword(password, row.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    // Update last_seen_at
    await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [row.id]);

    const user: User = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      authProvider: 'email',
      createdAt: row.created_at,
      lastSeenAt: new Date().toISOString(),
    };

    const token = signToken({ userId: user.id, username: user.username });
    const response: AuthResponse = { user };

    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    res.json(response);
  } catch (err) {
    logger.error({ err }, 'Login failed');
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── POST /auth/logout ───────────────────────────────────────────────────

router.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ── GET /auth/me ────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;

    // Fetch user + aggregated stats from game_players
    const userResult = await query<{
      id: string;
      username: string;
      display_name: string;
      email: string;
      created_at: string;
      last_seen_at: string;
    }>(
      'SELECT id, username, display_name, email, created_at, last_seen_at FROM users WHERE id = $1',
      [userId],
    );

    if (!userResult || userResult.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const row = userResult.rows[0]!;

    // Aggregate stats from game_players table
    const statsResult = await query<{
      games_played: string;
      games_won: string;
      total_correct_bulls: string;
      total_bulls_called: string;
      total_bluffs_successful: string;
      total_calls_made: string;
    }>(
      `SELECT
        COUNT(*)::text AS games_played,
        COUNT(*) FILTER (WHERE finish_position = 1)::text AS games_won,
        COALESCE(SUM((stats->>'correctBulls')::int), 0)::text AS total_correct_bulls,
        COALESCE(SUM((stats->>'bullsCalled')::int), 0)::text AS total_bulls_called,
        COALESCE(SUM((stats->>'bluffsSuccessful')::int), 0)::text AS total_bluffs_successful,
        COALESCE(SUM((stats->>'callsMade')::int), 0)::text AS total_calls_made
       FROM game_players
       WHERE user_id = $1`,
      [userId],
    );

    const stats = statsResult?.rows[0];
    const bullsCalled = stats ? parseInt(stats.total_bulls_called, 10) : 0;
    const correctBulls = stats ? parseInt(stats.total_correct_bulls, 10) : 0;
    const callsMade = stats ? parseInt(stats.total_calls_made, 10) : 0;
    const bluffsSuccessful = stats ? parseInt(stats.total_bluffs_successful, 10) : 0;

    const profile: PublicProfile = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      createdAt: row.created_at,
      gamesPlayed: stats ? parseInt(stats.games_played, 10) : 0,
      gamesWon: stats ? parseInt(stats.games_won, 10) : 0,
      bullAccuracy: bullsCalled > 0 ? Math.round((correctBulls / bullsCalled) * 100) : null,
      bluffSuccessRate: callsMade > 0 ? Math.round((bluffsSuccessful / callsMade) * 100) : null,
    };

    // Also include email for the current user's own profile
    const user: User = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      authProvider: 'email',
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };

    res.json({ user, profile });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch profile');
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

export { router as authRouter };
