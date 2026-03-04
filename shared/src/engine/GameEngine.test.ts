import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine, type TurnResult } from './GameEngine.js';
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

// ─── serialize / restore ────────────────────────────────────────────────────

describe('GameEngine.serialize / restore', () => {
  let engine: GameEngine;
  let p1: ServerPlayer;
  let p2: ServerPlayer;
  let p3: ServerPlayer;

  beforeEach(() => {
    p1 = makePlayer('p1', 'Alice');
    p2 = makePlayer('p2', 'Bob');
    p3 = makePlayer('p3', 'Charlie');
    engine = new GameEngine([p1, p2, p3]);
    engine.startRound();
  });

  it('round-trips a fresh game state', () => {
    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    expect(restored.currentPlayerId).toBe(engine.currentPlayerId);
    expect(restored.getClientState('p1').roundNumber).toBe(1);
    expect(restored.getClientState('p1').roundPhase).toBe(RoundPhase.CALLING);
  });

  it('round-trips mid-game state with a current hand', () => {
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
    engine.handleBull('p2');
    // Now in bull phase, p3's turn

    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    const state = restored.getClientState('p3');
    expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
    expect(state.currentHand).toEqual({ type: HandType.HIGH_CARD, rank: '7' });
    expect(state.lastCallerId).toBe('p1');
    expect(restored.currentPlayerId).toBe('p3');
  });

  it('preserves respondedPlayers across serialize/restore', () => {
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
    engine.handleBull('p2');

    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    // p3 should be able to act (bull or true), and it should resolve (both non-callers responded)
    const result = restored.handleTrue('p3');
    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
  });

  it('serialized snapshot is JSON-safe (no class instances or functions)', () => {
    engine.handleCall('p1', { type: HandType.PAIR, rank: '5' });
    const snapshot = engine.serialize();
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json);

    // Should survive a full JSON round-trip
    const restored = GameEngine.restore(parsed as GameEngineSnapshot);
    expect(restored.currentPlayerId).toBe('p2');
  });

  it('preserves player cards across serialize/restore (deep copy)', () => {
    const originalP1Cards = [...p1.cards];
    const snapshot = engine.serialize();

    // Mutate original cards
    p1.cards = [];

    const restored = GameEngine.restore(snapshot);
    const state = restored.getClientState('p1');
    expect(state.myCards).toEqual(originalP1Cards);
  });

  it('preserves gameStats across serialize/restore', () => {
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    expect(restored.getGameStats().playerStats['p1'].callsMade).toBe(1);
  });

  describe('restore validation', () => {
    it('rejects empty players array', () => {
      const snapshot = engine.serialize();
      snapshot.players = [];
      expect(() => GameEngine.restore(snapshot)).toThrow('players array is empty or missing');
    });

    it('rejects out-of-bounds currentPlayerIndex', () => {
      const snapshot = engine.serialize();
      snapshot.currentPlayerIndex = 99;
      expect(() => GameEngine.restore(snapshot)).toThrow('currentPlayerIndex');
    });

    it('rejects out-of-bounds startingPlayerIndex', () => {
      const snapshot = engine.serialize();
      snapshot.startingPlayerIndex = -1;
      expect(() => GameEngine.restore(snapshot)).toThrow('startingPlayerIndex');
    });

    it('rejects invalid lastCallerId', () => {
      const snapshot = engine.serialize();
      snapshot.lastCallerId = 'nonexistent';
      expect(() => GameEngine.restore(snapshot)).toThrow('lastCallerId');
    });

    it('rejects invalid respondedPlayer IDs', () => {
      const snapshot = engine.serialize();
      snapshot.respondedPlayers = ['ghost'];
      expect(() => GameEngine.restore(snapshot)).toThrow('respondedPlayer');
    });

    it('rejects invalid roundPhase', () => {
      const snapshot = engine.serialize();
      (snapshot as Record<string, unknown>).roundPhase = 'invalid_phase';
      expect(() => GameEngine.restore(snapshot)).toThrow('roundPhase');
    });
  });
});

// ─── eliminatePlayer ────────────────────────────────────────────────────────

