/**
 * CFR strategy evaluation for in-game bot decisions.
 *
 * Uses pre-trained strategy data (embedded in strategyData.ts) to make
 * decisions compatible with BotPlayer's interface.
 *
 * Strategy data is ~120KB total, acceptable for both server and client bundles.
 */

import type { Card, ClientGameState, JokerCount, LastChanceMode } from '../types.js';
import type { BotAction } from '../engine/BotPlayer.js';
import { AbstractAction, getInfoSetKey, getLegalAbstractActions } from './infoSet.js';
import { mapAbstractToConcreteAction } from './actionMapper.js';
import { STRATEGY_DATA, type StrategyEntry } from './strategyData.js';

/** Map active player count to strategy bucket key. */
function resolvePlayerBucket(activePlayers: number): string {
  if (activePlayers <= 2) return 'p2';
  if (activePlayers <= 4) return 'p34';
  return 'p5+';
}

// ── Heuristic fallback ───────────────────────────────────────────────

/**
 * Smarter fallback when info set is missing from trained strategy.
 * Uses a balanced distribution that doesn't create exploitable patterns:
 * - Raises (truthful) are preferred over bluffs when available
 * - Bull/true are moderately weighted to avoid being too predictable
 * - Bluffs are used sparingly to maintain unpredictability
 * - Pass is favored in last-chance to avoid reckless raises
 */
function heuristicFallback(legalActions: AbstractAction[]): AbstractAction {
  const weights = new Map<AbstractAction, number>();
  for (const action of legalActions) {
    weights.set(action, 1);
  }

  // Balanced bull/true — not heavily biased toward either
  if (legalActions.includes(AbstractAction.BULL)) {
    weights.set(AbstractAction.BULL, 2);
  }
  if (legalActions.includes(AbstractAction.TRUE)) {
    weights.set(AbstractAction.TRUE, 2);
  }
  if (legalActions.includes(AbstractAction.PASS)) {
    weights.set(AbstractAction.PASS, 3);
  }

  // Prefer truthful claims over bluffs — they're safer
  if (legalActions.includes(AbstractAction.TRUTHFUL_LOW)) {
    weights.set(AbstractAction.TRUTHFUL_LOW, 3);
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_MID)) {
    weights.set(AbstractAction.TRUTHFUL_MID, 2);
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_HIGH)) {
    weights.set(AbstractAction.TRUTHFUL_HIGH, 1);
  }

  // Bluffs stay low-weighted — used for unpredictability, not as default
  if (legalActions.includes(AbstractAction.BLUFF_SMALL)) {
    weights.set(AbstractAction.BLUFF_SMALL, 1);
  }
  if (legalActions.includes(AbstractAction.BLUFF_MID)) {
    weights.set(AbstractAction.BLUFF_MID, 1);
  }
  if (legalActions.includes(AbstractAction.BLUFF_BIG)) {
    weights.set(AbstractAction.BLUFF_BIG, 1);
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
 * an action from the probability distribution. Mixes in small epsilon-noise
 * (3%) to prevent predictability across many games. Falls back to a
 * heuristic when the info set isn't in the trained strategy.
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

      if (totalProb > 0) {
        const r = Math.random() * totalProb;
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
        chosenAction = heuristicFallback(legalActions);
      }
    } else {
      chosenAction = heuristicFallback(legalActions);
    }
  } else {
    chosenAction = heuristicFallback(legalActions);
  }

  return mapAbstractToConcreteAction(chosenAction, state, botCards);
}
