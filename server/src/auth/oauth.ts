import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { signToken, verifyToken } from './jwt.js';
import { AUTH_COOKIE_NAME } from './middleware.js';
import { cookieOptions } from './routes.js';
import { query } from '../db/index.js';
import { pool } from '../db/index.js';
import logger from '../logger.js';
import { track } from '../analytics/track.js';

const router = Router();

/** Custom URL scheme for native iOS app deep links. */
const NATIVE_URL_SCHEME = 'bullem';

// ── Server-side OAuth state store ────────────────────────────────────────
// On iOS, the OAuth flow starts in WKWebView (where cookies are set) but
// the OAuth provider opens in Safari (separate cookie jar). When the callback
// returns via Safari, the state/source cookies don't exist → state mismatch.
// This server-side store provides a fallback so the state can be verified
// even when cookies are lost crossing the WKWebView↔Safari boundary.
// TODO(scale): Externalize to Redis when running multiple server instances.
// The state values are short-lived (10 min TTL) and small, so an in-memory
// Map is fine for a single instance.

interface OAuthStateEntry {
  source: string | undefined;
  createdAt: number;
}

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — matches cookie maxAge

const oauthStateStore = new Map<string, OAuthStateEntry>();

/** Periodically clean expired entries to prevent unbounded growth. */
function cleanExpiredStates(): void {
  const now = Date.now();
  for (const [key, entry] of oauthStateStore) {
    if (now - entry.createdAt > STATE_TTL_MS) {
      oauthStateStore.delete(key);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanExpiredStates, 5 * 60 * 1000).unref();

/** Store OAuth state server-side alongside the cookie (belt and suspenders). */
function storeOAuthState(state: string, source: string | undefined): void {
  oauthStateStore.set(state, { source, createdAt: Date.now() });
}

/**
 * Verify OAuth state from the callback. Tries the cookie first (normal web flow),
 * then falls back to the server-side store (iOS native where cookies are lost).
 * Returns the source ('capacitor' | undefined) if state is valid, or null if invalid.
 */
function verifyOAuthState(
  callbackState: string | undefined,
  cookieState: string | undefined,
  cookieSource: string | undefined,
): { valid: boolean; source: string | undefined } {
  if (!callbackState) return { valid: false, source: undefined };

  // 1. Try cookie-based verification (works for normal web flow)
  if (cookieState && callbackState === cookieState) {
    // Clean up the server-side entry since we verified via cookie
    oauthStateStore.delete(callbackState);
    return { valid: true, source: cookieSource };
  }

  // 2. Fall back to server-side store (iOS native where cookies are lost)
  const stored = oauthStateStore.get(callbackState);
  if (stored && Date.now() - stored.createdAt <= STATE_TTL_MS) {
    oauthStateStore.delete(callbackState);
    return { valid: true, source: stored.source };
  }

  // State not found in either location
  oauthStateStore.delete(callbackState ?? '');
  return { valid: false, source: undefined };
}

/**
 * Build the redirect URL after successful OAuth for the given platform.
 * For Capacitor native apps, redirect to the custom URL scheme with the JWT
 * token so the native shell can set the cookie in WKWebView.
 * For web, redirect to the home page (cookie is already set on the response).
 */
function buildPostAuthRedirect(token: string, source: string | undefined): string {
  if (source === 'capacitor') {
    return `${NATIVE_URL_SCHEME}://auth-callback?token=${encodeURIComponent(token)}`;
  }
  return '/';
}

/**
 * Build the redirect URL after a failed OAuth attempt.
 * For Capacitor native apps, redirect to the custom URL scheme with an error.
 * For web, redirect to the login page with an error query param.
 */
function buildPostAuthErrorRedirect(source: string | undefined): string {
  if (source === 'capacitor') {
    return `${NATIVE_URL_SCHEME}://auth-callback?error=oauth_failed`;
  }
  return '/login?error=oauth_failed';
}

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

  const source = req.query.source as string | undefined;
  const state = crypto.randomBytes(32).toString('hex');

  res.cookie('oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: '/',
  });

  // Persist the request source (e.g. 'capacitor') so the callback knows
  // whether to redirect back via custom URL scheme or normal web redirect.
  if (source === 'capacitor') {
    res.cookie('oauth_source', 'capacitor', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
  }

  // Store state server-side so it survives iOS WKWebView→Safari cookie jar boundary
  storeOAuthState(state, source);

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
    const cookieSource = req.cookies?.oauth_source as string | undefined;

    // Always clear the state and source cookies
    res.clearCookie('oauth_state', { path: '/' });
    res.clearCookie('oauth_source', { path: '/' });

    // Verify state — tries cookie first, falls back to server-side store
    // (iOS native loses cookies when OAuth opens in Safari instead of WKWebView)
    const stateResult = verifyOAuthState(state, cookieState, cookieSource);
    const oauthSource = stateResult.source;

    if (!stateResult.valid) {
      logger.warn('OAuth state mismatch');
      res.redirect(buildPostAuthErrorRedirect(oauthSource));
      return;
    }

    if (!code) {
      logger.warn('OAuth callback missing code');
      res.redirect(buildPostAuthErrorRedirect(oauthSource));
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      logger.error('Google OAuth credentials not configured');
      res.redirect(buildPostAuthErrorRedirect(oauthSource));
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
      res.redirect(buildPostAuthErrorRedirect(oauthSource));
      return;
    }

    const tokenData = await tokenRes.json() as GoogleTokenResponse;

    // Fetch user profile
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      logger.error({ status: profileRes.status }, 'Google userinfo fetch failed');
      res.redirect(buildPostAuthErrorRedirect(oauthSource));
      return;
    }

    const profile = await profileRes.json() as GoogleUserInfo;
    const { id: googleId, email, name } = profile;

    if (!email || !googleId) {
      logger.error('Google profile missing email or id');
      res.redirect(buildPostAuthErrorRedirect(oauthSource));
      return;
    }

    if (!pool) {
      logger.error('Database unavailable during OAuth');
      res.redirect(buildPostAuthErrorRedirect(oauthSource));
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
      res.redirect(buildPostAuthRedirect(token, oauthSource));
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
      res.redirect(buildPostAuthRedirect(token, oauthSource));
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
          res.redirect(buildPostAuthRedirect(token, oauthSource));
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
      res.redirect(buildPostAuthErrorRedirect(oauthSource));
    }
  } catch (err) {
    logger.error({ err }, 'Google OAuth callback failed');
    res.redirect(buildPostAuthErrorRedirect(undefined));
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
  const teamId = process.env.APPLE_TEAM_ID;
  const clientId = process.env.APPLE_CLIENT_ID;
  const keyId = process.env.APPLE_KEY_ID;
  const privateKey = process.env.APPLE_PRIVATE_KEY;
  if (!teamId || !clientId || !keyId || !privateKey) {
    throw new Error('Apple OAuth environment variables not configured');
  }

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

  const source = req.query.source as string | undefined;
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

  // Persist the request source so the callback can redirect to the native app.
  if (source === 'capacitor') {
    res.cookie('apple_oauth_source', 'capacitor', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
      maxAge: 10 * 60 * 1000,
      path: '/',
    });
  }

  // Store state server-side so it survives iOS WKWebView→Safari cookie jar boundary
  storeOAuthState(state, source);

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
    const cookieSource = req.cookies?.apple_oauth_source as string | undefined;

    // Always clear the state and source cookies
    res.clearCookie('apple_oauth_state', { path: '/' });
    res.clearCookie('apple_oauth_source', { path: '/' });

    // Verify state — tries cookie first, falls back to server-side store
    // (iOS native loses cookies when OAuth opens in Safari instead of WKWebView)
    const stateResult = verifyOAuthState(state, cookieState, cookieSource);
    const appleOauthSource = stateResult.source;

    if (!stateResult.valid) {
      logger.warn('Apple OAuth state mismatch');
      res.redirect(buildPostAuthErrorRedirect(appleOauthSource));
      return;
    }

    if (!code) {
      logger.warn('Apple OAuth callback missing code');
      res.redirect(buildPostAuthErrorRedirect(appleOauthSource));
      return;
    }

    const clientId = process.env.APPLE_CLIENT_ID;
    const appleTeamId = process.env.APPLE_TEAM_ID;
    const appleKeyId = process.env.APPLE_KEY_ID;
    const applePrivateKey = process.env.APPLE_PRIVATE_KEY;
    if (!clientId || !appleTeamId || !appleKeyId || !applePrivateKey) {
      logger.error('Apple OAuth credentials not configured');
      res.redirect(buildPostAuthErrorRedirect(appleOauthSource));
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
      res.redirect(buildPostAuthErrorRedirect(appleOauthSource));
      return;
    }

    const tokenData = await tokenRes.json() as AppleTokenResponse;

    // Extract user info from id_token
    const idTokenPayload = decodeJwtPayload(tokenData.id_token);
    if (!idTokenPayload) {
      logger.error('Failed to decode Apple id_token');
      res.redirect(buildPostAuthErrorRedirect(appleOauthSource));
      return;
    }

    const appleId = idTokenPayload.sub as string | undefined;
    const email = idTokenPayload.email as string | undefined;

    if (!appleId) {
      logger.error('Apple id_token missing sub claim');
      res.redirect(buildPostAuthErrorRedirect(appleOauthSource));
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
      res.redirect(buildPostAuthErrorRedirect(appleOauthSource));
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
      res.redirect(buildPostAuthRedirect(token, appleOauthSource));
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
        res.redirect(buildPostAuthRedirect(token, appleOauthSource));
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
          res.redirect(buildPostAuthRedirect(token, appleOauthSource));
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
      res.redirect(buildPostAuthErrorRedirect(appleOauthSource));
    }
  } catch (err) {
    logger.error({ err }, 'Apple OAuth callback failed');
    res.redirect(buildPostAuthErrorRedirect(undefined));
  }
});

// ── POST /auth/token-exchange ─────────────────────────────────────────────
// Used by the Capacitor native app to set the httpOnly auth cookie in WKWebView
// after receiving a JWT via the bullem:// deep link from an OAuth callback.

router.post('/token-exchange', (req, res) => {
  const { token } = req.body as { token?: string };

  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: 'Missing token' });
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // Set the auth cookie in WKWebView's cookie jar (same domain, so it works)
  res.cookie(AUTH_COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true });
});

export { router as oauthRouter };
