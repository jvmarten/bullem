import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine.js';
import { HandType, RoundPhase, TurnAction } from '../types.js';
import type { ServerPlayer, HandCall, GameEngineSnapshot } from '../types.js';
import { STARTING_CARDS, MAX_CARDS } from '../constants.js';

function makePlayer(id: string, name: string, cardCount = STARTING_CARDS): ServerPlayer {
  return {
    id,
    name,
    cardCount,
    isConnected: true,
    isEliminated: false,
    isHost: false,
    cards: [],
  };
}

// ─── Cache invalidation: _sharedClientState ──────────────────────────────────

describe('GameEngine: shared client state cache invalidation', () => {
  it('updates public players when isConnected changes externally', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    // First call populates cache
    const state1 = engine.getClientState('p1');
    expect(state1.players.find(p => p.id === 'p2')!.isConnected).toBe(true);

    // External mutation (server sets isConnected = false on disconnect)
    p2.isConnected = false;

    // Cache should invalidate and reflect the change
    const state2 = engine.getClientState('p1');
    expect(state2.players.find(p => p.id === 'p2')!.isConnected).toBe(false);
  });

  it('updates public players when isEliminated changes externally', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    const state1 = engine.getClientState('p1');
    expect(state1.players.find(p => p.id === 'p2')!.isEliminated).toBe(false);

    p2.isEliminated = true;

    const state2 = engine.getClientState('p1');
    expect(state2.players.find(p => p.id === 'p2')!.isEliminated).toBe(true);
  });

  it('updates turn history snapshot after new actions', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    const state1 = engine.getClientState('p1');
    expect(state1.turnHistory).toHaveLength(0);

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });

    const state2 = engine.getClientState('p1');
    expect(state2.turnHistory).toHaveLength(1);
    expect(state2.turnHistory[0].action).toBe(TurnAction.CALL);
  });
});

// ─── Cache invalidation: _activePlayers ──────────────────────────────────────

describe('GameEngine: active players cache invalidation', () => {
  it('getActivePlayers returns correct list after external elimination', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    expect(engine.getActivePlayers()).toHaveLength(3);

    p2.isEliminated = true;

    // Cache should detect the change
    expect(engine.getActivePlayers()).toHaveLength(2);
    expect(engine.getActivePlayers().map(p => p.id)).not.toContain('p2');
  });

  it('getActivePlayers cache is consistent after multiple eliminations', () => {
    const players = Array.from({ length: 6 }, (_, i) =>
      makePlayer(`p${i}`, `Player${i}`)
    );
    const engine = new GameEngine(players);
    engine.startRound();

    expect(engine.getActivePlayers()).toHaveLength(6);

    players[1]!.isEliminated = true;
    expect(engine.getActivePlayers()).toHaveLength(5);

    players[3]!.isEliminated = true;
    expect(engine.getActivePlayers()).toHaveLength(4);

    players[5]!.isEliminated = true;
    expect(engine.getActivePlayers()).toHaveLength(3);

    const activeIds = engine.getActivePlayers().map(p => p.id);
    expect(activeIds).toEqual(['p0', 'p2', 'p4']);
  });
});

// ─── Serialize / restore fidelity: complex state ─────────────────────────────

