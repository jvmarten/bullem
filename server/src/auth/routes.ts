import express, { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import type { User, AuthResponse, PublicProfile, AvatarId } from '@bull-em/shared';
import { AVATAR_OPTIONS } from '@bull-em/shared';
import { hashPassword, verifyPassword } from './password.js';
import { signToken } from './jwt.js';
import { requireAuth, AUTH_COOKIE_NAME } from './middleware.js';
import { query } from '../db/index.js';
import { pool } from '../db/index.js';
import { getGameHistory } from '../db/games.js';
import { sendPasswordResetEmail } from '../email/index.js';
import logger from '../logger.js';
import type { RateLimiter } from '../rateLimit.js';
import { httpRequestsTotal } from '../metrics.js';
import { track } from '../analytics/track.js';

const router = Router();

/** Singleton RateLimiter instance, set via setAuthRateLimiter(). */
let rateLimiter: RateLimiter | null = null;

/** Configure the rate limiter for auth endpoints. Called once during startup. */
export function setAuthRateLimiter(limiter: RateLimiter): void {
  rateLimiter = limiter;
}

/** Rate limit config for auth endpoints. */
const AUTH_RATE_LIMIT_MAX = 10;        // max attempts per window
const AUTH_RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Express middleware: rate-limit by IP for brute-force protection.
 * Uses the shared RateLimiter (Redis-backed when available).
 */
function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!rateLimiter) {
    // No rate limiter configured — allow through (dev/test without Redis)
    next();
    return;
  }

  // Use X-Forwarded-For (Fly.io / reverse proxy) or fall back to socket address
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const key = `auth:${ip}`;

  void rateLimiter.checkWindow(key, AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW_MS).then((allowed) => {
    if (!allowed) {
      httpRequestsTotal.inc('auth_rate_limited');
      logger.warn({ ip, path: req.path }, 'Auth rate limit exceeded');
      res.status(429).json({ error: 'Too many requests — please try again later' });
      return;
    }
    next();
  }).catch((err) => {
    // Fail-open: if rate limit check fails, allow the request
    logger.warn({ err, ip }, 'Auth rate limit check failed — allowing request');
    next();
  });
}

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
export function cookieOptions(): {
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

router.post('/register', authRateLimit, async (req, res) => {
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

    // Use pool.query() directly (not the query() wrapper) so that constraint
    // violation errors (e.g., duplicate username/email — code 23505) propagate
    // to the catch block below. The query() wrapper catches all errors and
    // returns null, which would mask the violation as "Database unavailable."
    if (!pool) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    const result = await pool.query<{
      id: string;
      username: string;
      display_name: string;
      email: string;
      role: string;
      avatar: string | null;
      photo_url: string | null;
      auth_provider: string;
      created_at: string;
      last_seen_at: string;
    }>(
      `INSERT INTO users (username, display_name, email, password_hash, auth_provider)
       VALUES ($1, $2, $3, $4, 'email')
       RETURNING id, username, display_name, email, role, avatar, photo_url, auth_provider, created_at, last_seen_at`,
      [trimmedUsername, trimmedUsername, trimmedEmail, passwordHash],
    );

    if (result.rows.length === 0) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    const row = result.rows[0]!;
    const user: User = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      role: row.role as User['role'],
      authProvider: 'email',
      avatar: row.avatar as AvatarId | null,
      photoUrl: row.photo_url,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };

    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    const response: AuthResponse = { user };

    track('player:registered', { authMethod: 'email' }, user.id);

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

router.post('/login', authRateLimit, async (req, res) => {
  try {
    const { identifier, email: legacyEmail, password } = req.body as {
      identifier?: string;
      email?: string;
      password?: string;
    };

    // Support both 'identifier' (new) and 'email' (legacy) fields
    const loginId = identifier ?? legacyEmail;

    if (!loginId || !password) {
      res.status(400).json({ error: 'Username/email and password are required' });
      return;
    }

    const trimmedId = loginId.trim().toLowerCase();
    const isEmail = trimmedId.includes('@');

    const result = await query<{
      id: string;
      username: string;
      display_name: string;
      email: string;
      role: string;
      avatar: string | null;
      photo_url: string | null;
      password_hash: string | null;
      auth_provider: string;
      created_at: string;
      last_seen_at: string;
    }>(
      isEmail
        ? 'SELECT id, username, display_name, email, role, avatar, photo_url, password_hash, auth_provider, created_at, last_seen_at FROM users WHERE email = $1'
        : 'SELECT id, username, display_name, email, role, avatar, photo_url, password_hash, auth_provider, created_at, last_seen_at FROM users WHERE LOWER(username) = $1',
      [trimmedId],
    );

    if (!result || result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const row = result.rows[0]!;

    if (!row.password_hash) {
      const providerName = row.auth_provider === 'apple' ? 'Apple' : 'Google';
      res.status(401).json({ error: `This account uses ${providerName} sign-in. Use the 'Continue with ${providerName}' button to log in.` });
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
      role: row.role as User['role'],
      authProvider: row.auth_provider as User['authProvider'],
      avatar: row.avatar as AvatarId | null,
      photoUrl: row.photo_url,
      createdAt: row.created_at,
      lastSeenAt: new Date().toISOString(),
    };

    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    const response: AuthResponse = { user };

    track('player:login', { authMethod: 'email' }, user.id);

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
      role: string;
      avatar: string | null;
      photo_url: string | null;
      auth_provider: string;
      created_at: string;
      last_seen_at: string;
    }>(
      'SELECT id, username, display_name, email, role, avatar, photo_url, auth_provider, created_at, last_seen_at FROM users WHERE id = $1',
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
      avatar: row.avatar as AvatarId | null,
      photoUrl: row.photo_url,
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
      role: row.role as User['role'],
      authProvider: row.auth_provider as User['authProvider'],
      avatar: row.avatar as AvatarId | null,
      photoUrl: row.photo_url,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };

    res.json({ user, profile });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch profile');
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// ── PATCH /auth/avatar ──────────────────────────────────────────────────

router.patch('/avatar', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { avatar } = req.body as { avatar?: string | null };

    // Allow null to clear avatar, otherwise validate against known options
    if (avatar !== null && avatar !== undefined) {
      if (!(AVATAR_OPTIONS as readonly string[]).includes(avatar)) {
        res.status(400).json({ error: 'Invalid avatar option' });
        return;
      }
    }

    await query(
      'UPDATE users SET avatar = $1 WHERE id = $2',
      [avatar ?? null, userId],
    );

    res.json({ ok: true, avatar: avatar ?? null });
  } catch (err) {
    logger.error({ err }, 'Failed to update avatar');
    res.status(500).json({ error: 'Failed to update avatar' });
  }
});

// ── POST /auth/upload-photo ──────────────────────────────────────────
// Allows admin users to upload a profile photo from their device.
// Accepts JSON { photo: "<base64 data URL>" } and stores it in photo_url.
// TODO(scale): Migrate to S3/R2 object storage when photo count or payload size warrants it.

/** Max allowed photo payload size: 2 MB base64 (~1.5 MB raw image). */
const MAX_PHOTO_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const DATA_URL_REGEX = /^data:(image\/(?:jpeg|png|webp));base64,/;

router.post('/upload-photo', express.json({ limit: '3mb' }), requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const role = req.user!.role;

    if (role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    const { photo } = req.body as { photo?: string | null };

    // Allow null to clear photo
    if (photo === null || photo === undefined || photo === '') {
      await query('UPDATE users SET photo_url = NULL WHERE id = $1', [userId]);
      res.json({ ok: true, photoUrl: null });
      return;
    }

    if (typeof photo !== 'string') {
      res.status(400).json({ error: 'Photo must be a base64 data URL string' });
      return;
    }

    // Validate data URL format
    const match = DATA_URL_REGEX.exec(photo);
    if (!match) {
      res.status(400).json({
        error: `Invalid photo format. Allowed types: ${ALLOWED_PHOTO_TYPES.join(', ')}`,
      });
      return;
    }

    // Check size (base64 string length is a reasonable proxy)
    if (photo.length > MAX_PHOTO_SIZE_BYTES) {
      res.status(400).json({ error: 'Photo too large. Maximum size is ~1.5 MB.' });
      return;
    }

    await query('UPDATE users SET photo_url = $1 WHERE id = $2', [photo, userId]);

    logger.info({ userId }, 'Admin uploaded profile photo');
    res.json({ ok: true, photoUrl: photo });
  } catch (err) {
    logger.error({ err }, 'Failed to upload photo');
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// ── GET /auth/games ──────────────────────────────────────────────────

router.get('/games', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 50);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    const result = await getGameHistory(userId, limit, offset);
    if (!result) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch game history');
    res.status(500).json({ error: 'Failed to fetch game history' });
  }
});

// ── POST /auth/forgot-password ──────────────────────────────────────────

/** SHA-256 hash a plaintext token for storage/lookup. */
function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Password reset token lifetime: 1 hour. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

router.post('/forgot-password', authRateLimit, async (req, res) => {
  // Always return the same response to prevent email enumeration
  const genericMessage = 'If an account with that email exists, we sent a password reset link.';

  try {
    const { email } = req.body as { email?: string };

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();
    if (trimmedEmail.length > MAX_EMAIL_LENGTH || !EMAIL_REGEX.test(trimmedEmail)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    // Look up user — if not found, still return success (anti-enumeration)
    const userResult = await query<{ id: string; auth_provider: string }>(
      'SELECT id, auth_provider FROM users WHERE email = $1',
      [trimmedEmail],
    );

    if (!userResult || userResult.rows.length === 0) {
      res.json({ message: genericMessage });
      return;
    }

    const user = userResult.rows[0]!;

    // Only allow password reset for email auth users
    if (user.auth_provider !== 'email') {
      res.json({ message: genericMessage });
      return;
    }

    // Generate token, hash it, and store in DB
    const plainToken = crypto.randomUUID();
    const tokenHash = sha256(plainToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    if (!pool) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt.toISOString()],
    );

    // Send email (fire-and-forget — don't block response on email delivery)
    sendPasswordResetEmail(trimmedEmail, plainToken).catch((err) => {
      logger.error({ err, email: trimmedEmail }, 'Failed to send password reset email');
    });

    res.json({ message: genericMessage });
  } catch (err) {
    logger.error({ err }, 'Forgot password failed');
    // Still return generic message to prevent information leakage
    res.json({ message: genericMessage });
  }
});

// ── POST /auth/reset-password ───────────────────────────────────────────

router.post('/reset-password', authRateLimit, async (req, res) => {
  try {
    const { token, password } = req.body as { token?: string; password?: string };

    if (!token || !password) {
      res.status(400).json({ error: 'Token and password are required' });
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      res.status(400).json({
        error: `Password must be ${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH} characters`,
      });
      return;
    }

    const tokenHash = sha256(token);

    if (!pool) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    // Find a matching, non-expired, unused token
    const tokenResult = await pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_reset_tokens
       WHERE token_hash = $1
         AND expires_at > NOW()
         AND used_at IS NULL`,
      [tokenHash],
    );

    if (tokenResult.rows.length === 0) {
      res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
      return;
    }

    const resetRow = tokenResult.rows[0]!;

    // Hash the new password and update the user
    const passwordHash = await hashPassword(password);

    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [passwordHash, resetRow.user_id],
    );

    // Mark the token as used
    await pool.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1',
      [resetRow.id],
    );

    res.json({ message: 'Password has been reset successfully.' });
  } catch (err) {
    logger.error({ err }, 'Reset password failed');
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ── PATCH /auth/username ─────────────────────────────────────────────────

router.patch('/username', requireAuth, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { username } = req.body as { username?: string };

    if (!username) {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    const trimmed = username.trim();

    if (!USERNAME_REGEX.test(trimmed)) {
      res.status(400).json({
        error: 'Username must be 2–20 characters, start with a letter, and contain only letters, numbers, and underscores',
      });
      return;
    }

    if (!pool) {
      res.status(503).json({ error: 'Database unavailable' });
      return;
    }

    // Check current username — skip if unchanged
    const currentResult = await query<{ username: string }>(
      'SELECT username FROM users WHERE id = $1',
      [userId],
    );

    if (currentResult && currentResult.rows.length > 0 && currentResult.rows[0]!.username === trimmed) {
      res.json({ ok: true, username: trimmed });
      return;
    }

    try {
      await pool.query(
        'UPDATE users SET username = $1 WHERE id = $2',
        [trimmed, userId],
      );
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
        res.status(409).json({ error: 'Username already taken' });
        return;
      }
      throw err;
    }

    // Issue a new JWT with the updated username
    const userResult = await query<{ role: string }>(
      'SELECT role FROM users WHERE id = $1',
      [userId],
    );
    const role = userResult?.rows[0]?.role as 'user' | 'admin' ?? 'user';
    const token = signToken({ userId, username: trimmed, role });
    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());

    track('player:username_changed', {}, userId);
    res.json({ ok: true, username: trimmed });
  } catch (err) {
    logger.error({ err }, 'Failed to update username');
    res.status(500).json({ error: 'Failed to update username' });
  }
});

export { router as authRouter };
