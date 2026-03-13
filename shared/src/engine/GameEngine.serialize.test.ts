/**
 * Stress tests for GameEngine serialize/restore round-trip integrity.
 * Ensures complex mid-game states survive serialization without data loss
 * or corruption, which would cause server crashes on reconnection.
 */
import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine.js';
import type { ServerPlayer, Card, GameSettings, GameEngineSnapshot } from '../types.js';
import { HandType, RoundPhase } from '../types.js';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

function makePlayer(id: string, name: string, cards: Card[], cardCount = 1): ServerPlayer {
  return {
    id, name, cards, cardCount,
    isConnected: true, isEliminated: false, isHost: id === 'p1',
  };
}

const settings: GameSettings = { maxCards: 5, turnTimer: 0, botLevelCategory: 'mixed' };

describe('GameEngine serialize/restore round-trip', () => {
  it('preserves mid-bull-phase state exactly', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
      makePlayer('p3', 'C', [card('Q', 'diamonds')]),
    ];
    const engine = new GameEngine(players, settings);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    // Now in BULL_PHASE, waiting for p3

    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    expect(restored.currentPlayerId).toBe('p3');
    expect(restored.currentRoundPhase).toBe(RoundPhase.BULL_PHASE);

    // Restored engine should accept p3's action
    const result = restored.handleBull('p3');
    expect(result.type).toBe('last_chance');
  });

  it('preserves last-chance-used flag', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
    ];
    const engine = new GameEngine(players, settings);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    // Last chance triggered
    engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '2' });

    const snapshot = engine.serialize();
    expect(snapshot.lastChanceUsed).toBe(true);

    const restored = GameEngine.restore(snapshot);
    // P2 calls bull again — should resolve immediately (no second last chance)
    const result = restored.handleBull('p2');
    expect(result.type).toBe('resolve');
  });

  it('preserves eliminated player state', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')], 5),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
      makePlayer('p3', 'C', [card('Q', 'diamonds')]),
    ];
    const engine = new GameEngine(players, settings);
    engine.startRound();
    engine.eliminatePlayer('p1');

    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);

    expect(restored.getActivePlayers().length).toBe(2);
    expect(restored.getActivePlayers().every(p => p.id !== 'p1')).toBe(true);
  });

  it('preserves game statistics through serialize/restore', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
    ];
    const engine = new GameEngine(players, settings);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const statsBefore = engine.getGameStats();
    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);
    const statsAfter = restored.getGameStats();

    expect(statsAfter.totalRounds).toBe(statsBefore.totalRounds);
    expect(statsAfter.playerStats['p1']!.callsMade).toBe(statsBefore.playerStats['p1']!.callsMade);
    expect(statsAfter.playerStats['p2']!.bullsCalled).toBe(statsBefore.playerStats['p2']!.bullsCalled);
  });

  it('preserves round snapshots through serialize/restore', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
    ];
    const engine = new GameEngine(players, settings);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');
    engine.handleLastChancePass('p1');

    const snapshotsBefore = engine.getRoundSnapshots();
    const snapshot = engine.serialize();
    const restored = GameEngine.restore(snapshot);
    const snapshotsAfter = restored.getRoundSnapshots();

    expect(snapshotsAfter.length).toBe(snapshotsBefore.length);
    expect(snapshotsAfter[0]!.roundNumber).toBe(snapshotsBefore[0]!.roundNumber);
  });

  it('snapshot is fully JSON-serializable (no class instances, functions, circular refs)', () => {
    const players: ServerPlayer[] = [
      makePlayer('p1', 'A', [card('A', 'spades')]),
      makePlayer('p2', 'B', [card('K', 'hearts')]),
      makePlayer('p3', 'C', [card('Q', 'diamonds')]),
    ];
    const engine = new GameEngine(players, settings);
    engine.startRound();

    engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
    engine.handleBull('p2');

    const snapshot = engine.serialize();
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json) as GameEngineSnapshot;

    // Restored from JSON-parsed snapshot should work
    const restored = GameEngine.restore(parsed);
    expect(restored.currentPlayerId).toBe('p3');
    expect(restored.currentRoundPhase).toBe(RoundPhase.BULL_PHASE);
  });

  it('rejects invalid snapshot with out-of-bounds currentPlayerIndex', () => {
    const snapshot: GameEngineSnapshot = {
      players: [
        makePlayer('p1', 'A', [card('A', 'spades')]),
        makePlayer('p2', 'B', [card('K', 'hearts')]),
      ],
      settings,
      roundNumber: 1,
      roundPhase: RoundPhase.CALLING,
      currentPlayerIndex: 99, // out of bounds
      currentHand: null,
      lastCallerId: null,
      turnHistory: [],
      startingPlayerIndex: 0,
      startingPlayerId: 'p1',
      respondedPlayers: [],
      lastChanceUsed: false,
      gameStats: { totalRounds: 0, playerStats: {} },
      roundSnapshots: [],
      roundStartCards: [],
    };

    expect(() => GameEngine.restore(snapshot)).toThrow(/currentPlayerIndex.*out of bounds/);
  });

  it('rejects snapshot with non-existent lastCallerId', () => {
    const snapshot: GameEngineSnapshot = {
      players: [
        makePlayer('p1', 'A', [card('A', 'spades')]),
        makePlayer('p2', 'B', [card('K', 'hearts')]),
      ],
      settings,
      roundNumber: 1,
      roundPhase: RoundPhase.CALLING,
      currentPlayerIndex: 0,
      currentHand: null,
      lastCallerId: 'ghost_player',
      turnHistory: [],
      startingPlayerIndex: 0,
      startingPlayerId: 'p1',
      respondedPlayers: [],
      lastChanceUsed: false,
      gameStats: { totalRounds: 0, playerStats: {} },
      roundSnapshots: [],
      roundStartCards: [],
    };

    expect(() => GameEngine.restore(snapshot)).toThrow(/lastCallerId.*not found/);
  });

  it('rejects snapshot with empty players array', () => {
    const snapshot: GameEngineSnapshot = {
      players: [],
      settings,
      roundNumber: 1,
      roundPhase: RoundPhase.CALLING,
      currentPlayerIndex: 0,
      currentHand: null,
      lastCallerId: null,
      turnHistory: [],
      startingPlayerIndex: 0,
      startingPlayerId: '',
      respondedPlayers: [],
      lastChanceUsed: false,
      gameStats: { totalRounds: 0, playerStats: {} },
      roundSnapshots: [],
      roundStartCards: [],
    };

    expect(() => GameEngine.restore(snapshot)).toThrow(/players array is empty/);
  });

  it('rejects snapshot with invalid roundPhase', () => {
    const snapshot: GameEngineSnapshot = {
      players: [
        makePlayer('p1', 'A', [card('A', 'spades')]),
      ],
      settings,
      roundNumber: 1,
      roundPhase: 'invalid_phase' as RoundPhase,
      currentPlayerIndex: 0,
      currentHand: null,
      lastCallerId: null,
      turnHistory: [],
      startingPlayerIndex: 0,
      startingPlayerId: 'p1',
      respondedPlayers: [],
      lastChanceUsed: false,
      gameStats: { totalRounds: 0, playerStats: {} },
      roundSnapshots: [],
      roundStartCards: [],
    };

    expect(() => GameEngine.restore(snapshot)).toThrow(/unknown roundPhase/);
  });

  it('rejects snapshot with respondedPlayer not in players', () => {
    const snapshot: GameEngineSnapshot = {
      players: [
        makePlayer('p1', 'A', [card('A', 'spades')]),
        makePlayer('p2', 'B', [card('K', 'hearts')]),
      ],
      settings,
      roundNumber: 1,
      roundPhase: RoundPhase.CALLING,
      currentPlayerIndex: 0,
      currentHand: null,
      lastCallerId: null,
      turnHistory: [],
      startingPlayerIndex: 0,
      startingPlayerId: 'p1',
      respondedPlayers: ['phantom'],
      lastChanceUsed: false,
      gameStats: { totalRounds: 0, playerStats: {} },
      roundSnapshots: [],
      roundStartCards: [],
    };

    expect(() => GameEngine.restore(snapshot)).toThrow(/respondedPlayer.*not found/);
  });
});
