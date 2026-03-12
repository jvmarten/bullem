import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { signToken } from './jwt.js';
import { AUTH_COOKIE_NAME } from './middleware.js';
import { cookieOptions } from './routes.js';
import { query } from '../db/index.js';
import { pool } from '../db/index.js';
import logger from '../logger.js';
import { track } from '../analytics/track.js';

const router = Router();

/** Build the Google OAuth redirect URI based on environment. */
function getRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3001/auth/google/callback';
  }
  return 'https://bullem.cards/auth/google/callback';
}

// ── GET /auth/google ─────────────────────────────────────────────────────

router.get('/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    logger.error('GOOGLE_CLIENT_ID is not set');
    res.redirect('/login?error=oauth_failed');
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');

  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

// ── GET /auth/google/callback ────────────────────────────────────────────

interface GoogleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    const cookieState = req.cookies?.oauth_state as string | undefined;

    // Always clear the state cookie
    res.clearCookie('oauth_state', { path: '/' });

    // Verify state
    if (!state || !cookieState || state !== cookieState) {
      logger.warn('OAuth state mismatch');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    if (!code) {
      logger.warn('OAuth callback missing code');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      logger.error('Google OAuth credentials not configured');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    // Exchange code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      logger.error({ status: tokenRes.status }, 'Google token exchange failed');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    const tokenData = await tokenRes.json() as GoogleTokenResponse;

    // Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      logger.error({ status: profileRes.status }, 'Google userinfo fetch failed');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    const profile = await profileRes.json() as GoogleUserInfo;
    const { id: googleId, email, name } = profile;

    if (!email || !googleId) {
      logger.error('Google profile missing email or id');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    if (!pool) {
      logger.error('Database unavailable during OAuth');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    // 1. Look up by oauth_id
    const oauthResult = await query<{ id: string; username: string; role: string }>(
      `SELECT id, username, role FROM users
       WHERE oauth_id = $1 AND auth_provider IN ('google', 'email+google')`,
      [googleId],
    );

    if (oauthResult && oauthResult.rows.length > 0) {
      const row = oauthResult.rows[0]!;
      await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [row.id]);
      track('player:login', { authMethod: 'google' }, row.id);
      const token = signToken({ userId: row.id, username: row.username, role: row.role as 'user' | 'admin' });
      res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
      res.redirect('/');
      return;
    }

    // 2. Look up by email — link accounts
    const emailResult = await query<{ id: string; username: string; role: string; auth_provider: string }>(
      'SELECT id, username, role, auth_provider FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    if (emailResult && emailResult.rows.length > 0) {
      const row = emailResult.rows[0]!;
      const newProvider = row.auth_provider === 'email' ? 'email+google' : row.auth_provider;
      await query(
        'UPDATE users SET oauth_id = $1, auth_provider = $2, last_seen_at = NOW() WHERE id = $3',
        [googleId, newProvider, row.id],
      );
      track('player:login', { authMethod: 'google' }, row.id);
      const token = signToken({ userId: row.id, username: row.username, role: row.role as 'user' | 'admin' });
      res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
      res.redirect('/');
      return;
    }

    // 3. New user — generate username from Google display name
    const baseUsername = (name || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'user';

    // Ensure it starts with a letter
    const sanitized = /^[a-z]/.test(baseUsername) ? baseUsername : `u${baseUsername.slice(0, 19)}`;

    let username = sanitized;
    let inserted = false;

    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        const suffix = String(Math.floor(1000 + Math.random() * 9000)); // 4 random digits
        username = sanitized.slice(0, 16) + suffix;
      }

      // Ensure minimum length of 2 chars
      if (username.length < 2) {
        username = username + 'user'.slice(0, 2 - username.length);
      }

      try {
        const insertResult = await pool.query<{ id: string; username: string; role: string }>(
          `INSERT INTO users (username, display_name, email, password_hash, auth_provider, oauth_id)
           VALUES ($1, $2, $3, NULL, 'google', $4)
           RETURNING id, username, role`,
          [username, name || username, email.toLowerCase(), googleId],
        );

        if (insertResult.rows.length > 0) {
          const row = insertResult.rows[0]!;
          track('player:registered', { authMethod: 'google' }, row.id);
          const token = signToken({ userId: row.id, username: row.username, role: row.role as 'user' | 'admin' });
          res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
          res.redirect('/');
          inserted = true;
          break;
        }
      } catch (err: unknown) {
        // 23505 = unique constraint violation (username collision)
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          const detail = 'detail' in err ? String((err as { detail: string }).detail) : '';
          if (detail.includes('username')) {
            continue; // Try next username
          }
          // Email or oauth_id collision — shouldn't happen since we checked above, but handle gracefully
          logger.error({ err, detail }, 'Unexpected unique constraint violation during OAuth signup');
        } else {
          throw err;
        }
      }
    }

    if (!inserted) {
      logger.error({ googleId, email }, 'Failed to create OAuth user after retries');
      res.redirect('/login?error=oauth_failed');
    }
  } catch (err) {
    logger.error({ err }, 'Google OAuth callback failed');
    res.redirect('/login?error=oauth_failed');
  }
});

