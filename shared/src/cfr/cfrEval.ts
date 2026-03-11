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
 * Conservative fallback when info set is missing from trained strategy.
 * Better than uniform random — favors challenging and conservative play.
 */
function heuristicFallback(legalActions: AbstractAction[]): AbstractAction {
  const weights = new Map<AbstractAction, number>();
  for (const action of legalActions) {
    weights.set(action, 1);
  }

  if (legalActions.includes(AbstractAction.BULL)) {
    weights.set(AbstractAction.BULL, 3);
  }
  if (legalActions.includes(AbstractAction.TRUE)) {
    weights.set(AbstractAction.TRUE, 2);
  }
  if (legalActions.includes(AbstractAction.PASS)) {
    weights.set(AbstractAction.PASS, 4);
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_LOW)) {
    weights.set(AbstractAction.TRUTHFUL_LOW, 2);
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
 * Make a CFR-based decision for a bot.
 *
 * Looks up the trained strategy for the current game state and samples
 * an action from the probability distribution. Falls back to a heuristic
 * when the info set isn't in the trained strategy.
 *
 * @param state - The game state as seen by this bot
 * @param botCards - The bot's actual cards
 * @param totalCards - Total cards across all active players
 * @param activePlayers - Number of non-eliminated players
 * @returns A BotAction, or null if no legal actions (shouldn't happen in practice)
 */
export function decideCFR(
  state: ClientGameState,
  botCards: Card[],
  totalCards: number,
  activePlayers: number,
  jokerCount: JokerCount = 0,
  lastChanceMode: LastChanceMode = 'classic',
): BotAction | null {
  const legalActions = getLegalAbstractActions(state);
  if (legalActions.length === 0) return null;

  const bucket = resolvePlayerBucket(activePlayers);
  const strategyMap = STRATEGY_DATA.get(bucket);

  let chosenAction: AbstractAction;

  if (strategyMap) {
    const infoSetKey = getInfoSetKey(state, botCards, totalCards, activePlayers, jokerCount, lastChanceMode);
    const strategyEntry = strategyMap[infoSetKey];

    if (strategyEntry) {
      // Build probability distribution over legal actions
      let totalProb = 0;
      for (const action of legalActions) {
        totalProb += strategyEntry[action] ?? 0;
      }

      if (totalProb > 0) {
        const r = Math.random() * totalProb;
        let cumulative = 0;
        chosenAction = legalActions[legalActions.length - 1]!;
        for (const action of legalActions) {
          cumulative += strategyEntry[action] ?? 0;
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
