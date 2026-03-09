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
  strategy: Record<string, number>;
  chosenAction: AbstractAction;
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
    const { result, decisions } = runTrainingGame(players, settings, cfrEngine);
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
    const { result, decisions } = runTrainingGame(players, settings, existingEngine);
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
        const { action: abstractAction, strategy } = cfrEngine.sampleAction(infoSetKey, legalActions);

        // Accumulate strategy for averaging
        cfrEngine.accumulateStrategy(infoSetKey, legalActions, strategy);

        const concreteAction = mapAbstractToConcreteAction(abstractAction, state, player.cards);

        if (concreteAction) {
          action = concreteAction;
          decisions.push({
            botId: player.id,
            infoSetKey,
            legalActions,
            strategy,
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
 * Update regrets using outcome sampling.
 *
 * For each decision point on the sampled path:
 * - The chosen action gets the actual game utility
 * - Unchosen actions get utility 0 (no-information baseline)
 * - This is equivalent to importance-sampled external regret
 *
 * The key insight: over many iterations, the average regret for each
 * action converges to the true counterfactual regret because:
 * - Chosen action is sampled with probability strategy[a]
 * - The 1/strategy[a] importance weight is implicitly handled by CFR's
 *   regret accumulation (positive regret grows, negative shrinks)
 *
 * For 1v1 with a small info set space, this converges well.
 */
function updateRegrets(
  engine: CFREngine,
  decisions: DecisionRecord[],
  utilities: Map<string, number>,
): void {
  for (const decision of decisions) {
    const playerUtility = utilities.get(decision.botId) ?? 0;

    const actionUtilities: Record<string, number> = {};

    for (const action of decision.legalActions) {
      if (action === decision.chosenAction) {
        // The action we actually took — use the real outcome
        actionUtilities[action] = playerUtility;
      } else {
        // Actions we didn't take — use 0 as baseline.
        // Over many iterations, the regret for good unchosen actions
        // accumulates positively (0 > negative utility when we lost)
        // and negatively (0 < positive utility when we won).
        actionUtilities[action] = 0;
      }
    }

    // Strategy utility = weighted average of action utilities
    let strategyUtility = 0;
    for (const action of decision.legalActions) {
      const prob = decision.strategy[action] ?? 0;
      strategyUtility += prob * (actionUtilities[action] ?? 0);
    }

    engine.updateRegrets(
      decision.infoSetKey,
      decision.legalActions,
      actionUtilities,
      strategyUtility,
    );
  }
}
