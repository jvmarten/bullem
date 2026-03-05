import jwt from 'jsonwebtoken';
import logger from '../logger.js';

export interface JwtPayload {
  userId: string;
  username: string;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
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
    return { userId: decoded.userId, username: decoded.username };
  } catch (err) {
    logger.debug({ err }, 'JWT verification failed');
    return null;
  }
}
