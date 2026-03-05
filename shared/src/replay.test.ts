// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ReplayEngine, saveReplay, loadAllReplays, loadReplay, deleteReplay } from './replay.js';
import type { GameReplay, RoundSnapshot } from './replay.js';
import { HandType, TurnAction } from './types.js';
import type { RoundResult, TurnEntry, SpectatorPlayerCards } from './types.js';

function makeRoundSnapshot(roundNumber: number, turnCount = 2): RoundSnapshot {
  const turnHistory: TurnEntry[] = [];
  for (let i = 0; i < turnCount; i++) {
    turnHistory.push({
      playerId: i % 2 === 0 ? 'p1' : 'p2',
      playerName: i % 2 === 0 ? 'Alice' : 'Bob',
      action: i === 0 ? TurnAction.CALL : TurnAction.BULL,
      hand: i === 0 ? { type: HandType.PAIR, rank: '7' } : undefined,
      timestamp: Date.now() + i * 1000,
    });
  }

  const playerCards: SpectatorPlayerCards[] = [
    { playerId: 'p1', playerName: 'Alice', cards: [{ rank: '7', suit: 'hearts' }] },
    { playerId: 'p2', playerName: 'Bob', cards: [{ rank: 'K', suit: 'spades' }] },
  ];

  const result: RoundResult = {
    calledHand: { type: HandType.PAIR, rank: '7' },
    callerId: 'p1',
    handExists: false,
    revealedCards: [],
    penalties: { p1: 2, p2: 1 },
    penalizedPlayerIds: ['p1'],
    eliminatedPlayerIds: [],
    turnHistory,
  };

  return { roundNumber, playerCards, turnHistory, result };
}

function makeReplay(roundCount = 3): GameReplay {
  const rounds: RoundSnapshot[] = [];
  for (let i = 1; i <= roundCount; i++) {
    rounds.push(makeRoundSnapshot(i, i + 1));
  }
  return {
    id: `test-replay-${Date.now()}`,
    players: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }],
    settings: { maxCards: 5, turnTimer: 30 },
    rounds,
    winnerId: 'p2',
    completedAt: new Date().toISOString(),
  };
}

