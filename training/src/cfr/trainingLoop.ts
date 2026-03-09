/**
 * CFR self-play training loop — outcome sampling variant.
 *
 * Instead of probe rollouts for counterfactual utilities, uses the actual
 * game outcome to update regrets along the sampled path only. This is
 * dramatically faster per iteration and converges well for 1v1.
 *
 * Each iteration:
 * 1. Play a full game to completion, recording decision points
 * 2. Compute utility for each player from the game outcome (+1 win, -1 loss)
 * 3. Update regrets for every decision point on the sampled path:
 *    - For the chosen action: utility = actual outcome
 *    - For unchosen actions: utility = 0 (baseline / no information)
 *    - Regret = action_utility - strategy_weighted_utility
 */

import { BotDifficulty, GameEngine, BotPlayer } from '@bull-em/shared';
import type {
  GameSettings, ServerPlayer,
  ClientGameState,
} from '@bull-em/shared';
import type { BotAction } from '@bull-em/shared';
import { createBotPlayers } from '../gameLoop.js';
import type { BotConfig, GameResult } from '../types.js';
import { CFREngine } from './cfrEngine.js';
import {
  type AbstractAction,
  getInfoSetKey,
  getLegalAbstractActions,
} from './infoSet.js';
import { mapAbstractToConcreteAction } from './actionMapper.js';

const MAX_TURNS_PER_ROUND = 500;
const MAX_ROUNDS = 200;

