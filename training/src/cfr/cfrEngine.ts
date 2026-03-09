/**
 * Vanilla CFR (Counterfactual Regret Minimization) engine.
 *
 * Tracks cumulative regret and cumulative strategy for each information set,
 * then uses regret matching to compute action probabilities.
 *
 * This is the core data structure — the training loop drives iteration
 * by running games and feeding outcomes back here.
 */

import { AbstractAction, ALL_ABSTRACT_ACTIONS } from './infoSet.js';

/** Per-information-set node tracking regret and strategy sums. */
export interface CFRNode {
  /** Cumulative regret for each action. */
  regretSum: Record<string, number>;
  /** Cumulative strategy (weighted by reach probability) for each action. */
  strategySum: Record<string, number>;
  /** Number of times this info set was visited. */
  visits: number;
}

/** Serializable CFR state for checkpointing. */
export interface CFRState {
  /** Map from info set key to CFR node data. */
  nodes: Record<string, CFRNode>;
  /** Total training iterations completed. */
  iterations: number;
  /** Timestamp of last update. */
  lastUpdated: string;
}

/** Compact strategy entry for export (info set → action probabilities). */
export interface StrategyEntry {
  [action: string]: number;
}

/** Exported strategy file format. */
export interface ExportedStrategy {
  /** Map from info set key to action probability distribution. */
  strategy: Record<string, StrategyEntry>;
  /** Number of training iterations. */
  iterations: number;
  /** Number of unique information sets. */
  infoSetCount: number;
  /** Timestamp of export. */
  exportedAt: string;
  /** Average regret (convergence metric). */
  avgRegret: number;
}

export class CFREngine {
  /** Map from info set key to node. */
  private nodes = new Map<string, CFRNode>();
  /** Total iterations completed. */
  private _iterations = 0;