describe('GameEngine serialize/restore: complex state preservation', () => {
  it('preserves mid-bull-phase state with respondedPlayers', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.PAIR, rank: '7' });
    engine.handleBull('p2');
    // p3 and p4 haven't responded yet

    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    // Restored engine should let p3 act next
    expect(restored.currentPlayerId).toBe('p3');
    const state = restored.getClientState('p1');
    expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);

    // p3 can bull, then p4 must respond
    const result = restored.handleBull('p3');
    expect(result.type).toBe('continue');
    expect(restored.currentPlayerId).toBe('p4');
  });

  it('preserves lastChanceUsed flag across serialize/restore', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [{ rank: '7', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleBull('p3');
    // Use last chance
    engine.handleLastChanceRaise('p1', { type: HandType.HIGH_CARD, rank: '7' });

    const snapshot = engine.serialize();
    expect(snapshot.lastChanceUsed).toBe(true);

    const restored = GameEngine.restore(snapshot);

    // Both players bull again — should resolve immediately (no second last chance)
    restored.handleBull('p2');
    const result = restored.handleBull('p3');
    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
  });

  it('preserves eliminated player state across serialize/restore', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');

    p2.isEliminated = true;
    p2.cardCount = MAX_CARDS + 1;

    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    expect(restored.getActivePlayers()).toHaveLength(2);
    expect(restored.getActivePlayers().map(p => p.id)).toEqual(['p1', 'p3']);
  });

  it('restore validates negative currentPlayerIndex', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const snapshot = engine.serialize();
    snapshot.currentPlayerIndex = -1;
    expect(() => GameEngine.restore(snapshot)).toThrow('currentPlayerIndex');
  });

  it('restore validates unknown roundPhase string', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const snapshot = engine.serialize();
    (snapshot as Record<string, unknown>).roundPhase = 'hacking';
    expect(() => GameEngine.restore(snapshot)).toThrow('roundPhase');
  });
});

// ─── Client state: no card leaks in any phase ────────────────────────────────

describe('GameEngine: anti-cheat across all phases', () => {
  it('never exposes cards in players array during CALLING phase', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const state = engine.getClientState('p1');
    for (const player of state.players) {
      expect((player as Record<string, unknown>)['cards']).toBeUndefined();
    }
  });

  it('never exposes cards in players array during BULL_PHASE', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');

    const state = engine.getClientState('p3');
    expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
    for (const player of state.players) {
      expect((player as Record<string, unknown>)['cards']).toBeUndefined();
    }
  });

  it('never exposes cards in players array during RESOLVING phase', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleTrue('p3');

    // Now in RESOLVING phase
    const state = engine.getClientState('p2');
    for (const player of state.players) {
      expect((player as Record<string, unknown>)['cards']).toBeUndefined();
    }
  });

  it('provides correct myCards for each player (different cards)', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const state1 = engine.getClientState('p1');
    const state2 = engine.getClientState('p2');

    // Each player should see their own cards
    expect(state1.myCards).toEqual(p1.cards);
    expect(state2.myCards).toEqual(p2.cards);

    // Cards should be different (different dealt cards)
    if (p1.cards.length > 0 && p2.cards.length > 0) {
      // This could theoretically be the same card, but with a shuffled deck it's extremely unlikely
      expect(state1.myCards).not.toBe(state2.myCards); // different references at minimum
    }
  });

  it('spectator (eliminated player) sees all active cards', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.isEliminated = true;

    const state = engine.getClientState('p1');
    expect(state.spectatorCards).toBeDefined();
    expect(state.spectatorCards!).toHaveLength(2); // p2 and p3

    // Verify spectator cards match actual cards
    for (const sc of state.spectatorCards!) {
      const player = [p2, p3].find(p => p.id === sc.playerId);
      expect(player).toBeDefined();
      expect(sc.cards).toEqual(player!.cards);
    }
  });
});

// ─── Replay snapshots recording ──────────────────────────────────────────────

