import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from './jwt.js';

/** Extend Express Request with optional user info from JWT. */
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const AUTH_COOKIE_NAME = 'bull_em_token';

/**
 * Optional auth middleware. If a valid JWT cookie is present, attaches
 * `req.user` with { userId, username }. Never blocks unauthenticated
 * requests — guests can still play without an account.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}

/**
 * Required auth middleware. Returns 401 if no valid JWT cookie is present.
 * Use on routes that require authentication (e.g., profile updates).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  req.user = payload;
  next();
}

export { AUTH_COOKIE_NAME };
