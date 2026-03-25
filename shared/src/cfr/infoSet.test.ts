import { describe, it, expect } from 'vitest';
import { getLegalAbstractActions, getInfoSetKey, getInfoSetKey2P, AbstractAction } from './infoSet.js';
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
    // V5: 11 base parts (phase, playerCount, cardCount, elimPressure, totalCards,
    // myStrength, handVsClaim, claimHeight, plausibility, phaseDepth, bullSentiment)
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
    // V5: index 4 (was 3) — eliminationPressure inserted at index 3
    expect(keyLo.split('|')[4]).toBe('tLo');
    expect(keyMid.split('|')[4]).toBe('tMd1');
    expect(keyHi.split('|')[4]).toBe('tMd3');
  });

  it('includes hand strength bucket based on cards', () => {
    const state = makeState();
    // A pair = pair bucket
    const keyPair = getInfoSetKey(state, [card('A', 'spades'), card('A', 'hearts')], 4, 2);
    // Two same-suit cards = suitd (suited draw)
    const keySuitd = getInfoSetKey(state, [card('A', 'spades'), card('K', 'spades')], 4, 2);
    // High card only (no pair, no draw) = hcard
    const keyHcard = getInfoSetKey(state, [card('A', 'spades'), card('K', 'hearts')], 4, 2);
    // V5: index 5 (was 4) — eliminationPressure inserted at index 3
    expect(keyPair.split('|')[5]).toBe('pair');
    expect(keySuitd.split('|')[5]).toBe('suitd');
    expect(keyHcard.split('|')[5]).toBe('hcard');
    // Three of a kind = trips
    const keyTrips = getInfoSetKey(state, [card('A', 'spades'), card('A', 'hearts'), card('A', 'diamonds')], 6, 2);
    expect(keyTrips.split('|')[5]).toBe('trips');
    // Low cards with no pair/draw = weak
    const keyWeak = getInfoSetKey(state, [card('3', 'spades'), card('4', 'hearts')], 4, 2);
    expect(keyWeak.split('|')[5]).toBe('weak');
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
    // V5: index 5 (was 4) — eliminationPressure inserted at index 3
    expect(key.split('|')[5]).toBe('x'); // myHandStrengthBucket returns 'x' for empty
  });
});

// ── getInfoSetKey2P ────────────────────────────────────────────────

