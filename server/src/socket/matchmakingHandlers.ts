import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, RankedMode } from '@bull-em/shared';
import type { MatchmakingQueue } from '../matchmaking/MatchmakingQueue.js';
import type { InMemoryMatchmakingQueue } from '../dev/InMemoryMatchmakingQueue.js';
import { getCorrelatedLogger } from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const VALID_MODES: ReadonlySet<string> = new Set(['heads_up', 'multiplayer']);

export function registerMatchmakingHandlers(
  _io: TypedServer,
  socket: TypedSocket,
  matchmakingQueue: MatchmakingQueue | InMemoryMatchmakingQueue,
): void {
  socket.on('matchmaking:join', async (data, callback) => {
    const log = getCorrelatedLogger();

    // Validate mode
    if (!data || typeof data.mode !== 'string' || !VALID_MODES.has(data.mode)) {
      return callback({ error: 'Invalid matchmaking mode' });
    }
    const mode = data.mode as RankedMode;

    const error = await matchmakingQueue.joinQueue(socket, mode);
    if (error) {
      log.info({ mode, error }, 'Matchmaking join rejected');
      return callback({ error });
    }

    log.info({ mode }, 'Player joined matchmaking queue');
    callback({ ok: true });
  });

  socket.on('matchmaking:leave', async (callback) => {
    const log = getCorrelatedLogger();
    const left = await matchmakingQueue.leaveQueue(socket.id);
    if (left) {
      log.info('Player left matchmaking queue');
      socket.emit('matchmaking:cancelled');
    }
    callback({ ok: true });
  });
}