export interface TrainingConfig {
  /** Number of training iterations (games of self-play). */
  iterations: number;
  /** Number of players per game (should be 2 for 1v1). */
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

/** A decision point recorded during a training game. */
interface DecisionRecord {
  botId: string;
  infoSetKey: string;
  legalActions: AbstractAction[];
  /** The actual sampling strategy used (including exploration). */
  strategy: Record<string, number>;
  chosenAction: AbstractAction;
}

/**
 * Mix ε-greedy exploration into a strategy.
 * Ensures every action has at least ε/|A| probability, preventing
 * actions from getting permanently stuck at zero.
 */
function mixExploration(
  strategy: Record<string, number>,
  legalActions: AbstractAction[],
  epsilon: number,
): Record<string, number> {
  const mixed: Record<string, number> = {};
  const uniform = 1 / legalActions.length;
  for (const action of legalActions) {
    mixed[action] = (1 - epsilon) * (strategy[action] ?? 0) + epsilon * uniform;
  }
  return mixed;
}

/** Result of running a training game: outcome + all decision records. */
interface TrainingGameResult {
  result: GameResult;
  decisions: DecisionRecord[];
}

/**
 * Run the CFR self-play training loop with outcome sampling.
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
      difficulty: BotDifficulty.HARD,
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
    const { result, decisions } = runTrainingGame(players, settings, cfrEngine, iter);
    totalGames++;

    // Compute utility: +1 for winner, -1 for loser (1v1)
    const utilities = computePlayerUtilities(result, playerCount);

    // Update regrets using outcome sampling (no probes)
    updateRegrets(cfrEngine, decisions, utilities);

    cfrEngine.incrementIterations();

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
    const { result, decisions } = runTrainingGame(players, settings, existingEngine, startIter + i);
    totalGames++;

    const utilities = computePlayerUtilities(result, playerCount);
    updateRegrets(existingEngine, decisions, utilities);
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
 * 1v1: winner gets +1, loser gets -1.
 * Multi-player: linear scale from -1 (first out) to +1 (winner).
 */
function computePlayerUtilities(result: GameResult, playerCount: number): Map<string, number> {
  const utilities = new Map<string, number>();

  if (playerCount === 2) {
    // Clean 1v1: +1 / -1
    utilities.set(result.winnerId, 1.0);
    for (const elimId of result.eliminationOrder) {
      utilities.set(elimId, -1.0);
    }
  } else {
    // Multi-player: scale from -1 to +1
    utilities.set(result.winnerId, 1.0);
    for (let i = 0; i < result.eliminationOrder.length; i++) {
      const playerId = result.eliminationOrder[i]!;
      const position = i / Math.max(1, playerCount - 1);
      utilities.set(playerId, -1.0 + position * 2.0);
    }
  }

  return utilities;
}

// ── Training game loop ───────────────────────────────────────────────

/**
 * Run a single game for CFR training, recording decision points.
 * No engine snapshots needed — outcome sampling only uses the final result.
 */
function runTrainingGame(
  players: ServerPlayer[],
  settings: GameSettings,
  cfrEngine: CFREngine,
  iteration: number = 0,
): TrainingGameResult {
  // Reset player state
  for (const p of players) {
    p.cardCount = 1;
    p.isEliminated = false;
    p.cards = [];
  }

  const scope = `cfr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const engine = new GameEngine(players, settings);
  engine.startRound();

  const eliminationOrder: string[] = [];
  const decisions: DecisionRecord[] = [];
  let totalTurns = 0;
  let roundCount = 0;

  while (!engine.gameOver && roundCount < MAX_ROUNDS) {
    roundCount++;
    let roundTurns = 0;

    while (roundTurns < MAX_TURNS_PER_ROUND) {
      const currentId = engine.currentPlayerId;
      const player = players.find(p => p.id === currentId);
      if (!player) break;

      const state = engine.getClientState(currentId);
      const totalCards = players
        .filter(p => !p.isEliminated)
        .reduce((sum, p) => sum + p.cardCount, 0);

      // Get CFR action
      const legalActions = getLegalAbstractActions(state);
      let action: BotAction;

      if (legalActions.length > 0) {
        const infoSetKey = getInfoSetKey(state, player.cards, totalCards);
        const node = cfrEngine.getNode(infoSetKey, legalActions);
        const baseStrategy = cfrEngine.getStrategy(node, legalActions);

        // Mix in exploration — decays from 0.4 to 0.05 over training
        const epsilon = Math.max(0.05, 0.4 / Math.sqrt(1 + iteration / 1000));
        const samplingStrategy = mixExploration(baseStrategy, legalActions, epsilon);

        // Accumulate the BASE strategy (not the exploration-mixed one)
        // for the average strategy computation
        cfrEngine.accumulateStrategy(infoSetKey, legalActions, baseStrategy);

        // Sample from the exploration-mixed strategy
        let abstractAction: AbstractAction = legalActions[0]!;
        const r = Math.random();
        let cumulative = 0;
        for (const a of legalActions) {
          cumulative += samplingStrategy[a] ?? 0;
          if (r <= cumulative) {
            abstractAction = a;
            break;
          }
        }

        const concreteAction = mapAbstractToConcreteAction(abstractAction, state, player.cards);

        if (concreteAction) {
          action = concreteAction;
          decisions.push({
            botId: player.id,
            infoSetKey,
            legalActions,
            strategy: samplingStrategy,
            chosenAction: abstractAction,
          });
        } else {
          // Fallback to heuristic if mapping fails
          action = BotPlayer.decideAction(
            state, player.id, player.cards, BotDifficulty.HARD, undefined, scope,
          );
        }
      } else {
        action = BotPlayer.decideAction(
          state, player.id, player.cards, BotDifficulty.HARD, undefined, scope,
        );
      }

      // Dispatch the action
      const result = dispatchBotAction(engine, currentId, action);

      roundTurns++;
      totalTurns++;

      if (result.type === 'error') {
        break;
      }

      if (result.type === 'resolve') {
        for (const elimId of result.result.eliminatedPlayerIds) {
          if (!eliminationOrder.includes(elimId)) {
            eliminationOrder.push(elimId);
          }
        }
        BotPlayer.updateMemory(result.result, scope);

        if (!engine.gameOver) {
          const next = engine.startNextRound();
          if (next.type === 'game_over') break;
        }
        break;
      }

      if (result.type === 'game_over') {
        if (result.finalRoundResult) {
          for (const elimId of result.finalRoundResult.eliminatedPlayerIds) {
            if (!eliminationOrder.includes(elimId)) {
              eliminationOrder.push(elimId);
            }
          }
        }
        break;
      }
    }
  }

  BotPlayer.resetMemory(scope);

  return {
    result: {
      winnerId: engine.winnerId ?? players.find(p => !p.isEliminated)?.id ?? '',
      rounds: roundCount,
      turns: totalTurns,
      eliminationOrder,
    },
    decisions,
  };
}

/** Dispatch a BotAction to the appropriate GameEngine handler. */
function dispatchBotAction(
  engine: GameEngine,
  playerId: string,
  action: BotAction,
): ReturnType<GameEngine['handleCall']> {
  switch (action.action) {
    case 'call':
      return engine.handleCall(playerId, action.hand);
    case 'bull':
      return engine.handleBull(playerId);
    case 'true':
      return engine.handleTrue(playerId);
    case 'lastChanceRaise':
      return engine.handleLastChanceRaise(playerId, action.hand);
    case 'lastChancePass':
      return engine.handleLastChancePass(playerId);
  }
}

// ── Outcome sampling regret updates ──────────────────────────────────

/**
 * Update regrets using importance-weighted outcome sampling.
 *
 * For each decision point on the sampled path:
 * - The chosen action's utility is importance-weighted: u / max(p, ε)
 *   where p is the sampling probability and ε prevents division explosion.
 * - Unchosen actions get utility 0 (no information).
 * - Strategy utility = u (the unbiased expected value under sampling).
 *
 * This gives correct regret magnitudes:
 * - Chosen: u/p - u = u*(1/p - 1) — amplified for rarely-sampled actions
 * - Unchosen: 0 - u = -u — constant penalty/reward based on outcome
 *
 * Over many iterations, good actions accumulate large positive regret when
 * sampled (winning at low p gives huge importance weight) that outweighs
 * the -u penalty from iterations where other actions were chosen.
 */
function updateRegrets(
  engine: CFREngine,
  decisions: DecisionRecord[],
  utilities: Map<string, number>,
): void {
  // Maximum importance weight to prevent variance explosion
  const MAX_IMPORTANCE_WEIGHT = 20;
  // Minimum probability floor
  const MIN_PROB = 0.001;

  for (const decision of decisions) {
    const playerUtility = utilities.get(decision.botId) ?? 0;

    const p = Math.max(decision.strategy[decision.chosenAction] ?? 0, MIN_PROB);
    const importanceWeight = Math.min(1 / p, MAX_IMPORTANCE_WEIGHT);

    const actionUtilities: Record<string, number> = {};

    for (const action of decision.legalActions) {
      if (action === decision.chosenAction) {
        // Importance-weighted utility for the sampled action
        actionUtilities[action] = playerUtility * importanceWeight;
      } else {
        // No information about unchosen actions
        actionUtilities[action] = 0;
      }
    }

    // Strategy utility = E[v̂(a)] under sampling = p * (u/p) + (1-p)*0 = u
    const strategyUtility = playerUtility;

    engine.updateRegrets(
      decision.infoSetKey,
      decision.legalActions,
      actionUtilities,
      strategyUtility,
    );
  }
}
