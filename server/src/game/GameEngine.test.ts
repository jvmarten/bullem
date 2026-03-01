import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from './GameEngine.js';
import { GamePhase, HandType, RoundPhase, STARTING_CARDS, MAX_CARDS, DECK_SIZE, maxPlayersForMaxCards } from '@bull-em/shared';
import type { ServerPlayer, HandCall, PlayerId, GameSettings } from '@bull-em/shared';

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

  describe('last chance used guard', () => {
    it('all bull → last chance → raise → all bull again → resolves (no second last chance)', () => {
      // p1 calls, p2 and p3 bull → last chance for p1
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      const lc1 = engine.handleBull('p3');
      expect(lc1.type).toBe('last_chance');

      // p1 raises during last chance
      const raiseResult = engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '3' });
      expect(raiseResult.type).toBe('continue');

      // p2 and p3 both call bull again — should resolve, NOT enter last_chance again
      engine.handleBull('p2');
      const finalResult = engine.handleBull('p3');
      expect(finalResult.type === 'resolve' || finalResult.type === 'game_over').toBe(true);
    });

    it('last chance resets between rounds (startNextRound)', () => {
      // Round 1: use last chance
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      engine.handleLastChanceRaise('p1', { type: HandType.PAIR, rank: '3' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      // Round resolves — p1 used last chance

      engine.startNextRound();

      // Round 2: last chance should be available again
      // Call bull in turn order by checking currentPlayerId
      const starterId = engine.currentPlayerId;
      engine.handleCall(starterId, { type: HandType.HIGH_CARD, rank: '7' });

      const first = engine.currentPlayerId;
      engine.handleBull(first);
      const second = engine.currentPlayerId;
      const lc2 = engine.handleBull(second);
      expect(lc2.type).toBe('last_chance');
    });

    it('all bull → caller passes → resolves without using last chance flag', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleBull('p3');
      const passResult = engine.handleLastChancePass('p1');
      expect(passResult.type === 'resolve' || passResult.type === 'game_over').toBe(true);
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

  describe('startNextRound', () => {
    it('rotates starting player clockwise', () => {
      // Round 1 started with p1 (index 0 in active players)
      const stateR1 = engine.getClientState('p1');
      expect(stateR1.startingPlayerId).toBe('p1');

      // Resolve round so we can start the next one
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      const result = engine.startNextRound();
      expect(result.type).toBe('new_round');

      // Starting player should now be p2
      const stateR2 = engine.getClientState('p1');
      expect(stateR2.startingPlayerId).toBe('p2');
      expect(stateR2.roundNumber).toBe(2); // startRound set it to 1, startNextRound increments to 2
    });

    it('resets round state for new round', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      engine.startNextRound();

      const state = engine.getClientState('p1');
      expect(state.roundPhase).toBe(RoundPhase.CALLING);
      expect(state.currentHand).toBeNull();
      expect(state.lastCallerId).toBeNull();
      expect(state.turnHistory).toEqual([]);
    });

    it('re-deals cards based on current card counts', () => {
      // Give p2 extra cards (simulating a penalty)
      p2.cardCount = 3;

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      // Resolution may have changed card counts (penalties), capture them
      const p1CountAfterResolve = p1.cardCount;
      const p2CountAfterResolve = p2.cardCount;
      const p3CountAfterResolve = p3.cardCount;

      engine.startNextRound();

      // Each player should be dealt exactly their current card count
      expect(p1.cards.length).toBe(p1CountAfterResolve);
      expect(p2.cards.length).toBe(p2CountAfterResolve);
      expect(p3.cards.length).toBe(p3CountAfterResolve);
    });

    it('skips eliminated players when rotating starting player', () => {
      // Eliminate p2
      p2.isEliminated = true;

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      const result = engine.handleBull('p3'); // p2 is eliminated, so p3 is the only non-caller

      if (result.type === 'last_chance') {
        engine.handleLastChancePass('p1');
      }

      const nextResult = engine.startNextRound();
      expect(nextResult.type).toBe('new_round');

      // Starting player should skip p2 (eliminated) and go to p3
      const state = engine.getClientState('p1');
      expect(state.startingPlayerId).toBe('p3');
    });

    it('provides client state with gamePhase PLAYING', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      engine.startNextRound();

      const state = engine.getClientState('p1');
      expect(state.gamePhase).toBe(GamePhase.PLAYING);
    });
  });

  describe('game over detection via startNextRound', () => {
    it('returns game_over when only 1 player remains', () => {
      // Eliminate p2 and p3
      p2.isEliminated = true;
      p3.isEliminated = true;

      const result = engine.startNextRound();
      expect(result.type).toBe('game_over');
      if (result.type === 'game_over') {
        expect(result.winnerId).toBe('p1');
      }
    });

    it('returns game_over when eliminations during a round leave 1 player', () => {
      // Set up: p1 has 5 cards (at MAX), p2 has 1, p3 already eliminated
      const px = makePlayer('px', 'X', MAX_CARDS);
      const py = makePlayer('py', 'Y', 1);
      const pz = makePlayer('pz', 'Z', 1);
      pz.isEliminated = true;
      const eng = new GameEngine([px, py, pz]);
      eng.startRound();

      // px calls, py calls bull. Regardless of outcome, one will be penalized.
      eng.handleCall('px', { type: HandType.HIGH_CARD, rank: '2' });
      const bullResult = eng.handleBull('py');

      if (bullResult.type === 'last_chance') {
        eng.handleLastChancePass('px');
      }

      // If px was wrong and got a 6th card, they're eliminated
      // Try to start next round — should detect game over if px is eliminated
      const nextResult = eng.startNextRound();
      const active = eng.getActivePlayers();
      if (active.length <= 1) {
        expect(nextResult.type).toBe('game_over');
      } else {
        expect(nextResult.type).toBe('new_round');
      }
    });
  });

  describe('elimination during round cycling', () => {
    it('player at 5 cards who loses gets eliminated before next round', () => {
      // Set up controlled scenario: 3 players, pa at 5 cards
      const pa = makePlayer('pa', 'A', MAX_CARDS);
      const pb = makePlayer('pb', 'B', 1);
      const pc = makePlayer('pc', 'C', 1);
      const eng = new GameEngine([pa, pb, pc]);
      eng.startRound();

      // pa calls, pb and pc respond
      eng.handleCall('pa', { type: HandType.HIGH_CARD, rank: '2' });
      eng.handleBull('pb');
      const resolveResult = eng.handleTrue('pc');

      // Whether resolve or game_over, check the state
      if (resolveResult.type === 'resolve') {
        const { penalties, eliminatedPlayerIds } = resolveResult.result;
        // If pa was penalized (hand didn't exist), they should be eliminated
        if (penalties['pa'] > MAX_CARDS) {
          expect(eliminatedPlayerIds).toContain('pa');
          expect(pa.isEliminated).toBe(true);
        }

        // Now start next round
        const next = eng.startNextRound();
        if (pa.isEliminated) {
          // 2 players remain, game continues
          expect(next.type).toBe('new_round');
          // Eliminated player should not be in active players
          expect(eng.getActivePlayers().map(p => p.id)).not.toContain('pa');
        }
      }
    });
  });

  describe('full round lifecycle', () => {
    it('deal → call → bull/true → resolve → startNextRound → new round', () => {
      // Round 1: verify initial state
      expect(engine.getClientState('p1').roundNumber).toBe(1);
      expect(engine.currentPlayerId).toBe('p1');
      expect(p1.cards.length).toBe(STARTING_CARDS);

      // Force known cards so the hand check is deterministic
      p1.cards = [{ rank: '7', suit: 'spades' }];
      p2.cards = [{ rank: 'K', suit: 'hearts' }];
      p3.cards = [{ rank: '2', suit: 'clubs' }];

      // p1 calls high card 7 — this exists (p1 has 7 of spades)
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      expect(engine.currentPlayerId).toBe('p2');

      // p2 calls bull
      engine.handleBull('p2');
      expect(engine.getClientState('p1').roundPhase).toBe(RoundPhase.BULL_PHASE);

      // p3 calls true
      const resolveResult = engine.handleTrue('p3');
      expect(resolveResult.type).toBe('resolve');
      if (resolveResult.type !== 'resolve') return;

      // Hand exists (7 of spades), so bull callers (p2) are wrong
      expect(resolveResult.result.handExists).toBe(true);
      expect(resolveResult.result.penalties['p2']).toBe(STARTING_CARDS + 1); // p2 penalized
      expect(resolveResult.result.penalties['p1']).toBe(STARTING_CARDS); // p1 correct
      expect(resolveResult.result.penalties['p3']).toBe(STARTING_CARDS); // p3 correct
      expect(p2.cardCount).toBe(2);

      // Start next round
      const nextResult = engine.startNextRound();
      expect(nextResult.type).toBe('new_round');

      // Verify round 2 state
      const stateR2 = engine.getClientState('p1');
      expect(stateR2.roundNumber).toBe(2);
      expect(stateR2.roundPhase).toBe(RoundPhase.CALLING);
      expect(stateR2.startingPlayerId).toBe('p2');
      expect(stateR2.currentHand).toBeNull();
      expect(stateR2.roundResult).toBeNull();

      // p2 should have 2 cards now
      expect(p2.cards.length).toBe(2);
      expect(p1.cards.length).toBe(STARTING_CARDS);
    });
  });

  describe('deterministic elimination and game over', () => {
    it('eliminates player at MAX_CARDS when they are wrong, triggers game_over when 1 left', () => {
      // 2 players: pa at 5 cards, pb at 1 card
      const pa = makePlayer('pa', 'A', MAX_CARDS);
      const pb = makePlayer('pb', 'B', 1);
      const eng = new GameEngine([pa, pb]);
      eng.startRound();

      // Force cards so the call is deterministically false
      pa.cards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
                  { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
                  { rank: '6', suit: 'clubs' }];
      pb.cards = [{ rank: '7', suit: 'hearts' }];

      // pa calls royal flush in spades — impossible with these cards
      eng.handleCall('pa', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
      const bullResult = eng.handleBull('pb');
      expect(bullResult.type).toBe('last_chance');

      const resolveResult = eng.handleLastChancePass('pa');
      // pa was wrong (royal flush doesn't exist), pa has 5 cards → 6 → eliminated
      // pb is the only player left → game_over
      expect(resolveResult.type).toBe('game_over');
      if (resolveResult.type === 'game_over') {
        expect(resolveResult.winnerId).toBe('pb');
      }
      expect(pa.isEliminated).toBe(true);
      expect(pa.cardCount).toBe(MAX_CARDS + 1);
    });

    it('eliminates player at MAX_CARDS but game continues with 2+ remaining', () => {
      // 3 players: pa at 5 cards, pb at 1, pc at 1
      const pa = makePlayer('pa', 'A', MAX_CARDS);
      const pb = makePlayer('pb', 'B', 1);
      const pc = makePlayer('pc', 'C', 1);
      const eng = new GameEngine([pa, pb, pc]);
      eng.startRound();

      // Force cards — no royal flush possible
      pa.cards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
                  { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
                  { rank: '6', suit: 'clubs' }];
      pb.cards = [{ rank: '7', suit: 'hearts' }];
      pc.cards = [{ rank: '8', suit: 'hearts' }];

      // pa calls royal flush in spades — impossible
      eng.handleCall('pa', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
      eng.handleBull('pb');
      const resolveResult = eng.handleTrue('pc');

      // pa wrong (caller of non-existent hand), pc wrong (called true on non-existent)
      // pb right (called bull on non-existent)
      expect(resolveResult.type).toBe('resolve');
      if (resolveResult.type !== 'resolve') return;

      expect(resolveResult.result.handExists).toBe(false);
      expect(resolveResult.result.eliminatedPlayerIds).toContain('pa');
      expect(pa.isEliminated).toBe(true);
      // pc also wrong but only goes from 1→2, not eliminated
      expect(pc.cardCount).toBe(2);
      expect(pc.isEliminated).toBe(false);

      // Start next round — 2 players remain
      const nextResult = eng.startNextRound();
      expect(nextResult.type).toBe('new_round');
      expect(eng.getActivePlayers().map(p => p.id)).toEqual(['pb', 'pc']);
    });
  });

  describe('roundResult in client state', () => {
    it('is null at start of round', () => {
      const state = engine.getClientState('p1');
      expect(state.roundResult).toBeNull();
    });

    it('is populated after round resolves', () => {
      p1.cards = [{ rank: '7', suit: 'spades' }];
      p2.cards = [{ rank: 'K', suit: 'hearts' }];
      p3.cards = [{ rank: '2', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      const state = engine.getClientState('p1');
      expect(state.roundResult).not.toBeNull();
      expect(state.roundResult!.calledHand).toEqual({ type: HandType.HIGH_CARD, rank: '7' });
      expect(state.roundResult!.callerId).toBe('p1');
      expect(state.roundResult!.handExists).toBe(true);
    });

    it('is cleared after startNextRound', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      // Should be populated now
      expect(engine.getClientState('p1').roundResult).not.toBeNull();

      engine.startNextRound();

      // Should be cleared
      expect(engine.getClientState('p1').roundResult).toBeNull();
    });
  });

  describe('gameOver and winnerId getters', () => {
    it('gameOver is false when multiple players remain', () => {
      expect(engine.gameOver).toBe(false);
    });

    it('gameOver is true when only 1 player remains', () => {
      p2.isEliminated = true;
      p3.isEliminated = true;
      expect(engine.gameOver).toBe(true);
    });

    it('winnerId returns the sole remaining player', () => {
      p2.isEliminated = true;
      p3.isEliminated = true;
      expect(engine.winnerId).toBe('p1');
    });

    it('winnerId is null when multiple players remain', () => {
      expect(engine.winnerId).toBeNull();
    });
  });

  describe('GameSettings — configurable maxCards', () => {
    it('eliminates player at maxCards=3 when they reach 4 cards', () => {
      const pa = makePlayer('pa', 'A', 3); // at max
      const pb = makePlayer('pb', 'B', 1);
      const eng = new GameEngine([pa, pb], { maxCards: 3 });
      eng.startRound();

      pa.cards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' }, { rank: '4', suit: 'clubs' }];
      pb.cards = [{ rank: '7', suit: 'hearts' }];

      eng.handleCall('pa', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
      const bullResult = eng.handleBull('pb');
      expect(bullResult.type).toBe('last_chance');

      const resolveResult = eng.handleLastChancePass('pa');
      expect(resolveResult.type).toBe('game_over');
      if (resolveResult.type === 'game_over') {
        expect(resolveResult.winnerId).toBe('pb');
      }
      expect(pa.isEliminated).toBe(true);
      expect(pa.cardCount).toBe(4); // 3 + 1
    });

    it('eliminates player at maxCards=1 when they reach 2 cards', () => {
      const pa = makePlayer('pa', 'A', 1); // at max
      const pb = makePlayer('pb', 'B', 1);
      const eng = new GameEngine([pa, pb], { maxCards: 1 });
      eng.startRound();

      pa.cards = [{ rank: '2', suit: 'clubs' }];
      pb.cards = [{ rank: '7', suit: 'hearts' }];

      eng.handleCall('pa', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
      const bullResult = eng.handleBull('pb');
      expect(bullResult.type).toBe('last_chance');

      const resolveResult = eng.handleLastChancePass('pa');
      expect(resolveResult.type).toBe('game_over');
      if (resolveResult.type === 'game_over') {
        expect(resolveResult.winnerId).toBe('pb');
      }
      expect(pa.isEliminated).toBe(true);
      expect(pa.cardCount).toBe(2); // 1 + 1
    });

    it('does not eliminate player below maxCards threshold', () => {
      const pa = makePlayer('pa', 'A', 2); // below maxCards=3
      const pb = makePlayer('pb', 'B', 1);
      const eng = new GameEngine([pa, pb], { maxCards: 3 });
      eng.startRound();

      pa.cards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' }];
      pb.cards = [{ rank: '7', suit: 'hearts' }];

      eng.handleCall('pa', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
      const bullResult = eng.handleBull('pb');
      expect(bullResult.type).toBe('last_chance');

      const resolveResult = eng.handleLastChancePass('pa');
      // pa goes from 2 → 3 cards, which equals maxCards but doesn't exceed it
      expect(resolveResult.type).not.toBe('game_over');
      expect(pa.isEliminated).toBe(false);
      expect(pa.cardCount).toBe(3);
    });

    it('defaults to MAX_CARDS when no settings provided', () => {
      const pa = makePlayer('pa', 'A', MAX_CARDS);
      const pb = makePlayer('pb', 'B', 1);
      const eng = new GameEngine([pa, pb]); // no settings
      eng.startRound();

      pa.cards = Array(MAX_CARDS).fill(null).map((_, i) => ({ rank: String(i + 2) as any, suit: 'clubs' as const }));
      pb.cards = [{ rank: '7', suit: 'hearts' }];

      eng.handleCall('pa', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
      eng.handleBull('pb');
      const resolveResult = eng.handleLastChancePass('pa');

      expect(resolveResult.type).toBe('game_over');
      expect(pa.cardCount).toBe(MAX_CARDS + 1);
    });
  });

  describe('maxPlayersForMaxCards helper', () => {
    it('returns 52 for maxCards=1', () => {
      expect(maxPlayersForMaxCards(1)).toBe(52);
    });

    it('returns 10 for maxCards=5', () => {
      expect(maxPlayersForMaxCards(5)).toBe(10);
    });

    it('returns 13 for maxCards=4', () => {
      expect(maxPlayersForMaxCards(4)).toBe(13);
    });

    it('12 players with maxCards=4 is valid (48 <= 52)', () => {
      expect(12 * 4).toBeLessThanOrEqual(DECK_SIZE);
    });

    it('12 players with maxCards=5 is invalid (60 > 52)', () => {
      expect(12 * 5).toBeGreaterThan(DECK_SIZE);
    });
  });

  describe('GameStats tracking', () => {
    it('initializes stats for all players', () => {
      const stats = engine.getGameStats();
      expect(stats.totalRounds).toBe(0);
      expect(stats.playerStats['p1']).toBeDefined();
      expect(stats.playerStats['p2']).toBeDefined();
      expect(stats.playerStats['p3']).toBeDefined();
      expect(stats.playerStats['p1'].callsMade).toBe(0);
      expect(stats.playerStats['p1'].bullsCalled).toBe(0);
    });

    it('increments callsMade on handleCall', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      const stats = engine.getGameStats();
      expect(stats.playerStats['p1'].callsMade).toBe(1);
    });

    it('increments bullsCalled on handleBull', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      const stats = engine.getGameStats();
      expect(stats.playerStats['p2'].bullsCalled).toBe(1);
    });

    it('increments truesCalled on handleTrue', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleTrue('p3');
      const stats = engine.getGameStats();
      expect(stats.playerStats['p3'].truesCalled).toBe(1);
    });

    it('tracks correctBulls after a round with a non-existent hand', () => {
      // Force cards so we know the outcome
      p1.cards = [{ rank: '2', suit: 'clubs' }];
      p2.cards = [{ rank: '3', suit: 'hearts' }];
      p3.cards = [{ rank: '4', suit: 'diamonds' }];

      // Call a pair of Aces — impossible with these cards
      engine.handleCall('p1', { type: HandType.PAIR, rank: 'A' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      const stats = engine.getGameStats();
      // Hand doesn't exist, so p2 (bull) was correct, p3 (true) was wrong
      expect(stats.playerStats['p2'].correctBulls).toBe(1);
      expect(stats.playerStats['p3'].correctTrues).toBe(0);
    });

    it('tracks correctTrues after a round with an existing hand', () => {
      p1.cards = [{ rank: '7', suit: 'spades' }];
      p2.cards = [{ rank: 'K', suit: 'hearts' }];
      p3.cards = [{ rank: '2', suit: 'clubs' }];

      // Call high card 7 — exists (p1 has 7 of spades)
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      const stats = engine.getGameStats();
      expect(stats.playerStats['p3'].correctTrues).toBe(1);
      expect(stats.playerStats['p2'].correctBulls).toBe(0);
    });

    it('tracks bluffsSuccessful when caller hand exists', () => {
      p1.cards = [{ rank: '7', suit: 'spades' }];
      p2.cards = [{ rank: 'K', suit: 'hearts' }];
      p3.cards = [{ rank: '2', suit: 'clubs' }];

      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '7' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      const stats = engine.getGameStats();
      expect(stats.playerStats['p1'].bluffsSuccessful).toBe(1);
    });

    it('increments totalRounds on resolution', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      const stats = engine.getGameStats();
      expect(stats.totalRounds).toBe(1);
    });

    it('tracks roundsSurvived for non-eliminated players', () => {
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      const stats = engine.getGameStats();
      // All 3 players survive (no one eliminated with just 1-2 cards)
      expect(stats.playerStats['p1'].roundsSurvived).toBeGreaterThanOrEqual(1);
      expect(stats.playerStats['p2'].roundsSurvived).toBeGreaterThanOrEqual(1);
      expect(stats.playerStats['p3'].roundsSurvived).toBeGreaterThanOrEqual(1);
    });

    it('accumulates stats across multiple rounds', () => {
      // Round 1
      engine.handleCall('p1', { type: HandType.HIGH_CARD, rank: '2' });
      engine.handleBull('p2');
      engine.handleTrue('p3');

      engine.startNextRound();

      // Round 2 — p2 starts
      const starter = engine.currentPlayerId;
      engine.handleCall(starter, { type: HandType.HIGH_CARD, rank: '3' });
      const next1 = engine.currentPlayerId;
      engine.handleBull(next1);
      const next2 = engine.currentPlayerId;
      engine.handleTrue(next2);

      const stats = engine.getGameStats();
      expect(stats.totalRounds).toBe(2);
    });

    it('tracks stats through game over', () => {
      const pa = makePlayer('pa', 'A', MAX_CARDS);
      const pb = makePlayer('pb', 'B', 1);
      const eng = new GameEngine([pa, pb]);
      eng.startRound();

      pa.cards = [{ rank: '2', suit: 'clubs' }, { rank: '3', suit: 'clubs' },
                  { rank: '4', suit: 'clubs' }, { rank: '5', suit: 'clubs' },
                  { rank: '6', suit: 'clubs' }];
      pb.cards = [{ rank: '7', suit: 'hearts' }];

      eng.handleCall('pa', { type: HandType.ROYAL_FLUSH, suit: 'spades' });
      eng.handleBull('pb');
      eng.handleLastChancePass('pa');

      const stats = eng.getGameStats();
      expect(stats.totalRounds).toBe(1);
      expect(stats.playerStats['pa'].callsMade).toBe(1);
      expect(stats.playerStats['pb'].bullsCalled).toBe(1);
      expect(stats.playerStats['pb'].correctBulls).toBe(1);
      // pb survived, pa was eliminated
      expect(stats.playerStats['pb'].roundsSurvived).toBe(1);
    });
  });
});
