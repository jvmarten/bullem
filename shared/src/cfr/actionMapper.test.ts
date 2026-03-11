/**
 * Tests for CFR action mapper sanity checks.
 *
 * Verifies that the CFR bot never calls bull on a hand it can verify
 * from its own cards alone.
 */

import { describe, it, expect } from 'vitest';
import { mapAbstractToConcreteAction } from './actionMapper.js';
import { AbstractAction } from './infoSet.js';
import type { ClientGameState, Card } from '../types.js';
import { HandType, RoundPhase, GamePhase } from '../types.js';

function makeState(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    gamePhase: GamePhase.PLAYING,
    players: [],
    myCards: [],
    currentPlayerId: 'bot1',
    startingPlayerId: 'p1',
    currentHand: null,
    lastCallerId: 'p1',
    roundPhase: RoundPhase.BULL_PHASE,
    turnHistory: [],
    roundNumber: 1,
    maxCards: 5,
    ...overrides,
  };
}

describe('mapAbstractToConcreteAction — bull sanity check', () => {
  it('overrides bull to true when bot has three of a kind matching the called hand', () => {
    const botCards: Card[] = [
      { rank: '9', suit: 'spades' },
      { rank: '9', suit: 'hearts' },
      { rank: '9', suit: 'diamonds' },
    ];
    const state = makeState({
      currentHand: { type: HandType.THREE_OF_A_KIND, rank: '9' },
    });

    const result = mapAbstractToConcreteAction(AbstractAction.BULL, state, botCards);
    expect(result.action).toBe('true');
  });

  it('overrides bull to true when bot has a pair matching the called hand', () => {
    const botCards: Card[] = [
      { rank: '7', suit: 'spades' },
      { rank: '7', suit: 'hearts' },
    ];
    const state = makeState({
      currentHand: { type: HandType.PAIR, rank: '7' },
    });

    const result = mapAbstractToConcreteAction(AbstractAction.BULL, state, botCards);
    expect(result.action).toBe('true');
  });

  it('overrides bull to true when bot has high card matching the called hand', () => {
    const botCards: Card[] = [
      { rank: 'A', suit: 'spades' },
    ];
    const state = makeState({
      currentHand: { type: HandType.HIGH_CARD, rank: 'A' },
    });

    const result = mapAbstractToConcreteAction(AbstractAction.BULL, state, botCards);
    expect(result.action).toBe('true');
  });

  it('overrides bull to true when bot has four of a kind matching the called hand', () => {
    const botCards: Card[] = [
      { rank: '2', suit: 'spades' },
      { rank: '2', suit: 'hearts' },
      { rank: '2', suit: 'diamonds' },
      { rank: '2', suit: 'clubs' },
    ];
    const state = makeState({
      currentHand: { type: HandType.FOUR_OF_A_KIND, rank: '2' },
    });

    const result = mapAbstractToConcreteAction(AbstractAction.BULL, state, botCards);
    expect(result.action).toBe('true');
  });

  it('allows bull when bot does NOT have the called hand', () => {
    const botCards: Card[] = [
      { rank: '9', suit: 'spades' },
      { rank: '3', suit: 'hearts' },
      { rank: 'K', suit: 'diamonds' },
    ];
    const state = makeState({
      currentHand: { type: HandType.THREE_OF_A_KIND, rank: '9' },
    });

    const result = mapAbstractToConcreteAction(AbstractAction.BULL, state, botCards);
    expect(result.action).toBe('bull');
  });

  it('allows bull when there is no current hand', () => {
    const botCards: Card[] = [
      { rank: '9', suit: 'spades' },
    ];
    const state = makeState({
      currentHand: null,
    });

    const result = mapAbstractToConcreteAction(AbstractAction.BULL, state, botCards);
    expect(result.action).toBe('bull');
  });

  it('overrides bull to true when bot has flush matching the called hand', () => {
    const botCards: Card[] = [
      { rank: '2', suit: 'hearts' },
      { rank: '5', suit: 'hearts' },
      { rank: '9', suit: 'hearts' },
      { rank: 'K', suit: 'hearts' },
      { rank: 'A', suit: 'hearts' },
    ];
    const state = makeState({
      currentHand: { type: HandType.FLUSH, suit: 'hearts' },
    });

    const result = mapAbstractToConcreteAction(AbstractAction.BULL, state, botCards);
    expect(result.action).toBe('true');
  });

  it('does not affect non-bull actions', () => {
    const botCards: Card[] = [
      { rank: '9', suit: 'spades' },
      { rank: '9', suit: 'hearts' },
      { rank: '9', suit: 'diamonds' },
    ];
    const state = makeState({
      currentHand: { type: HandType.THREE_OF_A_KIND, rank: '9' },
    });

    const trueResult = mapAbstractToConcreteAction(AbstractAction.TRUE, state, botCards);
    expect(trueResult.action).toBe('true');
  });
});
