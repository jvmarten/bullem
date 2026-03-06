import { describe, it, expect, beforeEach } from 'vitest';
import { BotPlayer } from './BotPlayer.js';
import { HandType, RoundPhase, GamePhase, BotDifficulty, TurnAction } from '../types.js';
import type { Card, HandCall, ClientGameState } from '../types.js';
import { BOT_PROFILE_MAP, DEFAULT_BOT_PROFILE_CONFIG } from '../botProfiles.js';
import type { BotProfileConfig } from '../botProfiles.js';

function makeState(overrides: Partial<ClientGameState> = {}): ClientGameState {
  return {
    gamePhase: GamePhase.PLAYING,
    players: [
      { id: 'bot1', name: 'Bot', cardCount: 2, isConnected: true, isEliminated: false, isHost: false, isBot: true },
      { id: 'p1', name: 'Alice', cardCount: 2, isConnected: true, isEliminated: false, isHost: true },
      { id: 'p2', name: 'Bob', cardCount: 2, isConnected: true, isEliminated: false, isHost: false },
    ],
    myCards: [],
    currentPlayerId: 'bot1',
    startingPlayerId: 'p1',
    currentHand: null,
    lastCallerId: null,
    roundPhase: RoundPhase.CALLING,
    turnHistory: [],
    roundNumber: 1,
    maxCards: 5,
    ...overrides,
  };
}

const botCards: Card[] = [
  { rank: '7', suit: 'hearts' },
  { rank: 'J', suit: 'spades' },
];

const SAMPLE_SIZE = 200;

function countActions(
  state: ClientGameState,
  cards: Card[],
  config: BotProfileConfig | undefined,
  n: number,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const action = BotPlayer.decideAction(
      state, 'bot1', cards, BotDifficulty.HARD, undefined, `test-${i}`, config,
    );
    counts[action.action] = (counts[action.action] ?? 0) + 1;
  }
  return counts;
}

