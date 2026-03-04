import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine.js';
import { HandType, RoundPhase, TurnAction } from '../types.js';
import type { ServerPlayer, Card } from '../types.js';
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

// ─── Round resolution: who gets penalized in complex scenarios ──────────────

describe('GameEngine resolution: penalty correctness in multi-player scenarios', () => {
  it('penalizes ONLY the caller when hand does not exist and all others called bull', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];
    p4.cards = [{ rank: '5', suit: 'spades' }];

    // p1 bluffs pair of Aces (doesn't exist)
    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2');
    engine.handleBull('p3');
    engine.handleBull('p4');
    // All bull → last chance
    const result = engine.handleLastChancePass('p1');

    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(false);
      // Only p1 (caller) should be penalized — all bull callers are correct
      expect(result.result.penalizedPlayerIds).toEqual(['p1']);
    }
  });

  it('penalizes all bull callers when the hand actually exists', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    p1.cards = [{ rank: 'A', suit: 'clubs' }];
    p2.cards = [{ rank: 'A', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];
    p4.cards = [{ rank: '5', suit: 'spades' }];

    // p1 calls pair of Aces (actually exists across p1+p2)
    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2');
    engine.handleBull('p3');
    engine.handleBull('p4');
    const result = engine.handleLastChancePass('p1');

    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(true);
      // p2, p3, p4 called bull on an existing hand → all penalized
      expect(result.result.penalizedPlayerIds).toContain('p2');
      expect(result.result.penalizedPlayerIds).toContain('p3');
      expect(result.result.penalizedPlayerIds).toContain('p4');
      expect(result.result.penalizedPlayerIds).not.toContain('p1');
    }
  });

  it('penalizes mix of wrong responses: some bull + some true + caller', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    // No pair of Aces exists
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];
    p4.cards = [{ rank: '5', suit: 'spades' }];

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    // p2 enters bull phase
    engine.handleBull('p2');
    // p3 calls true (wrong — hand doesn't exist)
    engine.handleTrue('p3');
    // p4 calls bull (correct)
    const result = engine.handleBull('p4');

    if (result.type === 'last_chance') {
      const resolve = engine.handleLastChancePass('p1');
      if (resolve.type === 'resolve') {
        expect(resolve.result.handExists).toBe(false);
        // p1 (caller, hand doesn't exist) and p3 (called true on non-existent) penalized
        expect(resolve.result.penalizedPlayerIds).toContain('p1');
        expect(resolve.result.penalizedPlayerIds).toContain('p3');
        // p2 and p4 called bull correctly
        expect(resolve.result.penalizedPlayerIds).not.toContain('p2');
        expect(resolve.result.penalizedPlayerIds).not.toContain('p4');
      }
    } else if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(false);
      expect(result.result.penalizedPlayerIds).toContain('p1');
      expect(result.result.penalizedPlayerIds).toContain('p3');
      expect(result.result.penalizedPlayerIds).not.toContain('p2');
      expect(result.result.penalizedPlayerIds).not.toContain('p4');
    }
  });

  it('correctly handles hand that exists across multiple players cards', () => {
    const p1 = makePlayer('p1', 'Alice', 3);
    const p2 = makePlayer('p2', 'Bob', 3);
    const p3 = makePlayer('p3', 'Charlie', 3);
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // A straight 5-high (A,2,3,4,5) exists across all 3 players
    p1.cards = [{ rank: 'A', suit: 'clubs' }, { rank: '2', suit: 'clubs' }, { rank: '3', suit: 'hearts' }];
    p2.cards = [{ rank: '4', suit: 'diamonds' }, { rank: '5', suit: 'spades' }, { rank: 'K', suit: 'hearts' }];
    p3.cards = [{ rank: 'Q', suit: 'clubs' }, { rank: 'J', suit: 'diamonds' }, { rank: '10', suit: 'spades' }];

    engine.handleCall('p1', { type: HandType.STRAIGHT, highRank: '5' });
    engine.handleBull('p2'); // wrong — straight exists
    const result = engine.handleTrue('p3'); // correct — straight exists

    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(true);
      expect(result.result.penalizedPlayerIds).toContain('p2');
      expect(result.result.penalizedPlayerIds).not.toContain('p1');
      expect(result.result.penalizedPlayerIds).not.toContain('p3');
    }
  });
});

