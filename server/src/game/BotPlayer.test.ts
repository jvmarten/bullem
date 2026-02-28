import { describe, it, expect } from 'vitest';
import { BotPlayer } from './BotPlayer.js';
import {
  HandType, RoundPhase, GamePhase, STARTING_CARDS,
  isHigherHand,
} from '@bull-em/shared';
import type { Card, HandCall, ClientGameState, Player } from '@bull-em/shared';

function makeState(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    gamePhase: GamePhase.PLAYING,
    players: [
      { id: 'bot1', name: 'Bot', cardCount: 1, isConnected: true, isEliminated: false, isHost: false, isBot: true },
      { id: 'p1', name: 'Alice', cardCount: 1, isConnected: true, isEliminated: false, isHost: true },
    ],
    myCards: [],
    currentPlayerId: 'bot1',
    startingPlayerId: 'bot1',
    currentHand: null,
    lastCallerId: null,
    roundPhase: RoundPhase.CALLING,
    turnHistory: [],
    roundNumber: 1,
    ...overrides,
  };
}

describe('BotPlayer', () => {
  describe('findBestHandInCards', () => {
    it('returns high card for a single card', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const hand = BotPlayer.findBestHandInCards(cards);
      expect(hand).toEqual({ type: HandType.HIGH_CARD, rank: 'K' });
    });

    it('returns pair when two cards match', () => {
      const cards: Card[] = [
        { rank: '7', suit: 'hearts' },
        { rank: '7', suit: 'spades' },
      ];
      const hand = BotPlayer.findBestHandInCards(cards);
      expect(hand).toEqual({ type: HandType.PAIR, rank: '7' });
    });

    it('returns three of a kind when three cards match', () => {
      const cards: Card[] = [
        { rank: '9', suit: 'hearts' },
        { rank: '9', suit: 'spades' },
        { rank: '9', suit: 'clubs' },
      ];
      const hand = BotPlayer.findBestHandInCards(cards);
      expect(hand).toEqual({ type: HandType.THREE_OF_A_KIND, rank: '9' });
    });

    it('returns four of a kind when four cards match', () => {
      const cards: Card[] = [
        { rank: '5', suit: 'hearts' },
        { rank: '5', suit: 'spades' },
        { rank: '5', suit: 'clubs' },
        { rank: '5', suit: 'diamonds' },
      ];
      const hand = BotPlayer.findBestHandInCards(cards);
      expect(hand).toEqual({ type: HandType.FOUR_OF_A_KIND, rank: '5' });
    });

    it('returns highest pair when multiple pairs exist', () => {
      const cards: Card[] = [
        { rank: '3', suit: 'hearts' },
        { rank: '3', suit: 'spades' },
        { rank: 'Q', suit: 'clubs' },
        { rank: 'Q', suit: 'diamonds' },
      ];
      const hand = BotPlayer.findBestHandInCards(cards);
      // Should return the highest pair (Queens)
      expect(hand?.type).toBe(HandType.PAIR);
      if (hand?.type === HandType.PAIR) {
        expect(hand.rank).toBe('Q');
      }
    });

    it('returns null for empty cards', () => {
      expect(BotPlayer.findBestHandInCards([])).toBeNull();
    });
  });

  describe('findHandHigherThan', () => {
    it('finds a higher high card', () => {
      const cards: Card[] = [{ rank: 'A', suit: 'spades' }];
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: 'K' };
      const result = BotPlayer.findHandHigherThan(cards, currentHand);
      expect(result).not.toBeNull();
      expect(isHigherHand(result!, currentHand)).toBe(true);
    });

    it('finds a pair higher than a high card', () => {
      const cards: Card[] = [
        { rank: '3', suit: 'hearts' },
        { rank: '3', suit: 'spades' },
      ];
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: 'A' };
      const result = BotPlayer.findHandHigherThan(cards, currentHand);
      expect(result).not.toBeNull();
      expect(isHigherHand(result!, currentHand)).toBe(true);
    });

    it('returns null when no higher hand possible', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const result = BotPlayer.findHandHigherThan(cards, currentHand);
      expect(result).toBeNull();
    });
  });

  describe('estimatePlausibility', () => {
    it('returns high plausibility for high card bot has', () => {
      const cards: Card[] = [{ rank: '7', suit: 'spades' }];
      const hand: HandCall = { type: HandType.HIGH_CARD, rank: '7' };
      expect(BotPlayer.estimatePlausibility(hand, cards, 3)).toBeGreaterThan(0.9);
    });

    it('returns low plausibility for royal flush', () => {
      const cards: Card[] = [{ rank: '7', suit: 'spades' }];
      const hand: HandCall = { type: HandType.ROYAL_FLUSH, suit: 'spades' };
      expect(BotPlayer.estimatePlausibility(hand, cards, 5)).toBeLessThan(0.1);
    });

    it('returns moderate plausibility for pair with partial match', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const hand: HandCall = { type: HandType.PAIR, rank: 'K' };
      const p = BotPlayer.estimatePlausibility(hand, cards, 5);
      expect(p).toBeGreaterThan(0.1);
      expect(p).toBeLessThan(0.9);
    });
  });

  describe('decideAction', () => {
    it('makes an opening call when no current hand', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
      const action = BotPlayer.decideAction(state, 'bot1', cards);
      expect(action.action).toBe('call');
    });

    it('calls bull or raises when current hand exists in calling phase', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: { type: HandType.HIGH_CARD, rank: 'A' },
        lastCallerId: 'p1',
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards);
      expect(['call', 'bull']).toContain(action.action);
    });

    it('calls bull or true in bull phase', () => {
      const cards: Card[] = [{ rank: '7', suit: 'spades' }];
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: { type: HandType.HIGH_CARD, rank: '7' },
        lastCallerId: 'p1',
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards);
      expect(['bull', 'true', 'call']).toContain(action.action);
    });

    it('handles last chance phase', () => {
      const cards: Card[] = [{ rank: 'A', suit: 'spades' }];
      const state = makeState({
        roundPhase: RoundPhase.LAST_CHANCE,
        currentHand: { type: HandType.HIGH_CARD, rank: '7' },
        lastCallerId: 'bot1',
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards);
      expect(['lastChanceRaise', 'lastChancePass']).toContain(action.action);
    });

    it('returns a valid HandCall when making a call', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
      // Run multiple times to account for randomness
      for (let i = 0; i < 20; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards);
        if (action.action === 'call') {
          expect(action.hand).toBeDefined();
          expect(action.hand.type).toBeGreaterThanOrEqual(HandType.HIGH_CARD);
          expect(action.hand.type).toBeLessThanOrEqual(HandType.ROYAL_FLUSH);
        }
      }
    });
  });

  describe('makeBluffHand', () => {
    it('returns a valid hand when no current hand', () => {
      const hand = BotPlayer.makeBluffHand(null);
      expect(hand.type).toBe(HandType.HIGH_CARD);
    });

    it('returns a higher hand than current', () => {
      const current: HandCall = { type: HandType.HIGH_CARD, rank: '7' };
      const bluff = BotPlayer.makeBluffHand(current);
      expect(isHigherHand(bluff, current)).toBe(true);
    });

    it('escalates from high card ace to pair', () => {
      const current: HandCall = { type: HandType.HIGH_CARD, rank: 'A' };
      const bluff = BotPlayer.makeBluffHand(current);
      expect(bluff.type).toBeGreaterThanOrEqual(HandType.PAIR);
    });
  });
});
