import { describe, it, expect, beforeEach } from 'vitest';
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

// ─── Resolution scoring correctness ─────────────────────────────────────────

describe('GameEngine resolution scoring', () => {
  describe('penalty assignment accuracy', () => {
    it('penalizes only bull callers when hand exists', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      // Give p1 an Ace so "high card Ace" exists
      p1.cards = [{ rank: 'A', suit: 'spades' }];
      p2.cards = [{ rank: '2', suit: 'hearts' }];
      p3.cards = [{ rank: '3', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
      engine.handleBull('p2'); // wrong — hand exists
      const result = engine.handleTrue('p3'); // correct — hand exists

      expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
      if (result.type === 'resolve') {
        expect(result.result.handExists).toBe(true);
        expect(result.result.penalizedPlayerIds).toContain('p2');
        expect(result.result.penalizedPlayerIds).not.toContain('p1');
        expect(result.result.penalizedPlayerIds).not.toContain('p3');
      }
    });

    it('penalizes caller and true callers when hand does not exist', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      // No pair of Aces exists
      p1.cards = [{ rank: '2', suit: 'spades' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' }); // bluff
      engine.handleTrue('p2'); // wrong — hand doesn't exist
      const result = engine.handleBull('p3'); // correct

      if (result.type === 'last_chance') {
        const resolve = engine.handleLastChancePass('p1');
        expect(resolve.type === 'resolve' || resolve.type === 'game_over').toBe(true);
        if (resolve.type === 'resolve') {
          expect(resolve.result.handExists).toBe(false);
          expect(resolve.result.penalizedPlayerIds).toContain('p1'); // caller, hand doesn't exist
          expect(resolve.result.penalizedPlayerIds).toContain('p2'); // called true on non-existent
          expect(resolve.result.penalizedPlayerIds).not.toContain('p3'); // correct bull
        }
      }
    });

    it('increments cardCount for penalized players', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const engine = new GameEngine([p1, p2]);
      engine.startRound();

      p1.cards = [{ rank: '2', suit: 'spades' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];

      engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' }); // bluff
      const result = engine.handleBull('p2'); // correct

      if (result.type === 'last_chance') {
        engine.handleLastChancePass('p1');
      }
      // p1 was wrong (caller, hand doesn't exist) → cardCount 1 → 2
      expect(p1.cardCount).toBe(2);
      // p2 was correct → stays at 1
      expect(p2.cardCount).toBe(1);
    });

    it('eliminates player whose cardCount exceeds maxCards', () => {
      const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [
        { rank: '2', suit: 'spades' }, { rank: '3', suit: 'spades' },
        { rank: '4', suit: 'spades' }, { rank: '5', suit: 'spades' },
        { rank: '6', suit: 'spades' },
      ];
      p2.cards = [{ rank: '7', suit: 'hearts' }];
      p3.cards = [{ rank: '8', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'hearts' }); // bluff
      engine.handleBull('p2');
      engine.handleBull('p3');
      engine.handleLastChancePass('p1');

      // p1 at MAX_CARDS + 1 penalty → eliminated
      expect(p1.isEliminated).toBe(true);
    });
  });

  describe('stats tracking correctness', () => {
    it('tracks callsMade for regular calls', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const engine = new GameEngine([p1, p2]);
      engine.startRound();

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleCall('p2', { type: HandType.PAIR, rank: '3' });

      const stats = engine.getGameStats();
      expect(stats.playerStats['p1'].callsMade).toBe(1);
      expect(stats.playerStats['p2'].callsMade).toBe(1);
    });

    it('tracks bullsCalled and correctBulls', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [{ rank: '2', suit: 'spades' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' }); // bluff
      engine.handleBull('p2');
      engine.handleBull('p3');
      engine.handleLastChancePass('p1');

      const stats = engine.getGameStats();
      expect(stats.playerStats['p2'].bullsCalled).toBe(1);
      expect(stats.playerStats['p2'].correctBulls).toBe(1);
      expect(stats.playerStats['p3'].bullsCalled).toBe(1);
      expect(stats.playerStats['p3'].correctBulls).toBe(1);
    });

    it('tracks truesCalled and correctTrues', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [{ rank: 'A', suit: 'spades' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' }); // true
      engine.handleBull('p2');
      engine.handleTrue('p3');

      const stats = engine.getGameStats();
      expect(stats.playerStats['p3'].truesCalled).toBe(1);
      expect(stats.playerStats['p3'].correctTrues).toBe(1);
    });

    it('tracks bluffsSuccessful when caller hand exists', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [{ rank: 'A', suit: 'spades' }];
      p2.cards = [{ rank: 'A', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' }); // actually exists
      engine.handleBull('p2');
      engine.handleBull('p3');
      engine.handleLastChancePass('p1');

      const stats = engine.getGameStats();
      expect(stats.playerStats['p1'].bluffsSuccessful).toBe(1);
    });

    it('tracks roundsSurvived only for non-eliminated players', () => {
      const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [
        { rank: '2', suit: 'spades' }, { rank: '3', suit: 'spades' },
        { rank: '4', suit: 'spades' }, { rank: '5', suit: 'spades' },
        { rank: '6', suit: 'spades' },
      ];
      p2.cards = [{ rank: '7', suit: 'hearts' }];
      p3.cards = [{ rank: '8', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'hearts' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      engine.handleLastChancePass('p1');

      const stats = engine.getGameStats();
      // p1 eliminated → roundsSurvived stays 0
      expect(stats.playerStats['p1'].roundsSurvived).toBe(0);
      // p2, p3 survived
      expect(stats.playerStats['p2'].roundsSurvived).toBe(1);
      expect(stats.playerStats['p3'].roundsSurvived).toBe(1);
    });

    it('increments totalRounds on each resolution', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [{ rank: '2', suit: 'spades' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      expect(engine.getGameStats().totalRounds).toBe(1);
    });
  });

  describe('last chance mechanics', () => {
    it('triggers last chance when all non-callers call bull (no true)', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      const result = engine.handleBull('p3');

      expect(result.type).toBe('last_chance');
      if (result.type === 'last_chance') {
        expect(result.playerId).toBe('p1');
      }
    });

    it('does not trigger last chance when at least one player calls true', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [{ rank: '2', suit: 'spades' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      // p2 calls bull first (enters bull_phase)
      engine.handleBull('p2');
      // p3 calls true (now all non-callers responded, with a true present)
      const result = engine.handleTrue('p3');

      // Should resolve directly (has a true), not last_chance
      expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    });

    it('last chance raise resets bull phase and allows new responses', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      // p1 gets last chance, raises
      engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '3' });

      // After raise, should be in bull_phase, p2's turn
      const state = engine.getClientState('p2');
      expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
      expect(engine.currentPlayerId).toBe('p2');
    });

    it('second unanimous bull after last-chance raise resolves immediately (no second last chance)', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [{ rank: '2', suit: 'spades' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      // p1 uses last chance to raise
      engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '3' });
      // Everyone bulls again
      engine.handleBull('p2');
      const result = engine.handleBull('p3');

      // Should resolve directly — last chance already used
      expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    });

    it('last chance pass resolves the round', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      p1.cards = [{ rank: '2', suit: 'spades' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      const result = engine.handleLastChancePass('p1');

      expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    });

    it('rejects last chance raise from non-caller', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleBull('p3');

      const result = engine.handleLastChanceRaise('p2', { type: HandType.PAIR, rank: '3' });
      expect(result.type).toBe('error');
    });

    it('rejects last chance raise that is not higher', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const p3 = makePlayer('p3', 'Charlie');
      const engine = new GameEngine([p1, p2, p3]);
      engine.startRound();

      engine.handleCall('p1', { type: HandType.PAIR, rank: '7' });
      engine.handleBull('p2');
      engine.handleBull('p3');

      // Try to raise to a lower hand
      const result = engine.handleLastChanceRaise('p1', { type: HandType.HIGH_CARD, rank: 'A' });
      expect(result.type).toBe('error');
    });
  });
});

// ─── Turn validation edge cases ──────────────────────────────────────────────

describe('GameEngine turn validation', () => {
  it('rejects call from wrong player', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    // It's p1's turn
    const result = engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: '5' });
    expect(result.type).toBe('error');
  });

  it('rejects bull from wrong player', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' });
    // It's p2's turn, not p3
    const result = engine.handleBull('p3');
    expect(result.type).toBe('error');
  });

  it('rejects true during CALLING phase (before any bull)', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '5' });
    const result = engine.handleTrue('p2');
    expect(result.type).toBe('error');
  });

  it('rejects call that is not higher than current hand', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.PAIR, rank: '7' });
    const result = engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: 'A' });
    expect(result.type).toBe('error');
  });

  it('rejects bull when no hand has been called', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const result = engine.handleBull('p1');
    expect(result.type).toBe('error');
  });

  it('rejects actions from eliminated players', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.isEliminated = true;
    const result = engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    expect(result.type).toBe('error');
  });
});

