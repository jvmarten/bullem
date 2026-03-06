/**
 * E2E integration tests for lobby and room management via real Socket.io connections.
 * Spins up a real server, connects real clients, and tests the full pipeline:
 * socket emit → server handler → validation → state change → broadcast → client receive.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GamePhase, HandType } from '@bull-em/shared';
import {
  createTestServer,
  createRoom,
  joinRoom,
  addBot,
  kickPlayer,
  waitForEvent,
  tick,
  updateSettings,
  startGame,
  type TestContext,
} from './e2e-helpers.js';

describe('E2E: Room lifecycle', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  // ── Room creation ──────────────────────────────────────────────────────

  it('creates a room and returns a room code + reconnect token', async () => {
    const client = await ctx.connectClient();
    const result = await createRoom(client, 'Alice');

    expect(result.roomCode).toMatch(/^[A-Z]{4}$/);
    expect(result.reconnectToken).toBeTruthy();
  });

  it('broadcasts room:state to the creator after creating', async () => {
    const client = await ctx.connectClient();
    const statePromise = waitForEvent(client, 'room:state');
    const { roomCode } = await createRoom(client, 'Alice');
    const [state] = await statePromise;

    expect(state.roomCode).toBe(roomCode);
    expect(state.players).toHaveLength(1);
    expect(state.players[0]!.name).toBe('Alice');
    expect(state.players[0]!.isHost).toBe(true);
    expect(state.gamePhase).toBe(GamePhase.LOBBY);
  });

  it('rejects room creation with invalid name', async () => {
    const client = await ctx.connectClient();
    await expect(createRoom(client, '')).rejects.toThrow('Invalid name');
  });

  it('rejects room creation with name exceeding max length', async () => {
    const client = await ctx.connectClient();
    await expect(createRoom(client, 'A'.repeat(21))).rejects.toThrow('Invalid name');
  });

  // ── Room joining ──────────────────────────────────────────────────────

  it('allows a second player to join and broadcasts updated room state', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    const statePromise = waitForEvent(host, 'room:state');
    const joinResult = await joinRoom(joiner, roomCode, 'Bob');
    const [state] = await statePromise;

    expect(joinResult.playerId).toBeTruthy();
    expect(joinResult.reconnectToken).toBeTruthy();
    expect(state.players).toHaveLength(2);
    expect(state.players.map(p => p.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('rejects joining with invalid room code', async () => {
    const client = await ctx.connectClient();
    await expect(joinRoom(client, 'ZZZZ', 'Bob')).rejects.toThrow('Room not found');
  });

  it('rejects joining with invalid name', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await expect(joinRoom(joiner, roomCode, '')).rejects.toThrow('Invalid name');
  });

  it('rejects duplicate names in the same room', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await expect(joinRoom(joiner, roomCode, 'Alice')).rejects.toThrow('Name already taken');
  });

  it('rejects joining a full room', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    // Set max players to 2
    updateSettings(host, { maxCards: 5, turnTimer: 30, maxPlayers: 2 });
    await tick();

    const p2 = await ctx.connectClient();
    await joinRoom(p2, roomCode, 'Bob');

    const p3 = await ctx.connectClient();
    await expect(joinRoom(p3, roomCode, 'Charlie')).rejects.toThrow('Room is full');
  });

  // ── Room listing ──────────────────────────────────────────────────────

  it('lists available rooms', async () => {
    const host = await ctx.connectClient();
    await createRoom(host, 'Alice');

    const browser = await ctx.connectClient();
    const rooms = await new Promise<{ rooms: unknown[] }>((resolve) => {
      browser.emit('room:list', (res) => resolve(res));
    });

    expect(rooms.rooms).toHaveLength(1);
  });

  // ── Bot management ────────────────────────────────────────────────────

  it('adds and removes a bot', async () => {
    const host = await ctx.connectClient();
    await createRoom(host, 'Alice');

    // Set up listener BEFORE the action so we don't miss the broadcast
    const addStatePromise = waitForEvent(host, 'room:state');
    const { botId } = await addBot(host);
    expect(botId).toMatch(/^bot-/);

    const [state] = await addStatePromise;
    expect(state.players).toHaveLength(2);
    expect(state.players.find(p => p.isBot)).toBeTruthy();

    // Remove bot — listen before emitting
    const removeStatePromise = waitForEvent(host, 'room:state');
    host.emit('room:removeBot', { botId });
    const [stateAfter] = await removeStatePromise;
    expect(stateAfter.players).toHaveLength(1);
    expect(stateAfter.players.find(p => p.isBot)).toBeUndefined();
  });

  // ── Kick player ───────────────────────────────────────────────────────

  it('host can kick a player from the lobby', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    const { playerId: joinerId } = await joinRoom(joiner, roomCode, 'Bob');

    // Set up listeners BEFORE the kick action
    const kickedPromise = waitForEvent(joiner, 'room:kicked');
    const statePromise = waitForEvent(host, 'room:state');
    await kickPlayer(host, joinerId);
    await kickedPromise;

    const [state] = await statePromise;
    expect(state.players).toHaveLength(1);
    expect(state.players[0]!.name).toBe('Alice');
  });

  it('non-host cannot kick a player', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    // Collect room states to get player IDs — listen before join triggers broadcast
    const statePromise = waitForEvent(host, 'room:state');
    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');
    const [hostState] = await statePromise;
    const aliceId = hostState.players.find(p => p.name === 'Alice')!.id;

    await expect(kickPlayer(joiner, aliceId)).rejects.toThrow('Only the host');
  });

  // ── Room deletion ─────────────────────────────────────────────────────

  it('host can delete a room, notifying all players', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');

    const deletedPromise = waitForEvent(joiner, 'room:deleted');
    host.emit('room:delete');
    await deletedPromise;

    // Room should no longer be listable
    await tick();
    const rooms = await new Promise<{ rooms: unknown[] }>((resolve) => {
      const browser = host; // reuse
      browser.emit('room:list', (res) => resolve(res));
    });
    expect(rooms.rooms).toHaveLength(0);
  });

  // ── Leaving a room ────────────────────────────────────────────────────

  it('player leaving the lobby is removed from the room', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');

    const statePromise = waitForEvent(host, 'room:state');
    joiner.emit('room:leave');
    const [state] = await statePromise;

    expect(state.players).toHaveLength(1);
    expect(state.players[0]!.name).toBe('Alice');
  });

  it('host leaving assigns a new host', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');

    const statePromise = waitForEvent(joiner, 'room:state');
    host.emit('room:leave');
    const [state] = await statePromise;

    expect(state.players).toHaveLength(1);
    expect(state.players[0]!.name).toBe('Bob');
    expect(state.players[0]!.isHost).toBe(true);
  });

  // ── Settings ──────────────────────────────────────────────────────────

  it('host can update settings before others join', async () => {
    const host = await ctx.connectClient();
    await createRoom(host, 'Alice');

    const statePromise = waitForEvent(host, 'room:state');
    updateSettings(host, { maxCards: 3, turnTimer: 15 });
    const [state] = await statePromise;

    expect(state.settings.maxCards).toBe(3);
    expect(state.settings.turnTimer).toBe(15);
  });

  it('settings are locked after another human player joins', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');

    // Try to update — should emit room:error
    const errorPromise = waitForEvent(host, 'room:error');
    updateSettings(host, { maxCards: 3, turnTimer: 15 });
    const [errorMsg] = await errorPromise;
    expect(errorMsg).toMatch(/locked/i);
  });

  // ── Game start validation ─────────────────────────────────────────────

  it('rejects game start with only 1 player', async () => {
    const host = await ctx.connectClient();
    await createRoom(host, 'Alice');

    const errorPromise = waitForEvent(host, 'room:error');
    startGame(host);
    const [errorMsg] = await errorPromise;
    expect(errorMsg).toMatch(/at least 2/i);
  });

  it('non-host cannot start the game', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');

    const errorPromise = waitForEvent(joiner, 'room:error');
    startGame(joiner);
    const [errorMsg] = await errorPromise;
    expect(errorMsg).toMatch(/host/i);
  });

  it('starts a game with 2 human players and broadcasts game state', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');

    const hostGameState = waitForEvent(host, 'game:state');
    const joinerGameState = waitForEvent(joiner, 'game:state');

    startGame(host);

    const [hostState] = await hostGameState;
    const [joinerState] = await joinerGameState;

    // Both should be in PLAYING phase
    expect(hostState.gamePhase).toBe(GamePhase.PLAYING);
    expect(joinerState.gamePhase).toBe(GamePhase.PLAYING);

    // Each player sees their own cards (anti-cheat: not others')
    expect(hostState.myCards.length).toBeGreaterThanOrEqual(1);
    expect(joinerState.myCards.length).toBeGreaterThanOrEqual(1);

    // Both see 2 players
    expect(hostState.players).toHaveLength(2);
    expect(joinerState.players).toHaveLength(2);

    // Round 1 starts
    expect(hostState.roundNumber).toBe(1);
  });
});
