import pino from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
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
  return logger.child(context);
}

export default logger;
