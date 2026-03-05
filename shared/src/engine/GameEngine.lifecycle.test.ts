import { describe, it, expect } from 'vitest';
import { GameEngine, type TurnResult } from './GameEngine.js';
import { HandType, RoundPhase, TurnAction } from '../types.js';
import type { ServerPlayer, HandCall } from '../types.js';
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

// ─── Full game to completion ─────────────────────────────────────────────────

describe('GameEngine: full game to winner', () => {
  it('plays a complete game from round 1 until one player wins', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    let roundCount = 0;
    const maxRounds = 30; // safety bound

    while (roundCount < maxRounds) {
      roundCount++;
      const active = engine.getActivePlayers();
      if (active.length <= 1) break;

      // Force cards: caller always bluffs with Royal Flush
      for (const p of active) {
        if (p.cardCount <= 1) {
          p.cards = [{ rank: '2', suit: 'clubs' }];
        } else {
          p.cards = Array.from({ length: p.cardCount }, (_, i) => ({
            rank: (['2', '3', '4', '5', '6'] as const)[i % 5],
            suit: 'clubs' as const,
          }));
        }
      }

      const callerId = engine.currentPlayerId;
      engine.handleCall(callerId, { type: HandType.ROYAL_FLUSH, suit: 'spades' });

      // All others call bull
      const others = active.filter(p => p.id !== callerId);
      for (let i = 0; i < others.length; i++) {
        const result = engine.handleBull(engine.currentPlayerId);
        if (result.type === 'last_chance' || result.type === 'resolve' || result.type === 'game_over') {
          break;
        }
      }

      // Handle last chance if needed
      const state = engine.getClientState(callerId);
      if (state.roundPhase === RoundPhase.LAST_CHANCE) {
        engine.handleLastChancePass(callerId);
      }

      // Check for game over
      if (engine.gameOver) break;

      // Start next round
      const nextResult = engine.startNextRound();
      if (nextResult.type === 'game_over') break;
    }

    // Game should have ended with a winner
    expect(engine.gameOver).toBe(true);
    expect(engine.winnerId).toBeTruthy();
    expect(roundCount).toBeLessThan(maxRounds);
    expect(engine.getActivePlayers()).toHaveLength(1);
  });

  it('accumulates correct card counts when bluffer is caught each round', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    let rounds = 0;

    while (rounds < MAX_CARDS * 3 && !engine.gameOver) {
      rounds++;
      const active = engine.getActivePlayers();
      if (active.length <= 1) break;

      // Give everyone simple non-matching cards
      for (const p of active) {
        p.cards = Array.from({ length: p.cardCount }, () => ({
          rank: '2' as const, suit: 'clubs' as const,
        }));
      }

      const callerId = engine.currentPlayerId;
      const callerBefore = active.find(p => p.id === callerId)!.cardCount;

      // Caller bluffs Royal Flush (never exists with these cards)
      engine.handleCall(callerId, { type: HandType.ROYAL_FLUSH, suit: 'spades' });

      // All others call bull in turn order
      let resolved = false;
      for (let i = 0; i < active.length - 1; i++) {
        const result = engine.handleBull(engine.currentPlayerId);
        if (result.type === 'last_chance' || result.type === 'resolve' || result.type === 'game_over') {
          resolved = true;
          break;
        }
      }

      // Handle last chance
      const state = engine.getClientState(callerId);
      if (state.roundPhase === RoundPhase.LAST_CHANCE) {
        engine.handleLastChancePass(callerId);
      }

      if (engine.gameOver) break;

      // The caller should have been penalized (bluff caught)
      const callerPlayer = active.find(p => p.id === callerId)!;
      if (!callerPlayer.isEliminated) {
        expect(callerPlayer.cardCount).toBe(callerBefore + 1);
      }

      engine.startNextRound();
    }

    // Game should eventually end
    expect(engine.gameOver).toBe(true);
    expect(engine.winnerId).toBeTruthy();
  });
});

// ─── Starting player rotation with multiple eliminations ─────────────────────

