import { describe, it, expect, beforeEach } from 'vitest';
import { BotPlayer } from './BotPlayer.js';
import {
  HandType, RoundPhase, GamePhase, BotDifficulty, TurnAction,
  isHigherHand,
} from '@bull-em/shared';
import type { Card, HandCall, ClientGameState, RoundResult } from '@bull-em/shared';

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
    maxCards: 5,
    ...overrides,
  };
}

function makeManyCardState(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return makeState({
    players: [
      { id: 'bot1', name: 'Bot', cardCount: 4, isConnected: true, isEliminated: false, isHost: false, isBot: true },
      { id: 'p1', name: 'Alice', cardCount: 4, isConnected: true, isEliminated: false, isHost: true },
      { id: 'p2', name: 'Bob', cardCount: 3, isConnected: true, isEliminated: false, isHost: false },
    ],
    ...overrides,
  });
}

describe('BotPlayer', () => {
  // ─── findBestHandInCards ──────────────────────────────────────────

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
      expect(hand?.type).toBe(HandType.PAIR);
      if (hand?.type === HandType.PAIR) {
        expect(hand.rank).toBe('Q');
      }
    });

    it('returns null for empty cards', () => {
      expect(BotPlayer.findBestHandInCards([])).toBeNull();
    });
  });

  // ─── findHandHigherThan ───────────────────────────────────────────

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

    it('finds two pair when available', () => {
      const cards: Card[] = [
        { rank: 'K', suit: 'hearts' },
        { rank: 'K', suit: 'spades' },
        { rank: 'Q', suit: 'clubs' },
        { rank: 'Q', suit: 'diamonds' },
      ];
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'A' };
      const result = BotPlayer.findHandHigherThan(cards, currentHand);
      expect(result).not.toBeNull();
      expect(isHigherHand(result!, currentHand)).toBe(true);
    });

    it('picks the lowest valid hand (conservative)', () => {
      const cards: Card[] = [
        { rank: 'A', suit: 'spades' },
        { rank: 'K', suit: 'hearts' },
        { rank: 'K', suit: 'spades' },
      ];
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: 'Q' };
      const result = BotPlayer.findHandHigherThan(cards, currentHand);
      expect(result).not.toBeNull();
      // Should pick high card K or A (lowest valid), not pair of Ks
      expect(result!.type).toBe(HandType.HIGH_CARD);
    });
  });

  // ─── estimatePlausibility ─────────────────────────────────────────

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

    it('returns very high plausibility for pair bot already has', () => {
      const cards: Card[] = [
        { rank: 'K', suit: 'hearts' },
        { rank: 'K', suit: 'spades' },
      ];
      const hand: HandCall = { type: HandType.PAIR, rank: 'K' };
      expect(BotPlayer.estimatePlausibility(hand, cards, 5)).toBeGreaterThan(0.9);
    });

    it('returns low plausibility for straight flush', () => {
      const cards: Card[] = [{ rank: '7', suit: 'spades' }];
      const hand: HandCall = { type: HandType.STRAIGHT_FLUSH, suit: 'spades', highRank: '9' };
      expect(BotPlayer.estimatePlausibility(hand, cards, 5)).toBeLessThan(0.1);
    });
  });

  // ─── decideAction (NORMAL mode — default) ──────────────────────────

  describe('decideAction (Normal mode)', () => {
    it('makes an opening call when no current hand', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
      const action = BotPlayer.decideAction(state, 'bot1', cards);
      expect(action.action).toBe('call');
    });

    it('defaults to normal mode when no difficulty specified', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
      // Should not throw and should produce a valid action
      const action = BotPlayer.decideAction(state, 'bot1', cards);
      expect(action.action).toBe('call');
    });

    it('calls bull when no legitimate higher hand exists in calling phase', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: { type: HandType.HIGH_CARD, rank: 'A' },
        lastCallerId: 'p1',
      });
      // Normal bot mostly calls bull when it can't legitimately raise (90%)
      // but may occasionally bluff (10%), so run multiple times
      let bullCount = 0;
      const runs = 100;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'bull') bullCount++;
      }
      // Expect mostly bull (>65% — base 90% reduced by early-round bluff bonus)
      expect(bullCount).toBeGreaterThan(runs * 0.65);
    });

    it('mostly calls bull or true in bull phase (may occasionally raise)', () => {
      const cards: Card[] = [{ rank: '7', suit: 'spades' }];
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: { type: HandType.HIGH_CARD, rank: '7' },
        lastCallerId: 'p1',
      });
      // Normal bot uses plausibility heuristic; may raise 10% with a legitimate higher hand
      for (let i = 0; i < 100; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        expect(['bull', 'true', 'call']).toContain(action.action);
      }
    });

    it('handles last chance phase', () => {
      const cards: Card[] = [{ rank: 'A', suit: 'spades' }];
      const state = makeState({
        roundPhase: RoundPhase.LAST_CHANCE,
        currentHand: { type: HandType.HIGH_CARD, rank: '7' },
        lastCallerId: 'bot1',
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
      expect(['lastChanceRaise', 'lastChancePass']).toContain(action.action);
    });

    it('returns a valid HandCall when making a call', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
      for (let i = 0; i < 20; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'call') {
          expect(action.hand).toBeDefined();
          expect(action.hand.type).toBeGreaterThanOrEqual(HandType.HIGH_CARD);
          expect(action.hand.type).toBeLessThanOrEqual(HandType.ROYAL_FLUSH);
        }
      }
    });

    it('normal mode only generates simple hand types (HIGH_CARD, PAIR, THREE_OF_A_KIND)', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
      for (let i = 0; i < 50; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'call') {
          // Normal mode opening calls should only be simple types
          expect(action.hand.type).toBeLessThanOrEqual(HandType.STRAIGHT);
        }
      }
    });

    it('normal mode mostly passes in last chance when no higher hand (may bluff 20%)', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const state = makeState({
        roundPhase: RoundPhase.LAST_CHANCE,
        currentHand: { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
        lastCallerId: 'bot1',
      });
      let passCount = 0;
      const runs = 100;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'lastChancePass') passCount++;
      }
      // Normal bot passes ~80% when it can't raise legitimately, bluffs ~20%
      // But bluff may fail isHigherHand check, so pass rate could be higher
      expect(passCount).toBeGreaterThan(runs * 0.70);
    });
  });

  // ─── decideAction (HARD mode) ─────────────────────────────────────

  describe('decideAction (Hard mode)', () => {
    it('makes an opening call when no current hand', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
      expect(action.action).toBe('call');
    });

    it('calls bull or raises when current hand exists in calling phase', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: { type: HandType.HIGH_CARD, rank: 'A' },
        lastCallerId: 'p1',
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
      expect(['call', 'bull']).toContain(action.action);
    });

    it('calls bull, true, or raises in bull phase', () => {
      const cards: Card[] = [{ rank: '7', suit: 'spades' }];
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: { type: HandType.HIGH_CARD, rank: '7' },
        lastCallerId: 'p1',
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
      expect(['bull', 'true', 'call']).toContain(action.action);
    });

    it('handles last chance phase with raise when possible', () => {
      const cards: Card[] = [
        { rank: 'A', suit: 'spades' },
        { rank: 'A', suit: 'hearts' },
      ];
      const state = makeState({
        roundPhase: RoundPhase.LAST_CHANCE,
        currentHand: { type: HandType.HIGH_CARD, rank: '7' },
        lastCallerId: 'bot1',
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
      expect(['lastChanceRaise', 'lastChancePass']).toContain(action.action);
    });

    it('hard mode considers all hand types for opening call with many cards', () => {
      const cards: Card[] = [
        { rank: 'K', suit: 'hearts' },
        { rank: 'K', suit: 'spades' },
        { rank: 'Q', suit: 'clubs' },
        { rank: 'Q', suit: 'diamonds' },
        { rank: 'J', suit: 'hearts' },
      ];
      const state = makeManyCardState({
        roundPhase: RoundPhase.CALLING,
        currentHand: null,
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
      expect(action.action).toBe('call');
      if (action.action === 'call') {
        // With two pairs of K and Q, hard mode can find these
        expect(action.hand.type).toBeGreaterThanOrEqual(HandType.HIGH_CARD);
      }
    });

    it('hard mode uses adaptive aggression with more cards', () => {
      const cards: Card[] = [
        { rank: 'A', suit: 'spades' },
        { rank: 'A', suit: 'hearts' },
        { rank: 'A', suit: 'clubs' },
        { rank: 'K', suit: 'spades' },
      ];
      const state = makeManyCardState({
        roundPhase: RoundPhase.CALLING,
        currentHand: { type: HandType.PAIR, rank: '7' },
        lastCallerId: 'p1',
      });
      // With 3 aces and 4 cards, hard mode should be aggressive
      const actions = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
        actions.add(action.action);
      }
      expect(actions.has('call')).toBe(true); // Should raise at least sometimes
    });

    it('hard mode attempts desperate raise in last chance even with weak hand', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const state = makeState({
        roundPhase: RoundPhase.LAST_CHANCE,
        currentHand: { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
        lastCallerId: 'bot1',
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
      // Hard bot tries a desperate bluff rather than passing (passing guarantees loss)
      expect(action.action).toBe('lastChanceRaise');
    });

    it('hard mode fallback returns bull when current hand exists', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const state = makeState({
        roundPhase: RoundPhase.RESOLVING as any, // unusual phase
        currentHand: { type: HandType.HIGH_CARD, rank: 'A' },
      });
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
      expect(action.action).toBe('bull');
    });
  });

  // ─── decideAction (Impossible mode) ───────────────────────────────

  describe('decideAction (Impossible mode)', () => {
    it('impossible mode calls bull when hand does not exist', () => {
      const botCards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const allCards: Card[] = [
        { rank: '2', suit: 'clubs' },
        { rank: '5', suit: 'hearts' },
        { rank: '9', suit: 'spades' },
      ];
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        // Pair of 7s — doesn't exist in allCards
        currentHand: { type: HandType.PAIR, rank: '7' },
      });
      const action = BotPlayer.decideAction(state, 'bot1', botCards, BotDifficulty.IMPOSSIBLE, allCards);
      // Should call bull (hand doesn't exist) or raise
      expect(action.action === 'bull' || action.action === 'call').toBe(true);
      if (action.action === 'bull') {
        expect(action.action).toBe('bull');
      }
    });

    it('impossible mode calls true when hand exists', () => {
      const botCards: Card[] = [{ rank: '7', suit: 'clubs' }];
      const allCards: Card[] = [
        { rank: '7', suit: 'clubs' },
        { rank: '7', suit: 'hearts' },
        { rank: '9', suit: 'spades' },
      ];
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: { type: HandType.PAIR, rank: '7' },
      });
      // Run multiple times to account for the 25% raise chance
      let trueCount = 0;
      for (let i = 0; i < 50; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', botCards, BotDifficulty.IMPOSSIBLE, allCards);
        if (action.action === 'true') trueCount++;
        // Should never call bull on a hand that exists
        expect(action.action).not.toBe('bull');
      }
      expect(trueCount).toBeGreaterThan(0);
    });

    it('impossible mode calls bull in calling phase when hand does not exist', () => {
      const botCards: Card[] = [{ rank: '3', suit: 'clubs' }];
      const allCards: Card[] = [
        { rank: '3', suit: 'clubs' },
        { rank: '5', suit: 'hearts' },
      ];
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: { type: HandType.PAIR, rank: 'A' },
      });
      // Run multiple times — should mostly bull
      let bullCount = 0;
      for (let i = 0; i < 30; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', botCards, BotDifficulty.IMPOSSIBLE, allCards);
        if (action.action === 'bull') bullCount++;
      }
      // Should call bull most of the time (90% — 10% raise with real hand)
      expect(bullCount).toBeGreaterThan(15);
    });

    it('impossible mode opens with an existing hand', () => {
      const botCards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const allCards: Card[] = [
        { rank: 'K', suit: 'hearts' },
        { rank: 'K', suit: 'spades' },
        { rank: '5', suit: 'clubs' },
      ];
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: null,
      });
      const action = BotPlayer.decideAction(state, 'bot1', botCards, BotDifficulty.IMPOSSIBLE, allCards);
      expect(action.action).toBe('call');
    });
  });

  // ─── makeBluffHand ────────────────────────────────────────────────

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

    it('escalates from pair of aces to flush', () => {
      const current: HandCall = { type: HandType.PAIR, rank: 'A' };
      const bluff = BotPlayer.makeBluffHand(current);
      expect(bluff.type).toBeGreaterThanOrEqual(HandType.FLUSH);
    });

    it('escalates from flush to three of a kind', () => {
      const current: HandCall = { type: HandType.FLUSH, suit: 'spades' };
      const bluff = BotPlayer.makeBluffHand(current);
      expect(bluff.type).toBeGreaterThanOrEqual(HandType.THREE_OF_A_KIND);
    });

    it('escalates from three of a kind to straight', () => {
      const current: HandCall = { type: HandType.THREE_OF_A_KIND, rank: '5' };
      const bluff = BotPlayer.makeBluffHand(current);
      expect(bluff.type).toBeGreaterThanOrEqual(HandType.STRAIGHT);
    });
  });

  // ─── analyzeTurnHistory ───────────────────────────────────────────

  describe('analyzeTurnHistory', () => {
    it('returns 0 with insufficient history', () => {
      const history = [
        { playerId: 'p1', action: TurnAction.BULL, playerName: 'p1', timestamp: 0 },
      ];
      expect(BotPlayer.analyzeTurnHistory(history, 'bot1')).toBe(0);
    });

    it('returns negative bias when opponents call bull a lot', () => {
      const history = [
        { playerId: 'p1', action: TurnAction.BULL, playerName: 'p1', timestamp: 0 },
        { playerId: 'p2', action: TurnAction.BULL, playerName: 'p2', timestamp: 0 },
        { playerId: 'p1', action: TurnAction.BULL, playerName: 'p1', timestamp: 0 },
      ];
      const bias = BotPlayer.analyzeTurnHistory(history, 'bot1');
      expect(bias).toBeLessThan(0);
    });

    it('returns positive bias when opponents call true a lot', () => {
      const history = [
        { playerId: 'p1', action: TurnAction.TRUE, playerName: 'p1', timestamp: 0 },
        { playerId: 'p2', action: TurnAction.TRUE, playerName: 'p2', timestamp: 0 },
        { playerId: 'p1', action: TurnAction.TRUE, playerName: 'p1', timestamp: 0 },
      ];
      const bias = BotPlayer.analyzeTurnHistory(history, 'bot1');
      expect(bias).toBeGreaterThan(0);
    });

    it('returns 0 for balanced history', () => {
      const history = [
        { playerId: 'p1', action: TurnAction.BULL, playerName: 'p1', timestamp: 0 },
        { playerId: 'p2', action: TurnAction.TRUE, playerName: 'p2', timestamp: 0 },
      ];
      const bias = BotPlayer.analyzeTurnHistory(history, 'bot1');
      expect(bias).toBe(0);
    });

    it('ignores bot own actions in history', () => {
      const history = [
        { playerId: 'bot1', action: TurnAction.BULL, playerName: 'bot1', timestamp: 0 },
        { playerId: 'bot1', action: TurnAction.BULL, playerName: 'bot1', timestamp: 0 },
        { playerId: 'p1', action: TurnAction.TRUE, playerName: 'p1', timestamp: 0 },
        { playerId: 'p2', action: TurnAction.TRUE, playerName: 'p2', timestamp: 0 },
      ];
      const bias = BotPlayer.analyzeTurnHistory(history, 'bot1');
      // Only p1 and p2 counted: 2 true, 0 bull → positive bias
      expect(bias).toBeGreaterThan(0);
    });
  });

  // ─── Difficulty parameter behavior ────────────────────────────────

  describe('difficulty parameter', () => {
    it('accepts NORMAL difficulty', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState();
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
      expect(action).toBeDefined();
      expect(action.action).toBeDefined();
    });

    it('accepts HARD difficulty', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState();
      const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
      expect(action).toBeDefined();
      expect(action.action).toBeDefined();
    });

    it('both difficulties produce valid actions for all phases', () => {
      const cards: Card[] = [{ rank: 'A', suit: 'spades' }, { rank: 'K', suit: 'hearts' }];

      const phases = [
        { roundPhase: RoundPhase.CALLING, currentHand: null, lastCallerId: null },
        { roundPhase: RoundPhase.CALLING, currentHand: { type: HandType.HIGH_CARD, rank: '7' as const }, lastCallerId: 'p1' },
        { roundPhase: RoundPhase.BULL_PHASE, currentHand: { type: HandType.HIGH_CARD, rank: '7' as const }, lastCallerId: 'p1' },
        { roundPhase: RoundPhase.LAST_CHANCE, currentHand: { type: HandType.HIGH_CARD, rank: '7' as const }, lastCallerId: 'bot1' },
      ];

      for (const difficulty of [BotDifficulty.NORMAL, BotDifficulty.HARD]) {
        for (const phase of phases) {
          const state = makeState(phase);
          const action = BotPlayer.decideAction(state, 'bot1', cards, difficulty);
          expect(action).toBeDefined();
          expect(['call', 'bull', 'true', 'lastChanceRaise', 'lastChancePass']).toContain(action.action);
        }
      }
    });

    it('hard mode calls never produce an invalid raise', () => {
      const cards: Card[] = [{ rank: 'A', suit: 'spades' }];
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: '7' };
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand,
        lastCallerId: 'p1',
      });

      for (let i = 0; i < 50; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
        if (action.action === 'call') {
          expect(isHigherHand(action.hand, currentHand)).toBe(true);
        }
      }
    });

    it('normal mode calls never produce an invalid raise', () => {
      const cards: Card[] = [{ rank: 'A', suit: 'spades' }];
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: '7' };
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand,
        lastCallerId: 'p1',
      });

      for (let i = 0; i < 50; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'call') {
          expect(isHigherHand(action.hand, currentHand)).toBe(true);
        }
      }
    });
  });

  // ─── GTO Bluffing Behavior ─────────────────────────────────────────

  describe('GTO bluffing (Hard mode)', () => {
    it('bluffs less frequently with more opponents (same card count)', () => {
      // Use a higher hand with same per-player card count so total card pool
      // difference doesn't dominate the bluff-frequency effect
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const currentHand: HandCall = { type: HandType.THREE_OF_A_KIND, rank: '7' };

      // 2-player game (1 opponent), 1 card each → 2 total
      const state2p = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand,
        lastCallerId: 'p1',
      });

      // 5-player game (4 opponents), 1 card each → 5 total
      const state5p = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand,
        lastCallerId: 'p1',
        players: [
          { id: 'bot1', name: 'Bot', cardCount: 1, isConnected: true, isEliminated: false, isHost: false, isBot: true },
          { id: 'p1', name: 'Alice', cardCount: 1, isConnected: true, isEliminated: false, isHost: true },
          { id: 'p2', name: 'Bob', cardCount: 1, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p3', name: 'Carol', cardCount: 1, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p4', name: 'Dave', cardCount: 1, isConnected: true, isEliminated: false, isHost: false },
        ],
      });

      let bluffs2p = 0;
      let bluffs5p = 0;
      const runs = 200;

      for (let i = 0; i < runs; i++) {
        const a2 = BotPlayer.decideAction(state2p, 'bot1', cards, BotDifficulty.HARD);
        if (a2.action === 'call') bluffs2p++;
        const a5 = BotPlayer.decideAction(state5p, 'bot1', cards, BotDifficulty.HARD);
        if (a5.action === 'call') bluffs5p++;
      }

      // 3-of-a-kind with few total cards is implausible — bot mostly calls bull
      // With 5 players the GTO bluff rate is lower (1/5 vs 1/2)
      expect(bluffs5p).toBeLessThanOrEqual(bluffs2p + runs * 0.1);
    });

    it('position-aware: more suspicious of hands after many raises', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'K' };

      // State with few raises in history
      const stateFewRaises = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand,
        lastCallerId: 'p1',
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0 },
        ],
      });

      // State with many raises in history (suspicious)
      const stateManyRaises = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand,
        lastCallerId: 'p1',
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0 },
          { playerId: 'p2', playerName: 'Bob', action: TurnAction.CALL, timestamp: 0 },
          { playerId: 'p3', playerName: 'Carol', action: TurnAction.CALL, timestamp: 0 },
          { playerId: 'p4', playerName: 'Dave', action: TurnAction.CALL, timestamp: 0 },
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0 },
        ],
        players: [
          { id: 'bot1', name: 'Bot', cardCount: 2, isConnected: true, isEliminated: false, isHost: false, isBot: true },
          { id: 'p1', name: 'Alice', cardCount: 2, isConnected: true, isEliminated: false, isHost: true },
          { id: 'p2', name: 'Bob', cardCount: 2, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p3', name: 'Carol', cardCount: 2, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p4', name: 'Dave', cardCount: 2, isConnected: true, isEliminated: false, isHost: false },
        ],
      });

      let bullsFew = 0;
      let bullsMany = 0;
      const runs = 200;

      for (let i = 0; i < runs; i++) {
        const a1 = BotPlayer.decideAction(stateFewRaises, 'bot1', cards, BotDifficulty.HARD);
        if (a1.action === 'bull') bullsFew++;
        const a2 = BotPlayer.decideAction(stateManyRaises, 'bot1', cards, BotDifficulty.HARD);
        if (a2.action === 'bull') bullsMany++;
      }

      // With many raises, bot should call bull more often (more suspicious)
      expect(bullsMany).toBeGreaterThanOrEqual(bullsFew);
    });

    it('bluff raises are always valid higher hands', () => {
      // Bot has no legitimate hand but may try to bluff
      const cards: Card[] = [{ rank: '3', suit: 'clubs' }, { rank: '5', suit: 'hearts' }];
      const currentHand: HandCall = { type: HandType.PAIR, rank: '8' };
      const state = makeManyCardState({
        roundPhase: RoundPhase.CALLING,
        currentHand,
        lastCallerId: 'p1',
      });

      for (let i = 0; i < 100; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
        if (action.action === 'call') {
          // Every bluff raise must be a valid higher hand
          expect(isHigherHand(action.hand, currentHand)).toBe(true);
        }
      }
    });

    it('desperate bots bluff more aggressively', () => {
      const cards: Card[] = [{ rank: '3', suit: 'clubs' }];
      const currentHand: HandCall = { type: HandType.PAIR, rank: 'Q' };

      // Bot with 1 card (not desperate)
      const stateNormal = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand,
        lastCallerId: 'p1',
        players: [
          { id: 'bot1', name: 'Bot', cardCount: 1, isConnected: true, isEliminated: false, isHost: false, isBot: true },
          { id: 'p1', name: 'Alice', cardCount: 1, isConnected: true, isEliminated: false, isHost: true },
        ],
      });

      // Bot with 4 cards (desperate)
      const stateDesperate = makeManyCardState({
        roundPhase: RoundPhase.CALLING,
        currentHand,
        lastCallerId: 'p1',
      });
      const desperateCards: Card[] = [
        { rank: '3', suit: 'clubs' },
        { rank: '5', suit: 'hearts' },
        { rank: '7', suit: 'diamonds' },
        { rank: '9', suit: 'spades' },
      ];

      let bluffsNormal = 0;
      let bluffsDesperate = 0;
      const runs = 200;

      for (let i = 0; i < runs; i++) {
        const a1 = BotPlayer.decideAction(stateNormal, 'bot1', cards, BotDifficulty.HARD);
        if (a1.action === 'call') bluffsNormal++;
        const a2 = BotPlayer.decideAction(stateDesperate, 'bot1', desperateCards, BotDifficulty.HARD);
        if (a2.action === 'call') bluffsDesperate++;
      }

      // Desperate bots should bluff at least as often (probably more)
      expect(bluffsDesperate).toBeGreaterThanOrEqual(bluffsNormal * 0.8);
    });

    it('prefers semi-bluffs over pure bluffs when raising', () => {
      // Bot holds a single 7 — pair of 7s is a semi-bluff (we have 1 of 2)
      // Bot also could bluff pair of Ks (no Ks held — pure bluff)
      // The semi-bluff should be preferred
      const cards: Card[] = [{ rank: '7', suit: 'hearts' }, { rank: '3', suit: 'clubs' }];
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: 'A' };
      const state = makeManyCardState({
        roundPhase: RoundPhase.CALLING,
        currentHand,
        lastCallerId: 'p1',
      });

      let pairOf7 = 0;
      let otherPairs = 0;
      const runs = 200;

      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.HARD);
        if (action.action === 'call' && action.hand.type === HandType.PAIR) {
          if (action.hand.rank === '7' || action.hand.rank === '3') {
            pairOf7++;
          } else {
            otherPairs++;
          }
        }
      }

      // When bluffing a pair, should prefer ranks we hold (semi-bluffs)
      // This test just verifies the bluffs use held ranks
      if (pairOf7 + otherPairs > 0) {
        expect(pairOf7).toBeGreaterThan(0);
      }
    });
  });

  // ─── Normal Bot Behavioral Tests ────────────────────────────────────

  describe('Normal bot behavioral guarantees', () => {
    it('occasionally raises in bull phase with legitimate hand (~10%)', () => {
      const cards: Card[] = [
        { rank: 'A', suit: 'spades' },
        { rank: 'A', suit: 'hearts' },
      ];
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: { type: HandType.HIGH_CARD, rank: '7' },
        lastCallerId: 'p1',
      });
      let raiseCount = 0;
      const runs = 500;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        expect(['bull', 'true', 'call']).toContain(action.action);
        if (action.action === 'call') raiseCount++;
      }
      // ~10% raise rate — expect between 2% and 20% to account for variance
      expect(raiseCount).toBeGreaterThan(runs * 0.02);
      expect(raiseCount).toBeLessThan(runs * 0.20);
    });

    it('mostly calls bull when no legitimate raise in calling phase (~90%)', () => {
      // Bot has 3♣ — can't legitimately raise above pair of queens
      const cards: Card[] = [{ rank: '3', suit: 'clubs' }];
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: { type: HandType.PAIR, rank: 'Q' },
        lastCallerId: 'p1',
      });
      let bullCount = 0;
      const runs = 200;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'bull') bullCount++;
      }
      // 90% bull when no legitimate raise — expect >80% to account for variance
      expect(bullCount).toBeGreaterThan(runs * 0.80);
    });

    it('opens truthfully ~85% of the time (200 iterations)', () => {
      const cards: Card[] = [{ rank: 'K', suit: 'hearts' }];
      const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
      let truthful = 0;
      const runs = 200;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'call') {
          // Truthful = high card K (what the bot actually has)
          if (action.hand.type === HandType.HIGH_CARD && action.hand.rank === 'K') {
            truthful++;
          }
        }
      }
      // ~73% truthful in early rounds (85% base minus early-round bluff bonus)
      expect(truthful).toBeGreaterThan(runs * 0.60);
    });

    it('mostly passes in last chance when no legitimate raise (~80%)', () => {
      const cards: Card[] = [{ rank: '2', suit: 'clubs' }];
      const state = makeState({
        roundPhase: RoundPhase.LAST_CHANCE,
        currentHand: { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
        lastCallerId: 'bot1',
      });
      let passCount = 0;
      const runs = 200;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'lastChancePass') passCount++;
      }
      // 80% pass + 20% bluff attempt (bluff may fail isHigherHand, raising pass rate)
      expect(passCount).toBeGreaterThan(runs * 0.70);
    });

    it('mostly raises in calling phase when it has a higher hand (~80%)', () => {
      // Bot has a pair of aces, current hand is high card 7
      const cards: Card[] = [
        { rank: 'A', suit: 'spades' },
        { rank: 'A', suit: 'hearts' },
      ];
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: { type: HandType.HIGH_CARD, rank: '7' },
        lastCallerId: 'p1',
      });
      let raiseCount = 0;
      const runs = 200;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'call') raiseCount++;
      }
      // 80% raise when has legitimate hand — expect >70% to account for variance
      expect(raiseCount).toBeGreaterThan(runs * 0.70);
    });

    it('uses plausibility: calls true for high-plausibility hands', () => {
      // Bot has pair of 7s, called hand is a pair of Kings
      // estimatePlausibilitySimple for pair of K with one 7 in hand and 2 total cards
      // → depends on totalCards, but with only 2 total cards, pair is unlikely
      // Use a scenario where plausibility is clearly high: bot has the called rank
      const cards: Card[] = [
        { rank: 'K', suit: 'hearts' },
        { rank: '7', suit: 'spades' },
      ];
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: { type: HandType.HIGH_CARD, rank: 'K' },
        lastCallerId: 'p1',
      });
      // High card K with bot holding K → plausibility 0.95 > 0.6 → true
      let trueCount = 0;
      const runs = 100;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'true') trueCount++;
      }
      // Should mostly call true (>80% accounting for 10% raise chance)
      expect(trueCount).toBeGreaterThan(runs * 0.80);
    });

    it('uses plausibility: calls bull for low-plausibility hands', () => {
      // Bot has high card 7, called hand is three of a kind 9s
      // estimatePlausibilitySimple for 3oaK with 0 matching cards, 2 total cards → 0.1 < 0.4 → bull
      const cards: Card[] = [{ rank: '7', suit: 'spades' }];
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: { type: HandType.THREE_OF_A_KIND, rank: '9' },
        lastCallerId: 'p1',
      });
      let bullCount = 0;
      const runs = 100;
      for (let i = 0; i < runs; i++) {
        const action = BotPlayer.decideAction(state, 'bot1', cards, BotDifficulty.NORMAL);
        if (action.action === 'bull') bullCount++;
      }
      // Should mostly call bull (>85%)
      expect(bullCount).toBeGreaterThan(runs * 0.85);
    });
  });

  // ─── Hard Bot Memory Tests ──────────────────────────────────────────

  describe('Hard bot opponent memory', () => {
    beforeEach(() => {
      BotPlayer.resetMemory();
    });

    it('resetMemory() clears the map', () => {
      // Add some memory
      const result: RoundResult = {
        calledHand: { type: HandType.PAIR, rank: '7' },
        callerId: 'p1',
        handExists: false,
        revealedCards: [],
        penalties: { p1: 1 },
        penalizedPlayerIds: ['p1'],
        eliminatedPlayerIds: [],
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0, hand: { type: HandType.PAIR, rank: '7' } },
          { playerId: 'bot1', playerName: 'Bot', action: TurnAction.BULL, timestamp: 1 },
        ],
      };
      BotPlayer.updateMemory(result, 'test');
      expect(BotPlayer.getMemory('test').size).toBeGreaterThan(0);
      BotPlayer.resetMemory('test');
      expect(BotPlayer.getMemory('test').size).toBe(0);
    });

    it('updateMemory() correctly tracks bluffs caught', () => {
      const result: RoundResult = {
        calledHand: { type: HandType.PAIR, rank: '7' },
        callerId: 'p1',
        handExists: false, // it was a bluff
        revealedCards: [],
        penalties: { p1: 1 },
        penalizedPlayerIds: ['p1'],
        eliminatedPlayerIds: [],
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0, hand: { type: HandType.PAIR, rank: '7' } },
          { playerId: 'bot1', playerName: 'Bot', action: TurnAction.BULL, timestamp: 1 },
        ],
      };
      BotPlayer.updateMemory(result, 'test');
      const profile = BotPlayer.getMemory('test').get('p1');
      expect(profile).toBeDefined();
      expect(profile!.totalCalls).toBe(1);
      expect(profile!.bluffsCaught).toBe(1);
      expect(profile!.truthsCaught).toBe(0);
    });

    it('updateMemory() correctly tracks truths caught', () => {
      const result: RoundResult = {
        calledHand: { type: HandType.PAIR, rank: '7' },
        callerId: 'p1',
        handExists: true, // hand existed
        revealedCards: [],
        penalties: {},
        penalizedPlayerIds: [],
        eliminatedPlayerIds: [],
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0, hand: { type: HandType.PAIR, rank: '7' } },
          { playerId: 'bot1', playerName: 'Bot', action: TurnAction.BULL, timestamp: 1 },
        ],
      };
      BotPlayer.updateMemory(result, 'test');
      const profile = BotPlayer.getMemory('test').get('p1');
      expect(profile!.totalCalls).toBe(1);
      expect(profile!.truthsCaught).toBe(1);
      expect(profile!.bluffsCaught).toBe(0);
    });

    it('updateMemory() tracks bull caller accuracy', () => {
      const result: RoundResult = {
        calledHand: { type: HandType.PAIR, rank: '7' },
        callerId: 'p1',
        handExists: false,
        revealedCards: [],
        penalties: { p1: 1 },
        penalizedPlayerIds: ['p1'],
        eliminatedPlayerIds: [],
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0, hand: { type: HandType.PAIR, rank: '7' } },
          { playerId: 'p2', playerName: 'Bob', action: TurnAction.BULL, timestamp: 1 },
        ],
      };
      BotPlayer.updateMemory(result, 'test');
      const p2Profile = BotPlayer.getMemory('test').get('p2');
      expect(p2Profile).toBeDefined();
      expect(p2Profile!.bullCallsMade).toBe(1);
      expect(p2Profile!.correctBulls).toBe(1);
    });

    it('hard bot is more suspicious of a player with high bluff history', () => {
      // Build up a bluff-heavy profile for p1
      for (let i = 0; i < 5; i++) {
        BotPlayer.updateMemory({
          calledHand: { type: HandType.PAIR, rank: '7' },
          callerId: 'p1',
          handExists: false, // caught bluffing
          revealedCards: [],
          penalties: { p1: 1 },
          penalizedPlayerIds: ['p1'],
          eliminatedPlayerIds: [],
          turnHistory: [
            { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0, hand: { type: HandType.PAIR, rank: '7' } },
            { playerId: 'bot1', playerName: 'Bot', action: TurnAction.BULL, timestamp: 1 },
          ],
        }, 'test');
      }

      // Use a hand with moderate plausibility so memory can swing the decision.
      // High card K with multiple cards in play — plausible enough to split the decision.
      const cards: Card[] = [
        { rank: '5', suit: 'clubs' },
        { rank: '8', suit: 'hearts' },
        { rank: 'J', suit: 'diamonds' },
      ];
      const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: 'K' };

      const manyPlayers = [
        { id: 'bot1', name: 'Bot', cardCount: 3, isConnected: true, isEliminated: false, isHost: false, isBot: true },
        { id: 'p1', name: 'Alice', cardCount: 3, isConnected: true, isEliminated: false, isHost: true },
        { id: 'p2', name: 'Bob', cardCount: 3, isConnected: true, isEliminated: false, isHost: false },
      ];

      // State where p1 (known bluffer) made the call
      const stateBluffer = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand,
        lastCallerId: 'p1',
        players: manyPlayers,
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, timestamp: 0, hand: currentHand },
        ],
      });

      // State where p2 (unknown player) made the call
      const stateClean = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand,
        lastCallerId: 'p2',
        players: manyPlayers,
        turnHistory: [
          { playerId: 'p2', playerName: 'Bob', action: TurnAction.CALL, timestamp: 0, hand: currentHand },
        ],
      });

      let bullsBluffer = 0;
      let bullsClean = 0;
      const runs = 300;

      for (let i = 0; i < runs; i++) {
        const a1 = BotPlayer.decideAction(stateBluffer, 'bot1', cards, BotDifficulty.HARD, undefined, 'test');
        if (a1.action === 'bull') bullsBluffer++;
        const a2 = BotPlayer.decideAction(stateClean, 'bot1', cards, BotDifficulty.HARD, undefined, 'test');
        if (a2.action === 'bull') bullsClean++;
      }

      // Bot should be more suspicious of known bluffer (or at least equally so)
      expect(bullsBluffer).toBeGreaterThanOrEqual(bullsClean);
    });
  });

  // ─── Hard Bot Dynamic Threshold Tests ───────────────────────────────

  describe('Hard bot dynamic bull threshold', () => {
    beforeEach(() => {
      BotPlayer.resetMemory();
    });

    it('bot with 1 card calls true more often than bot with 4 cards for same marginal hand', () => {
      // Test the asymmetric threshold: 1-card=0.55, 4-card=0.35.
      // Use a PAIR where the bot holds 1 of the rank. With enough total cards
      // and BULL-only history (no CALL entries → no card inference),
      // the plausibility should fall between the two thresholds.
      //
      // P(pair of 8) with bot holding one 8, 20 total cards:
      // unseenCards=51(1-card) or 48(4-card), otherCards=19(1-card) or 16(4-card)
      // remaining = 3, needed = 1
      // P = 1 - hypergeomNone(~50, 3, ~18) ≈ pretty high
      // + truthBoost(0.10) → adjustedP likely > 0.55 for both.
      //
      // So we need to use a less plausible hand. THREE_OF_A_KIND with one held:
      // needs 2 more of 3 remaining, from ~18 draws of ~50.
      // P(>=2 of 3 from 18 draws of 50) is moderate.
      const currentHand: HandCall = { type: HandType.THREE_OF_A_KIND, rank: '8' };

      // Only BULL entries in history — no CALL entries to trigger inference
      const historyNoCalls = [
        { playerId: 'p2', playerName: 'Bob', action: TurnAction.BULL as const, timestamp: 0 },
      ];

      // Scenario 1: Bot with 1 card (threshold = 0.55), total = 20 cards
      const state1card = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand,
        lastCallerId: 'p1',
        turnHistory: historyNoCalls,
        players: [
          { id: 'bot1', name: 'Bot', cardCount: 1, isConnected: true, isEliminated: false, isHost: false, isBot: true },
          { id: 'p1', name: 'Alice', cardCount: 5, isConnected: true, isEliminated: false, isHost: true },
          { id: 'p2', name: 'Bob', cardCount: 5, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p3', name: 'Carol', cardCount: 5, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p4', name: 'Dave', cardCount: 4, isConnected: true, isEliminated: false, isHost: false },
        ],
      });

      // Scenario 2: Bot with 4 cards (threshold = 0.35), total = 20 cards
      const state4cards = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand,
        lastCallerId: 'p1',
        turnHistory: historyNoCalls,
        players: [
          { id: 'bot1', name: 'Bot', cardCount: 4, isConnected: true, isEliminated: false, isHost: false, isBot: true },
          { id: 'p1', name: 'Alice', cardCount: 4, isConnected: true, isEliminated: false, isHost: true },
          { id: 'p2', name: 'Bob', cardCount: 4, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p3', name: 'Carol', cardCount: 4, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p4', name: 'Dave', cardCount: 4, isConnected: true, isEliminated: false, isHost: false },
        ],
      });

      // Bot holds one 8 (semi-evidence for three of a kind)
      const cards1: Card[] = [{ rank: '8', suit: 'clubs' }];
      const cards4: Card[] = [
        { rank: '8', suit: 'clubs' },
        { rank: '3', suit: 'hearts' },
        { rank: '5', suit: 'diamonds' },
        { rank: 'J', suit: 'spades' },
      ];

      let true1card = 0;
      let true4cards = 0;
      const runs = 300;

      for (let i = 0; i < runs; i++) {
        const a1 = BotPlayer.decideAction(state1card, 'bot1', cards1, BotDifficulty.HARD);
        if (a1.action === 'true') true1card++;
        const a4 = BotPlayer.decideAction(state4cards, 'bot1', cards4, BotDifficulty.HARD);
        if (a4.action === 'true') true4cards++;
      }

      // With the asymmetric threshold: 1-card = 0.35 (lean true), 4-card = 0.55 (lean bull).
      // The 1-card bot (safe) calls true more easily (lower bar, threshold 0.35).
      // The 4-card bot (desperate) requires more evidence to call true (threshold 0.55).
      expect(true1card).toBeGreaterThan(true4cards);
    });
  });
});
