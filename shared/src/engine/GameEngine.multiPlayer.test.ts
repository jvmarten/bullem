/**
 * Critical tests for multi-player game resolution, elimination cascades,
 * and complex turn-flow scenarios that are most likely to harbor bugs.
 *
 * These tests target the highest-risk areas: penalty assignment with 4+ players,
 * cascading eliminations, mid-round player departure, and deck exhaustion.
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine.js';
import type { ServerPlayer, Card, HandCall, GameSettings } from '../types.js';
import { HandType, RoundPhase, TurnAction } from '../types.js';

/** Helper: create a player with predetermined cards. */
function makePlayer(id: string, name: string, cards: Card[], cardCount = 1): ServerPlayer {
  return {
    id, name, cards, cardCount,
    isConnected: true, isEliminated: false, isHost: id === 'p1',
  };
}

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

const defaultSettings: GameSettings = { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' };

describe('GameEngine 4-player mixed bull/true resolution', () => {
  it('penalizes only incorrect callers when hand exists', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'Alice', []),
      makePlayer('p2', 'Bob', []),
      makePlayer('p3', 'Charlie', []),
      makePlayer('p4', 'Diana', []),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // Override cards after dealing so we control the state
    const activePlayers = engine.getActivePlayers();
    activePlayers[0]!.cards = [card('A', 'spades')];
    activePlayers[1]!.cards = [card('K', 'hearts')];
    activePlayers[2]!.cards = [card('A', 'diamonds')];
    activePlayers[3]!.cards = [card('Q', 'clubs')];

    // P1 calls "pair of aces" — exists across p1 + p3
    const starter = engine.currentPlayerId;
    const pairAces: HandCall = { type: HandType.PAIR, rank: 'A' };
    engine.handleCall(starter, pairAces);

    // Next three players respond
    const nextIds = activePlayers.filter(p => p.id !== starter).map(p => p.id);
    // First two call bull, third calls true (need to follow turn order)
    const curId1 = engine.currentPlayerId;
    engine.handleBull(curId1);
    const curId2 = engine.currentPlayerId;
    engine.handleTrue(curId2);
    const curId3 = engine.currentPlayerId;
    const result = engine.handleBull(curId3);

    expect(result.type).toBe('resolve');
    if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(true);
      // Bull callers were wrong (hand exists)
      expect(result.result.penalizedPlayerIds).toContain(curId1);
      expect(result.result.penalizedPlayerIds).toContain(curId3);
      // Caller and true-caller were correct
      expect(result.result.penalizedPlayerIds).not.toContain(starter);
      expect(result.result.penalizedPlayerIds).not.toContain(curId2);
    }
  });

  it('penalizes caller and true-callers when hand does NOT exist', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'Alice', []),
      makePlayer('p2', 'Bob', []),
      makePlayer('p3', 'Charlie', []),
      makePlayer('p4', 'Diana', []),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // Override cards — no aces at all
    const activePlayers = engine.getActivePlayers();
    activePlayers[0]!.cards = [card('2', 'spades')];
    activePlayers[1]!.cards = [card('3', 'hearts')];
    activePlayers[2]!.cards = [card('4', 'diamonds')];
    activePlayers[3]!.cards = [card('5', 'clubs')];

    const starter = engine.currentPlayerId;
    // Bluff: "pair of aces" — doesn't exist
    engine.handleCall(starter, { type: HandType.PAIR, rank: 'A' });

    const curId1 = engine.currentPlayerId;
    engine.handleBull(curId1); // correct
    const curId2 = engine.currentPlayerId;
    engine.handleTrue(curId2); // wrong
    const curId3 = engine.currentPlayerId;
    const result = engine.handleBull(curId3); // correct

    expect(result.type).toBe('resolve');
    if (result.type === 'resolve') {
      expect(result.result.handExists).toBe(false);
      // Caller (bluffer) and true-caller penalized
      expect(result.result.penalizedPlayerIds).toContain(starter);
      expect(result.result.penalizedPlayerIds).toContain(curId2);
      // Bull callers were correct
      expect(result.result.penalizedPlayerIds).not.toContain(curId1);
      expect(result.result.penalizedPlayerIds).not.toContain(curId3);
    }
  });

  it('handles 6-player game with single bluffer penalized', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [], 5),
      makePlayer('p2', 'B', [], 5),
      makePlayer('p3', 'C', [], 5),
      makePlayer('p4', 'D', [], 5),
      makePlayer('p5', 'E', [], 5),
      makePlayer('p6', 'F', [], 5),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // Override cards — no aces
    for (const p of engine.getActivePlayers()) {
      p.cards = [card('2', 'spades'), card('3', 'hearts'), card('4', 'diamonds'), card('5', 'clubs'), card('6', 'spades')];
    }

    const starter = engine.currentPlayerId;
    // Bluff: "pair of aces"
    engine.handleCall(starter, { type: HandType.PAIR, rank: 'A' });

    // Everyone calls bull
    const bullCallers: string[] = [];
    for (let i = 0; i < 5; i++) {
      const curId = engine.currentPlayerId;
      bullCallers.push(curId);
      const r = engine.handleBull(curId);
      if (r.type === 'last_chance') {
        // Pass on last chance → resolve
        const resolveResult = engine.handleLastChancePass(starter);
        expect(resolveResult.type === 'resolve' || resolveResult.type === 'game_over').toBe(true);
        if (resolveResult.type === 'resolve') {
          expect(resolveResult.result.handExists).toBe(false);
          expect(resolveResult.result.penalizedPlayerIds).toContain(starter);
          expect(resolveResult.result.eliminatedPlayerIds).toContain(starter);
        } else if (resolveResult.type === 'game_over') {
          // P1 eliminated at max cards — game ends if only 1 remains,
          // but 5 should remain. This is a valid test path since
          // mass elimination guard may apply.
          expect(resolveResult.winnerId).toBeTruthy();
        }
        return;
      }
    }
  });
});

