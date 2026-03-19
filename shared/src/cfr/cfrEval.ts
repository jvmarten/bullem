/**
 * CFR strategy evaluation for in-game bot decisions.
 *
 * Uses pre-trained strategy data (embedded in strategyData.ts) to make
 * decisions compatible with BotPlayer's interface.
 *
 * Strategy data is ~120KB total, acceptable for both server and client bundles.
 *
 * Post-strategy safety layers:
 * 1. Plausibility override — forces bull when claims are impossible given card count
 * 2. Escalation dampening — increases bull probability as claims get absurdly high
 * 3. Plausibility-capped action mapping — prevents generating implausible hands
 */

import type { Card, ClientGameState, HandCall, JokerCount, LastChanceMode } from '../types.js';
import { HandType } from '../types.js';
import type { BotAction } from '../engine/BotPlayer.js';
import { AbstractAction, getInfoSetKey, getLegalAbstractActions } from './infoSet.js';
import { mapAbstractToConcreteAction } from './actionMapper.js';
import { STRATEGY_DATA, type StrategyEntry } from './strategyData.js';
import { RANK_VALUES } from '../constants.js';

/** Map active player count to strategy bucket key. */
function resolvePlayerBucket(activePlayers: number): string {
  if (activePlayers <= 2) return 'p2';
  if (activePlayers <= 4) return 'p34';
  return 'p5+';
}

// ── Claim plausibility analysis ────────────────────────────────────────

/**
 * Minimum total cards for each hand type to have a reasonable chance of
 * existing across all players' combined cards.
 */
const MIN_CARDS_FOR_HAND: Record<number, number> = {
  [HandType.HIGH_CARD]: 1,
  [HandType.PAIR]: 4,
  [HandType.TWO_PAIR]: 7,
  [HandType.FLUSH]: 8,
  [HandType.THREE_OF_A_KIND]: 8,
  [HandType.STRAIGHT]: 10,
  [HandType.FULL_HOUSE]: 12,
  [HandType.FOUR_OF_A_KIND]: 16,
  [HandType.STRAIGHT_FLUSH]: 20,
  [HandType.ROYAL_FLUSH]: 25,
};

/**
 * Returns 0.0 (certainly doesn't exist) to 1.0 (very likely exists)
 * representing how plausible the current claim is given total cards.
 */
function claimPlausibility(hand: HandCall | null, totalCards: number): number {
  if (!hand) return 1.0;
  const minNeeded = MIN_CARDS_FOR_HAND[hand.type] ?? 10;
  const ratio = totalCards / minNeeded;
  if (ratio >= 2.5) return 1.0;   // Very likely
  if (ratio >= 1.5) return 0.8;   // Likely
  if (ratio >= 1.0) return 0.5;   // Coin flip
  if (ratio >= 0.75) return 0.2;  // Unlikely
  return 0.0;                      // Nearly impossible
}

/**
 * Returns a "claim height" score from 0-1 indicating how high the claim is
 * relative to the full hand spectrum. Used to dampen escalation spirals.
 */
function claimHeightScore(hand: HandCall | null): number {
  if (!hand) return 0;
  // Base score from hand type (0-9 mapped to 0-1)
  let score = hand.type / HandType.ROYAL_FLUSH;
  // Within type, use rank to refine (higher rank = higher score)
  if ('rank' in hand && hand.rank) {
    score += (RANK_VALUES[hand.rank] / 14) * 0.05;
  } else if ('highRank' in hand && hand.highRank) {
    score += (RANK_VALUES[hand.highRank] / 14) * 0.05;
  }
  return Math.min(score, 1.0);
}

// ── Heuristic fallback ───────────────────────────────────────────────

/**
 * Context-aware fallback when info set is missing from trained strategy.
 *
 * Key improvements over naive uniform:
 * - When claim plausibility is low, heavily favor bull
 * - When claim height is very high (escalation spiral), favor bull
 * - Bluff weights scale down with fewer total cards
 * - Truthful claims preferred when possible
 */
