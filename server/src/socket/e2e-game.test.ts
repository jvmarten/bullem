/**
 * E2E integration tests for full game flow via real Socket.io connections.
 * Tests: game actions (call/bull/true), round resolution, multi-round play,
 * elimination, game over, rematch, reconnection, and spectating.
 *
 * KEY PATTERN: Always register event listeners BEFORE emitting the action that
 * triggers them. Socket.io broadcasts can arrive before the next line of code
 * after an emit, so `waitForEvent` must be called first, then the action.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GamePhase, HandType, RoundPhase, BotSpeed } from '@bull-em/shared';
import type { ClientGameState } from '@bull-em/shared';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@bull-em/shared';
import {
  createTestServer,
  createRoom,
  joinRoom,
  addBot,
  waitForEvent,
  collectEvents,
  tick,
  updateSettings,
  startGame,
  gameCall,
  gameBull,
  gameTrue,
  gameLastChancePass,
  gameContinue,
  gameRematch,
  type TestContext,
} from './e2e-helpers.js';

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

interface TwoPlayerGame {
  host: TypedClientSocket;
  joiner: TypedClientSocket;
  roomCode: string;
  hostId: string;
  joinerId: string;
  hostReconnectToken: string;
  joinerReconnectToken: string;
  initialState: ClientGameState;
  /** Socket of the player whose turn it is. */
  currentSocket: TypedClientSocket;
  /** Socket of the player who is NOT current. */
  otherSocket: TypedClientSocket;
  currentId: string;
  otherId: string;
}

/**
 * Set up a 2-player game, start it, and return everything needed for game action tests.
 * Listeners are registered BEFORE actions to avoid missed events.
 */
async function setupTwoPlayerGame(ctx: TestContext): Promise<TwoPlayerGame> {
  const host = await ctx.connectClient();
  const { roomCode, reconnectToken: hostReconnectToken } = await createRoom(host, 'Alice');

  // Listen for room:state BEFORE the join triggers a broadcast
  const roomStatePromise = waitForEvent(host, 'room:state');
  const joiner = await ctx.connectClient();
  const joinResult = await joinRoom(joiner, roomCode, 'Bob');
  const [roomState] = await roomStatePromise;
  const hostId = roomState.players.find(p => p.name === 'Alice')!.id;

  // Listen for game:state BEFORE starting the game
  const hostGamePromise = waitForEvent(host, 'game:state');
  const joinerGamePromise = waitForEvent(joiner, 'game:state');
  startGame(host);
  const [hostState] = await hostGamePromise;
  await joinerGamePromise;

  const currentId = hostState.currentPlayerId;
  const otherId = currentId === hostId ? joinResult.playerId : hostId;
  const currentSocket = currentId === hostId ? host : joiner;
  const otherSocket = currentId === hostId ? joiner : host;

  return {
    host, joiner, roomCode,
    hostId, joinerId: joinResult.playerId,
    hostReconnectToken, joinerReconnectToken: joinResult.reconnectToken,
    initialState: hostState,
    currentSocket, otherSocket, currentId, otherId,
  };
}

/**
 * Play call → bull → last-chance-pass in a 2-player game. Returns the round result.
 * Handles the automatic last-chance phase that always happens in 2-player bull calls.
 */
async function playCallBullResolve(
  game: TwoPlayerGame,
  hand: { type: HandType; rank?: string; suit?: string },
): Promise<{ roundResult: Parameters<ServerToClientEvents['game:roundResult']>[0] }> {
  const { currentSocket, otherSocket, host, joiner } = game;

  // Step 1: Call — listen on BOTH sockets since broadcastGameState sends to all.
  // If we only listen on otherSocket, currentSocket's game:state from the call
  // may arrive late and be caught by the bull listener instead.
  const afterCallBoth = Promise.all([
    waitForEvent(currentSocket, 'game:state'),
    waitForEvent(otherSocket, 'game:state'),
  ]);
  gameCall(currentSocket, hand as never);
  await afterCallBoth;

  // Step 2: Bull (triggers last chance in 2-player)
  const afterBullBoth = Promise.all([
    waitForEvent(currentSocket, 'game:state'),
    waitForEvent(otherSocket, 'game:state'),
  ]);
  gameBull(otherSocket);
  const [[lcState]] = await afterBullBoth;

  // Step 3: Last chance pass → resolve
  // Wait for the per-player rate limiter cooldown (200ms) since the same player
  // emitted game:call earlier and game:lastChancePass is also a game action.
  await tick(250);
  const rrHost = waitForEvent(host, 'game:roundResult', 10000);
  const rrJoiner = waitForEvent(joiner, 'game:roundResult', 10000);
  if (lcState.roundPhase === RoundPhase.LAST_CHANCE) {
    gameLastChancePass(currentSocket);
  }
  const [roundResult] = await Promise.race([rrHost, rrJoiner]);

  return { roundResult };
}