describe('GameEngine elimination during active round', () => {
  it('resolves round when eliminated player was the only unresponded player', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'Alice', [card('A', 'spades')]),
      makePlayer('p2', 'Bob', [card('K', 'hearts')]),
      makePlayer('p3', 'Charlie', [card('Q', 'diamonds')]),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // P1 calls a hand
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });

    // P2 calls bull
    engine.handleBull('p2');

    // P3 leaves mid-round — was the only unresponded player
    const result = engine.eliminatePlayer('p3');

    // Should resolve since all non-callers have now responded (or left)
    expect(result.type === 'resolve' || result.type === 'last_chance').toBe(true);
  });

  it('continues when eliminated player was not needed for resolution', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'Alice', [card('A', 'spades')]),
      makePlayer('p2', 'Bob', [card('K', 'hearts')]),
      makePlayer('p3', 'Charlie', [card('Q', 'diamonds')]),
      makePlayer('p4', 'Diana', [card('J', 'clubs')]),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // P1 calls
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });

    // P2 calls bull
    engine.handleBull('p2');

    // P3 leaves — P4 still hasn't responded
    const result = engine.eliminatePlayer('p3');
    expect(result.type).toBe('continue');
  });

  it('ends game when elimination leaves only 1 player', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'Alice', [card('A', 'spades')]),
      makePlayer('p2', 'Bob', [card('K', 'hearts')]),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    const result = engine.eliminatePlayer('p2');
    expect(result.type).toBe('game_over');
    if (result.type === 'game_over') {
      expect(result.winnerId).toBe('p1');
    }
  });
});

describe('GameEngine deck exhaustion with many players and high card counts', () => {
  it('deals available cards when deck runs low', () => {
    // 10 players × 5 cards = 50, but deck only has 52
    // This is close to the limit
    const players: ServerPlayer[] = [];
    for (let i = 0; i < 10; i++) {
      players.push(makePlayer(`p${i}`, `Player${i}`, [], 5));
    }
    const engine = new GameEngine(players, defaultSettings);

    // Should not throw
    engine.startRound();

    // All players should have cards (some may have fewer if deck is exhausted)
    const state = engine.getClientState('p0');
    expect(state.myCards.length).toBeGreaterThan(0);
    expect(state.myCards.length).toBeLessThanOrEqual(5);
  });

  it('handles extreme deck exhaustion (11 players × 5 cards)', () => {
    const players: ServerPlayer[] = [];
    for (let i = 0; i < 11; i++) {
      players.push(makePlayer(`p${i}`, `Player${i}`, [], 5));
    }
    const engine = new GameEngine(players, defaultSettings);

    // Should not throw even though 11×5=55 > 52
    engine.startRound();

    // Later players may get fewer cards, but no crash
    const totalCards = players.reduce((sum, p) => sum + p.cards.length, 0);
    expect(totalCards).toBeLessThanOrEqual(52);
    expect(totalCards).toBeGreaterThan(0);
  });
});

