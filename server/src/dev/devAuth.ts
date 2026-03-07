/**
 * Dev auth module — when dev auth is active (no DATABASE_URL, not production),
 * login and register accept any credentials and return a fake user with a real
 * signed JWT. The JWT is real, so existing auth middleware and socket middleware
 * work without changes.
 *
 * Guarded behind `isDevAuthActive()` — must never activate in production.
 */

import crypto from 'node:crypto';
import { Router } from 'express';
import type { User, AuthResponse, PublicProfile } from '@bull-em/shared';
import { signToken } from '../auth/jwt.js';
import { cookieOptions } from '../auth/routes.js';
import { requireAuth, AUTH_COOKIE_NAME } from '../auth/middleware.js';
import { getDevPublicProfile } from './devSeedData.js';
import logger from '../logger.js';

/**
 * Generate a stable, deterministic userId from a username.
 * Same username always produces the same UUID, enabling consistent identity
 * across dev sessions without a database.
 */
export function deterministicUserId(username: string): string {
  const hash = crypto.createHash('sha256').update(`dev-user:${username}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

function makeFakeUser(username: string): User {
  const userId = deterministicUserId(username);
  // DevPlayer gets admin role in dev mode — enables admin features for testing
  const role = username === 'DevPlayer' ? 'admin' : 'user';
  return {
    id: userId,
    username,
    displayName: username,
    email: `${username.toLowerCase()}@dev.local`,
    role,
    authProvider: 'email',
    avatar: null,
    photoUrl: null,
    createdAt: new Date(Date.now() - 30 * 24 * 3600_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
}

/**
 * Create an Express router that overrides /auth/register, /auth/login, and
 * /auth/me with dev-mode implementations. Mount this BEFORE the real auth
 * router so it takes precedence.
 */
export function createDevAuthRouter(): Router {
  const router = Router();

  // POST /auth/register — accept any valid-looking credentials
  router.post('/register', (req, res) => {
    const { username } = req.body as { username?: string };

    if (!username || username.trim().length < 2) {
      res.status(400).json({ error: 'Username is required (min 2 characters)' });
      return;
    }

    const trimmedUsername = username.trim();
    const user = makeFakeUser(trimmedUsername);
    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    const response: AuthResponse = { user };

    logger.debug({ userId: user.id, username: trimmedUsername }, 'Dev auth: registered fake user');

    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    res.status(201).json(response);
  });

  // POST /auth/login — accept any credentials
  router.post('/login', (req, res) => {
    const { identifier, email: legacyEmail } = req.body as {
      identifier?: string;
      email?: string;
    };

    const loginId = identifier ?? legacyEmail;
    if (!loginId || loginId.trim().length < 2) {
      res.status(400).json({ error: 'Username/email is required' });
      return;
    }

    // Use the identifier as the username (strip @domain if it looks like email)
    const trimmed = loginId.trim();
    const username = trimmed.includes('@') ? trimmed.split('@')[0]! : trimmed;

    const user = makeFakeUser(username);
    const token = signToken({ userId: user.id, username: user.username, role: user.role });
    const response: AuthResponse = { user };

    logger.debug({ userId: user.id, username }, 'Dev auth: logged in fake user');

    res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
    res.json(response);
  });

  // GET /auth/me — return fake user from the JWT (no DB hit)
  router.get('/me', requireAuth, (req, res) => {
    const { userId, username } = req.user!;
    const user = makeFakeUser(username);
    const profile: PublicProfile = getDevPublicProfile(userId, username);

    res.json({ user, profile });
  });

  return router;
}

export function logDevAuthActive(): void {
  logger.info(
    '🔓 Dev auth active — login/register accept any credentials (no database)',
  );
}
