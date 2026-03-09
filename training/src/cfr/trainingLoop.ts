/**
 * CFR self-play training loop — outcome sampling variant with per-round
 * credit assignment.
 *
 * Each iteration:
 * 1. Play a full game to completion, recording decision points per round
 * 2. After each round resolves, compute per-round utility:
 *    penalized players get -1, others get +1
 * 3. Update regrets for decisions in each round using that round's outcome,
 *    providing direct credit assignment instead of diluting across the game
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
  /**
   * Player count per game. When set to a single number, all games use that
   * count. When set to an array (e.g. [2, 3, 4, 6]), each iteration randomly
   * picks from the array — training the strategy across multiple table sizes.
   */
  players: number | number[];
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
  /** Which round this decision belongs to (for per-round credit assignment). */
  roundIndex: number;
}

/** Per-round outcome for credit assignment. */
interface RoundOutcome {
  /** Player IDs that were penalized (gained a card) this round. */
  penalizedPlayerIds: string[];
  /** All active player IDs at the start of this round. */
  activePlayerIds: string[];
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
  /** Per-round outcomes for round-level credit assignment. */
  roundOutcomes: RoundOutcome[];
}

/** Resolve player count for a single iteration — supports fixed or mixed. */
function resolvePlayerCount(players: number | number[]): number {
  if (typeof players === 'number') return players;
  return players[Math.floor(Math.random() * players.length)]!;
}

/** Validate a player count array or single value against maxCards. */
function validatePlayerCounts(players: number | number[], maxCards: number): void {
  const counts = typeof players === 'number' ? [players] : players;
  const maxPlayersForCards = Math.floor(52 / maxCards);
  for (const count of counts) {
    if (count < 2 || count > 12) {
      throw new Error(`Player count ${count} out of range (2-12)`);
    }
    if (count > maxPlayersForCards) {
      throw new Error(
        `${count} players with max ${maxCards} cards exceeds deck size. ` +
        `Max players for ${maxCards} cards: ${maxPlayersForCards}`,
      );
    }
  }
}

/**
 * Run the CFR self-play training loop with outcome sampling.
 * Supports mixed player counts to learn strategies across table sizes.
 */
