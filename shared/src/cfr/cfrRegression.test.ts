import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decideCFR, decideCFRWithSearch, setCFRStrategyData } from './cfrEval.js';
import { mapAbstractToConcreteAction } from './actionMapper.js';
import { AbstractAction } from './infoSet.js';
import { HandType, RoundPhase, GamePhase, TurnAction } from '../types.js';
import type { Card, ClientGameState, Player, TurnEntry } from '../types.js';
import { RANK_VALUES } from '../constants.js';

// Load strategy data from the JSON static asset before tests run.
beforeAll(() => {
  const jsonPath = path.resolve(import.meta.dirname, '../../../client/public/data/cfr-strategy.json');
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  setCFRStrategyData(JSON.parse(raw));
});

// ── Helpers ─────────────────────────────────────────────────────────

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

function makePlayer(id: string, cardCount: number): Player {
  return {
    id,
    name: id.toUpperCase(),
    cardCount,
    isConnected: true,
    isEliminated: false,
    isHost: false,
  };
}

function makeState(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    gamePhase: GamePhase.PLAYING,
    roundPhase: RoundPhase.CALLING,
    roundNumber: 1,
    maxCards: 5,
    players: [
      makePlayer('p1', 1),
      makePlayer('p2', 1),
    ],
    myCards: [card('A', 'spades')],
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

// ── Regression tests derived from replay 8246ba18 ───────────────────

describe('CFR regression tests', () => {
  it('should call bull on implausible claims with few cards', () => {
    // Scenario: 6 total cards (round 1), current claim is PAIR.
    // Bot holds [8h] — no matching card for a pair.
    // With only 6 cards, a pair is unlikely.
    const state = makeState({
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.PAIR, rank: '7' },
      lastCallerId: 'p2',
      players: [
        makePlayer('p1', 1),
        makePlayer('p2', 1),
        makePlayer('p3', 1),
        makePlayer('p4', 1),
        makePlayer('p5', 1),
        makePlayer('p6', 1),
      ],
    });
    const botCards = [card('8', 'hearts')];

    const N = 200;
    let bullCount = 0;
    for (let i = 0; i < N; i++) {
      const result = decideCFR(state, botCards, 6, 6);
      if (result?.action === 'bull') bullCount++;
    }

    // Bull should be chosen >25% — pair is unlikely with only 6 cards
    // and the bot doesn't hold a matching card. A degenerate CFR would
    // almost never call bull here.
    expect(bullCount).toBeGreaterThan(N * 0.25);
  });

  it('should not raise to full house with only 10 total cards', () => {
    // Scenario: 10 total cards, current claim is PAIR rank=J.
    // Bot holds [Jc, 4c]. CALLING phase with 4 active players.
    const state = makeState({
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.PAIR, rank: 'J' },
      lastCallerId: 'p2',
      players: [
        makePlayer('p1', 2),
        makePlayer('p2', 3),
        makePlayer('p3', 3),
        makePlayer('p4', 2),
      ],
    });
    const botCards = [card('J', 'clubs'), card('4', 'clubs')];

    const N = 200;
    let fullHouseOrHigherCount = 0;
    for (let i = 0; i < N; i++) {
      const result = decideCFR(state, botCards, 10, 4);
      if (result?.action === 'call' && result.hand.type >= HandType.FULL_HOUSE) {
        fullHouseOrHigherCount++;
      }
    }

    // Full house or higher should be <10% — needs 5 specific cards
    // from only 10 total.
    expect(fullHouseOrHigherCount).toBeLessThan(N * 0.1);
  });

  it('should prefer lastChancePass over raising when claim is already high', () => {
    // Scenario: LAST_CHANCE phase, current claim is STRAIGHT highRank=A.
    // 15 total cards. Bot holds [3h, 4h, Ad, Ks].
    // Bot is the one who made the claim (lastCallerId matches).
    const state = makeState({
      roundPhase: RoundPhase.LAST_CHANCE,
      currentHand: { type: HandType.STRAIGHT, highRank: 'A' },
      lastCallerId: 'p1',
      currentPlayerId: 'p1',
      players: [
        makePlayer('p1', 4),
        makePlayer('p2', 4),
        makePlayer('p3', 4),
        makePlayer('p4', 3),
      ],
    });
    const botCards = [card('3', 'hearts'), card('4', 'hearts'), card('A', 'diamonds'), card('K', 'spades')];

    const N = 200;
    let passCount = 0;
    for (let i = 0; i < N; i++) {
      const result = decideCFR(state, botCards, 15, 4);
      if (result?.action === 'lastChancePass') passCount++;
    }

    // lastChancePass should be chosen >30% — raising above a straight
    // with 15 cards leads to implausible territory. A degenerate CFR
    // would always try to raise, producing near-zero pass rate.
    expect(passCount).toBeGreaterThan(N * 0.3);
  });

  it('should not cascade true calls on implausible hands in multiplayer', () => {
    // Scenario: BULL_PHASE, 6 active players, 14 total cards.
    // Current claim is FLUSH suit=diamonds.
    // Bot holds [9s, As] — no diamonds at all.
    // Turn history shows 2 prior players called "true".
    const trueHistory: TurnEntry[] = [
      { playerId: 'p3', playerName: 'P3', action: TurnAction.CALL, hand: { type: HandType.FLUSH, suit: 'diamonds' }, timestamp: 1000 },
      { playerId: 'p4', playerName: 'P4', action: TurnAction.BULL, timestamp: 2000 },
      { playerId: 'p5', playerName: 'P5', action: TurnAction.TRUE, timestamp: 3000 },
      { playerId: 'p6', playerName: 'P6', action: TurnAction.TRUE, timestamp: 4000 },
    ];

    const state = makeState({
      roundPhase: RoundPhase.BULL_PHASE,
      currentHand: { type: HandType.FLUSH, suit: 'diamonds' },
      lastCallerId: 'p3',
      currentPlayerId: 'p1',
      turnHistory: trueHistory,
      players: [
        makePlayer('p1', 2),
        makePlayer('p2', 2),
        makePlayer('p3', 3),
        makePlayer('p4', 2),
        makePlayer('p5', 3),
        makePlayer('p6', 2),
      ],
    });
    const botCards = [card('9', 'spades'), card('A', 'spades')];

    const N = 200;
    let bullCount = 0;
    for (let i = 0; i < N; i++) {
      const result = decideCFR(state, botCards, 14, 6);
      if (result?.action === 'bull') bullCount++;
    }

    // Bull should be chosen >25% — bot holds no diamonds, flush is
    // unlikely with 14 cards, should not blindly follow true cascade.
    // A degenerate CFR would cascade true calls with near-zero bull rate.
    expect(bullCount).toBeGreaterThan(N * 0.25);
  });

  it('should almost always call bull when own cards disprove the claim', () => {
    // Scenario: CALLING phase, current claim is FOUR_OF_A_KIND rank=K.
    // Bot holds [Ks, Kh, Kd, 2c, 3c] — 3 of the 4 kings.
    // 20 total cards, 4 players. Only 1 king remains among 15 unknown
    // cards — four kings is nearly impossible.
    const state = makeState({
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.FOUR_OF_A_KIND, rank: 'K' },
      lastCallerId: 'p2',
      currentPlayerId: 'p1',
      players: [
        makePlayer('p1', 5),
        makePlayer('p2', 5),
        makePlayer('p3', 5),
        makePlayer('p4', 5),
      ],
    });
    const botCards = [
      card('K', 'spades'), card('K', 'hearts'), card('K', 'diamonds'),
      card('2', 'clubs'), card('3', 'clubs'),
    ];

    const N = 200;
    let bullCount = 0;
    for (let i = 0; i < N; i++) {
      const result = decideCFR(state, botCards, 20, 4);
      if (result?.action === 'bull') bullCount++;
    }

    // Bull should be chosen >80% — bot holds 3 of the 4 kings,
    // making four-of-a-kind nearly impossible.
    expect(bullCount).toBeGreaterThan(N * 0.8);
  });

  it('should not raise to four of a kind with 18 total cards', () => {
    // Scenario: CALLING phase, current claim is STRAIGHT highRank=K.
    // 18 total cards, bot holds [Kh, 3s, 7h, Ac], 5 active players.
    const state = makeState({
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.STRAIGHT, highRank: 'K' },
      lastCallerId: 'p2',
      currentPlayerId: 'p1',
      players: [
        makePlayer('p1', 4),
        makePlayer('p2', 4),
        makePlayer('p3', 4),
        makePlayer('p4', 3),
        makePlayer('p5', 3),
      ],
    });
    const botCards = [card('K', 'hearts'), card('3', 'spades'), card('7', 'hearts'), card('A', 'clubs')];

    const N = 200;
    let fourOfAKindOrHigherCount = 0;
    for (let i = 0; i < N; i++) {
      const result = decideCFR(state, botCards, 18, 5);
      if (result?.action === 'call' && result.hand.type >= HandType.FOUR_OF_A_KIND) {
        fourOfAKindOrHigherCount++;
      }
    }

    // Four of a kind or higher should be <35% — implausible with 18
    // cards divided among 5 players. A degenerate CFR would raise to
    // four-of-a-kind 50%+ of the time.
    expect(fourOfAKindOrHigherCount).toBeLessThan(N * 0.35);
  });

  it('bluff full house should not use very low ranks (2s/3s)', () => {
    // Tests the action mapper directly — verifies that BLUFF_SMALL
    // doesn't produce degenerate low-low full houses.
    const state = makeState({
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.STRAIGHT, highRank: '8' },
      lastCallerId: 'p2',
      currentPlayerId: 'p1',
      players: [
        makePlayer('p1', 3),
        makePlayer('p2', 4),
        makePlayer('p3', 4),
        makePlayer('p4', 4),
      ],
    });
    const botCards = [card('9', 'hearts'), card('J', 'diamonds'), card('5', 'clubs')];

    const N = 200;
    let lowLowFullHouseCount = 0;
    let fullHouseCount = 0;
    for (let i = 0; i < N; i++) {
      const result = mapAbstractToConcreteAction(AbstractAction.BLUFF_SMALL, state, botCards, 15);
      if (result.action === 'call' && result.hand.type === HandType.FULL_HOUSE) {
        fullHouseCount++;
        const hand = result.hand as { type: HandType.FULL_HOUSE; threeRank: string; twoRank: string };
        const threeVal = RANK_VALUES[hand.threeRank as Card['rank']];
        const twoVal = RANK_VALUES[hand.twoRank as Card['rank']];
        if (threeVal <= 5 && twoVal <= 5) {
          lowLowFullHouseCount++;
        }
      }
    }

    // The degenerate low-low full house pattern (both ranks <= 5)
    // should appear <20% of the time among full house results.
    // If no full houses were generated, the test passes trivially
    // (no degenerate pattern possible).
    if (fullHouseCount > 0) {
      expect(lowLowFullHouseCount).toBeLessThan(fullHouseCount * 0.2);
    }
  });
});
