import { describe, it, expect } from 'vitest';
import { getLegalAbstractActions, getInfoSetKey, AbstractAction } from './infoSet.js';
import { HandType, RoundPhase, GamePhase } from '../types.js';
import type { Card, ClientGameState, HandCall } from '../types.js';

// ── Helpers ─────────────────────────────────────────────────────────

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

function makeState(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    gamePhase: GamePhase.PLAYING,
    roundPhase: RoundPhase.CALLING,
    roundNumber: 1,
    maxCards: 5,
    players: [],
    myCards: [],
    currentPlayerId: 'p1',
    currentHand: null,
    lastCallerId: null,
    turnHistory: [],
    startingPlayerId: 'p1',
    roundResult: null,
    turnDeadline: null,
    turnDurationMs: null,
    ...overrides,
  };
}

// ── getLegalAbstractActions ──────────────────────────────────────────

describe('getLegalAbstractActions', () => {
  it('returns only raise actions for CALLING phase with no current hand (opening)', () => {
    const state = makeState({ roundPhase: RoundPhase.CALLING, currentHand: null });
    const actions = getLegalAbstractActions(state);
    expect(actions).toContain(AbstractAction.TRUTHFUL_LOW);
    expect(actions).toContain(AbstractAction.TRUTHFUL_MID);
    expect(actions).toContain(AbstractAction.TRUTHFUL_HIGH);
    expect(actions).toContain(AbstractAction.BLUFF_SMALL);
    expect(actions).toContain(AbstractAction.BLUFF_MID);
    expect(actions).toContain(AbstractAction.BLUFF_BIG);
    expect(actions).not.toContain(AbstractAction.BULL);
    expect(actions).not.toContain(AbstractAction.TRUE);
    expect(actions).not.toContain(AbstractAction.PASS);
    expect(actions).toHaveLength(6);
  });

  it('returns BULL + raise actions for CALLING phase with existing hand', () => {
    const state = makeState({
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.PAIR, rank: '5' },
    });
    const actions = getLegalAbstractActions(state);
    expect(actions).toContain(AbstractAction.BULL);
    expect(actions).toContain(AbstractAction.TRUTHFUL_LOW);
    expect(actions).not.toContain(AbstractAction.TRUE);
    expect(actions).not.toContain(AbstractAction.PASS);
    expect(actions).toHaveLength(7);
  });

  it('returns BULL + TRUE + raise actions for BULL_PHASE with existing hand', () => {
    const state = makeState({
      roundPhase: RoundPhase.BULL_PHASE,
      currentHand: { type: HandType.PAIR, rank: '5' },
    });
    const actions = getLegalAbstractActions(state);
    expect(actions).toContain(AbstractAction.BULL);
    expect(actions).toContain(AbstractAction.TRUE);
    expect(actions).toContain(AbstractAction.TRUTHFUL_LOW);
    expect(actions).toHaveLength(8);
  });

  it('returns only BULL + TRUE for BULL_PHASE with no current hand', () => {
    const state = makeState({
      roundPhase: RoundPhase.BULL_PHASE,
      currentHand: null,
    });
    const actions = getLegalAbstractActions(state);
    expect(actions).toEqual([AbstractAction.BULL, AbstractAction.TRUE]);
  });

  it('returns PASS + raise actions for LAST_CHANCE phase', () => {
    const state = makeState({
      roundPhase: RoundPhase.LAST_CHANCE,
      currentHand: { type: HandType.PAIR, rank: '5' },
    });
    const actions = getLegalAbstractActions(state);
    expect(actions).toContain(AbstractAction.PASS);
    expect(actions).toContain(AbstractAction.TRUTHFUL_LOW);
    expect(actions).not.toContain(AbstractAction.BULL);
    expect(actions).not.toContain(AbstractAction.TRUE);
    expect(actions).toHaveLength(7);
  });
});

// ── getInfoSetKey ───────────────────────────────────────────────────

