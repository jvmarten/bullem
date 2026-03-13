/**
 * Comprehensive ReplayEngine navigation tests.
 * Verifies stepping forward/backward, seeking, boundary detection,
 * and view state computation across multi-round replays.
 */
import { describe, it, expect } from 'vitest';
import { ReplayEngine, type GameReplay } from './replay.js';
import { HandType, TurnAction } from './types.js';
import type { TurnEntry, RoundResult, SpectatorPlayerCards } from './types.js';

function makeTurnEntry(playerId: string, action: TurnAction, hand?: TurnEntry['hand']): TurnEntry {
  return { playerId, playerName: `Player_${playerId}`, action, hand, timestamp: Date.now() };
}

function makePlayerCards(id: string, cards: { rank: string; suit: string }[]): SpectatorPlayerCards {
  return {
    playerId: id,
    playerName: `Player_${id}`,
    cards: cards.map(c => ({ rank: c.rank as any, suit: c.suit as any })),
  };
}

function makeRoundResult(callerIdVal: string, handExists: boolean): RoundResult {
  return {
    calledHand: { type: HandType.HIGH_CARD, rank: 'A' },
    callerId: callerIdVal,
    handExists,
    revealedCards: [],
    penalties: {},
    penalizedPlayerIds: [],
    eliminatedPlayerIds: [],
    turnHistory: [],
  };
}

function makeReplay(roundCount: number, turnsPerRound: number): GameReplay {
  const rounds = [];
  for (let r = 0; r < roundCount; r++) {
    const turnHistory: TurnEntry[] = [];
    turnHistory.push(makeTurnEntry('p1', TurnAction.CALL, { type: HandType.HIGH_CARD, rank: 'A' }));
    for (let t = 1; t < turnsPerRound; t++) {
      turnHistory.push(makeTurnEntry('p2', TurnAction.BULL));
    }
    rounds.push({
      roundNumber: r + 1,
      playerCards: [
        makePlayerCards('p1', [{ rank: 'A', suit: 'spades' }]),
        makePlayerCards('p2', [{ rank: 'K', suit: 'hearts' }]),
      ],
      turnHistory,
      result: makeRoundResult('p1', r % 2 === 0),
    });
  }
  return {
    id: 'test-replay',
    players: [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }],
    settings: { maxCards: 5, turnTimer: 30, botLevelCategory: 'mixed' as const },
    rounds,
    winnerId: 'p1',
    completedAt: new Date().toISOString(),
  };
}

