/**
 * CFR self-play training loop for the 5 Draw minigame.
 *
 * Unlike the standard Bull 'Em training which uses the full GameEngine,
 * this loop simulates the simplified 5 Draw game directly:
 * - 2 players, 5 cards each, 10 total
 * - Alternating turns: raise or pass
 * - No bull/true phases
 * - Pure self-play (2-player zero-sum → converges to Nash)
 *
 * Uses outcome sampling MCCFR with alternating updates.
 */

import type { Card, HandCall } from '@bull-em/shared';
import { HandChecker, isHigherHand, getMinimumRaise } from '@bull-em/shared';
import { buildDeck, shuffleDeck } from '@bull-em/shared';
import { CFREngine } from './cfrEngine.js';
import {
  FiveDrawAction,
  getFiveDrawLegalActions,
  getFiveDrawInfoSetKey,
} from './fiveDrawInfoSet.js';
import { mapFiveDrawAction } from './fiveDrawActionMapper.js';

const MAX_TURNS = 100;

export interface FiveDrawTrainingConfig {
  iterations: number;
  progressInterval: number;
  checkpointInterval: number;
  onCheckpoint?: (engine: CFREngine, iteration: number) => void;
  onProgress?: (metrics: FiveDrawProgressMetrics) => void;
}

export interface FiveDrawProgressMetrics {
  iteration: number;
  totalIterations: number;
  infoSets: number;
  avgRegretPerIteration: number;
  gamesPerSecond: number;
  elapsedMs: number;
  p1WinRate: number;
  p2WinRate: number;
}

export interface FiveDrawTrainingResult {
  engine: CFREngine;
  totalIterations: number;
  durationMs: number;
  finalAvgRegret: number;
  infoSetCount: number;
  p1Wins: number;
  p2Wins: number;
}

/** A decision point recorded during a training game. */
interface DecisionRecord {
  player: 0 | 1;
  infoSetKey: string;
  legalActions: FiveDrawAction[];
  strategy: Record<string, number>;
  chosenAction: FiveDrawAction;
}

/**
 * Mix ε-greedy exploration into a strategy.
 */
function mixExploration(
  strategy: Record<string, number>,
  legalActions: FiveDrawAction[],
  epsilon: number,
): Record<string, number> {
  const mixed: Record<string, number> = {};
  const uniform = 1 / legalActions.length;
  for (const action of legalActions) {
    mixed[action] = (1 - epsilon) * (strategy[action] ?? 0) + epsilon * uniform;
  }
  return mixed;
}

/**
 * Run the 5 Draw CFR self-play training loop.
 * Pure self-play — both players use the CFR strategy, converging to Nash.
 */
export function trainFiveDrawCFR(config: FiveDrawTrainingConfig): FiveDrawTrainingResult {
  const {
    iterations,
    progressInterval,
    checkpointInterval,
    onCheckpoint,
    onProgress,
  } = config;

  const cfrEngine = new CFREngine();
  const startTime = performance.now();
  let p1Wins = 0;
  let p2Wins = 0;

  // Window for recent win rate tracking
  const windowSize = 1000;
  let windowP1Wins = 0;
  let windowGames = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Alternating updates: update player 0 on even iters, player 1 on odd
    const traverser: 0 | 1 = (iter % 2) as 0 | 1;

    const result = runFiveDrawTrainingGame(cfrEngine, iter, traverser);

    // Update regrets for the traverser only
    updateRegrets(cfrEngine, result.decisions, result.winner, traverser);
    cfrEngine.incrementIterations();

    if (result.winner === 0) {
      p1Wins++;
      windowP1Wins++;
    } else {
      p2Wins++;
    }
    windowGames++;
    if (windowGames > windowSize) {
      // Reset window periodically
      windowP1Wins = result.winner === 0 ? 1 : 0;
      windowGames = 1;
    }

    if (progressInterval > 0 && (iter + 1) % progressInterval === 0) {
      const elapsed = performance.now() - startTime;
      onProgress?.({
        iteration: iter + 1,
        totalIterations: iterations,
        infoSets: cfrEngine.nodeCount,
        avgRegretPerIteration: cfrEngine.getAverageRegretPerIteration(),
        gamesPerSecond: (iter + 1) / (elapsed / 1000),
        elapsedMs: elapsed,
        p1WinRate: windowGames > 0 ? windowP1Wins / windowGames : 0.5,
        p2WinRate: windowGames > 0 ? 1 - (windowP1Wins / windowGames) : 0.5,
      });
    }

    if (checkpointInterval > 0 && (iter + 1) % checkpointInterval === 0) {
      onCheckpoint?.(cfrEngine, iter + 1);
    }
  }

  const durationMs = performance.now() - startTime;

  return {
    engine: cfrEngine,
    totalIterations: iterations,
    durationMs,
    finalAvgRegret: cfrEngine.getAverageRegretPerIteration(),
    infoSetCount: cfrEngine.nodeCount,
    p1Wins,
    p2Wins,
  };
}

