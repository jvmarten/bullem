import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine.js';
import { HandType, RoundPhase } from '../types.js';
import type { ServerPlayer, Card } from '../types.js';

/**
 * Edge case tests for GameEngine — covers gaps in existing test suites:
 * - Mass elimination guard behavior
 * - Stats accuracy in complex scenarios
 * - Last chance mechanics with strict/classic modes
 * - Unraiseable hand (royal flush) auto-bull-phase
 * - eliminatePlayer during different phases
 * - Multi-round card accumulation
 * - Serialize/restore integrity
 */

function makePlayers(count: number, cardCount = 1): ServerPlayer[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    cardCount,
    isConnected: true,
    isEliminated: false,
    isHost: i === 0,
    cards: [],
  }));
}

function setCards(engine: GameEngine, cardMap: Record<string, Card[]>): void {
  for (const p of engine.getActivePlayers()) {
    if (cardMap[p.id]) {
      p.cards = cardMap[p.id]!;
    }
  }
}

// ── Mass elimination guard ──────────────────────────────────────────────────

describe('GameEngine: mass elimination guard', () => {
  it('prevents total wipeout when all players at maxCards would be penalized via last-chance true', () => {
    // 2 players, both at maxCards=1. After last-chance raise, if opponent calls true
    // and the hand doesn't exist, both caller and true-caller are wrong → both eliminated.
    // Mass elimination guard should skip penalties.
    const players = makePlayers(2, 1);
    const engine = new GameEngine(players, { maxCards: 1, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
    });

    // p1 calls high card 5 (doesn't exist)
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' });
    // p2 calls bull → last chance
    engine.handleBull('p2');
    // p1 raises to pair of 5s (doesn't exist)
    engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '5' });
    // p2 calls true (wrong — pair doesn't exist)
    const result = engine.handleTrue('p2');

    // Both would be wrong. Both at maxCards. Guard should prevent elimination.
    expect(result.type).toBe('resolve');
    if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(false);
      expect(result.result.penalizedPlayerIds.length).toBe(0);
      expect(result.result.eliminatedPlayerIds.length).toBe(0);
    }
  });

  it('does NOT trigger guard when only some players would be eliminated', () => {
    const players = makePlayers(3, 1);
    const engine = new GameEngine(players, { maxCards: 3, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: '4', suit: 'diamonds' }],
    });

    // p1 calls pair of Aces (doesn't exist)
    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    // p2 calls bull (correct)
    engine.handleBull('p2');
    // p3 calls true (wrong — pair doesn't exist)
    const result = engine.handleTrue('p3');

    expect(result.type).toBe('resolve');
    if (result.type === 'resolve') {
      // p1 (caller, wrong) and p3 (true, wrong) are penalized
      expect(result.result.penalizedPlayerIds).toContain('p1');
      expect(result.result.penalizedPlayerIds).toContain('p3');
      expect(result.result.penalizedPlayerIds).not.toContain('p2');
    }
  });
});

// ── Stats tracking accuracy ─────────────────────────────────────────────────

describe('GameEngine: stats tracking', () => {
  it('tracks callsMade for multiple raises in a round', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: '3' });
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '4' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const stats = engine.getGameStats();
    expect(stats.playerStats['p1']!.callsMade).toBe(2);
    expect(stats.playerStats['p2']!.callsMade).toBe(1);
    expect(stats.playerStats['p2']!.bullsCalled).toBe(1);
  });

  it('tracks correctBulls when hand does not exist', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: '4', suit: 'diamonds' }],
    });

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2');
    engine.handleBull('p3');
    engine.handleLastChancePass('p1');

    const stats = engine.getGameStats();
    expect(stats.playerStats['p2']!.correctBulls).toBe(1);
    expect(stats.playerStats['p3']!.correctBulls).toBe(1);
    expect(stats.totalRounds).toBe(1);
  });

  it('tracks bluffsSuccessful when caller hand exists and opponents bull', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'A', suit: 'hearts' }],
    });

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const stats = engine.getGameStats();
    expect(stats.playerStats['p1']!.bluffsSuccessful).toBe(1);
  });

  it('tracks handBreakdown with both called and existed counts', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const stats = engine.getGameStats();
    const entry = stats.playerStats['p1']!.handBreakdown.find(e => e.handType === HandType.HIGH_CARD);
    expect(entry).toBeDefined();
    expect(entry!.called).toBe(1);
    expect(entry!.existed).toBe(1); // Ace exists in p1's hand
  });

  it('handBreakdown: existed=0 when called hand does not exist', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
    });

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const stats = engine.getGameStats();
    const entry = stats.playerStats['p1']!.handBreakdown.find(e => e.handType === HandType.PAIR);
    expect(entry).toBeDefined();
    expect(entry!.called).toBe(1);
    expect(entry!.existed).toBe(0); // No pair of Aces exists
  });

  it('last-chance raise increments callsMade and tracks handBreakdown', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' });
    engine.handleBull('p2');
    engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '5' });
    engine.handleBull('p2');

    const stats = engine.getGameStats();
    // handleCall + handleLastChanceRaise both increment callsMade
    expect(stats.playerStats['p1']!.callsMade).toBe(2);
    // Both HIGH_CARD and PAIR should be tracked
    const highCardEntry = stats.playerStats['p1']!.handBreakdown.find(e => e.handType === HandType.HIGH_CARD);
    const pairEntry = stats.playerStats['p1']!.handBreakdown.find(e => e.handType === HandType.PAIR);
    expect(highCardEntry).toBeDefined();
    expect(pairEntry).toBeDefined();
  });
});