// ─── eliminatePlayer complex scenarios ───────────────────────────────────────

describe('GameEngine.eliminatePlayer advanced', () => {
  it('advances turn correctly when current player is eliminated mid-turn', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    // p2's turn — eliminate p2
    expect(engine.currentPlayerId).toBe('p2');
    engine.eliminatePlayer('p2');

    // Turn should advance to p3 or p4, not stay stuck
    const currentId = engine.currentPlayerId;
    expect(currentId).not.toBe('p2');
    expect(['p3', 'p4']).toContain(currentId);
  });

  it('handles elimination of non-current player without changing whose turn it is', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const p4 = makePlayer('p4', 'Dave');
    const engine = new GameEngine([p1, p2, p3, p4]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    // p2's turn — eliminate p4 (not current player)
    expect(engine.currentPlayerId).toBe('p2');
    engine.eliminatePlayer('p4');

    // Should still be p2's turn
    expect(engine.currentPlayerId).toBe('p2');
  });

  it('cascading eliminations: if elimination triggers all-responded, resolves', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [{ rank: 'A', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    // p3 hasn't responded yet — eliminate p3
    const result = engine.eliminatePlayer('p3');

    // Now all non-callers (just p2) have responded → should resolve
    expect(
      result.type === 'last_chance' ||
      result.type === 'resolve' ||
      result.type === 'game_over'
    ).toBe(true);
  });
});