describe('E2E: Game actions', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('current player can make a call and turn advances', async () => {
    const game = await setupTwoPlayerGame(ctx);
    const { currentSocket, otherSocket, currentId } = game;

    const otherStatePromise = waitForEvent(otherSocket, 'game:state');
    gameCall(currentSocket, { type: HandType.HIGH_CARD, rank: '7' });
    const [nextState] = await otherStatePromise;

    expect(nextState.currentPlayerId).not.toBe(currentId);
    expect(nextState.currentHand).toEqual({ type: HandType.HIGH_CARD, rank: '7' });
  });

  it('non-current player cannot make a call (gets error)', async () => {
    const game = await setupTwoPlayerGame(ctx);
    const { otherSocket } = game;

    const errorPromise = waitForEvent(otherSocket, 'room:error');
    gameCall(otherSocket, { type: HandType.HIGH_CARD, rank: '7' });
    const [errorMsg] = await errorPromise;
    expect(errorMsg).toMatch(/not your turn/i);
  });

  it('calling bull triggers round resolution', async () => {
    const game = await setupTwoPlayerGame(ctx);
    const { roundResult } = await playCallBullResolve(game, { type: HandType.HIGH_CARD, rank: 'A' });

    expect(roundResult.calledHand).toEqual({ type: HandType.HIGH_CARD, rank: 'A' });
    expect(typeof roundResult.handExists).toBe('boolean');
    expect(roundResult.penalizedPlayerIds.length).toBeGreaterThan(0);
  });

  it('must raise higher than current hand', async () => {
    const game = await setupTwoPlayerGame(ctx);
    const { currentSocket, otherSocket } = game;

    // Consume both sockets' game:state to avoid stale events
    const afterCall = Promise.all([
      waitForEvent(currentSocket, 'game:state'),
      waitForEvent(otherSocket, 'game:state'),
    ]);
    gameCall(currentSocket, { type: HandType.HIGH_CARD, rank: 'K' });
    await afterCall;

    const errorPromise = waitForEvent(otherSocket, 'room:error');
    gameCall(otherSocket, { type: HandType.HIGH_CARD, rank: '7' });
    const [errorMsg] = await errorPromise;
    expect(errorMsg).toMatch(/higher/i);
  });
});

describe('E2E: Round resolution and multi-round play', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('plays through call → bull → last chance pass → resolution → continue → next round', async () => {
    const game = await setupTwoPlayerGame(ctx);
    const { host, joiner } = game;

    const { roundResult } = await playCallBullResolve(game, { type: HandType.PAIR, rank: '5' });

    expect(roundResult.calledHand).toEqual({ type: HandType.PAIR, rank: '5' });
    expect(typeof roundResult.handExists).toBe('boolean');
    expect(roundResult.turnHistory).toBeDefined();
    expect(roundResult.turnHistory!.length).toBeGreaterThanOrEqual(2);

    // Wait for rate limiter cooldown before continues (same player may have
    // emitted gameLastChancePass moments ago inside playCallBullResolve)
    await tick(250);
    const newRoundHost = waitForEvent(host, 'game:newRound', 10000);
    const newRoundJoiner = waitForEvent(joiner, 'game:newRound', 10000);
    gameContinue(host);
    gameContinue(joiner);
    const [newRoundState] = await Promise.race([newRoundHost, newRoundJoiner]);

    expect(newRoundState.roundNumber).toBe(2);
    expect(newRoundState.gamePhase).toBe(GamePhase.PLAYING);
  });

  it('penalized player gets extra cards in the next round', async () => {
    const game = await setupTwoPlayerGame(ctx);
    const { host, joiner } = game;

    const { roundResult } = await playCallBullResolve(game, { type: HandType.PAIR, rank: '5' });

    const penalizedIds = roundResult.penalizedPlayerIds;
    expect(penalizedIds.length).toBeGreaterThan(0);

    // Wait for rate limiter cooldown before continues
    await tick(250);
    const newRoundHost = waitForEvent(host, 'game:newRound', 10000);
    const newRoundJoiner = waitForEvent(joiner, 'game:newRound', 10000);
    gameContinue(host);
    gameContinue(joiner);
    const [nextState] = await Promise.race([newRoundHost, newRoundJoiner]);

    const penalizedPlayer = nextState.players.find(p => penalizedIds.includes(p.id));
    expect(penalizedPlayer?.cardCount).toBe(2);
  });
});

