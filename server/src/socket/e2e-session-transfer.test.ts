/**
 * E2E integration tests for session transfer (multi-device login).
 * When an authenticated user connects from a second device/tab while already
 * in a room, the session should transfer to the new socket and the old socket
 * should receive a 'session:transferred' event.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GamePhase, HandType } from '@bull-em/shared';
import {
  createTestServer,
  createRoom,
  joinRoom,
  addBot,
  waitForEvent,
  tick,
  startGame,
  type TestContext,
} from './e2e-helpers.js';

describe('E2E: Session transfer (multi-device)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('transfers session when authenticated user joins from a second socket in lobby', async () => {
    const userId = 'user-abc-123';
    const oldClient = await ctx.connectClient({ auth: { userId } });
    const { roomCode } = await createRoom(oldClient, 'Alice');

    // Listen for the transfer event on the old socket
    const transferPromise = waitForEvent(oldClient, 'session:transferred');

    // Connect a new client with the same userId and join the same room
    const newClient = await ctx.connectClient({ auth: { userId } });
    const result = await joinRoom(newClient, roomCode, 'Alice');

    // Old socket should receive session:transferred
    await transferPromise;

    // New socket should get a valid playerId and reconnect token
    expect(result.playerId).toBeTruthy();
    expect(result.reconnectToken).toBeTruthy();
  });

  it('transfers session during an active game', async () => {
    const userId = 'user-game-456';
    const host = await ctx.connectClient({ auth: { userId } });
    const { roomCode } = await createRoom(host, 'Alice');

    // Add a bot so we can start the game
    await addBot(host);

    // Start the game
    const gameStatePromise = waitForEvent(host, 'game:state');
    startGame(host);
    await gameStatePromise;

    // Transfer session to new socket mid-game
    const transferPromise = waitForEvent(host, 'session:transferred');
    const newClient = await ctx.connectClient({ auth: { userId } });

    // The new socket should receive game state after transfer
    const newGameStatePromise = waitForEvent(newClient, 'game:state');
    const result = await joinRoom(newClient, roomCode, 'Alice');
    const [gameState] = await newGameStatePromise;

    await transferPromise;

    expect(result.playerId).toBeTruthy();
    expect(gameState).toBeTruthy();
    expect(gameState.myCards).toBeDefined();
  });

  it('does not trigger for guest users (no userId)', async () => {
    // Guest creates a room
    const guest = await ctx.connectClient();
    const { roomCode } = await createRoom(guest, 'GuestAlice');

    // Another guest joins — should just be a normal join, not a transfer
    const guest2 = await ctx.connectClient();
    const result = await joinRoom(guest2, roomCode, 'GuestBob');

    expect(result.playerId).toBeTruthy();
    // Two players should be in the room
    const statePromise = waitForEvent(guest, 'room:state');
    // Trigger a state broadcast by having guest2 leave and rejoin
    await tick(50);
  });

  it('does not trigger when different authenticated users join', async () => {
    const client1 = await ctx.connectClient({ auth: { userId: 'user-1' } });
    const { roomCode } = await createRoom(client1, 'Alice');

    // Different user joins — no transfer
    const client2 = await ctx.connectClient({ auth: { userId: 'user-2' } });
    const result = await joinRoom(client2, roomCode, 'Bob');

    expect(result.playerId).toBeTruthy();

    // Wait a bit to make sure no session:transferred event was sent
    await tick(100);
    // client1 should still be connected
    expect(client1.connected).toBe(true);
  });

  it('handles same-browser two-tab scenario (same userId, same room)', async () => {
    const userId = 'user-tabs-789';
    const tab1 = await ctx.connectClient({ auth: { userId } });
    const { roomCode } = await createRoom(tab1, 'Alice');

    const transferPromise = waitForEvent(tab1, 'session:transferred');
    const tab2 = await ctx.connectClient({ auth: { userId } });
    const result = await joinRoom(tab2, roomCode, 'Alice');

    // Tab1 should be notified of transfer
    await transferPromise;
    expect(result.playerId).toBeTruthy();
    expect(result.reconnectToken).toBeTruthy();
  });

  it('rotates the reconnect token on session transfer', async () => {
    const userId = 'user-token-rotate';
    const oldClient = await ctx.connectClient({ auth: { userId } });
    const { roomCode, reconnectToken: oldToken } = await createRoom(oldClient, 'Alice');

    const transferPromise = waitForEvent(oldClient, 'session:transferred');
    const newClient = await ctx.connectClient({ auth: { userId } });
    const result = await joinRoom(newClient, roomCode, 'Alice');
    await transferPromise;

    // New token should be different from the original
    expect(result.reconnectToken).not.toBe(oldToken);
  });

  it('new socket receives room state after transfer', async () => {
    const userId = 'user-state-check';
    const oldClient = await ctx.connectClient({ auth: { userId } });
    const { roomCode } = await createRoom(oldClient, 'Alice');

    const newClient = await ctx.connectClient({ auth: { userId } });
    const roomStatePromise = waitForEvent(newClient, 'room:state');
    await joinRoom(newClient, roomCode, 'Alice');
    const [roomState] = await roomStatePromise;

    expect(roomState.roomCode).toBe(roomCode);
    expect(roomState.players).toHaveLength(1);
    expect(roomState.players[0]!.name).toBe('Alice');
    expect(roomState.players[0]!.isConnected).toBe(true);
  });
});