describe('ReplayEngine construction', () => {
  it('throws on empty rounds', () => {
    const replay: GameReplay = {
      id: 'empty', players: [], settings: { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' },
      rounds: [], winnerId: '', completedAt: '',
    };
    expect(() => new ReplayEngine(replay)).toThrow('no rounds');
  });

  it('starts at round 0, turn 0', () => {
    const engine = new ReplayEngine(makeReplay(3, 2));
    expect(engine.currentRoundIndex).toBe(0);
    expect(engine.currentTurnIndex).toBe(0);
    expect(engine.isAtStart).toBe(true);
    expect(engine.isAtEnd).toBe(false);
  });

  it('reports correct round count', () => {
    expect(new ReplayEngine(makeReplay(5, 2)).roundCount).toBe(5);
    expect(new ReplayEngine(makeReplay(1, 3)).roundCount).toBe(1);
  });
});

describe('ReplayEngine stepping', () => {
  it('steps through all turns in a round then to resolution', () => {
    const engine = new ReplayEngine(makeReplay(1, 3)); // 3 turns per round

    // Step 1: turn 1
    expect(engine.stepForward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(1);

    // Step 2: turn 2
    expect(engine.stepForward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(2);

    // Step 3: turn 3
    expect(engine.stepForward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(3);

    // Step 4: resolution (turn 4 = turnCount + 1)
    expect(engine.stepForward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(4);

    // Should be showing resolution
    const state = engine.getViewState();
    expect(state.showingResolution).toBe(true);

    // At end of single-round replay
    expect(engine.isAtEnd).toBe(true);
    expect(engine.stepForward()).toBe(false);
  });

  it('crosses round boundaries when stepping forward', () => {
    const engine = new ReplayEngine(makeReplay(2, 2)); // 2 rounds, 2 turns each

    // Step through round 1 (2 turns + resolution = 3 steps)
    engine.stepForward(); // turn 1
    engine.stepForward(); // turn 2
    engine.stepForward(); // resolution

    expect(engine.currentRoundIndex).toBe(0);

    // Next step should cross to round 2
    engine.stepForward();
    expect(engine.currentRoundIndex).toBe(1);
    expect(engine.currentTurnIndex).toBe(0);
  });

  it('steps backward correctly', () => {
    const engine = new ReplayEngine(makeReplay(1, 2));

    engine.stepForward(); // turn 1
    engine.stepForward(); // turn 2

    expect(engine.stepBackward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(1);

    expect(engine.stepBackward()).toBe(true);
    expect(engine.currentTurnIndex).toBe(0);
    expect(engine.isAtStart).toBe(true);

    // Can't go back further
    expect(engine.stepBackward()).toBe(false);
  });

  it('stepping backward across rounds goes to previous round resolution', () => {
    const engine = new ReplayEngine(makeReplay(2, 2));

    // Go to start of round 2
    engine.seekToRound(1);
    expect(engine.currentRoundIndex).toBe(1);
    expect(engine.currentTurnIndex).toBe(0);

    // Step back should go to round 1 resolution
    expect(engine.stepBackward()).toBe(true);
    expect(engine.currentRoundIndex).toBe(0);
    // Should be at resolution step (turnCount + 1 = 3)
    expect(engine.currentTurnIndex).toBe(3);
  });
});

describe('ReplayEngine seeking', () => {
  it('seekToRound jumps to the start of a round', () => {
    const engine = new ReplayEngine(makeReplay(5, 2));

    engine.seekToRound(3);
    expect(engine.currentRoundIndex).toBe(3);
    expect(engine.currentTurnIndex).toBe(0);
  });

  it('seekToRound ignores out-of-bounds index', () => {
    const engine = new ReplayEngine(makeReplay(3, 2));

    engine.seekToRound(1);
    engine.seekToRound(99); // should be ignored
    expect(engine.currentRoundIndex).toBe(1);

    engine.seekToRound(-1); // should be ignored
    expect(engine.currentRoundIndex).toBe(1);
  });

  it('seekToStart goes to beginning', () => {
    const engine = new ReplayEngine(makeReplay(3, 2));

    engine.seekToEnd();
    expect(engine.isAtEnd).toBe(true);

    engine.seekToStart();
    expect(engine.isAtStart).toBe(true);
    expect(engine.currentRoundIndex).toBe(0);
    expect(engine.currentTurnIndex).toBe(0);
  });

  it('seekToEnd goes to resolution of last round', () => {
    const engine = new ReplayEngine(makeReplay(3, 2));

    engine.seekToEnd();
    expect(engine.isAtEnd).toBe(true);
    expect(engine.currentRoundIndex).toBe(2);

    const state = engine.getViewState();
    expect(state.showingResolution).toBe(true);
  });

  it('seekToRoundEnd goes to resolution of current round', () => {
    const engine = new ReplayEngine(makeReplay(3, 4));

    engine.seekToRound(1);
    engine.stepForward(); // at turn 1 of round 2

    engine.seekToRoundEnd();
    expect(engine.currentRoundIndex).toBe(1);

    const state = engine.getViewState();
    expect(state.showingResolution).toBe(true);
  });
});

describe('ReplayEngine view state computation', () => {
  it('before any action shows empty history and null hand', () => {
    const engine = new ReplayEngine(makeReplay(1, 2));
    const state = engine.getViewState();

    expect(state.visibleHistory.length).toBe(0);
    expect(state.currentHand).toBeNull();
    expect(state.lastCallerId).toBeNull();
    expect(state.showingResolution).toBe(false);
  });

  it('after stepping shows progressive history', () => {
    const engine = new ReplayEngine(makeReplay(1, 3));

    engine.stepForward();
    let state = engine.getViewState();
    expect(state.visibleHistory.length).toBe(1);
    expect(state.currentHand).not.toBeNull(); // first action is a CALL
    expect(state.lastCallerId).toBe('p1');

    engine.stepForward();
    state = engine.getViewState();
    expect(state.visibleHistory.length).toBe(2);
  });

  it('playerCards are available for current round', () => {
    const engine = new ReplayEngine(makeReplay(2, 2));
    const state = engine.getViewState();

    expect(state.playerCards.length).toBe(2);
    expect(state.playerCards[0]!.playerId).toBe('p1');
    expect(state.playerCards[1]!.playerId).toBe('p2');
  });

  it('currentRoundStepCount is turnHistory.length + 1', () => {
    const replay = makeReplay(1, 4); // 4 turns
    const engine = new ReplayEngine(replay);
    expect(engine.currentRoundStepCount).toBe(5); // 4 turns + 1 resolution
  });
});

describe('ReplayEngine round result access', () => {
  it('returns current round result', () => {
    const engine = new ReplayEngine(makeReplay(3, 2));

    const result = engine.getCurrentRoundResult();
    expect(result.callerId).toBe('p1');
    expect(result.calledHand.type).toBe(HandType.HIGH_CARD);
  });

  it('returns correct round result after seeking', () => {
    const replay = makeReplay(3, 2);
    const engine = new ReplayEngine(replay);

    engine.seekToRound(2);
    const result = engine.getCurrentRoundResult();
    expect(result).toBe(replay.rounds[2]!.result);
  });
});

describe('ReplayEngine full game navigation', () => {
  it('can step through entire 5-round replay and back', () => {
    const engine = new ReplayEngine(makeReplay(5, 3));

    // Step all the way to the end
    let forwardSteps = 0;
    while (engine.stepForward()) {
      forwardSteps++;
    }
    expect(engine.isAtEnd).toBe(true);

    // Step all the way back
    let backwardSteps = 0;
    while (engine.stepBackward()) {
      backwardSteps++;
    }
    expect(engine.isAtStart).toBe(true);

    // Should take same number of steps both ways
    expect(forwardSteps).toBe(backwardSteps);
  });

  it('getReplay returns the original replay data', () => {
    const replay = makeReplay(2, 2);
    const engine = new ReplayEngine(replay);
    expect(engine.getReplay()).toBe(replay);
  });
});
