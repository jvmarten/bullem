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

describe('mapAbstractToConcreteAction — escalation spiral prevention', () => {
  it('converts truthful raise to bull when no candidates beat Full House (no degenerate same-type min-raise)', () => {
    // Regression: CFR bots with weak cards would fall back to getMinimumRaise(),
    // producing Full House 2s over 5s → 2s over 6s → ... endlessly.
    const botCards: Card[] = [
      { rank: '9', suit: 'clubs' },
      { rank: '4', suit: 'spades' },
    ];
    const state = makeState({
      currentHand: { type: HandType.FULL_HOUSE, threeRank: '2', twoRank: '4' },
    });

    // With 32 total cards (8 players × 4 cards), all types are plausible.
    // The bot should NOT produce a degenerate "Full House, 2s over 5s" raise.
    for (const action of [AbstractAction.TRUTHFUL_LOW, AbstractAction.TRUTHFUL_MID, AbstractAction.TRUTHFUL_HIGH]) {
      const result = mapAbstractToConcreteAction(action, state, botCards, 32);
      // Should be bull (no valid truthful candidates), NOT a same-type min-raise
      expect(result.action).toBe('bull');
    }
  });

  it('converts bluff raise to bull when no bluff can be generated above Full House within plausibility cap', () => {
    const botCards: Card[] = [
      { rank: '3', suit: 'hearts' },
      { rank: '7', suit: 'diamonds' },
    ];
    // Current call is already at Four of a Kind — bluffs need Straight Flush+
    const state = makeState({
      currentHand: { type: HandType.FOUR_OF_A_KIND, rank: 'A' },
    });

    // With only 10 total cards, maxPlausible is Straight (type 5).
    // Four of a Kind (type 7) > Straight (type 5), so the plausibility ceiling
    // check in adjustStrategyForPlausibility should already kill raises.
    // But even without that, the bluff generator should return null when
    // it can't produce anything above Four of a Kind of Aces within cap.
    const result = mapAbstractToConcreteAction(AbstractAction.BLUFF_SMALL, state, botCards, 10);
    expect(result.action).toBe('bull');
  });

  it('still allows cross-type minimum raises when appropriate', () => {
    const botCards: Card[] = [
      { rank: '5', suit: 'spades' },
    ];
    // Pair of Aces — minimum raise jumps to Two Pair (different type)
    const state = makeState({
      currentHand: { type: HandType.PAIR, rank: 'A' },
    });

    const result = mapAbstractToConcreteAction(AbstractAction.TRUTHFUL_LOW, state, botCards, 20);
    // Should produce a raise (Two Pair or higher), not bull
    expect(result.action).toBe('call');
    if (result.action === 'call') {
      expect(result.hand.type).toBeGreaterThan(HandType.PAIR);
    }
  });
});