// ── Last chance mode variations ─────────────────────────────────────────────

describe('GameEngine: strict vs classic last chance mode', () => {
  it('strict mode: last chance raise enters CALLING phase (true not immediately available)', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed', lastChanceMode: 'strict' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: '4', suit: 'diamonds' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' });
    engine.handleBull('p2');
    engine.handleBull('p3');

    engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '5' });

    const state = engine.getClientState('p2');
    expect(state.roundPhase).toBe(RoundPhase.CALLING);

    // True should fail in CALLING phase
    const trueResult = engine.handleTrue('p2');
    expect(trueResult.type).toBe('error');
  });

  it('classic mode (default): last chance raise enters BULL_PHASE', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: '4', suit: 'diamonds' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' });
    engine.handleBull('p2');
    engine.handleBull('p3');

    engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '5' });

    const state = engine.getClientState('p2');
    expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
  });

  it('strict mode exception: unraiseable last-chance raise enters BULL_PHASE', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed', lastChanceMode: 'strict' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
    });

    engine.handleCall('p1', { type: HandType.STRAIGHT_FLUSH, suit: 'clubs', highRank: 'K' });
    engine.handleBull('p2');
    // p1 raises to royal flush (nothing can beat it)
    engine.handleLastChanceRaise('p1', { type: HandType.ROYAL_FLUSH, suit: 'clubs' });

    // Even in strict mode, should be BULL_PHASE since the hand can't be raised
    const state = engine.getClientState('p2');
    expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
  });
});

// ── Unraiseable hand auto-enters bull phase ─────────────────────────────────

describe('GameEngine: unraiseable hand (royal flush) auto-enters bull phase', () => {
  it('calling royal flush immediately enters BULL_PHASE', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
    });

    engine.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'spades' });

    const state = engine.getClientState('p2');
    expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
  });

  it('opponent can call true on royal flush', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
    });

    engine.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
    // Should be able to call true since we're in BULL_PHASE
    const trueResult = engine.handleTrue('p2');
    expect(trueResult.type).toBe('resolve');
  });
});

// ── eliminatePlayer during different phases ─────────────────────────────────

describe('GameEngine: eliminatePlayer phase interactions', () => {
  it('eliminatePlayer during LAST_CHANCE auto-resolves when caller leaves', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: '4', suit: 'diamonds' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' });
    engine.handleBull('p2');
    engine.handleBull('p3');

    const result = engine.eliminatePlayer('p1');
    expect(result.type).toBe('resolve');
  });

  it('eliminatePlayer during RESOLVING just fixes index, returns continue', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: 'A', suit: 'diamonds' }],
    });

    // Play until round resolves
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    engine.handleTrue('p3');

    // Now in RESOLVING phase — eliminate someone
    const result = engine.eliminatePlayer('p2');
    // During RESOLVING, should just continue
    expect(result.type === 'continue' || result.type === 'game_over').toBe(true);
  });

  it('eliminatePlayer returns game_over when only 1 player left', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    const result = engine.eliminatePlayer('p1');
    expect(result.type).toBe('game_over');
    if (result.type === 'game_over') {
      expect(result.winnerId).toBe('p2');
    }
  });

  it('eliminatePlayer no-op for already eliminated player', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    engine.eliminatePlayer('p1');
    const result = engine.eliminatePlayer('p1');
    expect(result.type).toBe('continue');
  });

  it('eliminatePlayer cascades resolution when all non-callers have now responded', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: '4', suit: 'diamonds' }],
    });

    // p1 calls, p2 bulls, now it's p3's turn
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' });
    engine.handleBull('p2');

    // p3 leaves before responding → p2 is the only non-caller, already responded
    const result = engine.eliminatePlayer('p3');
    // Should cascade to last_chance or resolve
    expect(result.type === 'last_chance' || result.type === 'resolve').toBe(true);
  });
});

// ── Multi-round progression ─────────────────────────────────────────────────

describe('GameEngine: multi-round progression', () => {
  it('startNextRound rotates starting player correctly', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    const round1Starter = engine.currentPlayerId;

    // Complete round 1
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: '4', suit: 'diamonds' }],
    });
    engine.handleCall(engine.currentPlayerId, { type: HandType.HIGH_CARD, rank: 'A' });
    const nextId = engine.currentPlayerId;
    engine.handleBull(nextId);
    const lastId = engine.currentPlayerId;
    engine.handleBull(lastId);
    engine.handleLastChancePass(engine.getClientState('p1').currentPlayerId);

    engine.startNextRound();
    const round2Starter = engine.currentPlayerId;

    // Starting player should rotate
    expect(round2Starter).not.toBe(round1Starter);
  });

  it('startNextRound skips eliminated players in rotation', () => {
    const players = makePlayers(3, 5);
    // p2 at maxCards
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    // Manually eliminate p2
    players[1]!.isEliminated = true;

    const result = engine.startNextRound();
    expect(result.type).toBe('new_round');

    // p2 should not be the starting player
    expect(engine.currentPlayerId).not.toBe('p2');
  });

  it('startNextRound returns game_over when only 1 player left', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    players[0]!.isEliminated = true;
    const result = engine.startNextRound();
    expect(result.type).toBe('game_over');
    if (result.type === 'game_over') {
      expect(result.winnerId).toBe('p2');
    }
  });
});