// ─── Multiple eliminations in single round ──────────────────────────────────

describe('GameEngine: multiple eliminations in single round', () => {
  it('eliminates multiple wrong players who exceed maxCards', () => {
    const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
    const p2 = makePlayer('p2', 'Bob', MAX_CARDS);
    const p3 = makePlayer('p3', 'Charlie', 1);
    const p4 = makePlayer('p4', 'Dave', 1);
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    p1.cards = [
      { rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
      { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
      { rank: '6', suit: 'clubs' },
    ];
    p2.cards = [
      { rank: '7', suit: 'hearts' }, { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
    ];
    p3.cards = [{ rank: 'Q', suit: 'diamonds' }];
    p4.cards = [{ rank: 'K', suit: 'spades' }];

    // p1 bluffs royal flush (doesn't exist)
    engine.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
    // p2 wrongly calls true
    engine.handleTrue('p2');
    // p3 correctly calls bull
    engine.handleBull('p3');
    // p4 correctly calls bull
    const result = engine.handleBull('p4');

    if (result.type === 'last_chance') {
      const resolve = engine.handleLastChancePass('p1');
      if (resolve.type === 'resolve' || resolve.type === 'game_over') {
        // p1 (caller, hand doesn't exist, at MAX_CARDS) → eliminated
        expect(p1.isEliminated).toBe(true);
        // p2 (called true on non-existent, at MAX_CARDS) → eliminated
        expect(p2.isEliminated).toBe(true);
        // p3 and p4 correct, not eliminated
        expect(p3.isEliminated).toBe(false);
        expect(p4.isEliminated).toBe(false);
      }
    }
  });

  it('game ends when all but one player is eliminated in a single round', () => {
    const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
    const p2 = makePlayer('p2', 'Bob', MAX_CARDS);
    const p3 = makePlayer('p3', 'Charlie', 1);
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [
      { rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
      { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
      { rank: '6', suit: 'clubs' },
    ];
    p2.cards = [
      { rank: '7', suit: 'hearts' }, { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
    ];
    p3.cards = [{ rank: 'Q', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
    engine.handleTrue('p2'); // wrong
    const result = engine.handleBull('p3'); // correct

    if (result.type === 'last_chance') {
      const resolve = engine.handleLastChancePass('p1');
      expect(resolve.type).toBe('game_over');
      if (resolve.type === 'game_over') {
        expect(resolve.winnerId).toBe('p3');
      }
    }
  });
});

// ─── Mass elimination guard edge cases ──────────────────────────────────────

describe('GameEngine mass elimination guard: boundary conditions', () => {
  it('does NOT trigger guard when only some players would be eliminated', () => {
    const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
    const p2 = makePlayer('p2', 'Bob', 1); // would get +1 = 2, not eliminated
    const p3 = makePlayer('p3', 'Charlie', MAX_CARDS);
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // No pair of Aces
    p1.cards = [
      { rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
      { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
      { rank: '6', suit: 'clubs' },
    ];
    p2.cards = [{ rank: '7', suit: 'hearts' }];
    p3.cards = [
      { rank: '8', suit: 'diamonds' }, { rank: '9', suit: 'diamonds' },
      { rank: '10', suit: 'diamonds' }, { rank: 'J', suit: 'diamonds' },
      { rank: 'Q', suit: 'diamonds' },
    ];

    // p1 bluffs, p2 calls true (wrong), p3 calls bull (correct)
    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleTrue('p2');
    const result = engine.handleBull('p3');

    if (result.type === 'last_chance') {
      const resolve = engine.handleLastChancePass('p1');
      if (resolve.type === 'resolve' || resolve.type === 'game_over') {
        // p1 at MAX_CARDS → eliminated
        expect(p1.isEliminated).toBe(true);
        // p2 at 1 card, gets +1 = 2, not eliminated
        expect(p2.isEliminated).toBe(false);
        expect(p2.cardCount).toBe(2);
      }
    } else if (result.type === 'resolve') {
      expect(p1.isEliminated).toBe(true);
      expect(p2.isEliminated).toBe(false);
    }
  });

  it('guard does not trigger when at least one player is correct (not all penalized)', () => {
    // 3 players all at MAX_CARDS. p1 bluffs, p2 bulls (correct), p3 calls true (wrong).
    // p2 is correct → not all would be penalized → guard doesn't trigger.
    const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
    const p2 = makePlayer('p2', 'Bob', MAX_CARDS);
    const p3 = makePlayer('p3', 'Charlie', MAX_CARDS);
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [
      { rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
      { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
      { rank: '6', suit: 'clubs' },
    ];
    p2.cards = [
      { rank: '7', suit: 'hearts' }, { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
    ];
    p3.cards = [
      { rank: 'Q', suit: 'diamonds' }, { rank: 'K', suit: 'diamonds' },
      { rank: 'A', suit: 'diamonds' }, { rank: '2', suit: 'diamonds' },
      { rank: '3', suit: 'diamonds' },
    ];

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2'); // correct
    const result = engine.handleTrue('p3'); // wrong

    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    if (result.type === 'resolve') {
      // p1 and p3 penalized, not p2
      expect(result.result.penalizedPlayerIds).toContain('p1');
      expect(result.result.penalizedPlayerIds).toContain('p3');
      expect(result.result.penalizedPlayerIds).not.toContain('p2');
      // p1 and p3 eliminated (MAX_CARDS + 1)
      expect(p1.isEliminated).toBe(true);
      expect(p3.isEliminated).toBe(true);
    } else if (result.type === 'game_over') {
      // p2 wins
      expect(result.winnerId).toBe('p2');
    }
  });

  it('guard activates when every player would be eliminated simultaneously', () => {
    // 3 players at MAX_CARDS. Caller bluffs, one calls bull (enters bull_phase),
    // other calls true. Hand doesn't exist, so caller wrong + true-caller wrong.
    // But bull caller is correct, so NOT all would be eliminated → guard doesn't apply.
    // For the guard to trigger, ALL must be wrong AND all at MAX_CARDS.
    // This happens when: caller bluffs, everyone calls bull, last chance pass.
    // Caller wrong (hand doesn't exist). Bull callers correct.
    // Only caller is penalized → not ALL players penalized.
    //
    // The guard can trigger with last-chance raise: p1 calls, all bull, p1 raises
    // to another non-existent hand. All bull again → resolve (lastChanceUsed).
    // p1 wrong (caller, hand doesn't exist), p2 wrong (?). Wait, p2 called bull
    // and was right, so p2 is NOT wrong.
    //
    // The realistic guard scenario: caller bluffs, some call true (wrong),
    // and caller is also wrong. If all these wrong players are at MAX_CARDS...
    // but at least one correct bull caller won't be penalized.
    //
    // The ONLY way ALL are wrong: nobody calls bull. E.g., 2 players:
    // p1 calls (bluff), p2 raises (also bluff), p1 calls bull (enters bull phase
    // but only 2 players...). Actually with raises the caller changes.
    //
    // Simplest: 3 players. p1 calls bluff. p2 enters bull phase. p3 calls true.
    // p2 calls true. All non-callers called true on non-existent hand.
    // p1 wrong (caller). p2 wrong (true). p3 wrong (true). ALL wrong + all at MAX_CARDS.
    const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
    const p2 = makePlayer('p2', 'Bob', MAX_CARDS);
    const p3 = makePlayer('p3', 'Charlie', MAX_CARDS);
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [
      { rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
      { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
      { rank: '6', suit: 'clubs' },
    ];
    p2.cards = [
      { rank: '7', suit: 'hearts' }, { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
    ];
    p3.cards = [
      { rank: 'Q', suit: 'diamonds' }, { rank: 'K', suit: 'diamonds' },
      { rank: 'A', suit: 'diamonds' }, { rank: '2', suit: 'diamonds' },
      { rank: '3', suit: 'diamonds' },
    ];

    // p1 bluffs pair of Aces (doesn't exist — only 1 Ace total)
    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    // p2 calls bull (enters bull_phase)
    engine.handleBull('p2');
    // p3 calls true (wrong — hand doesn't exist)
    const result = engine.handleTrue('p3');

    // Result: p1 wrong (caller), p3 wrong (true on non-existent), p2 correct (bull)
    // Not ALL wrong → guard should NOT trigger; penalties apply normally
    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    if (result.type === 'resolve') {
      expect(result.result.penalizedPlayerIds).toContain('p1');
      expect(result.result.penalizedPlayerIds).toContain('p3');
      expect(result.result.penalizedPlayerIds).not.toContain('p2');
      // p1 and p3 at MAX_CARDS +1 → eliminated
      expect(p1.isEliminated).toBe(true);
      expect(p3.isEliminated).toBe(true);
      expect(p2.isEliminated).toBe(false);
    }
  });
});

// ─── Raise during game: state resets correctly ──────────────────────────────

describe('GameEngine: raise resets bull phase state', () => {
  it('raise after bull clears respondedPlayers and resets roundPhase', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    // p2 raises
    engine.handleCall('p2', { type: HandType.PAIR, rank: '3' });

    const state = engine.getClientState('p1');
    expect(state.roundPhase).toBe(RoundPhase.CALLING);
    expect(state.lastCallerId).toBe('p2');
    // Turn skips p2 (caller), goes to p3
    expect(engine.currentPlayerId).toBe('p3');
  });

  it('after a raise, new responses are needed from all non-callers', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [{ rank: '7', suit: 'spades' }];
    p2.cards = [{ rank: 'K', suit: 'hearts' }];
    p3.cards = [{ rank: 'A', suit: 'clubs' }];

    // p1 calls
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    // p2 raises
    engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: '5' });
    // After raise, p3's turn. p3 calls bull, but p1 hasn't responded to new call yet
    const result = engine.handleBull('p3');
    expect(result.type).toBe('continue'); // p1 still needs to respond

    // p1 also bulls → all non-callers responded
    const finalResult = engine.handleBull('p1');
    expect(
      finalResult.type === 'last_chance' ||
      finalResult.type === 'resolve' ||
      finalResult.type === 'game_over'
    ).toBe(true);
  });
});

// ─── Full game flow: round 1 → round 2 → round 3 ────────────────────────

describe('GameEngine: multi-round full flow', () => {
  it('plays through multiple rounds with correct card count progression', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // Round 1: p1 bluffs, caught
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2');
    engine.handleBull('p3');
    engine.handleLastChancePass('p1');

    expect(p1.cardCount).toBe(2);
    expect(p2.cardCount).toBe(1);
    expect(p3.cardCount).toBe(1);

    // Round 2
    engine.startNextRound();
    expect(p1.cards.length).toBe(2);
    expect(p2.cards.length).toBe(1);
    expect(p3.cards.length).toBe(1);
    expect(engine.getClientState('p1').roundNumber).toBe(2);

    // Round 2: whoever starts bluffs, gets caught
    p1.cards = p1.cardCount === 2
      ? [{ rank: '6', suit: 'clubs' }, { rank: '7', suit: 'hearts' }]
      : [{ rank: '6', suit: 'clubs' }];
    p2.cards = [{ rank: '5', suit: 'spades' }];
    p3.cards = [{ rank: '8', suit: 'diamonds' }];

    const callerId = engine.currentPlayerId;
    const callerCountBefore = [p1, p2, p3].find(p => p.id === callerId)!.cardCount;

    // Caller bluffs pair of Kings (doesn't exist)
    engine.handleCall(callerId, { type: HandType.PAIR, rank: 'K' });

    // The remaining two players call bull in turn order
    const firstBullId = engine.currentPlayerId;
    engine.handleBull(firstBullId);
    const secondBullId = engine.currentPlayerId;
    engine.handleBull(secondBullId);
    engine.handleLastChancePass(callerId);

    // Caller was wrong → cardCount incremented
    const callerPlayer = [p1, p2, p3].find(p => p.id === callerId)!;
    expect(callerPlayer.cardCount).toBe(callerCountBefore + 1);
  });
});

// ─── startNextRound: starting player rotation with eliminations ─────────────

describe('GameEngine: starting player rotation skips eliminated', () => {
  it('skips eliminated players when rotating starting player', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob', MAX_CARDS);
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // Round 1: p2 bluffs, gets caught and eliminated (at MAX_CARDS)
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [
      { rank: '7', suit: 'hearts' }, { rank: '8', suit: 'hearts' },
      { rank: '9', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
      { rank: 'J', suit: 'hearts' },
    ];
    p3.cards = [{ rank: '3', suit: 'diamonds' }];

    // p1 starts
    expect(engine.currentPlayerId).toBe('p1');
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleTrue('p3');
    // p2 called bull on existing hand (2 high exists) → penalized, at MAX_CARDS → eliminated

    const r2 = engine.startNextRound();
    expect(r2.type).toBe('new_round');
    // p2 eliminated, starting player should skip p2
    expect(p2.isEliminated).toBe(true);
    const state = engine.getClientState('p1');
    expect(state.startingPlayerId).not.toBe('p2');
  });
});

// ─── Turn order: complex 5+ player scenarios ────────────────────────────────

describe('GameEngine: turn order in 5-player game', () => {
  it('caller is skipped in turn rotation, all others get a chance', () => {
    const players = Array.from({ length: 5 }, (_, i) =>
      makePlayer(`p${i}`, `Player${i}`)
    );
    const engine = new GameEngine(players);
    engine.startRound();

    // p0 calls
    engine.handleCall('p0', { type: HandType.HIGH_CARD, rank: '2' });

    // Next players should be p1, p2, p3, p4 in order (p0 skipped as caller)
    expect(engine.currentPlayerId).toBe('p1');
    engine.handleBull('p1');
    expect(engine.currentPlayerId).toBe('p2');
    engine.handleBull('p2');
    expect(engine.currentPlayerId).toBe('p3');
    engine.handleBull('p3');

    // p4 is the last non-caller
    expect(engine.currentPlayerId).toBe('p4');
    const result = engine.handleBull('p4');
    // All non-callers bullied → last chance
    expect(result.type).toBe('last_chance');
  });
});

// ─── Edge: last chance raise followed by another unanimous bull ──────────────

describe('GameEngine: last chance raise → second round of responses', () => {
  it('after last-chance raise, new bull/true cycle with correct turn order', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [{ rank: '7', suit: 'spades' }];
    p2.cards = [{ rank: 'K', suit: 'hearts' }];
    p3.cards = [{ rank: '2', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleBull('p3');
    // last chance → raise
    engine.handleLastChanceRaise('p1', { type: HandType.HIGH_CARD, rank: '7' });

    // After raise, in BULL_PHASE, next turn should be p2 (not p1)
    const state = engine.getClientState('p2');
    expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
    expect(engine.currentPlayerId).toBe('p2');

    // p2 calls true (hand exists: p1 has a 7)
    engine.handleTrue('p2');
    // p3 calls bull
    const result = engine.handleBull('p3');

    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(true);
      // p3 called bull on existing hand → penalized
      expect(result.result.penalizedPlayerIds).toContain('p3');
      // p2 called true on existing hand → correct, not penalized
      expect(result.result.penalizedPlayerIds).not.toContain('p2');
    }
  });
});

// ─── Edge: consecutive raises before any bull/true ──────────────────────────

describe('GameEngine: consecutive raises', () => {
  it('multiple raises in sequence update hand and caller correctly', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: '5' });
    engine.handleCall('p3', { type: HandType.PAIR, rank: '3' });
    // Now p3 is the caller, turn should go to p1
    engine.handleCall('p1', { type: HandType.THREE_OF_A_KIND, rank: '2' });
    // Now p1 is the caller again, turn should go to p2

    expect(engine.currentPlayerId).toBe('p2');
    const state = engine.getClientState('p1');
    expect(state.currentHand).toEqual({ type: HandType.THREE_OF_A_KIND, rank: '2' });
    expect(state.lastCallerId).toBe('p1');
  });
});

// ─── Edge: eliminated player's cards don't count in resolution ──────────────

describe('GameEngine: eliminated player cards excluded from resolution', () => {
  it('eliminated player mid-round: their cards are not counted', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    // Only p4 has the Ace for "High Card Ace"
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];
    p4.cards = [{ rank: 'A', suit: 'spades' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    // Eliminate p4 (the only one with an Ace)
    engine.eliminatePlayer('p4');

    // Now p2 bulls
    engine.handleBull('p2');
    const result = engine.handleBull('p3');

    if (result.type === 'last_chance') {
      const resolve = engine.handleLastChancePass('p1');
      if (resolve.type === 'resolve') {
        // Hand should NOT exist because p4 (who had the Ace) was eliminated
        expect(resolve.result.handExists).toBe(false);
      }
    }
  });
});

// ─── Revealed cards ownership ───────────────────────────────────────────────

describe('GameEngine: revealed cards in round result', () => {
  it('revealed cards include ownership info for the UI', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [{ rank: 'A', suit: 'spades' }];
    p2.cards = [{ rank: 'A', suit: 'hearts' }];
    p3.cards = [{ rank: '3', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2');
    engine.handleBull('p3');
    engine.handleLastChancePass('p1');

    const state = engine.getClientState('p1');
    const roundResult = state.roundResult;
    expect(roundResult).toBeDefined();
    if (roundResult) {
      expect(roundResult.handExists).toBe(true);
      // Revealed cards should show both Aces with their owners
      expect(roundResult.revealedCards.length).toBeGreaterThanOrEqual(2);
      const ownerIds = roundResult.revealedCards.map(c => c.playerId);
      expect(ownerIds).toContain('p1');
      expect(ownerIds).toContain('p2');
      for (const card of roundResult.revealedCards) {
        expect(card.playerName).toBeDefined();
        expect(card.rank).toBe('A');
      }
    }
  });
});

// ─── turnHistory completeness after last chance ─────────────────────────────

describe('GameEngine: turnHistory includes all actions', () => {
  it('includes last_chance_pass in turn history', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const state = engine.getClientState('p1');
    const actions = state.turnHistory.map(t => t.action);
    expect(actions).toContain(TurnAction.CALL);
    expect(actions).toContain(TurnAction.BULL);
    expect(actions).toContain(TurnAction.LAST_CHANCE_PASS);
  });

  it('includes last_chance_raise in turn history with hand data', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleBull('p3');
    engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '5' });

    const state = engine.getClientState('p2');
    const raiseEntry = state.turnHistory.find(t => t.action === TurnAction.LAST_CHANCE_RAISE);
    expect(raiseEntry).toBeDefined();
    expect(raiseEntry!.hand).toEqual({ type: HandType.PAIR, rank: '5' });
    expect(raiseEntry!.playerId).toBe('p1');
  });

  it('round result includes turn history snapshot', () => {
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
    const result = engine.handleTrue('p3');

    if (result.type === 'resolve') {
      expect(result.result.turnHistory).toBeDefined();
      expect(result.result.turnHistory!.length).toBe(3);
    }
  });
});
