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
    const { state, botId, botCards, totalCards, activePlayers } = context;

    const legalActions = getLegalAbstractActions(state);
    if (legalActions.length === 0) return undefined;

    const infoSetKey = getInfoSetKey(state, botCards, totalCards, activePlayers);
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
 * Create a CFR evaluation strategy from a single pre-trained strategy file.
 * Uses the trained strategy to make decisions — no exploration.
 *
 * Optionally accepts an EvaluationStats object to track info set coverage.
 */
export function createCFREvaluationStrategy(
  exportedStrategy: ExportedStrategy,
  evalStats?: EvaluationStats,
): BotStrategy {
  return makeEvalStrategy(exportedStrategy, evalStats);
}

/**
 * Create a composite CFR evaluation strategy from per-player-count strategy files.
 * Dispatches to the correct strategy based on the number of active players.
 *
 * @param strategies Map from player count bucket ('p2', 'p3', 'p4', 'p5+') to strategy
 * @param evalStats Optional stats tracker
 */
export function createCompositeEvaluationStrategy(
  strategies: Map<string, ExportedStrategy>,
  evalStats?: EvaluationStats,
): BotStrategy {
  // Pre-build individual eval strategies for each bucket
  const bucketStrategies = new Map<string, BotStrategy>();
  for (const [bucket, strategy] of strategies) {
    bucketStrategies.set(bucket, makeEvalStrategy(strategy, evalStats));
  }

  return (context: BotStrategyContext): BotStrategyAction | undefined => {
    const bucket = resolvePlayerBucket(context.activePlayers);
    const strategy = bucketStrategies.get(bucket);
    if (strategy) {
      return strategy(context);
    }
    // No strategy for this player count — fall back to undefined (heuristic)
    if (evalStats) {
      evalStats.totalDecisions++;
      evalStats.misses++;
    }
    return undefined;
  };
}

/** Map active player count to the bucket key used in info set keys. */
function resolvePlayerBucket(activePlayers: number): string {
  if (activePlayers <= 2) return 'p2';
  if (activePlayers <= 4) return 'p34';
  return 'p5+';
}

/**
 * Heuristic fallback for missing info sets.
 * Instead of uniform random (which produces catastrophically bad play),
 * use conservative defaults:
 * - Opening: TRUTHFUL_LOW (conservative start)
 * - Responding to a call: favor BULL slightly (default skepticism)
 * - Bull phase: favor BULL (challenge is usually correct at lower claims)
 * - Last chance: favor PASS (don't over-commit)
 */
function heuristicFallback(
  legalActions: AbstractAction[],
  state: BotStrategyContext['state'],
): AbstractAction {
  // Build weighted distribution based on game phase
  const weights = new Map<AbstractAction, number>();
  for (const action of legalActions) {
    weights.set(action, 1); // base weight = 1
  }

  if (legalActions.includes(AbstractAction.BULL)) {
    weights.set(AbstractAction.BULL, 3); // Favor challenging
  }
  if (legalActions.includes(AbstractAction.TRUE)) {
    weights.set(AbstractAction.TRUE, 2); // Some belief
  }
  if (legalActions.includes(AbstractAction.PASS)) {
    weights.set(AbstractAction.PASS, 4); // Strongly prefer passing
  }
  if (legalActions.includes(AbstractAction.TRUTHFUL_LOW)) {
    weights.set(AbstractAction.TRUTHFUL_LOW, 2); // Prefer conservative claims
  }

  // Sample from weighted distribution
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

/** Shared implementation for single-strategy evaluation. */
function makeEvalStrategy(
  exportedStrategy: ExportedStrategy,
  evalStats?: EvaluationStats,
): BotStrategy {
  return (context: BotStrategyContext): BotStrategyAction | undefined => {
    const { state, botCards, totalCards, activePlayers } = context;

    const legalActions = getLegalAbstractActions(state);
    if (legalActions.length === 0) return undefined;

    const infoSetKey = getInfoSetKey(state, botCards, totalCards, activePlayers);
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
        chosenAction = heuristicFallback(legalActions, state);
      }
    } else {
      if (evalStats) evalStats.misses++;
      // Info set not in trained strategy — use heuristic fallback
      // instead of uniform random (which produces catastrophically bad play)
      chosenAction = heuristicFallback(legalActions, state);
    }

    return mapAbstractToConcreteAction(chosenAction, state, botCards);
  };
}
