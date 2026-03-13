import jwt from 'jsonwebtoken';
import logger from '../logger.js';

export interface JwtPayload {
  userId: string;
  username: string;
  role: 'user' | 'admin';
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // In dev mode without a database, use a hardcoded secret for convenience.
    // This is safe because dev auth tokens are ephemeral and never reach production.
    if (process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL) {
      return 'dev-mode-secret-not-for-production';
    }
    throw new Error('SESSION_SECRET environment variable is required for auth');
  }
  return secret;
}

/** Sign a JWT with the user's ID and username. Expires in 7 days. */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '7d' });
}

/** Verify and decode a JWT. Returns null if invalid or expired. */
export function verifyToken(token: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret()) as jwt.JwtPayload & JwtPayload;
    // Validate role is a known value to prevent unexpected privilege escalation
    // if the JWT payload is tampered with (e.g., via a compromised secret).
    const role = decoded.role === 'admin' ? 'admin' : 'user';
    return { userId: decoded.userId, username: decoded.username, role };
  } catch (err) {
    logger.debug({ err }, 'JWT verification failed');
    return null;
  }
}