describe('E2E: Game with bots', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('starts a game with human + bot and bot takes turns automatically', async () => {
    const host = await ctx.connectClient();
    await createRoom(host, 'Alice');

    updateSettings(host, { maxCards: 5, turnTimer: 30, botSpeed: BotSpeed.FAST });
    await tick();

    const addStatePromise = waitForEvent(host, 'room:state');
    await addBot(host);
    await addStatePromise;

    const gameStatePromise = waitForEvent(host, 'game:state');
    startGame(host);
    const [initialState] = await gameStatePromise;

    expect(initialState.players).toHaveLength(2);
    expect(initialState.gamePhase).toBe(GamePhase.PLAYING);

    const isHumanTurn = !initialState.players.find(p => p.id === initialState.currentPlayerId)?.isBot;
    if (isHumanTurn) {
      // Human turn → make a call, then wait for bot's response.
      // collectEvents(2) captures: 1) state after our call, 2) state after bot's action.
      const botResponsePromise = collectEvents(host, 'game:state', 2, 15000);
      gameCall(host, { type: HandType.HIGH_CARD, rank: '5' });
      const states = await botResponsePromise;
      // After bot acts, turn history should have at least our call + bot action
      expect(states[1]![0].turnHistory.length).toBeGreaterThan(1);
    } else {
      // Bot goes first — wait for it to act (it will broadcast a new game:state)
      const [stateAfterBot] = await waitForEvent(host, 'game:state', 15000);
      expect(stateAfterBot.turnHistory.length).toBeGreaterThan(0);
    }
  });
});

describe('E2E: Reconnection', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('player can reconnect during a game with a valid token', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const roomStatePromise = waitForEvent(host, 'room:state');
    const joiner = await ctx.connectClient();
    const joinResult = await joinRoom(joiner, roomCode, 'Bob');
    await roomStatePromise;

    const hostGamePromise = waitForEvent(host, 'game:state');
    const joinerGamePromise = waitForEvent(joiner, 'game:state');
    startGame(host);
    await hostGamePromise;
    await joinerGamePromise;

    // Disconnect joiner
    const disconnectedPromise = waitForEvent(host, 'player:disconnected');
    joiner.disconnect();
    const [disconnectedPlayerId] = await disconnectedPromise;
    expect(disconnectedPlayerId).toBe(joinResult.playerId);

    // Reconnect with a new socket
    const reconnected = await ctx.connectClient();
    const reconnectedPromise = waitForEvent(host, 'player:reconnected');
    const gameStatePromise = waitForEvent(reconnected, 'game:state');
    const reconnectResult = await joinRoom(reconnected, roomCode, 'Bob', {
      playerId: joinResult.playerId,
      reconnectToken: joinResult.reconnectToken,
    });
    const [reconnectedPlayerId] = await reconnectedPromise;

    expect(reconnectedPlayerId).toBe(joinResult.playerId);
    expect(reconnectResult.reconnectToken).toBeTruthy();
    expect(reconnectResult.reconnectToken).not.toBe(joinResult.reconnectToken);

    const [gameState] = await gameStatePromise;
    expect(gameState.gamePhase).toBe(GamePhase.PLAYING);
    expect(gameState.myCards.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects reconnection with invalid token', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    const joinResult = await joinRoom(joiner, roomCode, 'Bob');

    const gamePromise = waitForEvent(host, 'game:state');
    startGame(host);
    await gamePromise;

    joiner.disconnect();
    await tick(100);

    const reconnected = await ctx.connectClient();
    await expect(
      joinRoom(reconnected, roomCode, 'Bob', {
        playerId: joinResult.playerId,
        reconnectToken: 'invalid-token',
      }),
    ).rejects.toThrow();
  });
});

describe('E2E: Spectating', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('spectator can watch an active game', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    updateSettings(host, { maxCards: 5, turnTimer: 30, allowSpectators: true, spectatorsCanSeeCards: true });
    await tick();

    const addStatePromise = waitForEvent(host, 'room:state');
    await addBot(host);
    await addStatePromise;

    const gameStatePromise = waitForEvent(host, 'game:state');
    startGame(host);
    await gameStatePromise;

    // Spectator connects and watches
    const spectator = await ctx.connectClient();
    const spectatorStatePromise = waitForEvent(spectator, 'game:state');
    const spectatorResult = await new Promise<{ ok?: true; error?: string }>((resolve) => {
      spectator.emit('room:spectate', { roomCode }, (res) => resolve(res));
    });
    expect(spectatorResult.ok).toBe(true);

    const [spectatorState] = await spectatorStatePromise;
    expect(spectatorState.gamePhase).toBe(GamePhase.PLAYING);
    expect(spectatorState.spectatorCards).toBeDefined();
    expect(spectatorState.spectatorCards!.length).toBeGreaterThan(0);
  });

  it('rejects spectating when not allowed', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    updateSettings(host, { maxCards: 5, turnTimer: 30, allowSpectators: false });
    await tick();

    const addStatePromise = waitForEvent(host, 'room:state');
    await addBot(host);
    await addStatePromise;

    const gameStatePromise = waitForEvent(host, 'game:state');
    startGame(host);
    await gameStatePromise;

    const spectator = await ctx.connectClient();
    const result = await new Promise<{ ok?: true; error?: string }>((resolve) => {
      spectator.emit('room:spectate', { roomCode }, (res) => resolve(res));
    });
    expect(result.error).toMatch(/not allowed/i);
  });
});

