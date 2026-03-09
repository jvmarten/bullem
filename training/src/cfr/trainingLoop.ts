/**
 * CFR self-play training loop.
 *
 * Runs games between CFR agents, then updates regrets based on outcomes.
 * Uses external sampling: each iteration plays a full game, then computes
 * counterfactual regrets for each decision point based on the game result.
 *
 * The utility signal is binary: +1 for winning, -1 for losing, scaled
 * by finish position for multiplayer games.
 */

import { BotDifficulty } from '@bull-em/shared';
import type { GameSettings } from '@bull-em/shared';
import { createBotPlayers, runGame } from '../gameLoop.js';
import type { BotConfig, GameResult } from '../types.js';
import { CFREngine } from './cfrEngine.js';
import { createCFRTrainingStrategy, type DecisionRecord } from './cfrStrategy.js';
import { type AbstractAction } from './infoSet.js';

export interface TrainingConfig {
  /** Number of training iterations (games of self-play). */
  iterations: number;
  /** Number of players per game. */
  players: number;
  /** Max cards before elimination. */
  maxCards: number;
  /** How often to log progress (iterations). 0 = no progress. */
  progressInterval: number;
  /** How often to save checkpoints (iterations). 0 = no checkpoints. */
  checkpointInterval: number;
  /** Callback for saving checkpoints. */
  onCheckpoint?: (engine: CFREngine, iteration: number) => void;
  /** Callback for progress logging. */
  onProgress?: (metrics: ProgressMetrics) => void;
}

export interface ProgressMetrics {
  iteration: number;
  totalIterations: number;
  infoSets: number;
  avgRegretPerIteration: number;
  gamesPerSecond: number;
  elapsedMs: number;
}

export interface TrainingResult {
  engine: CFREngine;
  totalIterations: number;
  totalGames: number;
  durationMs: number;
  finalAvgRegret: number;
  infoSetCount: number;
}

/**
 * Run the CFR self-play training loop.
 *
 * Each iteration:
 * 1. Creates a fresh game with all CFR agents
 * 2. Plays the game to completion, recording all decision points
 * 3. Computes utility for each player based on game outcome
 * 4. Updates regrets at each decision point using outcome-sampling CFR
 */
export function trainCFR(config: TrainingConfig): TrainingResult {
  const {
    iterations,
    players: playerCount,
    maxCards,
    progressInterval,
    checkpointInterval,
    onCheckpoint,
    onProgress,
  } = config;

  const cfrEngine = new CFREngine();

  const botConfigs: BotConfig[] = Array.from(
    { length: playerCount },
    (_, i) => ({
      id: `cfr-${i}`,
      name: `CFR ${i + 1}`,
      difficulty: BotDifficulty.HARD, // Difficulty doesn't matter — strategy overrides
    }),
  );

  const settings: GameSettings = {
    maxCards,
    turnTimer: 0,
  };

  const players = createBotPlayers(botConfigs);
  const startTime = performance.now();
  let totalGames = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Record decisions made during this game
    const decisionLog: DecisionRecord[] = [];
    const strategy = createCFRTrainingStrategy(cfrEngine, decisionLog);

    // Run a self-play game
    const result = runGame(players, settings, botConfigs, strategy, BotDifficulty.HARD);
    totalGames++;

    // Compute utility for each player based on game outcome
    const utilities = computePlayerUtilities(result, playerCount);

    // Update regrets for each decision point
    updateRegrets(cfrEngine, decisionLog, utilities);

    cfrEngine.incrementIterations();

    // Progress reporting
    if (progressInterval > 0 && (iter + 1) % progressInterval === 0) {
      const elapsed = performance.now() - startTime;
      onProgress?.({
        iteration: iter + 1,
        totalIterations: iterations,
        infoSets: cfrEngine.nodeCount,
        avgRegretPerIteration: cfrEngine.getAverageRegretPerIteration(),
        gamesPerSecond: totalGames / (elapsed / 1000),
        elapsedMs: elapsed,
      });
    }

    // Checkpointing
    if (checkpointInterval > 0 && (iter + 1) % checkpointInterval === 0) {
      onCheckpoint?.(cfrEngine, iter + 1);
    }
  }

  const durationMs = performance.now() - startTime;

  return {
    engine: cfrEngine,
    totalIterations: iterations,
    totalGames,
    durationMs,
    finalAvgRegret: cfrEngine.getAverageRegretPerIteration(),
    infoSetCount: cfrEngine.nodeCount,
  };
}

/**
 * Resume training from an existing CFR engine state.
 */