function heuristicFallback(
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  totalCards: number,
): AbstractAction {
  const weights = new Map<AbstractAction, number>();
  for (const action of legalActions) {
    weights.set(action, 1);
  }

  const plausibility = claimPlausibility(currentHand, totalCards);
  const heightScore = claimHeightScore(currentHand);

  // Bull weight scales inversely with plausibility
  // plausibility 0.0 → bull weight 12 (overwhelmingly call bull)
  // plausibility 0.5 → bull weight 4
  // plausibility 1.0 → bull weight 2
  if (legalActions.includes(AbstractAction.BULL)) {
    const bullWeight = Math.max(2, Math.round(12 - 10 * plausibility));
    weights.set(AbstractAction.BULL, bullWeight);
  }

  // True weight scales with plausibility
  if (legalActions.includes(AbstractAction.TRUE)) {
    const trueWeight = Math.max(1, Math.round(5 * plausibility));
    weights.set(AbstractAction.TRUE, trueWeight);
  }

  // Pass is favored in last-chance
  if (legalActions.includes(AbstractAction.PASS)) {
    weights.set(AbstractAction.PASS, 4);
  }

  // Raise weights scale down when claims are already high
  // (prevents escalation spirals in fallback)
  const raiseScale = Math.max(0.1, 1 - heightScore);

  if (legalActions.includes(AbstractAction.TRUTHFUL_LOW)) {
    weights.set(AbstractAction.TRUTHFUL_LOW, Math.max(1, Math.round(4 * raiseScale)));
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_MID)) {
    weights.set(AbstractAction.TRUTHFUL_MID, Math.max(1, Math.round(2 * raiseScale)));
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_HIGH)) {
    weights.set(AbstractAction.TRUTHFUL_HIGH, Math.max(1, Math.round(1 * raiseScale)));
  }

  // Bluffs: minimal weight, further reduced by high claims or low cards
  const bluffScale = raiseScale * Math.min(1, totalCards / 10);
  if (legalActions.includes(AbstractAction.BLUFF_SMALL)) {
    weights.set(AbstractAction.BLUFF_SMALL, Math.max(1, Math.round(2 * bluffScale)));
  }
  if (legalActions.includes(AbstractAction.BLUFF_MID)) {
    weights.set(AbstractAction.BLUFF_MID, Math.max(1, Math.round(1 * bluffScale)));
  }
  if (legalActions.includes(AbstractAction.BLUFF_BIG)) {
    weights.set(AbstractAction.BLUFF_BIG, Math.max(1, Math.round(1 * bluffScale)));
  }

  let totalWeight = 0;
  for (const w of weights.values()) totalWeight += w;
  const r = Math.random() * totalWeight;
  let cumulative = 0;
  for (const action of legalActions) {
    cumulative += weights.get(action) ?? 1;
    if (r <= cumulative) return action;
  }
  return legalActions[legalActions.length - 1]!;
}

// ── Strategy adjustment ──────────────────────────────────────────────

/**
 * Apply post-strategy safety adjustments to prevent implausible behavior.
 *
 * The trained strategy may not cover all edge cases (especially multiplayer
 * early rounds with few total cards). These overrides act as guardrails:
 *
 * 1. When the current claim is implausible (e.g., two-pair with 5 total cards),
 *    shift probability mass heavily toward BULL.
 * 2. When claims have escalated very high (full house+), increase BULL weight
 *    to prevent bots from endlessly raising to royal flush.
 * 3. Remove raise actions that would produce implausible claims.
 */
