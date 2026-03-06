import { Router } from 'express';
import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { query } from '../db/index.js';
import type { RoomManager } from '../rooms/RoomManager.js';
import type { BotManager } from '../game/BotManager.js';
import logger from '../logger.js';

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROOM_CODE_REGEX = /^[A-Z]{4}$/;

export function createAdminRouter(
  io: TypedServer,
  roomManager: RoomManager,
  botManager: BotManager,
): Router {
  const router = Router();

  // All admin routes require authentication + admin role
  router.use(requireAuth, requireAdmin);

  // ── GET /admin/users ───────────────────────────────────────────────────
  router.get('/users', async (req, res) => {
    try {
      const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '20'), 10) || 20, 1), 100);
      const offset = (page - 1) * limit;

      const result = await query<{
        id: string;
        username: string;
        email: string | null;
        role: string;
        created_at: string;
        last_seen_at: string;
      }>(
        `SELECT id, username, email, role, created_at, last_seen_at
         FROM users
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      if (!result) {
        res.status(503).json({ error: 'Database unavailable' });
        return;
      }

      const countResult = await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM users');
      const total = countResult ? parseInt(countResult.rows[0]?.count ?? '0', 10) : 0;

      res.json({
        users: result.rows.map(row => ({
          id: row.id,
          username: row.username,
          email: row.email,
          role: row.role,
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
        })),
        page,
        limit,
        total,
      });
    } catch (err) {
      logger.error({ err }, 'Admin: failed to list users');
      res.status(500).json({ error: 'Failed to list users' });
    }
  });

  // ── POST /admin/set-role ───────────────────────────────────────────────
  router.post('/set-role', async (req, res) => {
    try {
      const { userId, role } = req.body as { userId?: string; role?: string };

      if (!userId || !UUID_REGEX.test(userId)) {
        res.status(400).json({ error: 'Invalid userId' });
        return;
      }

      if (role !== 'user' && role !== 'admin') {
        res.status(400).json({ error: 'Role must be "user" or "admin"' });
        return;
      }

      // Prevent demoting yourself
      if (userId === req.user!.userId && role !== 'admin') {
        res.status(400).json({ error: 'Cannot demote yourself' });
        return;
      }

      const result = await query<{ id: string; username: string; role: string }>(
        'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role',
        [role, userId],
      );

      if (!result) {
        res.status(503).json({ error: 'Database unavailable' });
        return;
      }

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const row = result.rows[0]!;
      logger.info(
        { adminUserId: req.user!.userId, targetUserId: userId, newRole: role },
        'Admin: role updated',
      );

      res.json({ id: row.id, username: row.username, role: row.role });
    } catch (err) {
      logger.error({ err }, 'Admin: failed to set role');
      res.status(500).json({ error: 'Failed to set role' });
    }
  });

  // ── GET /admin/rooms ───────────────────────────────────────────────────
  router.get('/rooms', (_req, res) => {
    try {
      const rooms: Array<{
        roomCode: string;
        playerCount: number;
        playerNames: string[];
        hostName: string;
        gamePhase: string;
        roundNumber: number;
      }> = [];

      // Use getAvailableRooms + getLiveGames to cover all phases, or iterate directly
      // Iterating all rooms via the room manager's internal state isn't exposed,
      // so we'll use the available public methods plus a direct room lookup.
      // Actually, let's add a method. For now, list available + live rooms.
      // The RoomManager doesn't expose a direct "all rooms" iterator, but we can
      // list available (lobby) rooms and live (playing) rooms.
      const available = roomManager.getAvailableRooms();
      const live = roomManager.getLiveGames();

      // Build a set of codes we've already listed
      const seen = new Set<string>();

      for (const r of available) {
        seen.add(r.roomCode);
        const room = roomManager.getRoom(r.roomCode);
        const playerNames = room
          ? [...room.players.values()].map(p => p.name)
          : [];
        rooms.push({
          roomCode: r.roomCode,
          playerCount: r.playerCount,
          playerNames,
          hostName: r.hostName,
          gamePhase: 'waiting',
          roundNumber: 0,
        });
      }

      for (const g of live) {
        if (seen.has(g.roomCode)) continue;
        seen.add(g.roomCode);
        const room = roomManager.getRoom(g.roomCode);
        const playerNames = room
          ? [...room.players.values()].map(p => p.name)
          : [];
        rooms.push({
          roomCode: g.roomCode,
          playerCount: g.playerCount,
          playerNames,
          hostName: g.hostName,
          gamePhase: 'in-progress',
          roundNumber: g.roundNumber,
        });
      }

      res.json({ rooms });
    } catch (err) {
      logger.error({ err }, 'Admin: failed to list rooms');
      res.status(500).json({ error: 'Failed to list rooms' });
    }
  });

  // ── POST /admin/kick ───────────────────────────────────────────────────
  router.post('/kick', (req, res) => {
    try {
      const { roomCode, playerName } = req.body as { roomCode?: string; playerName?: string };

      if (!roomCode || !ROOM_CODE_REGEX.test(roomCode.toUpperCase())) {
        res.status(400).json({ error: 'Invalid room code' });
        return;
      }

      if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
        res.status(400).json({ error: 'Invalid player name' });
        return;
      }

      const room = roomManager.getRoom(roomCode.toUpperCase());
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      // Find the player by name
      let targetPlayerId: string | null = null;
      for (const [playerId, player] of room.players) {
        if (player.name === playerName.trim()) {
          targetPlayerId = playerId;
          break;
        }
      }

      if (!targetPlayerId) {
        res.status(404).json({ error: 'Player not found in room' });
        return;
      }

      const targetSocketId = room.getSocketId(targetPlayerId);
      if (targetSocketId) {
        const targetSocket = io.sockets.sockets.get(targetSocketId);
        if (targetSocket) {
          targetSocket.emit('room:kicked');
          targetSocket.leave(room.roomCode);
        }
        room.removePlayer(targetSocketId);
        roomManager.removeSocketMapping(targetSocketId);
        roomManager.removePlayerMapping(targetPlayerId);
      } else {
        // Player is disconnected — remove from room directly
        room.players.delete(targetPlayerId);
        roomManager.removePlayerMapping(targetPlayerId);
      }

      // Broadcast updated room state
      io.to(room.roomCode).emit('room:state', room.getRoomState());
      if (room.game) {
        for (const [playerId] of room.players) {
          const sid = room.getSocketId(playerId);
          if (!sid) continue;
          const state = room.getClientGameState(playerId);
          if (state) io.to(sid).emit('game:state', state);
        }
      }

      roomManager.persistRoom(room);

      logger.info(
        { adminUserId: req.user!.userId, roomCode: room.roomCode, playerName },
        'Admin: player kicked from room',
      );

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Admin: failed to kick player');
      res.status(500).json({ error: 'Failed to kick player' });
    }
  });

  // ── POST /admin/close-room ────────────────────────────────────────────
  router.post('/close-room', (req, res) => {
    try {
      const { roomCode } = req.body as { roomCode?: string };

      if (!roomCode || !ROOM_CODE_REGEX.test(roomCode.toUpperCase())) {
        res.status(400).json({ error: 'Invalid room code' });
        return;
      }

      const code = roomCode.toUpperCase();
      const room = roomManager.getRoom(code);
      if (!room) {
        res.status(404).json({ error: 'Room not found' });
        return;
      }

      // Clear bot timers before deleting
      botManager.clearTurnTimer(code);

      // Notify all clients in the room
      io.to(code).emit('room:deleted');

      // Disconnect all sockets from the room
      for (const [playerId] of room.players) {
        const socketId = room.getSocketId(playerId);
        if (socketId) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) socket.leave(code);
        }
      }
      for (const sid of room.spectatorSockets) {
        const socket = io.sockets.sockets.get(sid);
        if (socket) socket.leave(code);
      }

      roomManager.deleteRoom(code);

      logger.info(
        { adminUserId: req.user!.userId, roomCode: code },
        'Admin: room force-closed',
      );

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Admin: failed to close room');
      res.status(500).json({ error: 'Failed to close room' });
    }
  });

  return router;
}