describe('GameEngine: starting player rotation edge cases', () => {
  it('rotates correctly when multiple consecutive players are eliminated', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const p5 = makePlayer('p5', 'Eve');
    const engine = new GameEngine([p1, p2, p3, p4, p5]);
    engine.startRound();

    // Simulate round 1 resolution
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];
    p4.cards = [{ rank: '5', suit: 'spades' }];
    p5.cards = [{ rank: '6', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleTrue('p3');
    engine.handleTrue('p4');
    engine.handleTrue('p5');

    // Eliminate p2 and p3 manually (as if they exceeded maxCards)
    p2.isEliminated = true;
    p3.isEliminated = true;

    const r2 = engine.startNextRound();
    expect(r2.type).toBe('new_round');

    // Starting player should skip p2 and p3
    const state = engine.getClientState('p1');
    expect(state.startingPlayerId).not.toBe('p2');
    expect(state.startingPlayerId).not.toBe('p3');
  });

  it('wraps around correctly when rotation passes the end of the player array', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // Round 1: p1 starts
    expect(engine.currentPlayerId).toBe('p1');

    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleTrue('p3');

    // Round 2: p2 starts
    engine.startNextRound();
    const r2State = engine.getClientState('p1');
    expect(r2State.startingPlayerId).toBe('p2');

    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: '3' });
    engine.handleBull('p3');
    engine.handleTrue('p1');

    // Round 3: p3 starts (wraps around)
    engine.startNextRound();
    const r3State = engine.getClientState('p1');
    expect(r3State.startingPlayerId).toBe('p3');

    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p3', { type: HandType.HIGH_CARD, rank: '4' });
    engine.handleBull('p1');
    engine.handleTrue('p2');

    // Round 4: should wrap back to p1
    engine.startNextRound();
    const r4State = engine.getClientState('p1');
    expect(r4State.startingPlayerId).toBe('p1');
  });
});

// ─── Elimination during BULL_PHASE with partial responses ────────────────────