function adjustStrategyForPlausibility(
  probs: Map<AbstractAction, number>,
  legalActions: AbstractAction[],
  currentHand: HandCall | null,
  totalCards: number,
): void {
  const plausibility = claimPlausibility(currentHand, totalCards);
  const heightScore = claimHeightScore(currentHand);

  const hasBull = legalActions.includes(AbstractAction.BULL);

  // Adjustment 1: When claims are implausible, shift mass toward bull
  if (hasBull && plausibility < 0.5) {
    // Transfer probability from raise actions to bull
    const bullBoost = (0.5 - plausibility) * 1.5; // 0 to 0.75 extra for bull
    const raiseActions = legalActions.filter(a =>
      a !== AbstractAction.BULL && a !== AbstractAction.TRUE && a !== AbstractAction.PASS,
    );

    let raiseMass = 0;
    for (const a of raiseActions) {
      raiseMass += probs.get(a) ?? 0;
    }

    if (raiseMass > 0) {
      // Reduce raise mass and shift to bull
      const transfer = Math.min(raiseMass * 0.8, bullBoost);
      const scale = 1 - transfer / raiseMass;
      for (const a of raiseActions) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
    }
  }

  // Adjustment 2: When claims are very high (escalation spiral), boost bull
  if (hasBull && heightScore > 0.6) {
    const escalationBoost = (heightScore - 0.6) * 1.5; // 0 to 0.6 extra for bull
    const raiseActions = legalActions.filter(a =>
      a !== AbstractAction.BULL && a !== AbstractAction.TRUE && a !== AbstractAction.PASS,
    );

    let raiseMass = 0;
    for (const a of raiseActions) {
      raiseMass += probs.get(a) ?? 0;
    }

    if (raiseMass > 0) {
      const transfer = Math.min(raiseMass * 0.7, escalationBoost);
      const scale = 1 - transfer / raiseMass;
      for (const a of raiseActions) {
        probs.set(a, (probs.get(a) ?? 0) * scale);
      }
      probs.set(AbstractAction.BULL, (probs.get(AbstractAction.BULL) ?? 0) + transfer);
    }
  }

  // Adjustment 3: When claim is near-impossible, make bull near-certain
  if (hasBull && plausibility === 0.0) {
    // Override: 90% bull, split remaining among other legal actions
    const otherActions = legalActions.filter(a => a !== AbstractAction.BULL);
    probs.set(AbstractAction.BULL, 0.9);
    const remaining = 0.1 / otherActions.length;
    for (const a of otherActions) {
      probs.set(a, remaining);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Small epsilon-noise mixed into the strategy at eval time.
 * Prevents humans from building a perfect model of the bot's tendencies.
 * Even if they figure out the rough strategy, the noise makes specific
 * predictions unreliable across many games.
 */
const EVAL_EPSILON = 0.03;

/**
 * Make a CFR-based decision for a bot.
 *
 * Looks up the trained strategy for the current game state and samples
 * an action from the probability distribution. Applies post-strategy
 * plausibility adjustments to prevent implausible behavior, then mixes
 * in small epsilon-noise (3%) for unpredictability.
 *
 * @param state - The game state as seen by this bot
 * @param botCards - The bot's actual cards
 * @param totalCards - Total cards across all active players
 * @param activePlayers - Number of non-eliminated players
 * @param botPlayerId - Bot's player ID (for opponent aggression tracking)
 * @param wasPenalizedLastRound - Whether this bot lost the previous round
 * @returns A BotAction, or null if no legal actions (shouldn't happen in practice)
 */
export function decideCFR(
  state: ClientGameState,
  botCards: Card[],
  totalCards: number,
  activePlayers: number,
  jokerCount: JokerCount = 0,
  lastChanceMode: LastChanceMode = 'classic',
  botPlayerId: string = '',
  wasPenalizedLastRound: boolean = false,
): BotAction | null {
  const legalActions = getLegalAbstractActions(state);
  if (legalActions.length === 0) return null;

  const bucket = resolvePlayerBucket(activePlayers);
  const strategyMap = STRATEGY_DATA.get(bucket);

  let chosenAction: AbstractAction;

  if (strategyMap) {
    const infoSetKey = getInfoSetKey(
      state, botCards, totalCards, activePlayers,
      jokerCount, lastChanceMode, botPlayerId, wasPenalizedLastRound,
    );
    const strategyEntry = strategyMap[infoSetKey];

    if (strategyEntry) {
      // Build probability distribution over legal actions with epsilon-noise
      const uniform = 1 / legalActions.length;
      let totalProb = 0;
      const probs = new Map<AbstractAction, number>();
      for (const action of legalActions) {
        const base = strategyEntry[action] ?? 0;
        // Mix in epsilon-noise: (1-ε)*strategy + ε*uniform
        const mixed = (1 - EVAL_EPSILON) * base + EVAL_EPSILON * uniform;
        probs.set(action, mixed);
        totalProb += mixed;
      }

      // Normalize
      if (totalProb > 0) {
        for (const action of legalActions) {
          probs.set(action, (probs.get(action) ?? 0) / totalProb);
        }
      }

      // Apply plausibility adjustments — overrides strategy for impossible claims
      adjustStrategyForPlausibility(probs, legalActions, state.currentHand, totalCards);

      // Sample from adjusted distribution
      let adjTotal = 0;
      for (const action of legalActions) {
        adjTotal += probs.get(action) ?? 0;
      }

      if (adjTotal > 0) {
        const r = Math.random() * adjTotal;
        let cumulative = 0;
        chosenAction = legalActions[legalActions.length - 1]!;
        for (const action of legalActions) {
          cumulative += probs.get(action) ?? 0;
          if (r <= cumulative) {
            chosenAction = action;
            break;
          }
        }
      } else {
        chosenAction = heuristicFallback(legalActions, state.currentHand, totalCards);
      }
    } else {
      chosenAction = heuristicFallback(legalActions, state.currentHand, totalCards);
    }
  } else {
    chosenAction = heuristicFallback(legalActions, state.currentHand, totalCards);
  }

  return mapAbstractToConcreteAction(chosenAction, state, botCards, totalCards);
}