describe('getInfoSetKey2P', () => {
  it('produces a key with 17 core segments', () => {
    const state = makeState({ startingPlayerId: 'p1' });
    const myCards = [card('A', 'spades'), card('K', 'hearts')];
    const key = getInfoSetKey2P(state, myCards, 4, 'p1', 5, 2);
    const parts = key.split('|');
    expect(parts.length).toBeGreaterThanOrEqual(17);
  });

  it('encodes exact hand type — pair vs high card', () => {
    const state = makeState({ startingPlayerId: 'p1' });
    const pairCards = [card('A', 'spades'), card('A', 'hearts')];
    const hcCards = [card('A', 'spades'), card('K', 'hearts')];
    const keyPair = getInfoSetKey2P(state, pairCards, 4, 'p1', 5, 2);
    const keyHc = getInfoSetKey2P(state, hcCards, 4, 'p1', 5, 2);
    // Index 5 = exact hand type
    expect(keyPair.split('|')[5]).toBe('pr');
    expect(keyHc.split('|')[5]).toBe('hc');
  });

  it('encodes best rank — ace vs low', () => {
    const state = makeState({ startingPlayerId: 'p1' });
    const aceCards = [card('A', 'spades')];
    const lowCards = [card('3', 'hearts')];
    const keyAce = getInfoSetKey2P(state, aceCards, 2, 'p1', 5, 1);
    const keyLow = getInfoSetKey2P(state, lowCards, 2, 'p1', 5, 1);
    // Index 6 = best rank
    expect(keyAce.split('|')[6]).toBe('rA');
    expect(keyLow.split('|')[6]).toBe('rL');
  });

  it('encodes opponent card count', () => {
    const state = makeState({ startingPlayerId: 'p1' });
    const myCards = [card('A', 'spades')];
    const key1 = getInfoSetKey2P(state, myCards, 2, 'p1', 5, 1);
    const key3 = getInfoSetKey2P(state, myCards, 4, 'p1', 5, 3);
    // Index 2 = opponent card count
    expect(key1.split('|')[2]).toBe('o1');
    expect(key3.split('|')[2]).toBe('o3');
  });

  it('encodes exact claim type — pair vs three of a kind', () => {
    const statePair = makeState({
      startingPlayerId: 'p1',
      currentHand: { type: HandType.PAIR, rank: '7' },
    });
    const stateTrips = makeState({
      startingPlayerId: 'p1',
      currentHand: { type: HandType.THREE_OF_A_KIND, rank: '7' },
    });
    const myCards = [card('7', 'spades')];
    const keyPair = getInfoSetKey2P(statePair, myCards, 4, 'p2', 5, 3);
    const keyTrips = getInfoSetKey2P(stateTrips, myCards, 4, 'p2', 5, 3);
    // Index 9 = exact claim type
    expect(keyPair.split('|')[9]).toBe('cP');
    expect(keyTrips.split('|')[9]).toBe('c3');
  });

  it('encodes position — opener vs responder', () => {
    const state = makeState({
      startingPlayerId: 'p1',
      currentHand: null,
    });
    const myCards = [card('A', 'spades')];
    const keyOpener = getInfoSetKey2P(state, myCards, 2, 'p1', 5, 1);
    const keyResponder = getInfoSetKey2P(state, myCards, 2, 'p2', 5, 1);
    // Index 13 = position
    expect(keyOpener.split('|')[13]).toBe('O');
    expect(keyResponder.split('|')[13]).toBe('R');
  });

  it('encodes elimination gaps — both players', () => {
    const state = makeState({ startingPlayerId: 'p1' });
    // My gap: maxCards(5) - myCards(4) = 1
    // Opp gap: maxCards(5) - oppCards(3) = 2
    const myCards = [card('A', 'spades'), card('K', 'hearts'), card('Q', 'diamonds'), card('J', 'clubs')];
    const key = getInfoSetKey2P(state, myCards, 7, 'p1', 5, 3);
    // Index 3 = my elim gap, index 4 = opp elim gap
    expect(key.split('|')[3]).toBe('g1');
    expect(key.split('|')[4]).toBe('og2');
  });

  it('produces different keys for same situation but different dominant suit counts', () => {
    const state = makeState({ startingPlayerId: 'p1' });
    // 3 hearts = dominant suit 3
    const suited = [card('A', 'hearts'), card('K', 'hearts'), card('Q', 'hearts')];
    // all different suits = dominant suit 1
    const rainbow = [card('A', 'hearts'), card('K', 'spades'), card('Q', 'diamonds')];
    const keySuited = getInfoSetKey2P(state, suited, 6, 'p1', 5, 3);
    const keyRainbow = getInfoSetKey2P(state, rainbow, 6, 'p1', 5, 3);
    // Index 7 = dominant suit count
    expect(keySuited.split('|')[7]).toBe('s3');
    expect(keyRainbow.split('|')[7]).toBe('s1');
  });

  it('encodes cards matching claim', () => {
    const state = makeState({
      startingPlayerId: 'p1',
      currentHand: { type: HandType.PAIR, rank: 'K' },
    });
    const has2 = [card('K', 'spades'), card('K', 'hearts')];
    const has1 = [card('K', 'spades'), card('3', 'hearts')];
    const has0 = [card('2', 'spades'), card('3', 'hearts')];
    const key2 = getInfoSetKey2P(state, has2, 4, 'p2', 5, 2);
    const key1 = getInfoSetKey2P(state, has1, 4, 'p2', 5, 2);
    const key0 = getInfoSetKey2P(state, has0, 4, 'p2', 5, 2);
    // Index 11 = matching cards count
    expect(key2.split('|')[11]).toBe('m2');
    expect(key1.split('|')[11]).toBe('m1');
    expect(key0.split('|')[11]).toBe('m0');
  });

  it('appends optional suffixes correctly', () => {
    const state = makeState({ startingPlayerId: 'p1' });
    const myCards = [card('A', 'spades')];
    const keyNormal = getInfoSetKey2P(state, myCards, 2, 'p1', 5, 1, 0, 'classic', false);
    const keyPen = getInfoSetKey2P(state, myCards, 2, 'p1', 5, 1, 0, 'classic', true);
    const keyJoker = getInfoSetKey2P(state, myCards, 2, 'p1', 5, 1, 2, 'classic', false);
    const keyStrict = getInfoSetKey2P(state, myCards, 2, 'p1', 5, 1, 0, 'strict', false);
    expect(keyNormal).not.toContain('pen');
    expect(keyPen).toContain('pen');
    expect(keyJoker).toContain('j2');
    expect(keyStrict).toContain('lcS');
  });

  it('is different from getInfoSetKey for the same inputs', () => {
    const state = makeState({ startingPlayerId: 'p1' });
    const myCards = [card('A', 'spades'), card('K', 'hearts')];
    const key2P = getInfoSetKey2P(state, myCards, 4, 'p1', 5, 2);
    const keyV5 = getInfoSetKey(state, myCards, 4, 2);
    // Different key formats — 2P has more segments
    expect(key2P).not.toBe(keyV5);
    expect(key2P.split('|').length).toBeGreaterThan(keyV5.split('|').length);
  });
});