// ─── 2-player game edge cases ────────────────────────────────────────────────

describe('GameEngine 2-player game', () => {
  it('immediately resolves or triggers last-chance when sole responder acts', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    p1.cards = [{ rank: '2', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    const result = engine.handleBull('p2');

    // With only 2 players, p2 is the only non-caller
    // All non-callers responded after p2's bull → triggers last_chance or resolve
    expect(result.type === 'last_chance' || result.type === 'resolve' || result.type === 'game_over').toBe(true);
  });

  it('handles back-and-forth raises in 2-player game', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: '3' }); // raise

    expect(engine.currentPlayerId).toBe('p1'); // p1's turn again (skip p2 who is caller)
    const state = engine.getClientState('p1');
    expect(state.lastCallerId).toBe('p2');
    expect(state.roundPhase).toBe(RoundPhase.CALLING);
  });
});

// ─── Deck exhaustion safety ──────────────────────────────────────────────────

describe('GameEngine deck exhaustion', () => {
  it('deals available cards when deck runs low instead of crashing', () => {
    // 12 players × 4 cards = 48 cards needed, deck has 52
    const players: ServerPlayer[] = [];
    for (let i = 0; i < 12; i++) {
      players.push(makePlayer(`p${i}`, `Player${i}`, 4));
    }
    const engine = new GameEngine(players);
    // Should not throw
    engine.startRound();

    // All players should have some cards
    for (const p of players) {
      expect(p.cards.length).toBeGreaterThan(0);
      expect(p.cards.length).toBeLessThanOrEqual(4);
    }
  });

  it('handles extreme case where deck is exhausted mid-deal', () => {
    // 11 players × 5 cards = 55 > 52, last player gets fewer cards
    const players: ServerPlayer[] = [];
    for (let i = 0; i < 11; i++) {
      players.push(makePlayer(`p${i}`, `Player${i}`, 5));
    }
    const engine = new GameEngine(players);
    engine.startRound();

    const totalDealt = players.reduce((sum, p) => sum + p.cards.length, 0);
    expect(totalDealt).toBeLessThanOrEqual(52);
  });
});

