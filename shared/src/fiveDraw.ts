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
import type { Card, HandCall, ClientGameState, TurnEntry } from './types.js';
import { HandType, RoundPhase, TurnAction } from './types.js';
import { isHigherHand, getMinimumRaise, handToString } from './hands.js';
import { HandChecker } from './engine/HandChecker.js';
import { decideCFR } from './cfr/cfrEval.js';
import type { BotAction } from './engine/BotPlayer.js';
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
 * Build a synthetic ClientGameState for the CFR bot to evaluate.
 * Mimics a 2-player Bull 'Em round with 5 cards each.
 */
function buildCFRState(
  dealerCards: Card[],
  currentHand: HandCall | null,
  turnHistory: FiveDrawTurnEntry[],
  roundPhase: RoundPhase,
  isPlayerTurn: boolean,
): ClientGameState {
  // Build turn entries matching the game engine's format
  const engineTurnHistory: TurnEntry[] = turnHistory.map(entry => ({
    playerId: entry.participant === 'player' ? 'player' : 'dealer',
    playerName: entry.participant === 'player' ? 'Player' : 'Dealer',
    action: entry.action === 'call' ? TurnAction.CALL : TurnAction.LAST_CHANCE_PASS,
    hand: entry.hand,
    timestamp: Date.now(),
  }));

  return {
    gamePhase: 'playing' as ClientGameState['gamePhase'],
    players: [
      {
        id: 'player',
        name: 'Player',
        cardCount: 5,
        isEliminated: false,
        isConnected: true,
        isBot: false,
        isHost: true,
      },
      {
        id: 'dealer',
        name: 'Dealer',
        cardCount: 5,
        isEliminated: false,
        isConnected: true,
        isBot: true,
        isHost: false,
      },
    ],
    myCards: dealerCards,
    currentPlayerId: isPlayerTurn ? 'player' : 'dealer',
    startingPlayerId: 'player',
    currentHand,
    lastCallerId: null,
    roundPhase,
    turnHistory: engineTurnHistory,
    roundNumber: 1,
    maxCards: 5,
  };
}

/**
 * Get the Dealer's (CFR bot) decision for the current game state.
 *
 * In 5 Draw, the only legal actions are:
 * - 'call' with a higher hand (raise)
 * - 'pass' (decline to raise, ending the round)
 *
 * No 'true' or 'bull' calls are allowed.
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

  // Build state for CFR — use CALLING phase since no bull/true allowed
  const state = buildCFRState(
    dealerCards,
    currentHand,
    turnHistory,
    currentHand ? RoundPhase.CALLING : RoundPhase.CALLING,
    false, // it's dealer's turn
  );

  const botAction = decideCFR(state, dealerCards, 10, 2);

  if (!botAction) {
    return { participant: 'dealer', action: 'pass' };
  }

  return mapBotActionToFiveDrawAction(botAction, currentHand);
}

/**
 * Map a BotAction from the CFR system to a FiveDrawTurnEntry.
 * In 5 Draw, bull/true get mapped to 'pass' since they aren't allowed.
 */
function mapBotActionToFiveDrawAction(
  botAction: BotAction,
  currentHand: HandCall | null,
): FiveDrawTurnEntry {
  switch (botAction.action) {
    case 'call':
    case 'lastChanceRaise':
      // Validate the hand is actually higher than current
      if (currentHand && !isHigherHand(botAction.hand, currentHand)) {
        // CFR produced an invalid raise — fall back to minimum raise or pass
        const minRaise = getMinimumRaise(currentHand);
        if (minRaise) {
          return { participant: 'dealer', action: 'call', hand: minRaise };
        }
        return { participant: 'dealer', action: 'pass' };
      }
      return { participant: 'dealer', action: 'call', hand: botAction.hand };

    case 'bull':
    case 'true':
    case 'lastChancePass':
      // In 5 Draw these mean "don't raise" = pass
      return { participant: 'dealer', action: 'pass' };
  }
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
