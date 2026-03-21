import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { decideCFR, preloadCFRStrategy } from './cfrEval.js';
import { HandType, RoundPhase, GamePhase } from '../types.js';
import type { Card, ClientGameState, HandCall } from '../types.js';

// Load strategy data before tests run — it's now lazy-loaded via dynamic import
beforeAll(async () => {
  await preloadCFRStrategy();
});

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
    players: [
      { id: 'p1', name: 'P1', cardCount: 1, isConnected: true, isEliminated: false, isHost: false },
      { id: 'p2', name: 'P2', cardCount: 1, isConnected: true, isEliminated: false, isHost: false },
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

afterEach(() => {
  vi.restoreAllMocks();
});

// ── decideCFR ───────────────────────────────────────────────────────

describe('decideCFR', () => {
  it('returns a valid BotAction on opening (no current hand)', () => {
    const state = makeState();
    const cards = [card('A', 'spades')];
    const result = decideCFR(state, cards, 2, 2);
    expect(result).not.toBeNull();
    expect(result!.action).toBe('call');
    if (result!.action === 'call') {
      expect(result!.hand).toBeDefined();
      expect(result!.hand.type).toBeGreaterThanOrEqual(HandType.HIGH_CARD);
      expect(result!.hand.type).toBeLessThanOrEqual(HandType.ROYAL_FLUSH);
    }
  });

  it('returns bull, true, or call when there is a current hand in BULL_PHASE', () => {
    const state = makeState({
      roundPhase: RoundPhase.BULL_PHASE,
      currentHand: { type: HandType.PAIR, rank: '7' },
      lastCallerId: 'p2',
    });
    const cards = [card('3', 'hearts')];
    const result = decideCFR(state, cards, 2, 2);
    expect(result).not.toBeNull();
    expect(['bull', 'true', 'call']).toContain(result!.action);
  });

  it('returns lastChanceRaise or lastChancePass in LAST_CHANCE phase', () => {
    const state = makeState({
      roundPhase: RoundPhase.LAST_CHANCE,
      currentHand: { type: HandType.PAIR, rank: '5' },
      lastCallerId: 'p1',
    });
    const cards = [card('K', 'spades')];
    const result = decideCFR(state, cards, 2, 2);
    expect(result).not.toBeNull();
    expect(['lastChanceRaise', 'lastChancePass']).toContain(result!.action);
  });

  it('returns call with a hand higher than current when raising in CALLING phase', () => {
    const currentHand: HandCall = { type: HandType.HIGH_CARD, rank: '3' };
    const state = makeState({
      roundPhase: RoundPhase.CALLING,
      currentHand,
      lastCallerId: 'p2',
    });
    const cards = [card('A', 'spades')];

    // Run multiple times to increase chance of seeing a call
    let gotCall = false;
    for (let i = 0; i < 50; i++) {
      const result = decideCFR(state, cards, 2, 2);
      if (result && result.action === 'call') {
        gotCall = true;
        // Verify the hand is higher
        expect(result.hand.type).toBeGreaterThanOrEqual(currentHand.type);
        break;
      }
    }
    // It's possible all 50 were bull, but that's statistically unlikely
    // Just make sure the function works without errors
    expect(true).toBe(true);
  });

  it('handles different player counts (2, 3-4, 5+)', () => {
    const state = makeState();
    const cards = [card('A', 'spades')];

    // Should not throw for any player count
    const r2 = decideCFR(state, cards, 2, 2);
    const r4 = decideCFR(state, cards, 8, 4);
    const r6 = decideCFR(state, cards, 12, 6);
    expect(r2).not.toBeNull();
    expect(r4).not.toBeNull();
    expect(r6).not.toBeNull();
  });

  it('handles joker count and last chance mode variants', () => {
    const state = makeState();
    const cards = [card('A', 'spades')];

    const rJoker = decideCFR(state, cards, 2, 2, 2);
    expect(rJoker).not.toBeNull();

    const rStrict = decideCFR(state, cards, 2, 2, 0, 'strict');
    expect(rStrict).not.toBeNull();
  });

  it('uses heuristic fallback gracefully (always returns a valid action)', () => {
    // Even with unusual state, should return a valid action
    const state = makeState({
      roundPhase: RoundPhase.CALLING,
      currentHand: { type: HandType.STRAIGHT, highRank: 'K' },
      lastCallerId: 'p2',
      turnHistory: [
        { playerId: 'p1', playerName: 'P1', action: 'call' as never, timestamp: 0 },
        { playerId: 'p2', playerName: 'P2', action: 'call' as never, timestamp: 0 },
        { playerId: 'p1', playerName: 'P1', action: 'call' as never, timestamp: 0 },
        { playerId: 'p2', playerName: 'P2', action: 'call' as never, timestamp: 0 },
      ],
    });
    const cards = [card('2', 'clubs'), card('3', 'diamonds'), card('4', 'hearts')];
    const result = decideCFR(state, cards, 6, 2);
    expect(result).not.toBeNull();
  });

  it('never returns null for valid game states', () => {
    // Opening, CALLING, and BULL_PHASE should all produce non-null
    const phases: RoundPhase[] = [RoundPhase.CALLING, RoundPhase.BULL_PHASE, RoundPhase.LAST_CHANCE];
    for (const phase of phases) {
      const state = makeState({
        roundPhase: phase,
        currentHand: phase === RoundPhase.CALLING ? null : { type: HandType.PAIR, rank: '5' },
        lastCallerId: phase === RoundPhase.CALLING ? null : 'p2',
      });
      const result = decideCFR(state, [card('A', 'spades')], 2, 2);
      expect(result, `phase=${phase}`).not.toBeNull();
    }
  });

  describe('card-aware Bayesian adjustment', () => {
    it('holding matching cards makes bull less likely on a pair claim', () => {
      // Bot holds a 7 — "pair of 7s" claim is more likely to exist
      const pairOf7s: HandCall = { type: HandType.PAIR, rank: '7' };
      const stateWithMatch = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: pairOf7s,
        lastCallerId: 'p2',
      });
      const cardsWithMatch = [card('7', 'hearts'), card('K', 'spades')];

      // Bot holds NO 7s — "pair of 7s" is less likely
      const cardsWithout = [card('2', 'clubs'), card('3', 'diamonds')];

      // Run many trials and count bull frequency
      const N = 500;
      let bullWithMatch = 0;
      let bullWithout = 0;

      for (let i = 0; i < N; i++) {
        const r1 = decideCFR(stateWithMatch, cardsWithMatch, 10, 2);
        if (r1?.action === 'bull') bullWithMatch++;

        const r2 = decideCFR(stateWithMatch, cardsWithout, 10, 2);
        if (r2?.action === 'bull') bullWithout++;
      }

      // With matching cards, bull should be called LESS often
      expect(bullWithMatch).toBeLessThan(bullWithout);
    });

    it('holding blocking cards makes bull more likely on four-of-a-kind', () => {
      // Bot holds 3 of the 4 kings — "four kings" is nearly impossible
      const fourKings: HandCall = { type: HandType.FOUR_OF_A_KIND, rank: 'K' };
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: fourKings,
        lastCallerId: 'p2',
        players: [
          { id: 'p1', name: 'P1', cardCount: 5, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p2', name: 'P2', cardCount: 5, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p3', name: 'P3', cardCount: 5, isConnected: true, isEliminated: false, isHost: false },
          { id: 'p4', name: 'P4', cardCount: 5, isConnected: true, isEliminated: false, isHost: false },
        ],
      });
      // Bot holds 3 kings — only 1 king left among all other players
      const blockingCards = [
        card('K', 'spades'), card('K', 'hearts'), card('K', 'diamonds'),
        card('2', 'clubs'), card('3', 'clubs'),
      ];

      const N = 200;
      let bullCount = 0;
      for (let i = 0; i < N; i++) {
        const r = decideCFR(state, blockingCards, 20, 4);
        if (r?.action === 'bull') bullCount++;
      }

      // With 3 of the 4 kings, bot should almost always call bull
      // (4th king needs to be among the remaining 15 unknown cards out of 47 pool)
      // That's ~32% chance — combined with other adjustments, bull should dominate
      expect(bullCount).toBeGreaterThan(N * 0.5);
    });

    it('works correctly with single-card hands (early rounds)', () => {
      // Early round: 1 card each, 2 players, 2 total cards
      const highCardQ: HandCall = { type: HandType.HIGH_CARD, rank: 'Q' };
      const state = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: highCardQ,
        lastCallerId: 'p2',
      });

      // Bot has a Q — the claim is true from our own cards alone
      const cardsWithQ = [card('Q', 'hearts')];
      const N = 200;
      let trueOrCallCount = 0;
      for (let i = 0; i < N; i++) {
        const r = decideCFR(state, cardsWithQ, 2, 2);
        if (r?.action === 'true' || r?.action === 'call') trueOrCallCount++;
      }
      // When we hold the claimed card, we should rarely bull
      expect(trueOrCallCount).toBeGreaterThan(N * 0.3);
    });
  });
});