/**
 * Resume 5 Draw training from an existing engine state.
 */
export function resumeFiveDrawTraining(
  existingEngine: CFREngine,
  config: FiveDrawTrainingConfig,
): FiveDrawTrainingResult {
  const {
    iterations: additionalIterations,
    progressInterval,
    checkpointInterval,
    onCheckpoint,
    onProgress,
  } = config;

  const startTime = performance.now();
  const startIter = existingEngine.iterations;
  let p1Wins = 0;
  let p2Wins = 0;
  let windowP1Wins = 0;
  let windowGames = 0;
  const windowSize = 1000;

  for (let i = 0; i < additionalIterations; i++) {
    const globalIter = startIter + i;
    const traverser: 0 | 1 = (globalIter % 2) as 0 | 1;

    const result = runFiveDrawTrainingGame(existingEngine, globalIter, traverser);
    updateRegrets(existingEngine, result.decisions, result.winner, traverser);
    existingEngine.incrementIterations();

    if (result.winner === 0) {
      p1Wins++;
      windowP1Wins++;
    } else {
      p2Wins++;
    }
    windowGames++;
    if (windowGames > windowSize) {
      windowP1Wins = result.winner === 0 ? 1 : 0;
      windowGames = 1;
    }

    const currentIter = startIter + i + 1;

    if (progressInterval > 0 && (i + 1) % progressInterval === 0) {
      const elapsed = performance.now() - startTime;
      onProgress?.({
        iteration: currentIter,
        totalIterations: startIter + additionalIterations,
        infoSets: existingEngine.nodeCount,
        avgRegretPerIteration: existingEngine.getAverageRegretPerIteration(),
        gamesPerSecond: (i + 1) / (elapsed / 1000),
        elapsedMs: elapsed,
        p1WinRate: windowGames > 0 ? windowP1Wins / windowGames : 0.5,
        p2WinRate: windowGames > 0 ? 1 - (windowP1Wins / windowGames) : 0.5,
      });
    }

    if (checkpointInterval > 0 && (i + 1) % checkpointInterval === 0) {
      onCheckpoint?.(existingEngine, currentIter);
    }
  }

  const durationMs = performance.now() - startTime;

  return {
    engine: existingEngine,
    totalIterations: existingEngine.iterations,
    durationMs,
    finalAvgRegret: existingEngine.getAverageRegretPerIteration(),
    infoSetCount: existingEngine.nodeCount,
    p1Wins,
    p2Wins,
  };
}

// ── Game simulation ─────────────────────────────────────────────────

interface FiveDrawGameResult {
  winner: 0 | 1;
  decisions: DecisionRecord[];
}

/**
 * Run a single 5 Draw training game.
 * P1 (player 0) opens, P2 (player 1) responds, alternating.
 */
