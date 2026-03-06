import pino from 'pino';
import { getCorrelationContext } from './correlationContext.js';

const level = process.env.LOG_LEVEL ?? 'info';
const isDev = process.env.NODE_ENV !== 'production';

const baseLogger = pino({
  level,
  ...(isDev
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

interface ChildLoggerContext {
  roomCode?: string;
  playerId?: string;
}

/** Create a child logger with room/player correlation IDs. */
export function createChildLogger(context: ChildLoggerContext): pino.Logger {
  return baseLogger.child(context);
}

/**
 * Get a logger that automatically includes the current correlation context
 * (correlationId, event, roomCode, playerId, socketId) from AsyncLocalStorage.
 * Falls back to the base logger if no correlation context is active.
 */
export function getCorrelatedLogger(): pino.Logger {
  const ctx = getCorrelationContext();
  if (!ctx) return baseLogger;
  return baseLogger.child({
    correlationId: ctx.correlationId,
    event: ctx.event,
    ...(ctx.roomCode ? { roomCode: ctx.roomCode } : {}),
    ...(ctx.playerId ? { playerId: ctx.playerId } : {}),
    socketId: ctx.socketId,
  });
}

export default baseLogger;
