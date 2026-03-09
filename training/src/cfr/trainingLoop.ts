/**
 * CFR self-play training loop.
 *
 * Runs games between CFR agents, then updates regrets based on outcomes.
 * Uses probe-based counterfactual utility estimation: at each decision point
 * during a training game, the engine state is snapshotted. After the game,
 * for each unchosen action, a rollout is played from the snapshot with that
 * action to estimate the counterfactual utility.
 */

import { BotDifficulty, GameEngine, BotPlayer, RoundPhase } from '@bull-em/shared';
import type {
  GameSettings, ServerPlayer, Card, GameEngineSnapshot,
  ClientGameState,
} from '@bull-em/shared';
import type { BotAction } from '@bull-em/shared';
import { createBotPlayers } from '../gameLoop.js';
import type { BotConfig, BotStrategy, BotStrategyAction, GameResult } from '../types.js';
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

/** A decision point recorded during a training game, with engine snapshot for probing. */
interface TrainingDecisionRecord {
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
  /** Engine snapshot BEFORE the action was applied (for counterfactual probes). */
  engineSnapshot: GameEngineSnapshot;
  /** Bot's actual cards at this decision point. */
  botCards: Card[];
  /** Total cards across all active players at this decision point. */
  totalCards: number;
}

/** Result of running a training game: the game outcome plus all decision records. */
interface TrainingGameResult {
  result: GameResult;
  decisions: TrainingDecisionRecord[];
}

/**
 * Run the CFR self-play training loop.
 *
 * Each iteration:
 * 1. Plays a full game to completion, recording decision points with engine snapshots
 * 2. Computes utility for each player based on game outcome
 * 3. For each decision point, probes counterfactual utilities by replaying with alternate actions
 * 4. Updates regrets using real counterfactual utility estimates
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
    // Run a self-play game with snapshot capture
    const strategy = createCFRTrainingStrategyInternal(cfrEngine);
    const { result, decisions } = runTrainingGame(players, settings, botConfigs, cfrEngine, strategy);
    totalGames++;

    // Compute utility for each player based on game outcome
    const utilities = computePlayerUtilities(result, playerCount);

    // Update regrets using probe-based counterfactual utilities
    updateRegrets(cfrEngine, decisions, utilities, players, settings, botConfigs);

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
    const strategy = createCFRTrainingStrategyInternal(existingEngine);
    const { result, decisions } = runTrainingGame(players, settings, botConfigs, existingEngine, strategy);
    totalGames++;

    const utilities = computePlayerUtilities(result, playerCount);
    updateRegrets(existingEngine, decisions, utilities, players, settings, botConfigs);
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

// ── Training game loop with snapshot capture ──────────────────────────

/**
 * Run a single game for CFR training, capturing engine snapshots at each decision point.
 * This is a specialized version of runGame that gives us the data needed for
 * probe-based counterfactual utility estimation.
 */