describe('GameEngine.eliminatePlayer', () => {
  it('returns game_over when only 1 player remains after elimination', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const result = engine.eliminatePlayer('p1');
    expect(result.type).toBe('game_over');
    if (result.type === 'game_over') {
      expect(result.winnerId).toBe('p2');
    }
  });

  it('does nothing for already-eliminated player', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.isEliminated = true;
    const result = engine.eliminatePlayer('p1');
    expect(result.type).toBe('continue');
  });

  it('does nothing for nonexistent player', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const result = engine.eliminatePlayer('ghost');
    expect(result.type).toBe('continue');
  });

  it('continues game with 2+ remaining after mid-round elimination', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    // Eliminate p3 mid-round
    const result = engine.eliminatePlayer('p3');
    expect(result.type !== 'game_over').toBe(true);
    expect(engine.getActivePlayers()).toHaveLength(2);
  });

  it('auto-resolves when caller leaves during LAST_CHANCE', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
    engine.handleBull('p2');
    const lcResult = engine.handleBull('p3');
    expect(lcResult.type).toBe('last_chance');

    // The caller (p1) leaves during last chance
    const elimResult = engine.eliminatePlayer('p1');
    expect(elimResult.type === 'resolve' || elimResult.type === 'game_over').toBe(true);
  });

  it('resolves round when eliminating player leaves all non-callers responded', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
    engine.handleBull('p2');
    // p3 hasn't acted yet — but eliminate p3, leaving only p2 as non-caller
    // p2 already responded (bull), so all non-callers have responded
    const elimResult = engine.eliminatePlayer('p3');
    // Should trigger last_chance or resolve since all non-callers responded
    expect(
      elimResult.type === 'last_chance' ||
      elimResult.type === 'resolve' ||
      elimResult.type === 'game_over'
    ).toBe(true);
  });

  it('handles elimination during RESOLVING phase gracefully', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // Force cards and resolve
    p1.cards = [{ rank: '7', suit: 'spades' }];
    p2.cards = [{ rank: 'K', suit: 'hearts' }];
    p3.cards = [{ rank: '2', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
    engine.handleBull('p2');
    engine.handleTrue('p3');
    // Now in RESOLVING phase

    const result = engine.eliminatePlayer('p2');
    expect(result.type).toBe('continue');
    expect(p2.isEliminated).toBe(true);
  });
});

// ─── Mass elimination guard ─────────────────────────────────────────────────

describe('GameEngine mass elimination guard', () => {
  it('skips penalties when ALL active players would be eliminated', () => {
    // 2 players both at MAX_CARDS. If both are wrong, both would be eliminated = draw.
    // The guard should prevent this.
    const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
    const p2 = makePlayer('p2', 'Bob', MAX_CARDS);
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    // Force cards — no pair of Aces exists
    p1.cards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
                { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
                { rank: '6', suit: 'clubs' }];
    p2.cards = [{ rank: '7', suit: 'hearts' }, { rank: '8', suit: 'hearts' },
                { rank: '9', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
                { rank: 'J', suit: 'hearts' }];

    // p1 calls pair of Aces (doesn't exist)
    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    // p2 calls true (wrong, since pair of Aces doesn't exist)
    // But this means BOTH are wrong: p1 (caller, hand doesn't exist) and p2 (called true on non-existent)
    // Both at MAX_CARDS, so both would be eliminated → guard should kick in
    const result = engine.handleTrue('p2');

    if (result.type === 'resolve') {
      // Guard should prevent mass elimination — no one gets penalized
      expect(result.result.penalizedPlayerIds).toEqual([]);
      expect(p1.isEliminated).toBe(false);
      expect(p2.isEliminated).toBe(false);
    }
    // Could also be last_chance, which is fine
  });

  it('applies penalties normally when not all players would be eliminated', () => {
    const p1 = makePlayer('p1', 'Alice', MAX_CARDS);
    const p2 = makePlayer('p2', 'Bob', 1); // low card count, won't be eliminated
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    p1.cards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
                { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
                { rank: '6', suit: 'clubs' }];
    p2.cards = [{ rank: '7', suit: 'hearts' }];

    // p1 calls royal flush (doesn't exist), p2 calls bull (correct)
    engine.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
    const bullResult = engine.handleBull('p2');

    if (bullResult.type === 'last_chance') {
      const resolveResult = engine.handleLastChancePass('p1');
      if (resolveResult.type === 'game_over') {
        // p1 gets eliminated, p2 wins — penalties were applied normally
        expect(p1.isEliminated).toBe(true);
        expect(resolveResult.winnerId).toBe('p2');
      }
    }
  });
});

// ─── Client state anti-cheat ────────────────────────────────────────────────

describe('GameEngine client state anti-cheat', () => {
  it('never leaks other players cards in normal client state', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    const stateForP1 = engine.getClientState('p1');

    // myCards should only be p1's cards
    expect(stateForP1.myCards).toEqual(p1.cards);
    expect(stateForP1.myCards).not.toEqual(p2.cards);

    // No spectator cards for active players
    expect(stateForP1.spectatorCards).toBeUndefined();

    // Players array should not contain card data
    for (const player of stateForP1.players) {
      expect((player as unknown as Record<string, unknown>).cards).toBeUndefined();
    }
  });

  it('provides spectator cards to eliminated players', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.isEliminated = true;

    const stateForP1 = engine.getClientState('p1');
    expect(stateForP1.spectatorCards).toBeDefined();
    expect(stateForP1.spectatorCards!.length).toBe(2); // p2 and p3 (active players)
    // Spectator cards should include actual card data
    for (const sc of stateForP1.spectatorCards!) {
      expect(sc.cards.length).toBeGreaterThan(0);
    }
  });

  it('returns empty cards for unknown player', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    const state = engine.getClientState('ghost');
    expect(state.myCards).toEqual([]);
  });
});

