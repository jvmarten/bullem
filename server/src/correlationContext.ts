import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface CorrelationContext {
  /** Unique ID for tracing a single socket event through the system. */
  correlationId: string;
  /** Socket event name (e.g. 'game:call', 'room:create'). */
  event: string;
  /** Room code, if known at the time the context is created. */
  roomCode?: string;
  /** Player ID, if known at the time the context is created. */
  playerId?: string;
  /** Socket ID of the originating connection. */
  socketId: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Run a function within a correlation context. All code executed inside
 *  (including async continuations) can retrieve the context via `getCorrelationContext()`. */
export function runWithCorrelation(ctx: CorrelationContext, fn: () => void): void {
  storage.run(ctx, fn);
}

/** Retrieve the current correlation context, or undefined if not inside a correlated call. */
export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

/** Generate a new correlation ID (v4 UUID). */
export function generateCorrelationId(): string {
  return randomUUID();
}