describe('E2E: Game over and rematch', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('game ends when a player is eliminated and only one remains', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    // maxCards=1 means first penalty eliminates
    updateSettings(host, { maxCards: 1, turnTimer: 30 });
    await tick();

    const roomStatePromise = waitForEvent(host, 'room:state');
    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');
    const [rs] = await roomStatePromise;
    const hostPlayerId = rs.players.find(p => p.name === 'Alice')!.id;

    const hostGamePromise = waitForEvent(host, 'game:state');
    const joinerGamePromise = waitForEvent(joiner, 'game:state');
    startGame(host);
    const [initialState] = await hostGamePromise;
    await joinerGamePromise;

    const currentId = initialState.currentPlayerId;
    const currentSocket = currentId === hostPlayerId ? host : joiner;
    const otherSocket = currentId === hostPlayerId ? joiner : host;

    // Call — consume game:state from both sockets
    const afterCall = Promise.all([
      waitForEvent(currentSocket, 'game:state'),
      waitForEvent(otherSocket, 'game:state'),
    ]);
    gameCall(currentSocket, { type: HandType.HIGH_CARD, rank: 'A' });
    await afterCall;

    // Bull → triggers last chance — consume both sockets
    const afterBull = Promise.all([
      waitForEvent(currentSocket, 'game:state'),
      waitForEvent(otherSocket, 'game:state'),
    ]);
    gameBull(otherSocket);
    const [[lcState]] = await afterBull;

    // Wait for rate limiter cooldown, then listen on both sockets for game:over
    await tick(250);
    const goHost = waitForEvent(host, 'game:over', 15000);
    const goJoiner = waitForEvent(joiner, 'game:over', 15000);
    if (lcState.roundPhase === RoundPhase.LAST_CHANCE) {
      gameLastChancePass(currentSocket);
    }

    const [winnerId, stats] = await Promise.race([goHost, goJoiner]);
    expect(winnerId).toBeTruthy();
    expect(stats.totalRounds).toBeGreaterThanOrEqual(1);
  });

  it('host can start a rematch after game over', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    updateSettings(host, { maxCards: 1, turnTimer: 30 });
    await tick();

    const roomStatePromise = waitForEvent(host, 'room:state');
    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');
    const [rs] = await roomStatePromise;
    const hostPlayerId = rs.players.find(p => p.name === 'Alice')!.id;

    const hostGamePromise = waitForEvent(host, 'game:state');
    const joinerGamePromise = waitForEvent(joiner, 'game:state');
    startGame(host);
    const [initialState] = await hostGamePromise;
    await joinerGamePromise;

    const currentId = initialState.currentPlayerId;
    const currentSocket = currentId === hostPlayerId ? host : joiner;
    const otherSocket = currentId === hostPlayerId ? joiner : host;

    // Play to game over
    // Call — consume both sockets' game:state
    const afterCall = Promise.all([
      waitForEvent(currentSocket, 'game:state'),
      waitForEvent(otherSocket, 'game:state'),
    ]);
    gameCall(currentSocket, { type: HandType.HIGH_CARD, rank: 'A' });
    await afterCall;

    // Bull — consume both sockets' game:state
    const afterBull = Promise.all([
      waitForEvent(currentSocket, 'game:state'),
      waitForEvent(otherSocket, 'game:state'),
    ]);
    gameBull(otherSocket);
    const [[lcState]] = await afterBull;

    // Wait for rate limiter cooldown, then listen on both sockets for game:over
    await tick(250);
    const goHost = waitForEvent(host, 'game:over', 15000);
    const goJoiner = waitForEvent(joiner, 'game:over', 15000);
    if (lcState.roundPhase === RoundPhase.LAST_CHANCE) {
      gameLastChancePass(currentSocket);
    }
    await Promise.race([goHost, goJoiner]);

    // Start rematch
    const rematchStarting = waitForEvent(host, 'game:rematchStarting');
    const newGameState = waitForEvent(host, 'game:state');
    gameRematch(host);
    await rematchStarting;
    const [state] = await newGameState;

    expect(state.gamePhase).toBe(GamePhase.PLAYING);
    expect(state.roundNumber).toBe(1);
    expect(state.players.every(p => !p.isEliminated)).toBe(true);
  });
});