  get iterations(): number {
    return this._iterations;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  /** Get or create a CFR node for an information set. */
  getNode(infoSetKey: string, legalActions: AbstractAction[]): CFRNode {
    let node = this.nodes.get(infoSetKey);
    if (!node) {
      const regretSum: Record<string, number> = {};
      const strategySum: Record<string, number> = {};
      for (const action of legalActions) {
        regretSum[action] = 0;
        strategySum[action] = 0;
      }
      node = { regretSum, strategySum, visits: 0 };
      this.nodes.set(infoSetKey, node);
    }
    return node;
  }

  /**
   * Regret matching: convert cumulative regrets into a probability distribution.
   * Actions with positive regret get probability proportional to their regret.
   * If all regrets are non-positive, use uniform distribution over legal actions.
   */
  getStrategy(node: CFRNode, legalActions: AbstractAction[]): Record<string, number> {
    const strategy: Record<string, number> = {};
    let normalizingSum = 0;

    for (const action of legalActions) {
      const regret = node.regretSum[action] ?? 0;
      const positiveRegret = Math.max(0, regret);
      strategy[action] = positiveRegret;
      normalizingSum += positiveRegret;
    }

    if (normalizingSum > 0) {
      for (const action of legalActions) {
        strategy[action] = strategy[action]! / normalizingSum;
      }
    } else {
      // Uniform distribution
      const prob = 1 / legalActions.length;
      for (const action of legalActions) {
        strategy[action] = prob;
      }
    }

    return strategy;
  }

  /**
   * Sample an action from the current strategy at this info set.
   * Returns both the chosen action and the strategy (for weighting).
   */
  sampleAction(
    infoSetKey: string,
    legalActions: AbstractAction[],
  ): { action: AbstractAction; strategy: Record<string, number> } {
    const node = this.getNode(infoSetKey, legalActions);
    const strategy = this.getStrategy(node, legalActions);

    // Roulette wheel selection
    const r = Math.random();
    let cumulative = 0;
    for (const action of legalActions) {
      cumulative += strategy[action] ?? 0;
      if (r <= cumulative) {
        return { action, strategy };
      }
    }

    // Fallback (floating point edge case)
    return { action: legalActions[legalActions.length - 1]!, strategy };
  }

  /**
   * Update regrets for an info set after observing outcomes.
   * In external sampling CFR, we update regrets as:
   *   regret[a] += utility(a) - utility(strategy)
   * where utility(strategy) is the weighted average utility.
   */
  updateRegrets(
    infoSetKey: string,
    legalActions: AbstractAction[],
    actionUtilities: Record<string, number>,
    strategyUtility: number,
  ): void {
    const node = this.getNode(infoSetKey, legalActions);
    node.visits++;

    for (const action of legalActions) {
      const utility = actionUtilities[action] ?? 0;
      const regret = utility - strategyUtility;
      node.regretSum[action] = (node.regretSum[action] ?? 0) + regret;
    }
  }

  /**
   * Accumulate the current strategy into the strategy sum (for averaging).
   * This is called each iteration to build the average strategy.
   */
  accumulateStrategy(
    infoSetKey: string,
    legalActions: AbstractAction[],
    strategy: Record<string, number>,
    weight: number = 1,
  ): void {
    const node = this.getNode(infoSetKey, legalActions);
    for (const action of legalActions) {
      node.strategySum[action] = (node.strategySum[action] ?? 0) + weight * (strategy[action] ?? 0);
    }
  }

  /**
   * Get the average strategy for an info set (the converged solution).
   * This is what gets exported as the final strategy.
   */
  getAverageStrategy(node: CFRNode): Record<string, number> {
    const strategy: Record<string, number> = {};
    let normalizingSum = 0;

    for (const [action, sum] of Object.entries(node.strategySum)) {
      normalizingSum += sum;
    }

    if (normalizingSum > 0) {
      for (const [action, sum] of Object.entries(node.strategySum)) {
        strategy[action] = sum / normalizingSum;
      }
    } else {
      // Uniform over all actions in this node
      const actions = Object.keys(node.strategySum);
      const prob = 1 / actions.length;
      for (const action of actions) {
        strategy[action] = prob;
      }
    }

    return strategy;
  }

  /** Increment the iteration counter. */
  incrementIterations(): void {
    this._iterations++;
  }

  /** Compute average absolute regret across all nodes (convergence metric). */
  getAverageRegret(): number {
    if (this.nodes.size === 0) return 0;

    let totalRegret = 0;
    let totalActions = 0;

    for (const node of this.nodes.values()) {
      for (const regret of Object.values(node.regretSum)) {
        totalRegret += Math.abs(regret);
        totalActions++;
      }
    }

    return totalActions > 0 ? totalRegret / totalActions : 0;
  }

  /** Compute average regret per iteration (should trend toward 0). */
  getAverageRegretPerIteration(): number {
    if (this._iterations === 0) return 0;
    return this.getAverageRegret() / this._iterations;
  }

  // ── Serialization ──────────────────────────────────────────────────────

  /** Export full CFR state for checkpointing. */
  toState(): CFRState {
    const nodes: Record<string, CFRNode> = {};
    for (const [key, node] of this.nodes) {
      nodes[key] = {
        regretSum: { ...node.regretSum },
        strategySum: { ...node.strategySum },
        visits: node.visits,
      };
    }
    return {
      nodes,
      iterations: this._iterations,
      lastUpdated: new Date().toISOString(),
    };
  }

  /** Load CFR state from a checkpoint. */
  fromState(state: CFRState): void {
    this.nodes.clear();
    for (const [key, node] of Object.entries(state.nodes)) {
      this.nodes.set(key, {
        regretSum: { ...node.regretSum },
        strategySum: { ...node.strategySum },
        visits: node.visits,
      });
    }
    this._iterations = state.iterations;
  }

  /**
   * Export a compact strategy file.
   * Prunes near-zero probabilities and rounds to 4 decimal places.
   */
  exportStrategy(pruneThreshold: number = 0.005, precision: number = 4): ExportedStrategy {
    const strategy: Record<string, StrategyEntry> = {};

    for (const [key, node] of this.nodes) {
      const avgStrategy = this.getAverageStrategy(node);
      const entry: StrategyEntry = {};

      for (const [action, prob] of Object.entries(avgStrategy)) {
        if (prob >= pruneThreshold) {
          entry[action] = Number(prob.toFixed(precision));
        }
      }

      // Renormalize after pruning
      const sum = Object.values(entry).reduce((s, v) => s + v, 0);
      if (sum > 0 && Math.abs(sum - 1) > 0.001) {
        for (const action of Object.keys(entry)) {
          entry[action] = Number((entry[action]! / sum).toFixed(precision));
        }
      }

      // Only include nodes with meaningful strategy
      if (Object.keys(entry).length > 0) {
        strategy[key] = entry;
      }
    }

    return {
      strategy,
      iterations: this._iterations,
      infoSetCount: Object.keys(strategy).length,
      exportedAt: new Date().toISOString(),
      avgRegret: this.getAverageRegretPerIteration(),
    };
  }
}
