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
  socket.on('push:subscribe', async (subscription, callback) => {
    if (typeof callback !== 'function') return;
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

    // Validate the endpoint is a well-formed HTTPS URL to prevent SSRF.
    // Web Push endpoints are always HTTPS URLs from browser push services.
    try {
      const url = new URL(subscription.endpoint);
      if (url.protocol !== 'https:') {
        callback({ error: 'Push endpoint must use HTTPS' });
        return;
      }
    } catch {
      callback({ error: 'Invalid push endpoint URL' });
      return;
    }

    await pushManager.subscribe(playerId, subscription);
    log.info({ playerId }, 'Player subscribed to push notifications');
    callback({ ok: true });
  });

  socket.on('push:unsubscribe', async (callback) => {
    if (typeof callback !== 'function') return;
    const log = getCorrelatedLogger();
    const room = roomManager.getRoomForSocket(socket.id);
    const playerId = room?.getPlayerId(socket.id);
    if (!playerId) {
      callback({ ok: true }); // Idempotent — no error if not in a room
      return;
    }

    await pushManager.unsubscribe(playerId);
    log.info({ playerId }, 'Player unsubscribed from push notifications');
    callback({ ok: true });
  });
}