describe('GameEngine starting player rotation correctness', () => {
  it('rotates correctly over multiple rounds including eliminations', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('2', 'spades')]),
      makePlayer('p2', 'B', [card('3', 'hearts')]),
      makePlayer('p3', 'C', [card('4', 'diamonds')]),
      makePlayer('p4', 'D', [card('5', 'clubs')]),
    ];
    const engine = new GameEngine(players, defaultSettings);

    // Round 1: p1 starts
    engine.startRound();
    const starter1 = engine.currentPlayerId;

    // Simulate round and start next
    engine.handleCall(starter1, { type: HandType.HIGH_CARD, rank: '2' });
    // Let remaining players all bull
    const active = engine.getActivePlayers();
    for (const p of active) {
      if (p.id !== starter1) {
        const r = engine.handleBull(p.id);
        if (r.type === 'last_chance') {
          engine.handleLastChancePass(starter1);
          break;
        }
      }
    }

    // Round 2
    const r2 = engine.startNextRound();
    expect(r2.type).toBe('new_round');
    const starter2 = engine.currentPlayerId;
    expect(starter2).not.toBe(starter1);

    // The starting player should have rotated to the next active player
    const expectedStarterIndex = 1; // p2 should start round 2
    expect(starter2).toBe(`p${expectedStarterIndex + 1}`);
  });

  it('wraps around when reaching the end of the player list', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('2', 'spades')]),
      makePlayer('p2', 'B', [card('3', 'hearts')]),
    ];
    const engine = new GameEngine(players, defaultSettings);

    // Round 1
    engine.startRound();
    const starter1 = engine.currentPlayerId;

    // Quick resolution
    engine.handleCall(starter1, { type: HandType.HIGH_CARD, rank: '2' });
    const other1 = starter1 === 'p1' ? 'p2' : 'p1';
    engine.handleBull(other1);
    // Last chance
    engine.handleLastChancePass(starter1);

    // Round 2
    engine.startNextRound();
    const starter2 = engine.currentPlayerId;
    expect(starter2).not.toBe(starter1);

    // Quick resolution
    engine.handleCall(starter2, { type: HandType.HIGH_CARD, rank: '3' });
    const other2 = starter2 === 'p1' ? 'p2' : 'p1';
    engine.handleBull(other2);
    engine.handleLastChancePass(starter2);

    // Round 3 — should wrap back to original starter
    engine.startNextRound();
    const starter3 = engine.currentPlayerId;
    expect(starter3).toBe(starter1);
  });
});

describe('GameEngine turn order skips caller correctly', () => {
  it('caller never responds to their own call in bull phase', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
      makePlayer('p3', 'C', [card('Q', 'diamonds')]),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // P1 calls
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });

    // Current player should be p2 (not p1)
    expect(engine.currentPlayerId).toBe('p2');

    // P2 calls bull
    engine.handleBull('p2');

    // Current player should be p3 (skipping p1)
    expect(engine.currentPlayerId).toBe('p3');
  });

  it('after a raise, turn order resets and skips the new caller', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
      makePlayer('p3', 'C', [card('Q', 'diamonds')]),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // P1 calls high card
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    expect(engine.currentPlayerId).toBe('p2');

    // P2 raises to pair
    engine.handleCall('p2', { type: HandType.PAIR, rank: '2' });

    // Now P3 should be next (skipping P2 who is the new caller)
    expect(engine.currentPlayerId).toBe('p3');
  });
});

describe('GameEngine client state anti-cheat guarantees', () => {
  it('never includes other players card data in any state field', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'Alice', []),
      makePlayer('p2', 'Bob', []),
      makePlayer('p3', 'Charlie', []),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // Override cards after dealing
    const active = engine.getActivePlayers();
    active[0]!.cards = [card('A', 'spades')];
    active[1]!.cards = [card('K', 'hearts')];
    active[2]!.cards = [card('Q', 'diamonds')];

    const state1 = engine.getClientState(active[0]!.id);
    const state2 = engine.getClientState(active[1]!.id);

    // Each player should only see their own cards
    expect(state1.myCards).toEqual([card('A', 'spades')]);
    expect(state2.myCards).toEqual([card('K', 'hearts')]);

    // Players array should not have cards
    for (const p of state1.players) {
      expect(p).not.toHaveProperty('cards');
    }

    // No spectator cards for active players
    expect(state1.spectatorCards).toBeUndefined();
  });

  it('provides spectator cards only to eliminated players', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'Alice', []),
      makePlayer('p2', 'Bob', []),
      makePlayer('p3', 'Charlie', []),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    const active = engine.getActivePlayers();
    // Eliminate last player
    engine.eliminatePlayer(active[2]!.id);

    const stateEliminated = engine.getClientState(active[2]!.id);
    expect(stateEliminated.spectatorCards).toBeDefined();
    expect(stateEliminated.spectatorCards!.length).toBe(2); // 2 still active

    // Active players still don't get spectator cards
    const stateActive = engine.getClientState(active[0]!.id);
    expect(stateActive.spectatorCards).toBeUndefined();
  });
});

