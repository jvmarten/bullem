import { describe, it, expect } from 'vitest';
import { GameEngine } from './GameEngine.js';
import { HandType, RoundPhase } from '../types.js';
import type { ServerPlayer, HandCall, GameSettings } from '../types.js';
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

const STRICT_SETTINGS: GameSettings = { maxCards: MAX_CARDS, turnTimer: 0, lastChanceMode: 'strict' };
const CLASSIC_SETTINGS: GameSettings = { maxCards: MAX_CARDS, turnTimer: 0, lastChanceMode: 'classic' };

/** Set up a 3-player game where all non-callers bull, triggering last chance,
 *  then the caller raises. Returns the engine after the last chance raise. */
function setupLastChanceRaise(settings: GameSettings): GameEngine {
  const p1 = makePlayer('p1', 'Alice');
  const p2 = makePlayer('p2', 'Bob');
  const p3 = makePlayer('p3', 'Charlie');
  const engine = new GameEngine([p1, p2, p3], settings);
  engine.startRound();

  // Give cards so we can control outcomes
  p1.cards = [{ rank: 'A', suit: 'spades' }];
  p2.cards = [{ rank: '2', suit: 'hearts' }];
  p3.cards = [{ rank: '3', suit: 'clubs' }];

  // p1 calls high card Ace
  engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: 'A' });
  // p2 and p3 both call bull → triggers last chance for p1
  engine.handleBull('p2');
  const lcResult = engine.handleBull('p3');
  expect(lcResult.type).toBe('last_chance');

  // p1 raises during last chance
  const raiseHand: HandCall = { type: HandType.PAIR, rank: 'A' };
  const raiseResult = engine.handleLastChanceRaise('p1', raiseHand);
  expect(raiseResult.type).toBe('continue');

  return engine;
}

describe('GameEngine lastChanceMode', () => {
  describe('strict mode', () => {
    it('enters CALLING phase after last chance raise', () => {
      const engine = setupLastChanceRaise(STRICT_SETTINGS);
      const state = engine.getClientState('p2');
      expect(state.roundPhase).toBe(RoundPhase.CALLING);
    });

    it('rejects true from first responder after last chance raise', () => {
      const engine = setupLastChanceRaise(STRICT_SETTINGS);
      // p2 is next — trying true in CALLING phase should fail
      const result = engine.handleTrue('p2');
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.message).toContain('bull phase');
      }
    });

    it('allows bull from first responder after last chance raise', () => {
      const engine = setupLastChanceRaise(STRICT_SETTINGS);
      const result = engine.handleBull('p2');
      expect(result.type).not.toBe('error');
    });

    it('allows raise from first responder after last chance raise', () => {
      const engine = setupLastChanceRaise(STRICT_SETTINGS);
      const raiseHand: HandCall = { type: HandType.THREE_OF_A_KIND, rank: 'A' };
      const result = engine.handleCall('p2', raiseHand);
      expect(result.type).not.toBe('error');
    });

    it('allows true after first bull is called (transitions to BULL_PHASE)', () => {
      const engine = setupLastChanceRaise(STRICT_SETTINGS);
      // p2 calls bull → transitions to BULL_PHASE
      engine.handleBull('p2');
      const state = engine.getClientState('p3');
      expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);

      // p3 can now call true
      const result = engine.handleTrue('p3');
      expect(result.type).not.toBe('error');
    });
  });

  describe('classic mode', () => {
    it('enters BULL_PHASE after last chance raise', () => {
      const engine = setupLastChanceRaise(CLASSIC_SETTINGS);
      const state = engine.getClientState('p2');
      expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
    });

    it('allows true from first responder after last chance raise', () => {
      const engine = setupLastChanceRaise(CLASSIC_SETTINGS);
      const result = engine.handleTrue('p2');
      expect(result.type).not.toBe('error');
    });

    it('allows bull from first responder after last chance raise', () => {
      const engine = setupLastChanceRaise(CLASSIC_SETTINGS);
      const result = engine.handleBull('p2');
      expect(result.type).not.toBe('error');
    });
  });

  describe('default behavior (no setting)', () => {
    it('defaults to classic — allows true after last chance raise', () => {
      // No lastChanceMode set — should default to classic behavior
      const defaultSettings: GameSettings = { maxCards: MAX_CARDS, turnTimer: 0 };
      const engine = setupLastChanceRaise(defaultSettings);
      const state = engine.getClientState('p2');
      expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);

      const result = engine.handleTrue('p2');
      expect(result.type).not.toBe('error');
    });
  });

  describe('serialization', () => {
    it('preserves lastChanceMode through serialize/restore', () => {
      const p1 = makePlayer('p1', 'Alice');
      const p2 = makePlayer('p2', 'Bob');
      const engine = new GameEngine([p1, p2], STRICT_SETTINGS);
      engine.startRound();

      const snapshot = engine.serialize();
      expect(snapshot.settings.lastChanceMode).toBe('strict');

      const restored = GameEngine.restore(snapshot);
      const restoredSnapshot = restored.serialize();
      expect(restoredSnapshot.settings.lastChanceMode).toBe('strict');
    });
  });
});