describe('E2E: Three player game — true calls', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('with 3 players, after a bull, next player can call true', async () => {
    const p1 = await ctx.connectClient();
    const { roomCode } = await createRoom(p1, 'Alice');

    const p2 = await ctx.connectClient();
    await joinRoom(p2, roomCode, 'Bob');

    // Listen before third player join
    const rsPromise = waitForEvent(p1, 'room:state');
    const p3 = await ctx.connectClient();
    await joinRoom(p3, roomCode, 'Charlie');
    const [rs] = await rsPromise;

    const idMap = new Map<string, TypedClientSocket>();
    for (const p of rs.players) {
      if (p.name === 'Alice') idMap.set(p.id, p1);
      else if (p.name === 'Bob') idMap.set(p.id, p2);
      else idMap.set(p.id, p3);
    }

    const p1GamePromise = waitForEvent(p1, 'game:state');
    startGame(p1);
    const [initialState] = await p1GamePromise;

    const currentId = initialState.currentPlayerId;
    const currentSocket = idMap.get(currentId)!;

    // Current player makes a call — listen on all 3 before emitting
    const s1Promise = Promise.all([
      waitForEvent(p1, 'game:state'),
      waitForEvent(p2, 'game:state'),
      waitForEvent(p3, 'game:state'),
    ]);
    gameCall(currentSocket, { type: HandType.HIGH_CARD, rank: 'K' });
    const states1 = await s1Promise;

    const stateAfterCall = states1[0][0];
    const nextPlayerId = stateAfterCall.currentPlayerId;
    const nextSocket = idMap.get(nextPlayerId)!;

    // Next player calls bull
    const s2Promise = Promise.all([
      waitForEvent(p1, 'game:state'),
      waitForEvent(p2, 'game:state'),
      waitForEvent(p3, 'game:state'),
    ]);
    gameBull(nextSocket);
    const states2 = await s2Promise;

    const stateAfterBull = states2[0][0];
    expect(stateAfterBull.roundPhase).toBe(RoundPhase.BULL_PHASE);

    const thirdPlayerId = stateAfterBull.currentPlayerId;
    const thirdSocket = idMap.get(thirdPlayerId)!;
    expect(thirdPlayerId).not.toBe(currentId);

    // Third player calls true → all non-callers have responded → resolve
    const roundResultPromise = waitForEvent(p1, 'game:roundResult', 10000);
    gameTrue(thirdSocket);
    const [roundResult] = await roundResultPromise;

    expect(roundResult.calledHand).toEqual({ type: HandType.HIGH_CARD, rank: 'K' });
    expect(typeof roundResult.handExists).toBe('boolean');
  });
});

describe('E2E: Player leaving during game', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('player leaving during a 2-player game triggers game over for the remaining player', async () => {
    const game = await setupTwoPlayerGame(ctx);

    const gameOverPromise = waitForEvent(game.host, 'game:over', 10000);
    game.joiner.emit('room:leave');
    const [winnerId] = await gameOverPromise;
    expect(winnerId).toBeTruthy();
  });
});

describe('E2E: Anti-cheat — server-authoritative state', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestServer();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('each player only receives their own cards, not other players cards', async () => {
    const host = await ctx.connectClient();
    const { roomCode } = await createRoom(host, 'Alice');

    const joiner = await ctx.connectClient();
    await joinRoom(joiner, roomCode, 'Bob');

    // Listen BEFORE starting
    const hostStatePromise = waitForEvent(host, 'game:state');
    const joinerStatePromise = waitForEvent(joiner, 'game:state');
    startGame(host);

    const [hostState] = await hostStatePromise;
    const [joinerState] = await joinerStatePromise;

    expect(hostState.myCards.length).toBeGreaterThanOrEqual(1);
    expect(joinerState.myCards.length).toBeGreaterThanOrEqual(1);

    for (const player of hostState.players) {
      expect(player).not.toHaveProperty('cards');
    }
    for (const player of joinerState.players) {
      expect(player).not.toHaveProperty('cards');
    }

    expect(hostState.spectatorCards).toBeUndefined();
    expect(joinerState.spectatorCards).toBeUndefined();
  });
});
