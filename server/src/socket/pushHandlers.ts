import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { PushManager } from '../push/PushManager.js';
import { getCorrelatedLogger } from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerPushHandlers(
  _io: TypedServer,
  socket: TypedSocket,
  roomManager: RoomManager,
  pushManager: PushManager,
): void {
  socket.on('push:subscribe', (subscription, callback) => {
    const log = getCorrelatedLogger();
    const room = roomManager.getRoomForSocket(socket.id);
    const playerId = room?.getPlayerId(socket.id);
    if (!playerId) {
      callback({ error: 'Not in a room' });
      return;
    }

    if (!subscription || !subscription.endpoint) {
      callback({ error: 'Invalid subscription' });
      return;
    }

    pushManager.subscribe(playerId, subscription);
    log.info({ playerId }, 'Player subscribed to push notifications');
    callback({ ok: true });
  });

  socket.on('push:unsubscribe', (callback) => {
    const log = getCorrelatedLogger();
    const room = roomManager.getRoomForSocket(socket.id);
    const playerId = room?.getPlayerId(socket.id);
    if (!playerId) {
      callback({ ok: true }); // Idempotent — no error if not in a room
      return;
    }

    pushManager.unsubscribe(playerId);
    log.info({ playerId }, 'Player unsubscribed from push notifications');
    callback({ ok: true });
  });
}