// ── Serialize/restore ───────────────────────────────────────────────────────

describe('GameEngine: serialize/restore integrity', () => {
  it('round-trip preserves turn history and current player', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
      p3: [{ rank: '4', suit: 'diamonds' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');

    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    const state = restored.getClientState('p3');
    expect(state.turnHistory.length).toBe(2);
    expect(state.currentPlayerId).toBe('p3');
  });

  it('round-trip JSON serialization preserves game state', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });

    const snapshot = engine.serialize();
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json);
    const restored = GameEngine.restore(parsed);

    expect(restored.getClientState('p1').roundNumber).toBe(1);
    expect(restored.getClientState('p1').currentHand).toEqual({ type: HandType.HIGH_CARD, rank: 'A' });
  });

  it('restore rejects out-of-bounds currentPlayerIndex', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    const snapshot = engine.serialize();
    snapshot.currentPlayerIndex = 99;
    expect(() => GameEngine.restore(snapshot)).toThrow(/currentPlayerIndex/);
  });

  it('restore rejects invalid lastCallerId', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    const snapshot = engine.serialize();
    snapshot.lastCallerId = 'ghost';
    expect(() => GameEngine.restore(snapshot)).toThrow(/lastCallerId/);
  });

  it('restore rejects invalid respondedPlayer', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    const snapshot = engine.serialize();
    snapshot.respondedPlayers.push('ghost');
    expect(() => GameEngine.restore(snapshot)).toThrow(/respondedPlayer/);
  });

  it('restore preserves round snapshots for replay', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: '2', suit: 'hearts' }],
      p2: [{ rank: '3', suit: 'clubs' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const snapshots = engine.getRoundSnapshots();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.roundNumber).toBe(1);
    expect(snapshots[0]!.result.calledHand.type).toBe(HandType.HIGH_CARD);

    // Verify snapshots survive serialize/restore
    const engineSnapshot = engine.serialize();
    const restored = GameEngine.restore(engineSnapshot);
    const restoredSnapshots = restored.getRoundSnapshots();
    expect(restoredSnapshots.length).toBe(1);
  });
});

// ── Anti-cheat: client state isolation ──────────────────────────────────────

describe('GameEngine: client state isolation (anti-cheat)', () => {
  it('never leaks other players cards in getClientState', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
      p3: [{ rank: 'Q', suit: 'diamonds' }],
    });

    const p1State = engine.getClientState('p1');
    expect(p1State.myCards).toEqual([{ rank: 'A', suit: 'spades' }]);
    // Player info should not contain card data
    for (const player of p1State.players) {
      expect((player as Record<string, unknown>)['cards']).toBeUndefined();
    }
    // No spectator cards for active players
    expect(p1State.spectatorCards).toBeUndefined();
  });

  it('eliminated players get spectator cards', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
      p3: [{ rank: 'Q', suit: 'diamonds' }],
    });

    players[0]!.isEliminated = true;

    const p1State = engine.getClientState('p1');
    expect(p1State.spectatorCards).toBeDefined();
    expect(p1State.spectatorCards!.length).toBe(2); // Only active players
  });

  it('unknown playerId gets empty myCards', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    const state = engine.getClientState('unknown');
    expect(state.myCards).toEqual([]);
  });
});

// ── Turn validation edge cases ──────────────────────────────────────────────

describe('GameEngine: turn validation', () => {
  it('rejects call during RESOLVING phase', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    // Now in RESOLVING — all actions should fail
    const result = engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    expect(result.type).toBe('error');
  });

  it('rejects bull when no hand has been called', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    const result = engine.handleBull('p1');
    expect(result.type).toBe('error');
  });

  it('rejects call that is not higher than current', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
    });

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    const result = engine.handleCall('p2', { type: HandType.PAIR, rank: '2' });
    expect(result.type).toBe('error');
  });

  it('rejects true during CALLING phase', () => {
    const players = makePlayers(2);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();
    setCards(engine, {
      p1: [{ rank: 'A', suit: 'spades' }],
      p2: [{ rank: 'K', suit: 'hearts' }],
    });

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    const result = engine.handleTrue('p2');
    expect(result.type).toBe('error');
  });

  it('rejects actions from eliminated players', () => {
    const players = makePlayers(3);
    const engine = new GameEngine(players, { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' });
    engine.startRound();

    players[1]!.isEliminated = true;
    const result = engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: 'A' });
    expect(result.type).toBe('error');
  });
});