// ─── startNextRound edge cases ───────────────────────────────────────────────

describe('GameEngine.startNextRound', () => {
  it('rotates starting player clockwise skipping eliminated players', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // Simulate round 1 resolve
    p1.cards = [{ rank: '2', suit: 'spades' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleTrue('p3');

    // Start next round
    const r2 = engine.startNextRound();
    expect(r2.type).toBe('new_round');

    // Starting player should have rotated from p1 to p2
    const state = engine.getClientState('p1');
    expect(state.startingPlayerId).toBe('p2');
  });

  it('returns game_over when only 1 player remains', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    p2.isEliminated = true;

    const result = engine.startNextRound();
    expect(result.type).toBe('game_over');
    if (result.type === 'game_over') {
      expect(result.winnerId).toBe('p1');
    }
  });

  it('deals correct number of cards based on each player cardCount', () => {
    const p1 = makePlayer('p1', 'Alice', 3);
    const p2 = makePlayer('p2', 'Bob', 1);
    const p3 = makePlayer('p3', 'Charlie', 2);
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // Force resolution
    p1.cards = [{ rank: '2', suit: 'spades' }, { rank: '3', suit: 'spades' }, { rank: '4', suit: 'spades' }];
    p2.cards = [{ rank: '5', suit: 'hearts' }];
    p3.cards = [{ rank: '6', suit: 'clubs' }, { rank: '7', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleTrue('p3');

    engine.startNextRound();

    // Each player should get cards based on their cardCount
    expect(p2.cards.length).toBeGreaterThan(0);
    // p1 has 3 (or 4 if penalized), p2 has 1 (or 2 if penalized)
    // Exact values depend on resolution — just verify no crashes and cards dealt
    for (const p of [p1, p2, p3]) {
      if (!p.isEliminated) {
        expect(p.cards.length).toBe(p.cardCount);
      }
    }
  });
});

// ─── getClientState completeness ─────────────────────────────────────────────

describe('GameEngine.getClientState', () => {
  it('includes turnHistory with all actions', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');

    const state = engine.getClientState('p1');
    expect(state.turnHistory).toHaveLength(2);
    expect(state.turnHistory[0].action).toBe(TurnAction.CALL);
    expect(state.turnHistory[0].playerId).toBe('p1');
    expect(state.turnHistory[1].action).toBe(TurnAction.BULL);
    expect(state.turnHistory[1].playerId).toBe('p2');
  });

  it('includes player names in turnHistory entries', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });

    const state = engine.getClientState('p1');
    expect(state.turnHistory[0].playerName).toBe('Alice');
  });

  it('does not include spectatorCards for active players', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const state = engine.getClientState('p1');
    expect(state.spectatorCards).toBeUndefined();
  });

  it('includes spectatorCards with all active player cards for eliminated players', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.isEliminated = true;

    const state = engine.getClientState('p1');
    expect(state.spectatorCards).toBeDefined();
    expect(state.spectatorCards!.length).toBe(2); // p2 and p3
    // Verify actual card data is included
    for (const sc of state.spectatorCards!) {
      expect(sc.playerId).toBeDefined();
      expect(sc.playerName).toBeDefined();
      expect(Array.isArray(sc.cards)).toBe(true);
    }
  });
});