export function trainCFR(config: TrainingConfig): TrainingResult {
  const {
    iterations,
    players: playerSpec,
    maxCards,
    progressInterval,
    checkpointInterval,
    onCheckpoint,
    onProgress,
  } = config;

  validatePlayerCounts(playerSpec, maxCards);

  const cfrEngine = new CFREngine();

  // Pre-create player pools for each possible player count to avoid re-allocation.
  // For mixed training, we reuse the pool matching each iteration's player count.
  const maxPlayerCount = typeof playerSpec === 'number'
    ? playerSpec
    : Math.max(...playerSpec);
  const playerPool = createBotPlayers(
    Array.from({ length: maxPlayerCount }, (_, i) => ({
      id: `cfr-${i}`,
      name: `CFR ${i + 1}`,
      difficulty: BotDifficulty.HARD,
    })),
  );

  const settings: GameSettings = {
    maxCards,
    turnTimer: 0,
  };

  const startTime = performance.now();
  let totalGames = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const playerCount = resolvePlayerCount(playerSpec);
    // Use a slice of the pool matching this iteration's player count
    const players = playerPool.slice(0, playerCount);

    // Alternate the traversing player each iteration — only update one
    // player's regrets per game to avoid contradictory signals from the
    // same trajectory (a win for player A is a loss for player B).
    const traverserId = `cfr-${iter % playerCount}`;

    const { result, decisions, roundOutcomes } = runTrainingGame(players, settings, cfrEngine, iter);
    totalGames++;

    // Update regrets per round — each round's decisions use that round's outcome.
    // This provides direct credit assignment instead of diluting across the whole game.
    updateRegretsPerRound(cfrEngine, decisions, roundOutcomes, traverserId);

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
    players: playerSpec,
    maxCards,
    progressInterval,
    checkpointInterval,
    onCheckpoint,
    onProgress,
  } = config;

  validatePlayerCounts(playerSpec, maxCards);

  const maxPlayerCount = typeof playerSpec === 'number'
    ? playerSpec
    : Math.max(...playerSpec);
  const playerPool = createBotPlayers(
    Array.from({ length: maxPlayerCount }, (_, i) => ({
      id: `cfr-${i}`,
      name: `CFR ${i + 1}`,
      difficulty: BotDifficulty.HARD,
    })),
  );

  const settings: GameSettings = {
    maxCards,
    turnTimer: 0,
  };

  const startTime = performance.now();
  const startIter = existingEngine.iterations;
  let totalGames = 0;

  for (let i = 0; i < additionalIterations; i++) {
    const playerCount = resolvePlayerCount(playerSpec);
    const players = playerPool.slice(0, playerCount);
    const traverserId = `cfr-${(startIter + i) % playerCount}`;

    const { result, decisions, roundOutcomes } = runTrainingGame(players, settings, existingEngine, startIter + i);
    totalGames++;

    updateRegretsPerRound(existingEngine, decisions, roundOutcomes, traverserId);
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
 * Compute per-round utility for each player.
 * Players who were penalized (gained a card) get -1, others get +1.
 */
function computeRoundUtilities(outcome: RoundOutcome): Map<string, number> {
  const utilities = new Map<string, number>();
  const penalizedSet = new Set(outcome.penalizedPlayerIds);

  for (const playerId of outcome.activePlayerIds) {
    utilities.set(playerId, penalizedSet.has(playerId) ? -1.0 : 1.0);
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
  const roundOutcomes: RoundOutcome[] = [];
  let totalTurns = 0;
  let roundCount = 0;

  while (!engine.gameOver && roundCount < MAX_ROUNDS) {
    const currentRoundIndex = roundCount;
    const activePlayerIds = players.filter(p => !p.isEliminated).map(p => p.id);
    roundCount++;
    let roundTurns = 0;

    while (roundTurns < MAX_TURNS_PER_ROUND) {
      const currentId = engine.currentPlayerId;
      const player = players.find(p => p.id === currentId);
      if (!player) break;

      const state = engine.getClientState(currentId);
      const activePlayers = players.filter(p => !p.isEliminated);
      const totalCards = activePlayers.reduce((sum, p) => sum + p.cardCount, 0);
      const activePlayerCount = activePlayers.length;

      // Get CFR action
      const legalActions = getLegalAbstractActions(state);
      let action: BotAction;

      if (legalActions.length > 0) {
        const infoSetKey = getInfoSetKey(state, player.cards, totalCards, activePlayerCount);
        const node = cfrEngine.getNode(infoSetKey, legalActions);
        const baseStrategy = cfrEngine.getStrategy(node, legalActions);

        // Mix in exploration — decays from 0.4 to 0.05 over training
        const epsilon = Math.max(0.05, 0.4 / Math.sqrt(1 + iteration / 1000));
        const samplingStrategy = mixExploration(baseStrategy, legalActions, epsilon);

        // Accumulate the BASE strategy (not the exploration-mixed one)
        // for the average strategy computation. Use linear weighting so later
        // (more informed) iterations dominate the average.
        const weight = Math.max(1, iteration);
        cfrEngine.accumulateStrategy(infoSetKey, legalActions, baseStrategy, weight);

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

        // mapAbstractToConcreteAction always returns a valid action for
        // raise/bluff/bull/true/pass — undefined only for impossible states
        if (concreteAction) {
          action = concreteAction;
        } else {
          action = BotPlayer.decideAction(
            state, player.id, player.cards, BotDifficulty.HARD, undefined, scope,
          );
        }

        // Always record the decision so CFR learns from every state
        decisions.push({
          botId: player.id,
          infoSetKey,
          legalActions,
          strategy: samplingStrategy,
          chosenAction: abstractAction,
          roundIndex: currentRoundIndex,
        });
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
        // Record per-round outcome for credit assignment
        roundOutcomes[currentRoundIndex] = {
          penalizedPlayerIds: [...result.result.penalizedPlayerIds],
          activePlayerIds,
        };

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
          // Record final round outcome
          roundOutcomes[currentRoundIndex] = {
            penalizedPlayerIds: [...result.finalRoundResult.penalizedPlayerIds],
            activePlayerIds,
          };

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
    roundOutcomes,
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
 * Update regrets per round for the traversing player only (outcome sampling MCCFR).
 *
 * CRITICAL FIX: Uses per-round utility instead of per-game utility.
 * Each decision's regret uses the outcome of the round it belongs to, not the
 * entire game. This provides direct credit assignment — a good bull call in
 * round 1 is credited for round 1's outcome, not diluted by rounds 2-5.
 *
 * Key design decisions:
 * 1. Only update ONE player per iteration (the traverser). Updating all
 *    players simultaneously creates contradictory signals.
 * 2. Update ALL actions at each decision point — both chosen and unchosen.
 *    In outcome sampling, the estimated counterfactual value is:
 *    - Chosen action a*: v̂(a*) = u * W (importance-weighted)
 *    - Unchosen action a: v̂(a) = 0 (no sample for that branch)
 *    The baseline is: σ(a*) × v̂(a*) = p × u × W
 *    So instantaneous regret is:
 *    - Chosen:   u*W - p*u*W = u*W*(1 - p)
 *    - Unchosen: 0 - p*u*W = -p*u*W
 *    When W is uncapped (W = 1/p): baseline = u, matching standard formula.
 *    When W is capped: baseline < u, correctly reducing unchosen regret magnitude.
 * 3. Importance weighting on the chosen action is capped to prevent
 *    variance explosion from low-probability samples.
 */
function updateRegretsPerRound(
  engine: CFREngine,
  decisions: DecisionRecord[],
  roundOutcomes: RoundOutcome[],
  traverserId: string,
): void {
  // Maximum importance weight to prevent variance explosion
  const MAX_IMPORTANCE_WEIGHT = 20;
  // Minimum probability floor
  const MIN_PROB = 0.001;

  for (const decision of decisions) {
    // Only update the traversing player's regrets
    if (decision.botId !== traverserId) continue;

    // Use per-round utility instead of per-game utility
    const outcome = roundOutcomes[decision.roundIndex];
    if (!outcome) continue; // Round didn't resolve (error/timeout)

    const penalizedSet = new Set(outcome.penalizedPlayerIds);
    const playerUtility = penalizedSet.has(decision.botId) ? -1.0 : 1.0;

    const p = Math.max(decision.strategy[decision.chosenAction] ?? 0, MIN_PROB);
    const importanceWeight = Math.min(1 / p, MAX_IMPORTANCE_WEIGHT);

    // Estimated counterfactual value of the chosen action
    const chosenValue = playerUtility * importanceWeight;
    // Baseline: σ(a*) × v̂(a*) = p × u × W
    // When uncapped (W = 1/p): baseline = p * u * (1/p) = u
    // When capped: baseline = p * u * W_max (correctly reduced)
    const baseline = p * chosenValue;

    const node = engine.getNode(decision.infoSetKey, decision.legalActions);
    node.visits++;

    for (const action of decision.legalActions) {
      if (action === decision.chosenAction) {
        // Chosen: v̂(a*) - baseline = u*W - p*u*W = u*W*(1 - p)
        const regret = chosenValue - baseline;
        node.regretSum[action] = (node.regretSum[action] ?? 0) + regret;
      } else {
        // Unchosen: 0 - baseline = -p*u*W
        const regret = -baseline;
        node.regretSum[action] = (node.regretSum[action] ?? 0) + regret;
      }
    }
  }
}
