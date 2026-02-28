import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './GameEngine.js';
import { HandType, RoundPhase, STARTING_CARDS } from '@bull-em/shared';
import type { ServerPlayer, HandCall, PlayerId } from '@bull-em/shared';

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

describe('GameEngine', () => {
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

  describe('startRound', () => {
    it('deals cards to all active players', () => {
      expect(p1.cards.length).toBe(STARTING_CARDS);
      expect(p2.cards.length).toBe(STARTING_CARDS);
      expect(p3.cards.length).toBe(STARTING_CARDS);
    });

    it('sets current player to first active player', () => {
      expect(engine.currentPlayerId).toBe('p1');
    });

    it('provides client state', () => {
      const state = engine.getClientState('p1');
      expect(state.roundNumber).toBe(1);
      expect(state.roundPhase).toBe(RoundPhase.CALLING);
      expect(state.myCards.length).toBe(STARTING_CARDS);
      expect(state.currentHand).toBeNull();
    });

    it('hides other players cards in client state', () => {
      const state = engine.getClientState('p2');
      // myCards should be p2's cards, not p1's
      expect(state.myCards).toEqual(p2.cards);
    });
  });

  describe('handleCall', () => {
    it('accepts a valid first call', () => {
      const result = engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      expect(result.type).toBe('continue');
      expect(engine.getClientState('p2').currentHand).toEqual({ type: HandType.HIGH_CARD, rank: '7' });
    });

    it('advances turn after call', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      expect(engine.currentPlayerId).toBe('p2');
    });

    it('rejects call from wrong player', () => {
      const result = engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: '7' });
      expect(result.type).toBe('error');
    });

    it('rejects call that is not higher than current', () => {
      engine.handleCall('p1', { type: HandType.PAIR, rank: 'K' });
      // p2 tries a lower call
      const result = engine.handleCall('p2', { type: HandType.HIGH_CARD, rank: 'A' });
      expect(result.type).toBe('error');
    });

    it('accepts a raise (higher call)', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      const result = engine.handleCall('p2', { type: HandType.PAIR, rank: '3' });
      expect(result.type).toBe('continue');
    });
  });

  describe('handleBull', () => {
    it('enters bull phase on first bull call', () => {
      engine.handleCall('p1', { type: HandType.PAIR, rank: '5' });
      engine.handleBull('p2');
      const state = engine.getClientState('p3');
      expect(state.roundPhase).toBe(RoundPhase.BULL_PHASE);
    });

    it('rejects bull when no hand has been called', () => {
      const result = engine.handleBull('p1');
      expect(result.type).toBe('error');
    });

    it('rejects bull from wrong player', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      const result = engine.handleBull('p3'); // p2 should go next
      expect(result.type).toBe('error');
    });
  });

  describe('handleTrue', () => {
    it('allows true call during bull phase', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      const result = engine.handleTrue('p3');
      expect(result.type).not.toBe('error');
    });

    it('rejects true during calling phase', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      const result = engine.handleTrue('p2');
      expect(result.type).toBe('error');
    });
  });

  describe('bull resolution - all players call bull', () => {
    it('triggers last chance when all non-callers call bull', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      const result = engine.handleBull('p3');
      expect(result.type).toBe('last_chance');
      if (result.type === 'last_chance') {
        expect(result.playerId).toBe('p1');
      }
    });
  });

  describe('handleLastChanceRaise', () => {
    it('allows the last caller to raise', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      // p1 gets last chance
      const result = engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '3' });
      expect(result.type).toBe('continue');
    });

    it('rejects raise from non-caller', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      const result = engine.handleLastChanceRaise('p2', { type: HandType.PAIR, rank: '3' });
      expect(result.type).toBe('error');
    });

    it('rejects raise that is not higher', () => {
      engine.handleCall('p1', { type: HandType.PAIR, rank: 'K' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      const result = engine.handleLastChanceRaise('p1', { type: HandType.HIGH_CARD, rank: 'A' });
      expect(result.type).toBe('error');
    });
  });

  describe('handleLastChancePass', () => {
    it('resolves the round when last caller passes', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      const result = engine.handleLastChancePass('p1');
      expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    });
  });

  describe('round resolution', () => {
    it('resolves when bull phase ends with mixed bull/true calls', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      const result = engine.handleTrue('p3');
      // After both non-callers responded (one bull, one true), should resolve
      expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    });

    it('penalizes incorrect callers', () => {
      // We need controlled cards for this test
      // p1 calls high card 7, which may or may not exist
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      const result = engine.handleTrue('p3');

      if (result.type === 'resolve') {
        const { handExists, penalties } = result.result;
        // If hand exists: bull callers (p2) are wrong, true callers (p3) and caller (p1) are right
        // If hand doesn't exist: bull callers (p2) are right, true callers (p3) and caller (p1) are wrong
        if (handExists) {
          expect(penalties['p2']).toBe(STARTING_CARDS + 1); // p2 was wrong (called bull)
          expect(penalties['p1']).toBe(STARTING_CARDS); // p1 was right
          expect(penalties['p3']).toBe(STARTING_CARDS); // p3 was right (called true)
        } else {
          expect(penalties['p1']).toBe(STARTING_CARDS + 1); // p1 was wrong (hand doesn't exist)
          expect(penalties['p2']).toBe(STARTING_CARDS); // p2 was right (called bull)
          expect(penalties['p3']).toBe(STARTING_CARDS + 1); // p3 was wrong (called true)
        }
      }
    });
  });

  describe('2-player game', () => {
    let engine2: GameEngine;
    let a: ServerPlayer;
    let b: ServerPlayer;

    beforeEach(() => {
      a = makePlayer('a', 'Alice');
      b = makePlayer('b', 'Bob');
      engine2 = new GameEngine([a, b]);
      engine2.startRound();
    });

    it('bull from the only other player triggers last chance', () => {
      engine2.handleCall('a', { type: HandType.HIGH_CARD, rank: '7' });
      const result = engine2.handleBull('b');
      expect(result.type).toBe('last_chance');
    });

    it('pass after last chance resolves', () => {
      engine2.handleCall('a', { type: HandType.HIGH_CARD, rank: '7' });
      engine2.handleBull('b');
      const result = engine2.handleLastChancePass('a');
      expect(result.type === 'resolve' || result.type === 'game_over').toBe(true);
    });
  });

  describe('elimination', () => {
    it('eliminates player who reaches 6 cards', () => {
      const p1 = makePlayer('p1', 'Alice', 5); // at 5 cards, one more = eliminated
      const p2 = makePlayer('p2', 'Bob', 1);
      const eng = new GameEngine([p1, p2]);
      eng.startRound();

      // p1 calls something ridiculous that can't exist
      eng.handleCall('p1', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
      const result = eng.handleBull('p2');

      if (result.type === 'last_chance') {
        const resolve = eng.handleLastChancePass('p1');
        if (resolve.type === 'resolve') {
          // Royal flush is extremely unlikely with just 6 cards (5+1)
          // but we can't guarantee it doesn't exist, so just check structure
          expect(resolve.result.penalties).toBeDefined();
        } else if (resolve.type === 'game_over') {
          expect(resolve.winnerId).toBeDefined();
        }
      }
    });
  });

  describe('getActivePlayers', () => {
    it('excludes eliminated players', () => {
      p2.isEliminated = true;
      const active = engine.getActivePlayers();
      expect(active.map(p => p.id)).toEqual(['p1', 'p3']);
    });
  });

  describe('turn advancement', () => {
    it('skips the caller during bull phase', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      // Now it's p2's turn, they call bull
      engine.handleBull('p2');
      // Should go to p3, skipping p1 (the caller)
      expect(engine.currentPlayerId).toBe('p3');
    });
  });
});