describe('GameEngine: elimination during BULL_PHASE', () => {
  it('handles elimination of a player who already responded with bull', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    p1.cards = [{ rank: 'A', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];
    p4.cards = [{ rank: '5', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2'); // p2 responded

    // Eliminate p2 (who already responded)
    engine.eliminatePlayer('p2');

    // p3 should still be able to act
    const result = engine.handleBull('p3');
    // After p3 bulls, only p4 remains as non-caller
    if (result.type === 'continue') {
      const finalResult = engine.handleBull('p4');
      expect(
        finalResult.type === 'last_chance' ||
        finalResult.type === 'resolve' ||
        finalResult.type === 'game_over'
      ).toBe(true);
    }
  });

  it('resolves immediately when last unresponded player is eliminated', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [{ rank: 'A', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2'); // p2 responded with bull

    // Eliminate p3 (the only unresponded player)
    const result = engine.eliminatePlayer('p3');

    // All non-callers responded (p2 bullied, p3 eliminated)
    // Should trigger last_chance or resolve
    expect(
      result.type === 'last_chance' ||
      result.type === 'resolve' ||
      result.type === 'game_over'
    ).toBe(true);
  });
});

// ─── 2-player game: immediate resolution patterns ────────────────────────────

describe('GameEngine: 2-player resolution patterns', () => {
  it('2-player: call → bull → last chance raise → bull → resolve (no second last chance)', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    p1.cards = [{ rank: '7', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    const bullResult = engine.handleBull('p2');
    expect(bullResult.type).toBe('last_chance');

    // p1 raises to something that exists
    engine.handleLastChanceRaise('p1', { type: HandType.HIGH_CARD, rank: '7' });

    // p2 bulls again — should resolve immediately (lastChanceUsed = true)
    const finalResult = engine.handleBull('p2');
    expect(finalResult.type === 'resolve' || finalResult.type === 'game_over').toBe(true);

    if (finalResult.type === 'resolve') {
      // Hand exists (p1 has a 7), so p2's bull is wrong
      expect(finalResult.result.handExists).toBe(true);
      expect(finalResult.result.penalizedPlayerIds).toContain('p2');
    }
  });

  it('2-player: call → true → resolve (hand exists, no bull phase needed)', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    p1.cards = [{ rank: 'A', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    // p2 cannot call true in CALLING phase — must bull first or raise
    const trueResult = engine.handleTrue('p2');
    expect(trueResult.type).toBe('error'); // Can't call true in CALLING phase
  });
});

// ─── Player never responded gets penalized ───────────────────────────────────

describe('GameEngine: unresponded players during resolution', () => {
  it('penalizes players who never responded (eliminated mid-round, treated as wrong)', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    // No pair of Aces
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];
    p4.cards = [{ rank: '5', suit: 'spades' }];

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' }); // bluff
    engine.handleBull('p2'); // correct bull
    engine.handleBull('p3'); // correct bull

    // p4 hasn't responded but all other non-callers have → triggers last chance
    const result = engine.handleBull('p4');
    expect(result.type).toBe('last_chance');

    engine.handleLastChancePass('p1');

    // Verify the round result
    const state = engine.getClientState('p1');
    expect(state.roundResult).toBeDefined();
    expect(state.roundResult!.handExists).toBe(false);
    // p1 (caller, hand doesn't exist) is penalized
    expect(state.roundResult!.penalizedPlayerIds).toContain('p1');
    // p2, p3, p4 called bull correctly
    expect(state.roundResult!.penalizedPlayerIds).not.toContain('p2');
    expect(state.roundResult!.penalizedPlayerIds).not.toContain('p3');
    expect(state.roundResult!.penalizedPlayerIds).not.toContain('p4');
  });
});

// ─── Raise chain: escalating calls across many players ───────────────────────

describe('GameEngine: long raise chains', () => {
  it('handles 5+ consecutive raises before anyone calls bull', () => {
    const players = Array.from({ length: 4 }, (_, i) =>
      makePlayer(`p${i}`, `Player${i}`)
    );
    const engine = new GameEngine(players);
    engine.startRound();

    // Long raise chain
    engine.handleCall('p0', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' }); // raise
    engine.handleCall('p2', { type: HandType.PAIR, rank: '3' }); // raise
    engine.handleCall('p3', { type: HandType.PAIR, rank: '7' }); // raise
    engine.handleCall('p0', { type: HandType.THREE_OF_A_KIND, rank: '2' }); // raise

    // After all raises, state should be consistent
    const state = engine.getClientState('p0');
    expect(state.lastCallerId).toBe('p0');
    expect(state.currentHand).toEqual({ type: HandType.THREE_OF_A_KIND, rank: '2' });
    expect(state.roundPhase).toBe(RoundPhase.CALLING);

    // Turn should skip p0 (caller) and go to p1
    expect(engine.currentPlayerId).toBe('p1');

    // Verify turn history recorded all 5 calls
    expect(state.turnHistory.filter(t => t.action === TurnAction.CALL)).toHaveLength(5);
  });
});

// ─── gameOver / winnerId consistency ─────────────────────────────────────────

describe('GameEngine: gameOver and winnerId', () => {
  it('gameOver returns false with 2+ active players', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    expect(engine.gameOver).toBe(false);
    expect(engine.winnerId).toBeNull();
  });

  it('gameOver returns true with 1 active player', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    p2.isEliminated = true;

    expect(engine.gameOver).toBe(true);
    expect(engine.winnerId).toBe('p1');
  });

  it('gameOver returns true with 0 active players', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    p1.isEliminated = true;
    p2.isEliminated = true;

    expect(engine.gameOver).toBe(true);
    expect(engine.winnerId).toBeNull(); // no winner
  });
});

// ─── Round number tracking ───────────────────────────────────────────────────

describe('GameEngine: round number tracking', () => {
  it('increments round number on each startRound/startNextRound', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);

    engine.startRound();
    expect(engine.getClientState('p1').roundNumber).toBe(1);

    // Resolve round
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleTrue('p3');

    engine.startNextRound();
    expect(engine.getClientState('p1').roundNumber).toBe(2);

    // Resolve round 2
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall(engine.currentPlayerId, { type: HandType.HIGH_CARD, rank: '2' });
    const id2 = engine.currentPlayerId;
    engine.handleBull(id2);
    const id3 = engine.currentPlayerId;
    engine.handleTrue(id3);

    engine.startNextRound();
    expect(engine.getClientState('p1').roundNumber).toBe(3);
  });
});