// ── Apple OAuth ──────────────────────────────────────────────────────────

/** Build the Apple OAuth redirect URI based on environment. */
function getAppleRedirectUri(): string {
  if (process.env.APPLE_REDIRECT_URI) {
    return process.env.APPLE_REDIRECT_URI;
  }
  if (process.env.NODE_ENV !== 'production') {
    return 'http://localhost:3001/auth/apple/callback';
  }
  return 'https://bullem.cards/auth/apple/callback';
}

/**
 * Generate the Apple client_secret — a short-lived JWT (ES256) signed with
 * the private key from the Apple Developer portal.
 *
 * See: https://developer.apple.com/documentation/sign_in_with_apple/generate_and_validate_tokens
 */
function generateAppleClientSecret(): string {
  const teamId = process.env.APPLE_TEAM_ID!;
  const clientId = process.env.APPLE_CLIENT_ID!;
  const keyId = process.env.APPLE_KEY_ID!;
  const privateKey = process.env.APPLE_PRIVATE_KEY!;

  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: teamId,
      iat: now,
      exp: now + 300, // 5 minutes
      aud: 'https://appleid.apple.com',
      sub: clientId,
    },
    privateKey,
    {
      algorithm: 'ES256',
      header: { alg: 'ES256', kid: keyId },
    },
  );
}