describe('GameEngine: replay snapshot recording', () => {
  it('records a round snapshot after each resolution', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    expect(engine.getRoundSnapshots()).toHaveLength(0);

    p1.cards = [{ rank: '7', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
    engine.handleBull('p2');
    engine.handleTrue('p3');

    // After resolution, should have 1 snapshot
    expect(engine.getRoundSnapshots()).toHaveLength(1);

    const snapshot = engine.getRoundSnapshots()[0]!;
    expect(snapshot.roundNumber).toBe(1);
    expect(snapshot.turnHistory).toHaveLength(3);
    expect(snapshot.result).toBeDefined();
    expect(snapshot.result.calledHand).toEqual({ type: HandType.HIGH_CARD, rank: '7' });
  });

  it('captures dealt cards at round start (before any actions)', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    // Store what was dealt
    const p1DealtCards = [...p1.cards];
    const p2DealtCards = [...p2.cards];

    // Now play through and resolve
    engine.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
    const result = engine.handleBull('p2');

    if (result.type === 'last_chance') {
      engine.handleLastChancePass('p1');
    }

    const snapshot = engine.getRoundSnapshots()[0]!;
    expect(snapshot.playerCards).toBeDefined();
    expect(snapshot.playerCards).toHaveLength(2);

    // Cards in snapshot should match what was dealt at round start
    const p1Snapshot = snapshot.playerCards.find(pc => pc.playerId === 'p1');
    const p2Snapshot = snapshot.playerCards.find(pc => pc.playerId === 'p2');
    expect(p1Snapshot).toBeDefined();
    expect(p2Snapshot).toBeDefined();
    expect(p1Snapshot!.cards).toEqual(p1DealtCards);
    expect(p2Snapshot!.cards).toEqual(p2DealtCards);
  });

  it('accumulates snapshots across multiple rounds', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // Round 1
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleTrue('p3');

    expect(engine.getRoundSnapshots()).toHaveLength(1);

    // Round 2
    engine.startNextRound();

    p1.cards = Array.from({ length: p1.cardCount }, () => ({ rank: '5' as const, suit: 'clubs' as const }));
    p2.cards = Array.from({ length: p2.cardCount }, () => ({ rank: '6' as const, suit: 'hearts' as const }));
    p3.cards = Array.from({ length: p3.cardCount }, () => ({ rank: '7' as const, suit: 'diamonds' as const }));

    const caller = engine.currentPlayerId;
    engine.handleCall(caller, { type: HandType.HIGH_CARD, rank: '5' });

    const nonCallers = engine.getActivePlayers().filter(p => p.id !== caller);
    engine.handleBull(engine.currentPlayerId);
    const lastResult = engine.handleTrue(engine.currentPlayerId);

    if (lastResult.type === 'last_chance') {
      engine.handleLastChancePass(caller);
    }

    expect(engine.getRoundSnapshots()).toHaveLength(2);
    expect(engine.getRoundSnapshots()[1]!.roundNumber).toBe(2);
  });
});

// ─── getRoundSummary accuracy ────────────────────────────────────────────────

describe('GameEngine: getRoundSummary', () => {
  it('returns correct active player count and total cards', () => {
    const p1 = makePlayer('p1', 'Alice', 3);
    const p2 = makePlayer('p2', 'Bob', 2);
    const p3 = makePlayer('p3', 'Charlie', 1);
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    const summary = engine.getRoundSummary();
    expect(summary.activePlayerCount).toBe(3);
    expect(summary.totalCards).toBe(6); // 3 + 2 + 1
    expect(summary.turnCount).toBe(0);
  });

  it('excludes eliminated players from summary', () => {
    const p1 = makePlayer('p1', 'Alice', 3);
    const p2 = makePlayer('p2', 'Bob', 2);
    const p3 = makePlayer('p3', 'Charlie', 1);
    p2.isEliminated = true;

    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    const summary = engine.getRoundSummary();
    expect(summary.activePlayerCount).toBe(2);
    expect(summary.totalCards).toBe(4); // 3 + 1, not counting p2
  });

  it('increments turnCount after actions', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    expect(engine.getRoundSummary().turnCount).toBe(1);

    engine.handleBull('p2');
    expect(engine.getRoundSummary().turnCount).toBe(2);
  });
});

// ─── Turn timer deadline ─────────────────────────────────────────────────────

describe('GameEngine: turn deadline', () => {
  it('stores and exposes turn deadline in client state', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    engine.setTurnDeadline(Date.now() + 30000);
    const state = engine.getClientState('p1');
    expect(state.turnDeadline).toBeDefined();
    expect(state.turnDeadline).toBeGreaterThan(0);
  });

  it('returns null deadline when not set', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const state = engine.getClientState('p1');
    expect(state.turnDeadline).toBeNull();
  });

  it('clears deadline when set to null', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    engine.setTurnDeadline(Date.now() + 30000);
    engine.setTurnDeadline(null);

    const state = engine.getClientState('p1');
    expect(state.turnDeadline).toBeNull();
  });
});