function runFiveDrawTrainingGame(
  cfrEngine: CFREngine,
  iteration: number,
  traverser: 0 | 1,
): FiveDrawGameResult {
  // Deal cards
  const deck = shuffleDeck(buildDeck());
  const p1Cards = deck.slice(0, 5);
  const p2Cards = deck.slice(5, 10);
  const allCards = [...p1Cards, ...p2Cards];
  const cards: [Card[], Card[]] = [p1Cards, p2Cards];

  let currentHand: HandCall | null = null;
  let lastCaller: 0 | 1 = 0;
  let currentPlayer: 0 | 1 = 0; // P1 opens
  let turnCount = 0;
  const decisions: DecisionRecord[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const myCards = cards[currentPlayer]!;
    const isOpener = currentPlayer === 0;
    const legalActions = getFiveDrawLegalActions(currentHand);

    const infoSetKey = getFiveDrawInfoSetKey(myCards, currentHand, turnCount, isOpener);
    // Use FiveDrawAction strings as AbstractAction-compatible keys in CFREngine
    const node = cfrEngine.getNode(infoSetKey, legalActions as unknown as import('./infoSet.js').AbstractAction[]);
    const baseStrategy = cfrEngine.getStrategy(node, legalActions as unknown as import('./infoSet.js').AbstractAction[]);

    // Mix in exploration — decays over training
    const epsilon = Math.max(0.05, 0.4 / Math.sqrt(1 + iteration / 1000));
    const samplingStrategy = mixExploration(baseStrategy, legalActions, epsilon);

    // Accumulate the base strategy (for average strategy computation)
    const weight = Math.max(1, iteration);
    cfrEngine.accumulateStrategy(
      infoSetKey,
      legalActions as unknown as import('./infoSet.js').AbstractAction[],
      baseStrategy,
      weight,
    );

    // Sample action
    let chosenAction: FiveDrawAction = legalActions[0]!;
    const r = Math.random();
    let cumulative = 0;
    for (const a of legalActions) {
      cumulative += samplingStrategy[a] ?? 0;
      if (r <= cumulative) {
        chosenAction = a;
        break;
      }
    }

    // Record decision
    decisions.push({
      player: currentPlayer,
      infoSetKey,
      legalActions,
      strategy: samplingStrategy,
      chosenAction,
    });

    // Execute action
    const concrete = mapFiveDrawAction(chosenAction, currentHand, myCards);

    if (concrete.action === 'pass') {
      // Round ends — resolve
      break;
    }

    // It's a raise
    if (concrete.hand) {
      // Validate the raise is actually higher
      if (currentHand && !isHigherHand(concrete.hand, currentHand)) {
        // Invalid raise — treat as pass
        break;
      }
      currentHand = concrete.hand;
      lastCaller = currentPlayer;
    } else {
      // No hand produced — treat as pass
      break;
    }

    turnCount++;
    currentPlayer = currentPlayer === 0 ? 1 : 0;
  }

  // Resolve: check if last called hand exists in all 10 cards
  if (!currentHand) {
    // Edge case: no call was ever made (shouldn't happen since P1 must open)
    return { winner: 1, decisions };
  }

  const handExists = HandChecker.exists(allCards, currentHand);
  // Last caller wins if hand exists; passer wins if it doesn't
  const winner: 0 | 1 = handExists ? lastCaller : (lastCaller === 0 ? 1 : 0);

  return { winner, decisions };
}

// ── Regret updates ──────────────────────────────────────────────────

/**
 * Update regrets using outcome sampling.
 * Only updates the traverser's decisions.
 */
function updateRegrets(
  engine: CFREngine,
  decisions: DecisionRecord[],
  winner: 0 | 1,
  traverser: 0 | 1,
): void {
  const MAX_IMPORTANCE_WEIGHT = 20;
  const MIN_PROB = 0.001;

  // Traverser utility: +1 if won, -1 if lost
  const traverserUtility = winner === traverser ? 1.0 : -1.0;

  for (const decision of decisions) {
    if (decision.player !== traverser) continue;

    const p = Math.max(decision.strategy[decision.chosenAction] ?? 0, MIN_PROB);
    const importanceWeight = Math.min(1 / p, MAX_IMPORTANCE_WEIGHT);

    const chosenValue = traverserUtility * importanceWeight;
    const baseline = p * chosenValue;

    const node = engine.getNode(
      decision.infoSetKey,
      decision.legalActions as unknown as import('./infoSet.js').AbstractAction[],
    );
    node.visits++;

    for (const action of decision.legalActions) {
      if (action === decision.chosenAction) {
        const regret = chosenValue - baseline;
        node.regretSum[action] = (node.regretSum[action] ?? 0) + regret;
      } else {
        const regret = -baseline;
        node.regretSum[action] = (node.regretSum[action] ?? 0) + regret;
      }
    }
  }
}