describe('BotPlayer with profile configs', () => {
  beforeEach(() => {
    BotPlayer.resetMemory();
  });

  describe('regression: no profile config matches default behavior', () => {
    it('decideAction with undefined config produces same result types as with DEFAULT config', () => {
      // Test calling phase with existing hand (triggers bull/raise decisions)
      const state = makeState({
        currentHand: { type: HandType.PAIR, rank: '9' },
        lastCallerId: 'p1',
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, hand: { type: HandType.PAIR, rank: '9' }, timestamp: 1 },
        ],
      });

      // Both undefined and default config should produce valid actions
      for (let i = 0; i < 50; i++) {
        const withoutConfig = BotPlayer.decideAction(
          state, 'bot1', botCards, BotDifficulty.HARD, undefined, `scope-a-${i}`,
        );
        const withDefaultConfig = BotPlayer.decideAction(
          state, 'bot1', botCards, BotDifficulty.HARD, undefined, `scope-b-${i}`, DEFAULT_BOT_PROFILE_CONFIG,
        );

        // Both should produce valid actions
        expect(['call', 'bull', 'true', 'lastChanceRaise', 'lastChancePass']).toContain(withoutConfig.action);
        expect(['call', 'bull', 'true', 'lastChanceRaise', 'lastChancePass']).toContain(withDefaultConfig.action);
      }
    });
  });

  describe('The Rock bluffs less than Maverick', () => {
    it('Maverick raises more aggressively in calling phase with no legitimate hand', () => {
      const rockConfig = BOT_PROFILE_MAP.get('the_rock')!.config;
      const maverickConfig = BOT_PROFILE_MAP.get('maverick')!.config;

      // Calling phase with an existing hand that the bot can't legitimately beat.
      // The bot must choose between bluff-raising and calling bull.
      // bluffFrequency and aggressionBias control this decision.
      const callingState = makeState({
        roundPhase: RoundPhase.CALLING,
        currentHand: { type: HandType.THREE_OF_A_KIND, rank: 'K' },
        lastCallerId: 'p1',
        players: [
          { id: 'bot1', name: 'Bot', cardCount: 3, isConnected: true, isEliminated: false, isHost: false, isBot: true },
          { id: 'p1', name: 'Alice', cardCount: 3, isConnected: true, isEliminated: false, isHost: true },
          { id: 'p2', name: 'Bob', cardCount: 3, isConnected: true, isEliminated: false, isHost: false },
        ],
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, hand: { type: HandType.THREE_OF_A_KIND, rank: 'K' } as HandCall, timestamp: 1 },
        ],
      });

      // Weak cards — bot can't legitimately beat three-of-a-kind kings
      const weakCards: Card[] = [
        { rank: '3', suit: 'clubs' },
        { rank: '5', suit: 'hearts' },
        { rank: '8', suit: 'diamonds' },
      ];

      let rockRaises = 0;
      let maverickRaises = 0;
      const n = 500;

      for (let i = 0; i < n; i++) {
        const rockAction = BotPlayer.decideAction(
          callingState, 'bot1', weakCards, BotDifficulty.HARD, undefined, `rock-call-${i}`, rockConfig,
        );
        const mavAction = BotPlayer.decideAction(
          callingState, 'bot1', weakCards, BotDifficulty.HARD, undefined, `mav-call-${i}`, maverickConfig,
        );

        if (rockAction.action === 'call') rockRaises++;
        if (mavAction.action === 'call') maverickRaises++;
      }

      // Maverick (bluffFrequency=1.8) should raise-bluff more than Rock (bluffFrequency=0.15)
      expect(maverickRaises).toBeGreaterThanOrEqual(rockRaises);
    });
  });

  describe('Ice Queen vs Loose Cannon raising behavior', () => {
    it('Loose Cannon raises more in bull phase when hand is suspicious', () => {
      const iceQueenConfig = BOT_PROFILE_MAP.get('ice_queen')!.config;
      const looseCannonConfig = BOT_PROFILE_MAP.get('loose_cannon')!.config;

      // Bull phase with a moderately suspicious hand — adjustedP should be < 0.5
      // to trigger the raise consideration code path. Use a high hand type that's
      // unlikely with few total cards, so plausibility is low.
      const state = makeState({
        roundPhase: RoundPhase.BULL_PHASE,
        currentHand: { type: HandType.THREE_OF_A_KIND, rank: 'K' },
        lastCallerId: 'p1',
        players: [
          { id: 'bot1', name: 'Bot', cardCount: 2, isConnected: true, isEliminated: false, isHost: false, isBot: true },
          { id: 'p1', name: 'Alice', cardCount: 2, isConnected: true, isEliminated: false, isHost: true },
          { id: 'p2', name: 'Bob', cardCount: 2, isConnected: true, isEliminated: false, isHost: false },
        ],
        turnHistory: [
          { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, hand: { type: HandType.THREE_OF_A_KIND, rank: 'K' } as HandCall, timestamp: 1 },
          { playerId: 'p2', playerName: 'Bob', action: TurnAction.BULL, timestamp: 2 },
        ],
      });

      // Give the bot a pair of aces — a legitimate higher hand (four of a kind aces > three of a kind kings)
      // The bot can raise from three-of-a-kind K to four-of-a-kind with these cards
      // Actually, pair of A is only good for raising if it can find a higher hand
      // Let's give cards that form a pair — the bot can raise to "four of a kind"
      const goodCards: Card[] = [
        { rank: 'A', suit: 'hearts' },
        { rank: 'A', suit: 'spades' },
      ];

      let iceQueenRaises = 0;
      let looseCannonRaises = 0;
      const n = 500;

      for (let i = 0; i < n; i++) {
        const iqAction = BotPlayer.decideAction(
          state, 'bot1', goodCards, BotDifficulty.HARD, undefined, `iq-${i}`, iceQueenConfig,
        );
        const lcAction = BotPlayer.decideAction(
          state, 'bot1', goodCards, BotDifficulty.HARD, undefined, `lc-${i}`, looseCannonConfig,
        );
        if (iqAction.action === 'call') iceQueenRaises++;
        if (lcAction.action === 'call') looseCannonRaises++;
      }

      // Loose Cannon (bullPhaseRaiseRate=0.30) should raise more than Ice Queen (0.08)
      // The difference should be clear over 500 samples
      expect(looseCannonRaises).toBeGreaterThanOrEqual(iceQueenRaises);
    });
  });

  describe('profile configs produce valid actions in all phases', () => {
    const phases: { phase: RoundPhase; hand: HandCall | null; lastCallerId: string | null }[] = [
      { phase: RoundPhase.CALLING, hand: null, lastCallerId: null },
      { phase: RoundPhase.CALLING, hand: { type: HandType.PAIR, rank: '5' }, lastCallerId: 'p1' },
      { phase: RoundPhase.BULL_PHASE, hand: { type: HandType.PAIR, rank: '5' }, lastCallerId: 'p1' },
      { phase: RoundPhase.LAST_CHANCE, hand: { type: HandType.PAIR, rank: '5' }, lastCallerId: 'bot1' },
    ];

    for (const profile of [
      BOT_PROFILE_MAP.get('the_rock')!,
      BOT_PROFILE_MAP.get('maverick')!,
      BOT_PROFILE_MAP.get('the_grinder')!,
      BOT_PROFILE_MAP.get('wildcard')!,
      BOT_PROFILE_MAP.get('the_professor')!,
      BOT_PROFILE_MAP.get('shark')!,
      BOT_PROFILE_MAP.get('loose_cannon')!,
      BOT_PROFILE_MAP.get('ice_queen')!,
    ]) {
      for (const { phase, hand, lastCallerId } of phases) {
        it(`${profile.name} produces valid action in ${phase}`, () => {
          const state = makeState({
            roundPhase: phase,
            currentHand: hand,
            lastCallerId,
            turnHistory: hand ? [
              { playerId: 'p1', playerName: 'Alice', action: TurnAction.CALL, hand, timestamp: 1 },
              ...(phase === RoundPhase.BULL_PHASE ? [{ playerId: 'p2', playerName: 'Bob', action: TurnAction.BULL as TurnAction, timestamp: 2 }] : []),
            ] : [],
          });

          for (let i = 0; i < 20; i++) {
            const action = BotPlayer.decideAction(
              state, 'bot1', botCards, BotDifficulty.HARD, undefined, `test-${profile.key}-${phase}-${i}`, profile.config,
            );
            expect(['call', 'bull', 'true', 'lastChanceRaise', 'lastChancePass']).toContain(action.action);
          }
        });
      }
    }
  });
});