describe('ReplayEngine', () => {
  it('throws on empty rounds', () => {
    const replay = makeReplay(0);
    replay.rounds = [];
    expect(() => new ReplayEngine(replay)).toThrow('no rounds');
  });

  it('starts at round 0 turn 0', () => {
    const engine = new ReplayEngine(makeReplay());
    expect(engine.currentRoundIndex).toBe(0);
    expect(engine.currentTurnIndex).toBe(0);
    expect(engine.isAtStart).toBe(true);
    expect(engine.isAtEnd).toBe(false);
  });

  it('steps forward through turns and resolution', () => {
    const replay = makeReplay(1);
    // Round 1 has 2 turn entries (turnCount = roundNumber + 1 = 2)
    const engine = new ReplayEngine(replay);

    // Step through 2 turns
    expect(engine.stepForward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(1);
    const vs1 = engine.getViewState();
    expect(vs1.visibleHistory).toHaveLength(1);
    expect(vs1.showingResolution).toBe(false);

    expect(engine.stepForward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(2);
    const vs2 = engine.getViewState();
    expect(vs2.visibleHistory).toHaveLength(2);

    // Step to resolution
    expect(engine.stepForward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(3);
    const vs3 = engine.getViewState();
    expect(vs3.showingResolution).toBe(true);

    // At end
    expect(engine.isAtEnd).toBe(true);
    expect(engine.stepForward()).toBe(false);
  });

  it('steps backward', () => {
    const engine = new ReplayEngine(makeReplay(1));
    engine.seekToEnd();
    expect(engine.isAtEnd).toBe(true);

    expect(engine.stepBackward()).toBe(true);
    const vs = engine.getViewState();
    expect(vs.showingResolution).toBe(false);

    engine.seekToStart();
    expect(engine.isAtStart).toBe(true);
    expect(engine.stepBackward()).toBe(false);
  });

  it('navigates across rounds', () => {
    const replay = makeReplay(3);
    const engine = new ReplayEngine(replay);

    engine.seekToRound(2);
    expect(engine.currentRoundIndex).toBe(2);
    expect(engine.currentTurnIndex).toBe(0);

    engine.seekToRound(0);
    expect(engine.currentRoundIndex).toBe(0);
  });

  it('seekToEnd goes to last round resolution', () => {
    const replay = makeReplay(3);
    const engine = new ReplayEngine(replay);
    engine.seekToEnd();
    expect(engine.isAtEnd).toBe(true);
    expect(engine.currentRoundIndex).toBe(2);
    expect(engine.getViewState().showingResolution).toBe(true);
  });

  it('seekToRoundEnd shows resolution for current round', () => {
    const engine = new ReplayEngine(makeReplay(2));
    engine.seekToRound(0);
    engine.seekToRoundEnd();
    expect(engine.getViewState().showingResolution).toBe(true);
    expect(engine.currentRoundIndex).toBe(0);
  });

  it('computes currentHand from visible history', () => {
    const engine = new ReplayEngine(makeReplay(1));
    // Before any step
    expect(engine.getViewState().currentHand).toBeNull();

    // After first step (CALL with hand)
    engine.stepForward();
    const vs = engine.getViewState();
    expect(vs.currentHand).not.toBeNull();
    expect(vs.currentHand!.type).toBe(HandType.PAIR);
    expect(vs.lastCallerId).toBe('p1');
  });

  it('roundCount returns correct number', () => {
    expect(new ReplayEngine(makeReplay(5)).roundCount).toBe(5);
  });

  it('ignores seekToRound with out-of-bounds index', () => {
    const engine = new ReplayEngine(makeReplay(2));
    engine.seekToRound(99);
    expect(engine.currentRoundIndex).toBe(0); // unchanged
    engine.seekToRound(-1);
    expect(engine.currentRoundIndex).toBe(0); // unchanged
  });

  it('crosses round boundaries on step forward/backward', () => {
    const replay = makeReplay(2);
    const engine = new ReplayEngine(replay);

    // Go to end of round 0
    engine.seekToRoundEnd();
    expect(engine.currentRoundIndex).toBe(0);
    expect(engine.getViewState().showingResolution).toBe(true);

    // Step forward should move to round 1
    engine.stepForward();
    expect(engine.currentRoundIndex).toBe(1);
    expect(engine.currentTurnIndex).toBe(0);

    // Step backward should go back to round 0 resolution
    engine.stepBackward();
    expect(engine.currentRoundIndex).toBe(0);
    expect(engine.getViewState().showingResolution).toBe(true);
  });
});

describe('localStorage persistence', () => {
  beforeEach(() => {
    localStorage.removeItem('bull-em-replays');
  });

  it('saves and loads a replay', () => {
    const replay = makeReplay(2);
    saveReplay(replay);
    const loaded = loadReplay(replay.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(replay.id);
    expect(loaded!.rounds).toHaveLength(2);
  });

  it('loads all replays newest first', () => {
    const r1 = makeReplay(1);
    r1.id = 'r1';
    const r2 = makeReplay(2);
    r2.id = 'r2';
    saveReplay(r1);
    saveReplay(r2);
    const all = loadAllReplays();
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe('r2'); // newest first
  });

  it('deletes a replay by ID', () => {
    const replay = makeReplay(1);
    saveReplay(replay);
    expect(loadReplay(replay.id)).not.toBeNull();
    deleteReplay(replay.id);
    expect(loadReplay(replay.id)).toBeNull();
  });

  it('returns null for non-existent replay', () => {
    expect(loadReplay('nonexistent')).toBeNull();
  });

  it('evicts oldest replays beyond max capacity', () => {
    // Save 12 replays (max is 10)
    for (let i = 0; i < 12; i++) {
      const r = makeReplay(1);
      r.id = `evict-${i}`;
      saveReplay(r);
    }
    const all = loadAllReplays();
    expect(all).toHaveLength(10);
    // Oldest (evict-0 and evict-1) should be evicted
    expect(all.find(r => r.id === 'evict-0')).toBeUndefined();
    expect(all.find(r => r.id === 'evict-1')).toBeUndefined();
  });
});
