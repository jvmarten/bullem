/**
 * CFR bot strategy — pluggable into the simulator's BotStrategy interface.
 *
 * Two modes:
 * 1. Training mode: uses the CFR engine to sample actions and records
 *    decision points for regret updates after the game.
 * 2. Evaluation mode: uses a pre-trained strategy file to make decisions
 *    deterministically (no exploration, no regret tracking).
 */

import type { Card, ClientGameState } from '@bull-em/shared';
import type { BotStrategy, BotStrategyContext, BotStrategyAction } from '../types.js';
import { CFREngine, type ExportedStrategy } from './cfrEngine.js';
import {
  AbstractAction,
  getInfoSetKey,
  getLegalAbstractActions,
} from './infoSet.js';
import { mapAbstractToConcreteAction } from './actionMapper.js';

/** A recorded decision point during a training game (for post-game regret updates). */
export interface DecisionRecord {
  /** The bot that made this decision. */
  botId: string;
  /** Info set key at the decision point. */
  infoSetKey: string;
  /** Legal actions available. */
  legalActions: AbstractAction[];
  /** Strategy used (probability of each action). */
  strategy: Record<string, number>;
  /** Action that was actually taken. */
  chosenAction: AbstractAction;
}

/**
 * Create a CFR training strategy.
 * Records all decision points so the training loop can update regrets after the game.
 */
export function createCFRTrainingStrategy(
  cfrEngine: CFREngine,
  decisionLog: DecisionRecord[],
): BotStrategy {
  return (context: BotStrategyContext): BotStrategyAction | undefined => {
    const { state, botId, botCards, totalCards } = context;

    const legalActions = getLegalAbstractActions(state);
    if (legalActions.length === 0) return undefined;

    const infoSetKey = getInfoSetKey(state, botCards, totalCards);
    const { action: abstractAction, strategy } = cfrEngine.sampleAction(infoSetKey, legalActions);

    // Accumulate strategy for averaging
    cfrEngine.accumulateStrategy(infoSetKey, legalActions, strategy);

    // Record the decision for post-game regret updates
    decisionLog.push({
      botId,
      infoSetKey,
      legalActions,
      strategy,
      chosenAction: abstractAction,
    });

    return mapAbstractToConcreteAction(abstractAction, state, botCards);
  };
}

/** Stats tracked during evaluation for diagnosing strategy coverage. */
export interface EvaluationStats {
  /** Total decision points encountered. */
  totalDecisions: number;
  /** Decision points where the info set was found in the strategy. */
  hits: number;
  /** Decision points where the info set was NOT in the strategy (uniform random fallback). */
  misses: number;
}

/**
 * Create a CFR evaluation strategy from a pre-trained strategy file.
 * Uses the average strategy to make decisions — no exploration.
 *
 * Optionally accepts an EvaluationStats object to track info set coverage.
 */
export function createCFREvaluationStrategy(
  exportedStrategy: ExportedStrategy,
  evalStats?: EvaluationStats,
): BotStrategy {
  return (context: BotStrategyContext): BotStrategyAction | undefined => {
    const { state, botCards, totalCards } = context;

    const legalActions = getLegalAbstractActions(state);
    if (legalActions.length === 0) return undefined;

    const infoSetKey = getInfoSetKey(state, botCards, totalCards);
    const strategyEntry = exportedStrategy.strategy[infoSetKey];

    let chosenAction: AbstractAction;

    if (evalStats) evalStats.totalDecisions++;

    if (strategyEntry) {
      if (evalStats) evalStats.hits++;

      // Build a proper probability distribution over legal actions
      // Strategy entry may not cover all legal actions (pruned near-zero probs)
      let totalProb = 0;
      for (const action of legalActions) {
        totalProb += strategyEntry[action] ?? 0;
      }

      if (totalProb > 0) {
        // Renormalize over legal actions to handle rounding/pruning
        const r = Math.random() * totalProb;
        let cumulative = 0;
        chosenAction = legalActions[legalActions.length - 1]!; // fallback to last (not first)
        for (const action of legalActions) {
          cumulative += strategyEntry[action] ?? 0;
          if (r <= cumulative) {
            chosenAction = action;
            break;
          }
        }
      } else {
        // Strategy entry exists but has no coverage of current legal actions
        chosenAction = legalActions[Math.floor(Math.random() * legalActions.length)]!;
      }
    } else {
      if (evalStats) evalStats.misses++;
      // Info set not in trained strategy — fall back to uniform random
      chosenAction = legalActions[Math.floor(Math.random() * legalActions.length)]!;
    }

    return mapAbstractToConcreteAction(chosenAction, state, botCards);
  };
}