// ─── Turn advancement edge cases ────────────────────────────────────────────

describe('GameEngine turn advancement', () => {
  it('wraps around correctly in 2-player game', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const engine = new GameEngine([p1, p2]);
    engine.startRound();

    expect(engine.currentPlayerId).toBe('p1');
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    // In 2-player, after p1 calls, p2 should be next
    expect(engine.currentPlayerId).toBe('p2');
  });

  it('handles raise resetting bull phase', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    // p2 raises instead of bull/true
    engine.handleCall('p2', { type: HandType.PAIR, rank: '3' });

    const state = engine.getClientState('p1');
    expect(state.roundPhase).toBe(RoundPhase.CALLING);
    expect(state.lastCallerId).toBe('p2');
    // Turn should be p3 (skipping p2 who is the new caller)
    expect(engine.currentPlayerId).toBe('p3');
  });

  it('rejects actions during RESOLVING phase', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    p1.cards = [{ rank: '7', suit: 'spades' }];
    p2.cards = [{ rank: 'K', suit: 'hearts' }];
    p3.cards = [{ rank: '2', suit: 'clubs' }];

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
    engine.handleBull('p2');
    engine.handleTrue('p3'); // resolves

    const callResult = engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    expect(callResult.type).toBe('error');

    const bullResult = engine.handleBull('p2');
    expect(bullResult.type).toBe('error');
  });
});

// ─── Multi-round game progression ───────────────────────────────────────────

describe('GameEngine multi-round progression', () => {
  it('plays 3 rounds with penalty accumulation', () => {
    const p1 = makePlayer('p1', 'Alice');
    const p2 = makePlayer('p2', 'Bob');
    const p3 = makePlayer('p3', 'Charlie');
    const engine = new GameEngine([p1, p2, p3]);
    engine.startRound();

    // Round 1: p1 bluffs, gets caught
    p1.cards = [{ rank: '2', suit: 'clubs' }];
    p2.cards = [{ rank: '3', suit: 'hearts' }];
    p3.cards = [{ rank: '4', suit: 'diamonds' }];

    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' }); // bluff
    engine.handleBull('p2');
    engine.handleBull('p3');
    engine.handleLastChancePass('p1');

    // p1 should have 2 cards now (was wrong)
    expect(p1.cardCount).toBe(2);

    // Start round 2
    const r2 = engine.startNextRound();
    expect(r2.type).toBe('new_round');
    expect(engine.getClientState('p1').roundNumber).toBe(2);

    // p1 should be dealt 2 cards
    expect(p1.cards.length).toBe(2);
  });
});

// ─── Edge: last chance raise → all true → resolve ────────────────────────

describe('GameEngine last chance → raise → mixed responses', () => {
  it('last chance raise → one bull one true → resolves correctly', () => {
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
    // p1 gets last chance, raises to high card 7 (exists)
    engine.handleLastChanceRaise('p1', { type: HandType.HIGH_CARD, rank: '7' });

    // p2 calls bull, p3 calls true
    engine.handleBull('p2');
    const result = engine.handleTrue('p3');

    expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(true);
      // p2 wrong (called bull on existing hand), p1 and p3 correct
      expect(result.result.penalizedPlayerIds).toContain('p2');
      expect(result.result.penalizedPlayerIds).not.toContain('p1');
      expect(result.result.penalizedPlayerIds).not.toContain('p3');
    }
  });
});