export function resumeTraining(
  existingEngine: CFREngine,
  config: TrainingConfig,
): TrainingResult {
  const {
    iterations: additionalIterations,
    players: playerCount,
    maxCards,
    progressInterval,
    checkpointInterval,
    onCheckpoint,
    onProgress,
  } = config;

  const botConfigs: BotConfig[] = Array.from(
    { length: playerCount },
    (_, i) => ({
      id: `cfr-${i}`,
      name: `CFR ${i + 1}`,
      difficulty: BotDifficulty.HARD,
    }),
  );

  const settings: GameSettings = {
    maxCards,
    turnTimer: 0,
  };

  const players = createBotPlayers(botConfigs);
  const startTime = performance.now();
  const startIter = existingEngine.iterations;
  let totalGames = 0;

  for (let i = 0; i < additionalIterations; i++) {
    const decisionLog: DecisionRecord[] = [];
    const strategy = createCFRTrainingStrategy(existingEngine, decisionLog);

    const result = runGame(players, settings, botConfigs, strategy, BotDifficulty.HARD);
    totalGames++;

    const utilities = computePlayerUtilities(result, playerCount);
    updateRegrets(existingEngine, decisionLog, utilities);
    existingEngine.incrementIterations();

    const currentIter = startIter + i + 1;

    if (progressInterval > 0 && (i + 1) % progressInterval === 0) {
      const elapsed = performance.now() - startTime;
      onProgress?.({
        iteration: currentIter,
        totalIterations: startIter + additionalIterations,
        infoSets: existingEngine.nodeCount,
        avgRegretPerIteration: existingEngine.getAverageRegretPerIteration(),
        gamesPerSecond: totalGames / (elapsed / 1000),
        elapsedMs: elapsed,
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
    totalGames,
    durationMs,
    finalAvgRegret: existingEngine.getAverageRegretPerIteration(),
    infoSetCount: existingEngine.nodeCount,
  };
}

/**
 * Compute utility for each player based on the game result.
 * Winner gets +1, losers get penalties proportional to finish position.
 */
function computePlayerUtilities(result: GameResult, playerCount: number): Map<string, number> {
  const utilities = new Map<string, number>();

  // Winner gets full positive utility
  utilities.set(result.winnerId, 1.0);

  // Eliminated players get negative utility proportional to when they were eliminated
  // First eliminated = worst (-1), last eliminated = less bad
  for (let i = 0; i < result.eliminationOrder.length; i++) {
    const playerId = result.eliminationOrder[i]!;
    // Scale from -1 (first out) to -0.1 (last eliminated before winner)
    const position = i / Math.max(1, playerCount - 1);
    utilities.set(playerId, -1.0 + position * 0.9);
  }

  return utilities;
}

/**
 * Update CFR regrets based on the game outcome.
 *
 * For outcome-sampling CFR, the regret update for player i at info set h is:
 *   regret(a) = utility_if_played(a) - utility_of_strategy
 *
 * Since we can't replay the game with different actions efficiently,
 * we approximate: the chosen action gets the actual utility, and we
 * estimate counterfactual utilities for other actions using a simple heuristic:
 * - BULL when hand is likely fake → positive regret signal
 * - RAISE when we won → the raise was good
 * - etc.
 *
 * This is a simplified "outcome sampling" approach where we use the actual
 * game utility as the signal.
 */
function updateRegrets(
  engine: CFREngine,
  decisionLog: DecisionRecord[],
  utilities: Map<string, number>,
): void {
  for (const decision of decisionLog) {
    const utility = utilities.get(decision.botId) ?? 0;

    // Compute the strategy-weighted utility (expected value under current strategy)
    // In outcome sampling, we approximate this by the actual utility
    const strategyUtility = utility;

    // For the chosen action, the utility is what actually happened
    // For other actions, we use a heuristic estimate:
    // - If we won (utility > 0), the chosen action was good → other actions get lower estimated utility
    // - If we lost (utility < 0), the chosen action was bad → other actions get slightly better estimated utility
    const actionUtilities: Record<string, number> = {};

    for (const action of decision.legalActions) {
      if (action === decision.chosenAction) {
        // The action we took: actual utility
        actionUtilities[action] = utility;
      } else {
        // Counterfactual estimate for actions not taken:
        // Use a dampened inverse signal — if our action was bad, alternatives
        // might have been slightly better (and vice versa). The dampening
        // factor prevents wild swings.
        actionUtilities[action] = -utility * 0.3;
      }
    }

    engine.updateRegrets(
      decision.infoSetKey,
      decision.legalActions,
      actionUtilities,
      strategyUtility,
    );
  }
}
