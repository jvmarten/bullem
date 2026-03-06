import { Router } from 'express';
import crypto from 'crypto';
import { signToken } from './jwt.js';
import { AUTH_COOKIE_NAME } from './middleware.js';
import { cookieOptions } from './routes.js';
import { query } from '../db/index.js';
import { pool } from '../db/index.js';
import logger from '../logger.js';

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
    const oauthResult = await query<{ id: string; username: string }>(
      `SELECT id, username FROM users
       WHERE oauth_id = $1 AND auth_provider IN ('google', 'email+google')`,
      [googleId],
    );

    if (oauthResult && oauthResult.rows.length > 0) {
      const row = oauthResult.rows[0]!;
      await query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [row.id]);
      const token = signToken({ userId: row.id, username: row.username });
      res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
      res.redirect('/');
      return;
    }

    // 2. Look up by email — link accounts
    const emailResult = await query<{ id: string; username: string; auth_provider: string }>(
      'SELECT id, username, auth_provider FROM users WHERE email = $1',
      [email.toLowerCase()],
    );

    if (emailResult && emailResult.rows.length > 0) {
      const row = emailResult.rows[0]!;
      const newProvider = row.auth_provider === 'email' ? 'email+google' : row.auth_provider;
      await query(
        'UPDATE users SET oauth_id = $1, auth_provider = $2, last_seen_at = NOW() WHERE id = $3',
        [googleId, newProvider, row.id],
      );
      const token = signToken({ userId: row.id, username: row.username });
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
        const insertResult = await pool.query<{ id: string; username: string }>(
          `INSERT INTO users (username, display_name, email, password_hash, auth_provider, oauth_id)
           VALUES ($1, $2, $3, NULL, 'google', $4)
           RETURNING id, username`,
          [username, name || username, email.toLowerCase(), googleId],
        );

        if (insertResult.rows.length > 0) {
          const row = insertResult.rows[0]!;
          const token = signToken({ userId: row.id, username: row.username });
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

export { router as oauthRouter };