function runTrainingGame(
  players: ServerPlayer[],
  settings: GameSettings,
  botConfigs: BotConfig[],
  cfrEngine: CFREngine,
  strategy: InternalTrainingStrategy,
): TrainingGameResult {
  // Reset player state for a fresh game
  for (const p of players) {
    p.cardCount = 1;
    p.isEliminated = false;
    p.cards = [];
  }

  const scope = `cfr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const engine = new GameEngine(players, settings);
  engine.startRound();

  const eliminationOrder: string[] = [];
  const decisions: TrainingDecisionRecord[] = [];
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

      // Snapshot the engine BEFORE the action for counterfactual probing
      const snapshot = engine.serialize();

      // Get action from CFR strategy (records decision internally)
      const totalCards = players
        .filter(p => !p.isEliminated)
        .reduce((sum, p) => sum + p.cardCount, 0);

      const { action, decision } = strategy(state, player, totalCards);

      // Store the snapshot and cards with the decision record
      if (decision) {
        decisions.push({
          ...decision,
          engineSnapshot: snapshot,
          botCards: [...player.cards],
          totalCards,
        });
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

// ── Internal training strategy ────────────────────────────────────────

/** Decision record without snapshot (added by runTrainingGame). */
interface BaseDecisionRecord {
  botId: string;
  infoSetKey: string;
  legalActions: AbstractAction[];
  strategy: Record<string, number>;
  chosenAction: AbstractAction;
}

/** Internal strategy function that returns both the action and the decision record. */
type InternalTrainingStrategy = (
  state: ClientGameState,
  player: ServerPlayer,
  totalCards: number,
) => { action: BotAction; decision: BaseDecisionRecord | null };

/**
 * Create a CFR training strategy that samples actions and records decisions.
 * Unlike the exported version in cfrStrategy.ts, this returns both the action
 * and decision record directly (without storing snapshots — those are added by
 * runTrainingGame which has access to the engine).
 */
function createCFRTrainingStrategyInternal(cfrEngine: CFREngine): InternalTrainingStrategy {
  return (state: ClientGameState, player: ServerPlayer, totalCards: number) => {
    const legalActions = getLegalAbstractActions(state);

    if (legalActions.length === 0) {
      // Fallback to built-in heuristic
      const heuristicAction = BotPlayer.decideAction(
        state, player.id, player.cards, BotDifficulty.HARD, undefined,
        'cfr-fallback',
      );
      return { action: heuristicAction, decision: null };
    }

    const infoSetKey = getInfoSetKey(state, player.cards, totalCards);
    const { action: abstractAction, strategy } = cfrEngine.sampleAction(infoSetKey, legalActions);

    // Accumulate strategy for averaging
    cfrEngine.accumulateStrategy(infoSetKey, legalActions, strategy);

    const concreteAction = mapAbstractToConcreteAction(abstractAction, state, player.cards);

    if (!concreteAction) {
      // Abstract action couldn't map to concrete — fallback
      const heuristicAction = BotPlayer.decideAction(
        state, player.id, player.cards, BotDifficulty.HARD, undefined,
        'cfr-fallback',
      );
      return { action: heuristicAction, decision: null };
    }

    return {
      action: concreteAction,
      decision: {
        botId: player.id,
        infoSetKey,
        legalActions,
        strategy,
        chosenAction: abstractAction,
      },
    };
  };
}

// ── Counterfactual probe rollouts ─────────────────────────────────────

/**
 * Roll out a game from a snapshot with a specified first action.
 * Used for probing counterfactual utilities of unchosen actions.
 * Returns the game result, or null if the action was invalid.
 */
function rolloutFromSnapshot(
  snapshot: GameEngineSnapshot,
  firstPlayerId: string,
  firstAction: BotAction,
  cfrEngine: CFREngine,
): GameResult | null {
  const engine = GameEngine.restore(snapshot);
  const players = snapshot.players.map(p => ({ ...p, cards: [...p.cards] }));

  // Apply the counterfactual first action
  const firstResult = dispatchBotAction(engine, firstPlayerId, firstAction);

  if (firstResult.type === 'error') {
    return null;
  }

  const eliminationOrder: string[] = [];
  let totalTurns = 1;
  let roundCount = 0;

  // Handle immediate resolution from the first action
  if (firstResult.type === 'resolve') {
    for (const elimId of firstResult.result.eliminatedPlayerIds) {
      if (!eliminationOrder.includes(elimId)) {
        eliminationOrder.push(elimId);
      }
    }
    if (engine.gameOver) {
      return {
        winnerId: engine.winnerId ?? players.find(p => !p.isEliminated)?.id ?? '',
        rounds: 1,
        turns: totalTurns,
        eliminationOrder,
      };
    }
    const next = engine.startNextRound();
    if (next.type === 'game_over') {
      return {
        winnerId: next.winnerId,
        rounds: 1,
        turns: totalTurns,
        eliminationOrder,
      };
    }
    roundCount = 1;
  } else if (firstResult.type === 'game_over') {
    if (firstResult.finalRoundResult) {
      for (const elimId of firstResult.finalRoundResult.eliminatedPlayerIds) {
        if (!eliminationOrder.includes(elimId)) {
          eliminationOrder.push(elimId);
        }
      }
    }
    return {
      winnerId: firstResult.winnerId ?? engine.winnerId ?? '',
      rounds: 1,
      turns: totalTurns,
      eliminationOrder,
    };
  }

  // Play out the rest of the game using CFR strategy
  const scope = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  while (!engine.gameOver && roundCount < MAX_ROUNDS) {
    roundCount++;
    let roundTurns = 0;

    while (roundTurns < MAX_TURNS_PER_ROUND) {
      const currentId = engine.currentPlayerId;
      const player = players.find(p => p.id === currentId);
      if (!player) break;

      const state = engine.getClientState(currentId);
      const action = getProbeAction(state, player, cfrEngine, players, scope);
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
    winnerId: engine.winnerId ?? players.find(p => !p.isEliminated)?.id ?? '',
    rounds: roundCount,
    turns: totalTurns,
    eliminationOrder,
  };
}

/**
 * Get an action for probe rollouts using the current CFR strategy.
 * Falls back to heuristic bot if the CFR strategy can't produce a valid action.
 */
function getProbeAction(
  state: ClientGameState,
  player: ServerPlayer,
  cfrEngine: CFREngine,
  allPlayers: ServerPlayer[],
  scope: string,
): BotAction {
  const legalActions = getLegalAbstractActions(state);

  if (legalActions.length > 0) {
    const totalCards = allPlayers
      .filter(p => !p.isEliminated)
      .reduce((sum, p) => sum + p.cardCount, 0);
    const infoSetKey = getInfoSetKey(state, player.cards, totalCards);
    const { action: abstractAction } = cfrEngine.sampleAction(infoSetKey, legalActions);
    const concreteAction = mapAbstractToConcreteAction(abstractAction, state, player.cards);
    if (concreteAction) return concreteAction;
  }

  // Fallback to heuristic
  return BotPlayer.decideAction(
    state, player.id, player.cards, BotDifficulty.HARD, undefined, scope,
  );
}

// ── Regret updates with counterfactual probes ─────────────────────────

/**
 * Update CFR regrets based on real counterfactual utility estimates.
 *
 * For each decision point, we know the utility of the chosen action (from the
 * actual game outcome). For each unchosen action, we probe the counterfactual
 * utility by replaying from the decision point's snapshot with that action
 * and playing out the rest of the game.
 *
 * This gives us real utility estimates for regret computation instead of
 * the crude heuristic that was previously used.
 */
function updateRegrets(
  engine: CFREngine,
  decisions: TrainingDecisionRecord[],
  utilities: Map<string, number>,
  players: ServerPlayer[],
  settings: GameSettings,
  botConfigs: BotConfig[],
): void {
  for (const decision of decisions) {
    const chosenUtility = utilities.get(decision.botId) ?? 0;

    // Strategy utility: the expected utility under the current strategy.
    // We use the actual utility weighted by the probability of the chosen action,
    // plus probe utilities weighted by their probabilities.
    const actionUtilities: Record<string, number> = {};
    actionUtilities[decision.chosenAction] = chosenUtility;

    // Probe counterfactual utilities for unchosen actions
    for (const action of decision.legalActions) {
      if (action === decision.chosenAction) continue;

      // Map the abstract action to a concrete action using the saved state
      const restoredEngine = GameEngine.restore(decision.engineSnapshot);
      const state = restoredEngine.getClientState(decision.botId);
      const concreteAction = mapAbstractToConcreteAction(action, state, decision.botCards);

      if (!concreteAction) {
        // Can't map this action — use the chosen utility as a neutral estimate
        actionUtilities[action] = chosenUtility;
        continue;
      }

      // Probe: play out the game from this point with the alternative action
      const probeResult = rolloutFromSnapshot(
        decision.engineSnapshot,
        decision.botId,
        concreteAction,
        engine,
      );

      if (probeResult) {
        // Compute utility for the deciding player from the probe result
        const probePlayerCount = decision.engineSnapshot.players.filter(p => !p.isEliminated).length;
        const probeUtilities = computePlayerUtilities(probeResult, probePlayerCount);
        actionUtilities[action] = probeUtilities.get(decision.botId) ?? 0;
      } else {
        // Probe failed (invalid action) — use neutral estimate
        actionUtilities[action] = chosenUtility;
      }
    }

    // Compute strategy utility as the weighted sum of action utilities
    let strategyUtility = 0;
    for (const action of decision.legalActions) {
      const prob = decision.strategy[action] ?? 0;
      const util = actionUtilities[action] ?? 0;
      strategyUtility += prob * util;
    }

    engine.updateRegrets(
      decision.infoSetKey,
      decision.legalActions,
      actionUtilities,
      strategyUtility,
    );
  }
}
