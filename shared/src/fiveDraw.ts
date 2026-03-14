/**
 * 5 Draw Minigame — shared types and pure logic.
 *
 * A solo one-round Bull 'Em game against the Dealer. Player and Dealer each
 * get dealt 5 cards, then play one round of normal Bull 'Em with strict LCR
 * rules. No true calls allowed. Round ends when someone passes (doesn't raise
 * the current call). The last caller wins if their hand exists in the combined
 * 10 cards; otherwise the passer wins.
 *
 * Runs entirely client-side using the shared engine (hand checking, CFR
 * strategy, etc.) — no socket/server needed for gameplay.
 */
import type { Card, HandCall } from './types.js';
import { isHigherHand, getMinimumRaise, handToString } from './hands.js';
import { HandChecker } from './engine/HandChecker.js';
import { decideFiveDrawCFR } from './cfr/fiveDrawEval.js';
import { buildDeck, shuffleDeck } from './deckDraw.js';

// ── Constants ────────────────────────────────────────────────────────────

export const FIVE_DRAW_MIN_WAGER = 1;
export const FIVE_DRAW_MAX_WAGER = 10_000;
export const FIVE_DRAW_DEFAULT_WAGER = 10;

/** Winner gets 2x their wager (net +1x). */
export const FIVE_DRAW_WIN_MULTIPLIER = 2;

// ── Types ────────────────────────────────────────────────────────────────

export type FiveDrawParticipant = 'player' | 'dealer';

export interface FiveDrawTurnEntry {
  participant: FiveDrawParticipant;
  action: 'call' | 'pass';
  hand?: HandCall;
}

/** Possible game phases for the 5 Draw minigame. */
export type FiveDrawPhase =
  | 'wager'       // Choosing wager amount
  | 'dealing'     // Cards being dealt
  | 'playing'     // Active round in progress
  | 'resolving'   // Checking the hand
  | 'result';     // Showing outcome

export interface FiveDrawResult {
  playerCards: Card[];
  dealerCards: Card[];
  turnHistory: FiveDrawTurnEntry[];
  /** The final (highest) hand call that gets checked. */
  lastCall: HandCall;
  /** Who made the last call. */
  lastCaller: FiveDrawParticipant;
  /** Whether the last call actually exists in the combined 10 cards. */
  handExists: boolean;
  /** Who won the round. */
  winner: FiveDrawParticipant;
  wager: number;
  /** Total payout (0 if lost, 2x wager if won). */
  payout: number;
}

// ── Pure game logic ──────────────────────────────────────────────────────

/**
 * Deal 5 cards each to player and dealer from a shuffled 52-card deck.
 */
export function dealFiveDrawCards(rng: () => number = Math.random): {
  playerCards: Card[];
  dealerCards: Card[];
} {
  const deck = shuffleDeck(buildDeck(), rng);
  return {
    playerCards: deck.slice(0, 5),
    dealerCards: deck.slice(5, 10),
  };
}

/**
 * Get the Dealer's (CFR bot) decision for the current game state.
 *
 * Uses a dedicated 5 Draw CFR strategy trained specifically for the
 * call-or-pass mechanics, rather than mapping standard Bull 'Em actions.
 *
 * In 5 Draw, the only legal actions are:
 * - 'call' with a higher hand (raise)
 * - 'pass' (decline to raise, ending the round)
 */
export function getDealerAction(
  dealerCards: Card[],
  currentHand: HandCall | null,
  turnHistory: FiveDrawTurnEntry[],
): FiveDrawTurnEntry {
  // If there's no possible raise, dealer must pass
  if (currentHand) {
    const minRaise = getMinimumRaise(currentHand);
    if (!minRaise) {
      return { participant: 'dealer', action: 'pass' };
    }
  }

  // Count turns so far for the info set key
  const turnCount = turnHistory.length;
  // Dealer is always P2 (responder) — player opens first for house edge
  const isOpener = false;

  const decision = decideFiveDrawCFR(dealerCards, currentHand, turnCount, isOpener);

  if (decision.action === 'pass') {
    return { participant: 'dealer', action: 'pass' };
  }

  // Validate the hand is actually higher than current
  if (decision.hand && currentHand && !isHigherHand(decision.hand, currentHand)) {
    const fallback = getMinimumRaise(currentHand);
    if (fallback) {
      return { participant: 'dealer', action: 'call', hand: fallback };
    }
    return { participant: 'dealer', action: 'pass' };
  }

  return { participant: 'dealer', action: 'call', hand: decision.hand };
}

/**
 * Resolve the round: check if the last called hand exists in the combined
 * 10 cards, determine the winner, and calculate payout.
 */
export function resolveFiveDraw(
  playerCards: Card[],
  dealerCards: Card[],
  turnHistory: FiveDrawTurnEntry[],
  wager: number,
): FiveDrawResult {
  // Find the last call in the history
  const lastCallEntry = [...turnHistory].reverse().find(e => e.action === 'call');
  if (!lastCallEntry || !lastCallEntry.hand) {
    // Should never happen — there should always be at least one call
    throw new Error('No call found in turn history');
  }

  const lastCall = lastCallEntry.hand;
  const lastCaller = lastCallEntry.participant;
  const allCards = [...playerCards, ...dealerCards];
  const handExists = HandChecker.exists(allCards, lastCall);

  // Last caller wins if their hand exists; otherwise the passer wins
  const winner: FiveDrawParticipant = handExists ? lastCaller : (lastCaller === 'player' ? 'dealer' : 'player');
  const playerWon = winner === 'player';
  const payout = playerWon ? wager * FIVE_DRAW_WIN_MULTIPLIER : 0;

  return {
    playerCards,
    dealerCards,
    turnHistory,
    lastCall,
    lastCaller,
    handExists,
    winner,
    wager,
    payout,
  };
}

/** Format a hand call for display. Re-export for convenience. */
export { handToString };