/** Decode a JWT payload without verification (safe when received directly from Apple's token endpoint over TLS). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1]!, 'base64url').toString('utf8');
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── GET /auth/apple ──────────────────────────────────────────────────────

router.get('/apple', (req, res) => {
  const clientId = process.env.APPLE_CLIENT_ID;
  if (!clientId) {
    logger.error('APPLE_CLIENT_ID is not set');
    res.redirect('/login?error=oauth_failed');
    return;
  }

  const state = crypto.randomBytes(32).toString('hex');

  // Apple sends the callback as a cross-site POST, so sameSite must be 'none'
  // (with secure: true) for the state cookie to be included.
  res.cookie('apple_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getAppleRedirectUri(),
    response_type: 'code',
    scope: 'name email',
    state,
    response_mode: 'form_post',
  });

  res.redirect(`https://appleid.apple.com/auth/authorize?${params.toString()}`);
});

// ── POST /auth/apple/callback ────────────────────────────────────────────

interface AppleTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token: string;
  refresh_token?: string;
}

router.post('/apple/callback', async (req, res) => {
  try {
    const { code, state, user: userParam } = req.body as {
      code?: string;
      state?: string;
      user?: string; // JSON string with name, only on first authorization
    };
    const cookieState = req.cookies?.apple_oauth_state as string | undefined;

    // Always clear the state cookie
    res.clearCookie('apple_oauth_state', { path: '/' });

    // Verify state
    if (!state || !cookieState || state !== cookieState) {
      logger.warn('Apple OAuth state mismatch');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    if (!code) {
      logger.warn('Apple OAuth callback missing code');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    const clientId = process.env.APPLE_CLIENT_ID;
    const appleTeamId = process.env.APPLE_TEAM_ID;
    const appleKeyId = process.env.APPLE_KEY_ID;
    const applePrivateKey = process.env.APPLE_PRIVATE_KEY;
    if (!clientId || !appleTeamId || !appleKeyId || !applePrivateKey) {
      logger.error('Apple OAuth credentials not configured');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    const clientSecret = generateAppleClientSecret();

    // Exchange code for tokens
    const tokenRes = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getAppleRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      logger.error({ status: tokenRes.status }, 'Apple token exchange failed');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    const tokenData = await tokenRes.json() as AppleTokenResponse;

    // Extract user info from id_token
    const idTokenPayload = decodeJwtPayload(tokenData.id_token);
    if (!idTokenPayload) {
      logger.error('Failed to decode Apple id_token');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    const appleId = idTokenPayload.sub as string | undefined;
    const email = idTokenPayload.email as string | undefined;

    if (!appleId) {
      logger.error('Apple id_token missing sub claim');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    // Apple sends name only on first authorization via the `user` POST param
    let displayName: string | null = null;
    if (userParam) {
      try {
        const userData = JSON.parse(userParam) as { name?: { firstName?: string; lastName?: string } };
        const parts = [userData.name?.firstName, userData.name?.lastName].filter(Boolean);
        if (parts.length > 0) {
          displayName = parts.join(' ');
        }
      } catch {
        // Ignore parse errors — name is optional
      }
    }

    if (!pool) {
      logger.error('Database unavailable during Apple OAuth');
      res.redirect('/login?error=oauth_failed');
      return;
    }

    // 1. Look up by oauth_id (returning Apple user)
    const oauthResult = await query<{ id: string; username: string; role: string }>(
      `SELECT id, username, role FROM users
       WHERE oauth_id = $1 AND auth_provider IN ('apple', 'email+apple')`,
      [appleId],
    );

    if (oauthResult && oauthResult.rows.length > 0) {
      const row = oauthResult.rows[0]!;
      await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [row.id]);
      track('player:login', { authMethod: 'apple' }, row.id);
      const token = signToken({ userId: row.id, username: row.username, role: row.role as 'user' | 'admin' });
      res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
      res.redirect('/');
      return;
    }

    // 2. Look up by email — link accounts (only if email is available)
    if (email) {
      const emailResult = await query<{ id: string; username: string; role: string; auth_provider: string }>(
        'SELECT id, username, role, auth_provider FROM users WHERE email = $1',
        [email.toLowerCase()],
      );

      if (emailResult && emailResult.rows.length > 0) {
        const row = emailResult.rows[0]!;
        const newProvider = row.auth_provider === 'email' ? 'email+apple' : row.auth_provider;
        await query(
          'UPDATE users SET oauth_id = $1, auth_provider = $2, last_seen_at = NOW() WHERE id = $3',
          [appleId, newProvider, row.id],
        );
        track('player:login', { authMethod: 'apple' }, row.id);
        const token = signToken({ userId: row.id, username: row.username, role: row.role as 'user' | 'admin' });
        res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
        res.redirect('/');
        return;
      }
    }

    // 3. New user — generate username from Apple display name or email
    const nameSource = displayName || (email ? email.split('@')[0] : null) || 'user';
    const baseUsername = nameSource
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'user';

    // Ensure it starts with a letter
    const sanitized = /^[a-z]/.test(baseUsername) ? baseUsername : `u${baseUsername.slice(0, 19)}`;

    let username = sanitized;
    let inserted = false;

    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) {
        const suffix = String(Math.floor(1000 + Math.random() * 9000)); // 4 random digits
        username = sanitized.slice(0, 16) + suffix;
      }

      // Ensure minimum length of 2 chars
      if (username.length < 2) {
        username = username + 'user'.slice(0, 2 - username.length);
      }

      try {
        const insertResult = await pool.query<{ id: string; username: string; role: string }>(
          `INSERT INTO users (username, display_name, email, password_hash, auth_provider, oauth_id)
           VALUES ($1, $2, $3, NULL, 'apple', $4)
           RETURNING id, username, role`,
          [username, displayName || username, email ? email.toLowerCase() : null, appleId],
        );

        if (insertResult.rows.length > 0) {
          const row = insertResult.rows[0]!;
          track('player:registered', { authMethod: 'apple' }, row.id);
          const token = signToken({ userId: row.id, username: row.username, role: row.role as 'user' | 'admin' });
          res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
          res.redirect('/');
          inserted = true;
          break;
        }
      } catch (err: unknown) {
        // 23505 = unique constraint violation (username collision)
        if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
          const detail = 'detail' in err ? String((err as { detail: string }).detail) : '';
          if (detail.includes('username')) {
            continue; // Try next username
          }
          logger.error({ err, detail }, 'Unexpected unique constraint violation during Apple OAuth signup');
        } else {
          throw err;
        }
      }
    }

    if (!inserted) {
      logger.error({ appleId, email }, 'Failed to create Apple OAuth user after retries');
      res.redirect('/login?error=oauth_failed');
    }
  } catch (err) {
    logger.error({ err }, 'Apple OAuth callback failed');
    res.redirect('/login?error=oauth_failed');
  }
});

export { router as oauthRouter };