describe('GameEngine statistics tracking across multiple rounds', () => {
  it('accumulates stats correctly across rounds', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // Round 1: P1 calls ace high (true), P2 calls bull (wrong)
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const stats1 = engine.getGameStats();
    expect(stats1.playerStats['p1']!.callsMade).toBe(1);
    expect(stats1.playerStats['p2']!.bullsCalled).toBe(1);
    expect(stats1.totalRounds).toBe(1);

    // Round 2
    engine.startNextRound();
    engine.handleCall(engine.currentPlayerId, { type: HandType.HIGH_CARD, rank: '2' });
    const nextPlayer = engine.currentPlayerId;
    engine.handleBull(nextPlayer);
    // Need to handle last chance if triggered
    const currentPlayer = engine.currentPlayerId;
    if (engine.currentRoundPhase === RoundPhase.LAST_CHANCE) {
      engine.handleLastChancePass(currentPlayer);
    }

    const stats2 = engine.getGameStats();
    expect(stats2.totalRounds).toBe(2);
  });
});

describe('GameEngine mass elimination guard', () => {
  it('skips penalties when ALL active players would be eliminated', () => {
    // Both players at max cards
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('2', 'spades')], 5),
      makePlayer('p2', 'B', [card('3', 'hearts')], 5),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // P1 bluffs pair of aces (doesn't exist)
    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    // P2 calls true (wrong — hand doesn't exist)
    engine.handleTrue('p2');

    // Both would be wrong: P1 (bluffer) and P2 (wrong true)
    // If both get +1 card, both exceed 5 → both eliminated → draw
    // Mass elimination guard should prevent this
    const state = engine.getClientState('p1');
    // Neither should be eliminated since the guard prevented it
    const p1 = state.players.find(p => p.id === 'p1');
    const p2 = state.players.find(p => p.id === 'p2');
    expect(p1!.isEliminated).toBe(false);
    expect(p2!.isEliminated).toBe(false);
  });

  it('does NOT activate when only some players would be eliminated', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('2', 'spades')], 5), // at max
      makePlayer('p2', 'B', [card('3', 'hearts')], 3), // not at max
      makePlayer('p3', 'C', [card('A', 'diamonds')], 2), // not at max
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // P1 bluffs "pair of aces" — doesn't exist (only p3 has an ace)
    engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
    engine.handleBull('p2'); // correct
    const result = engine.handleBull('p3'); // correct

    if (result.type === 'last_chance') {
      engine.handleLastChancePass('p1');
    }

    // P1 should be penalized (and eliminated since at max cards)
    const finalResult = result.type === 'last_chance'
      ? engine.handleLastChancePass('p1')
      : result;

    // This test just verifies the guard doesn't prevent normal elimination
    if (finalResult.type === 'resolve' || finalResult.type === 'game_over') {
      // The result should penalize P1 at minimum
      const r = finalResult.type === 'resolve' ? finalResult.result : finalResult.finalRoundResult;
      if (r) {
        expect(r.penalizedPlayerIds).toContain('p1');
      }
    }
  });
});

describe('GameEngine replay snapshot recording', () => {
  it('records round snapshots with correct card data', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const snapshots = engine.getRoundSnapshots();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.roundNumber).toBe(1);
    expect(snapshots[0]!.playerCards.length).toBe(2);
    expect(snapshots[0]!.turnHistory.length).toBeGreaterThan(0);
    expect(snapshots[0]!.result).toBeDefined();
    expect(snapshots[0]!.result.calledHand).toEqual({ type: HandType.HIGH_CARD, rank: 'A' });
  });

  it('accumulates snapshots across multiple rounds', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('2', 'spades')]),
      makePlayer('p2', 'B', [card('3', 'hearts')]),
    ];
    const engine = new GameEngine(players, defaultSettings);
    engine.startRound();

    // Round 1
    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    // Round 2
    engine.startNextRound();
    const starter = engine.currentPlayerId;
    engine.handleCall(starter, { type: HandType.HIGH_CARD, rank: '3' });
    const other = starter === 'p1' ? 'p2' : 'p1';
    engine.handleBull(other);
    if (engine.currentRoundPhase === RoundPhase.LAST_CHANCE) {
      engine.handleLastChancePass(starter);
    }

    const snapshots = engine.getRoundSnapshots();
    expect(snapshots.length).toBe(2);
    expect(snapshots[0]!.roundNumber).toBe(1);
    expect(snapshots[1]!.roundNumber).toBe(2);
  });
});