describe('getInfoSetKey', () => {
  it('produces a pipe-delimited string', () => {
    const state = makeState();
    const key = getInfoSetKey(state, [card('A', 'spades')], 4, 2);
    expect(key).toContain('|');
    const parts = key.split('|');
    expect(parts.length).toBeGreaterThanOrEqual(11);
  });

  it('starts with the round phase first character', () => {
    const callingState = makeState({ roundPhase: RoundPhase.CALLING });
    const bullState = makeState({ roundPhase: RoundPhase.BULL_PHASE });
    const keyC = getInfoSetKey(callingState, [], 4, 2);
    const keyB = getInfoSetKey(bullState, [], 4, 2);
    expect(keyC.split('|')[0]).toBe('c');
    expect(keyB.split('|')[0]).toBe('b');
  });

  it('includes player count bucket', () => {
    const state = makeState();
    const key2 = getInfoSetKey(state, [], 4, 2);
    const key3 = getInfoSetKey(state, [], 6, 3);
    const key6 = getInfoSetKey(state, [], 12, 6);
    expect(key2.split('|')[1]).toBe('p2');
    expect(key3.split('|')[1]).toBe('p34');
    expect(key6.split('|')[1]).toBe('p5+');
  });

  it('includes card count bucket', () => {
    const state = makeState();
    const key1 = getInfoSetKey(state, [card('A', 'spades')], 4, 2);
    const key2 = getInfoSetKey(state, [card('A', 'spades'), card('K', 'spades')], 4, 2);
    const key5 = getInfoSetKey(state, [
      card('A', 'spades'), card('K', 'spades'), card('Q', 'spades'),
      card('J', 'spades'), card('10', 'spades'),
    ], 10, 2);
    expect(key1.split('|')[2]).toBe('c1');
    expect(key2.split('|')[2]).toBe('c2');
    expect(key5.split('|')[2]).toBe('c5');
  });

  it('includes total cards bucket', () => {
    const state = makeState();
    const keyLo = getInfoSetKey(state, [], 3, 2);
    const keyMid = getInfoSetKey(state, [], 6, 2);
    const keyHi = getInfoSetKey(state, [], 12, 2);
    expect(keyLo.split('|')[3]).toBe('tLo');
    expect(keyMid.split('|')[3]).toBe('tMid');
    expect(keyHi.split('|')[3]).toBe('tHi');
  });

  it('includes hand strength and high card buckets based on cards', () => {
    const state = makeState();
    // A pair = strong
    const keyStrong = getInfoSetKey(state, [card('A', 'spades'), card('A', 'hearts')], 4, 2);
    // Two same-suit cards = draw
    const keyDraw = getInfoSetKey(state, [card('A', 'spades'), card('K', 'spades')], 4, 2);
    // All different = weak
    const keyWeak = getInfoSetKey(state, [card('A', 'spades'), card('K', 'hearts')], 4, 2);
    expect(keyStrong.split('|')[4]).toBe('strong');
    expect(keyDraw.split('|')[4]).toBe('draw');
    expect(keyWeak.split('|')[4]).toBe('weak');
    // High card bucket (index 5)
    expect(keyStrong.split('|')[5]).toBe('hHi'); // Ace = high
    // Low cards
    const keyLow = getInfoSetKey(state, [card('3', 'spades'), card('4', 'hearts')], 4, 2);
    expect(keyLow.split('|')[5]).toBe('hLo');
  });

  it('appends 2P refinement suffix for 2-player games with a current hand', () => {
    const state = makeState({
      currentHand: { type: HandType.HIGH_CARD, rank: 'A' },
    });
    const key = getInfoSetKey(state, [card('A', 'spades')], 4, 2);
    expect(key).toMatch(/\|hc$/);

    const state2 = makeState({
      currentHand: { type: HandType.PAIR, rank: 'A' },
    });
    const key2 = getInfoSetKey(state2, [card('A', 'spades')], 4, 2);
    expect(key2).toMatch(/\|rh$/);
  });

  it('does not append 2P refinement for 3+ players', () => {
    const state = makeState({
      currentHand: { type: HandType.HIGH_CARD, rank: 'A' },
    });
    const key = getInfoSetKey(state, [card('A', 'spades')], 6, 3);
    expect(key).not.toMatch(/\|hc$/);
  });

  it('appends joker suffix for non-zero joker count', () => {
    const state = makeState();
    const key0 = getInfoSetKey(state, [], 4, 2, 0);
    const key1 = getInfoSetKey(state, [], 4, 2, 1);
    const key2 = getInfoSetKey(state, [], 4, 2, 2);
    expect(key0).not.toContain('j1');
    expect(key0).not.toContain('j2');
    expect(key1).toContain('j1');
    expect(key2).toContain('j2');
  });

  it('appends strict last chance mode suffix', () => {
    const state = makeState();
    const keyClassic = getInfoSetKey(state, [], 4, 2, 0, 'classic');
    const keyStrict = getInfoSetKey(state, [], 4, 2, 0, 'strict');
    expect(keyClassic).not.toContain('lcS');
    expect(keyStrict).toContain('lcS');
  });

  it('produces different keys for different hand vs claim situations', () => {
    const hand: HandCall = { type: HandType.PAIR, rank: 'K' };
    const stateWithHand = makeState({ currentHand: hand });

    // Player has the pair = "has"
    const keyHas = getInfoSetKey(stateWithHand, [card('K', 'spades'), card('K', 'hearts')], 4, 2);
    // Player has nothing related = "below"
    const keyBelow = getInfoSetKey(stateWithHand, [card('2', 'spades'), card('3', 'hearts')], 4, 2);

    expect(keyHas).not.toBe(keyBelow);
  });

  it('produces different keys for early vs late turns', () => {
    const stateEarly = makeState({ turnHistory: [] });
    const stateLate = makeState({
      turnHistory: [
        { playerId: 'p1', playerName: 'P1', action: 'call' as never, timestamp: 0 },
        { playerId: 'p2', playerName: 'P2', action: 'bull' as never, timestamp: 0 },
        { playerId: 'p1', playerName: 'P1', action: 'call' as never, timestamp: 0 },
      ],
    });
    const keyEarly = getInfoSetKey(stateEarly, [], 4, 2);
    const keyLate = getInfoSetKey(stateLate, [], 4, 2);
    expect(keyEarly).not.toBe(keyLate);
  });

  it('handles empty cards gracefully', () => {
    const state = makeState();
    const key = getInfoSetKey(state, [], 0, 2);
    expect(key.split('|')[4]).toBe('x'); // myHandStrengthBucket returns 'x' for empty
    expect(key.split('|')[5]).toBe('x'); // highCardBucket returns 'x' for empty
  });
});
