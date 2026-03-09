/**
 * Evolutionary bot parameter optimization.
 *
 * Evolves BotProfileConfig parameters through tournament-based selection:
 * 1. Start with a population seeded from the 81 bot profiles + random variations
 * 2. Run round-robin tournaments (every bot vs every other bot)
 * 3. Rank by win rate, keep top performers
 * 4. Create next generation: clone winners + mutate parameters
 * 5. Repeat until win rates plateau
 *
 * Uses the existing headless simulator infrastructure (gameLoop, simulator).
 */

import { BotDifficulty } from '@bull-em/shared';
import type { BotProfileConfig } from '@bull-em/shared';
import { BOT_PROFILES, DEFAULT_BOT_PROFILE_CONFIG } from '@bull-em/shared';
import { createBotPlayers, runGame } from './gameLoop.js';
import type { BotConfig, GameResult } from './types.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────

/** A single individual in the population — a set of bot parameters with a unique ID. */
export interface Individual {
  id: string;
  config: BotProfileConfig;
  /** Which seed this individual originated from (personality name or 'random'). */
  origin: string;
  /** Generation this individual was created in. */
  generation: number;
}

/** Results from evaluating an individual across a tournament. */
export interface IndividualResult {
  individual: Individual;
  wins: number;
  games: number;
  winRate: number;
}

/** Configuration for the evolutionary optimization run. */
export interface EvolutionConfig {
  /** Number of generations to run. */
  generations: number;
  /** Population size (number of individuals per generation). */
  populationSize: number;
  /** Number of games per matchup in round-robin. */
  gamesPerMatchup: number;
  /** Number of players per game (default 2 for cleanest signal). */
  playersPerGame: number;
  /** Max cards before elimination. */
  maxCards: number;
  /** Fraction of population to keep each generation (top performers). */
  survivalRate: number;
  /** Mutation strength — max fraction to nudge each parameter. */
  mutationStrength: number;
  /** Probability of mutating each parameter independently. */
  mutationRate: number;
  /** Output directory for evolved strategies. */
  outputDir: string;
  /** Max number of hall-of-fame members to keep (0 disables HoF). */
  hofSize: number;
  /** Weight of HoF win rate in blended fitness (0–1). */
  hofWeight: number;
  /** Number of elite individuals that always survive to the next generation (default: 2). */
  eliteCount: number;
  /** Weight of bot profile benchmark in blended fitness (0–1, default: 0.2). */
  profileWeight: number;
  /** Enable fitness sharing for diversity preservation (default: true). */
  fitnessSharing: boolean;
}

/** Summary of a single generation's results. */
export interface GenerationSummary {
  generation: number;
  bestWinRate: number;
  /** Best win rate from population tournament only (before HoF blending). */
  bestPopWinRate: number;
  /** Best win rate against HoF benchmark opponents (undefined if HoF disabled). */
  bestBenchWinRate?: number;
  avgWinRate: number;
  bestIndividual: Individual;
  paramSpread: Record<keyof BotProfileConfig, { min: number; max: number; avg: number }>;
}

/** Full result of an evolution run. */
export interface EvolutionResult {
  bestIndividual: Individual;
  bestWinRate: number;
  /** Best individual's win rate against the hall of fame (undefined if HoF disabled). */
  bestHofWinRate?: number;
  generations: GenerationSummary[];
  totalGames: number;
  durationMs: number;
}

// ── Parameter bounds ───────────────────────────────────────────────────

/** Min/max bounds and mutation impact weight for each parameter.
 *  Impact weight (0.0–1.0) controls how much mutation budget this parameter gets.
 *  High-impact params (bluffFrequency, bullThreshold) get larger mutations;
 *  low-impact params get smaller mutations. This prevents the search space from
 *  being dominated by low-impact dimensions. */
const PARAM_BOUNDS: Record<keyof BotProfileConfig, { min: number; max: number; impact: number }> = {
  bluffFrequency:           { min: 0.0, max: 2.0, impact: 1.0 },
  bullThreshold:            { min: 0.0, max: 1.0, impact: 1.0 },
  riskTolerance:            { min: 0.0, max: 1.0, impact: 0.8 },
  aggressionBias:           { min: 0.0, max: 1.0, impact: 0.9 },
  lastChanceBluffRate:      { min: 0.0, max: 1.0, impact: 0.5 },
  openingBluffRate:         { min: 0.0, max: 1.0, impact: 0.7 },
  bullPhaseRaiseRate:       { min: 0.0, max: 1.0, impact: 0.6 },
  trustMultiplier:          { min: 0.0, max: 2.0, impact: 0.7 },
  cardCountSensitivity:     { min: 0.0, max: 2.0, impact: 0.4 },
  headsUpAggression:        { min: 0.0, max: 1.0, impact: 0.8 },
  survivalPressure:         { min: 0.0, max: 1.0, impact: 0.7 },
  bluffTargetSelection:     { min: 0.0, max: 1.0, impact: 0.5 },
  positionAwareness:        { min: 0.0, max: 1.0, impact: 0.6 },
  trueCallConfidence:       { min: 0.0, max: 1.0, impact: 0.6 },
  counterBluffRate:         { min: 0.0, max: 1.0, impact: 0.8 },
  bullPhaseBluffRate:       { min: 0.0, max: 1.0, impact: 0.6 },
  openingHandTypePreference:{ min: 0.0, max: 1.0, impact: 0.5 },
};

const PARAM_KEYS = Object.keys(PARAM_BOUNDS) as (keyof BotProfileConfig)[];

// ── Helpers ────────────────────────────────────────────────────────────

let nextId = 0;
function makeId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}

/** Clamp a value within parameter bounds. */
function clampParam(key: keyof BotProfileConfig, value: number): number {
  const { min, max } = PARAM_BOUNDS[key];
  return Math.max(min, Math.min(max, value));
}

/** Create a random BotProfileConfig within valid bounds. */
function randomConfig(): BotProfileConfig {
  const config = {} as Record<keyof BotProfileConfig, number>;
  for (const key of PARAM_KEYS) {
    const { min, max } = PARAM_BOUNDS[key];
    config[key] = min + Math.random() * (max - min);
  }
  return config as BotProfileConfig;
}

/** Mutate a config by nudging each parameter with impact-weighted probability.
 *  High-impact parameters get larger mutations (proportional to their impact weight).
 *  This prevents the search from wasting budget on low-impact dimensions. */
function mutateConfig(
  config: BotProfileConfig,
  mutationStrength: number,
  mutationRate: number,
): BotProfileConfig {
  const mutated = { ...config };
  for (const key of PARAM_KEYS) {
    if (Math.random() < mutationRate) {
      const { min, max, impact } = PARAM_BOUNDS[key];
      const range = max - min;
      // Scale mutation magnitude by impact weight: high-impact params get full mutation,
      // low-impact params get reduced mutation (but never zero)
      const effectiveStrength = mutationStrength * (0.3 + 0.7 * impact);
      const delta = (Math.random() * 2 - 1) * effectiveStrength * range;
      mutated[key] = clampParam(key, mutated[key] + delta);
    }
  }
  return mutated;
}

/**
 * Coupled parameter groups — parameters that interact strongly should be
 * inherited together from the same parent to preserve learned interactions.
 * Within each group, all params come from the same parent (70% of the time).
 */
const COUPLED_PARAM_GROUPS: (keyof BotProfileConfig)[][] = [
  ['bluffFrequency', 'aggressionBias', 'counterBluffRate'],  // Bluff aggression cluster
  ['bullThreshold', 'trueCallConfidence', 'cardCountSensitivity'], // Defensiveness cluster
  ['riskTolerance', 'bluffTargetSelection', 'bullPhaseBluffRate'], // Risk-taking cluster
  ['survivalPressure', 'headsUpAggression', 'lastChanceBluffRate'], // Game-state awareness cluster
];

/** Crossover two parent configs — coupled-aware crossover.
 *  Parameters in the same coupling group inherit from the same parent 70% of the time
 *  to preserve learned parameter interactions. Uncoupled params use uniform crossover. */
function crossover(a: BotProfileConfig, b: BotProfileConfig): BotProfileConfig {
  const child = {} as Record<keyof BotProfileConfig, number>;
  const assigned = new Set<keyof BotProfileConfig>();

  // Coupled groups: same parent for the whole group (70%) or independent (30%)
  for (const group of COUPLED_PARAM_GROUPS) {
    if (Math.random() < 0.7) {
      // Pick one parent for the entire group
      const parent = Math.random() < 0.5 ? a : b;
      for (const key of group) {
        child[key] = parent[key];
        assigned.add(key);
      }
    } else {
      // Independent crossover within this group
      for (const key of group) {
        child[key] = Math.random() < 0.5 ? a[key] : b[key];
        assigned.add(key);
      }
    }
  }

  // Remaining uncoupled parameters: uniform crossover
  for (const key of PARAM_KEYS) {
    if (!assigned.has(key)) {
      child[key] = Math.random() < 0.5 ? a[key] : b[key];
    }
  }

  return child as BotProfileConfig;
}

// ── Population seeding ─────────────────────────────────────────────────

/** Create the initial population from existing bot profiles + random variations. */
export function seedPopulation(size: number): Individual[] {
  const population: Individual[] = [];

  // Seed from the 81 bot profiles (level 9 versions of each personality)
  const level9Profiles = BOT_PROFILES.filter(p => p.key.endsWith('_lvl9'));
  for (const profile of level9Profiles) {
    if (population.length >= size) break;
    population.push({
      id: makeId(profile.key),
      config: { ...profile.config },
      origin: profile.key,
      generation: 0,
    });
  }

  // Add the default config
  if (population.length < size) {
    population.push({
      id: makeId('default'),
      config: { ...DEFAULT_BOT_PROFILE_CONFIG },
      origin: 'default',
      generation: 0,
    });
  }

  // Fill remaining slots with random configs and mutations of existing profiles
  while (population.length < size) {
    if (Math.random() < 0.5 && level9Profiles.length > 0) {
      // Mutated version of an existing profile
      const base = level9Profiles[Math.floor(Math.random() * level9Profiles.length)]!;
      population.push({
        id: makeId('mutant'),
        config: mutateConfig(base.config, 0.3, 1.0),
        origin: `${base.key}-mutant`,
        generation: 0,
      });
    } else {
      // Fully random
      population.push({
        id: makeId('random'),
        config: randomConfig(),
        origin: 'random',
        generation: 0,
      });
    }
  }

  return population;
}

// ── Tournament ─────────────────────────────────────────────────────────

/**
 * Run a round-robin tournament where every individual plays against every
 * other individual. For >2 player games, individuals are grouped into
 * tables of `playersPerGame`.
 *
 * Returns results sorted by win rate (best first).
 */
export function runTournament(
  population: Individual[],
  gamesPerMatchup: number,
  playersPerGame: number,
  maxCards: number,
): IndividualResult[] {
  const wins: Map<string, number> = new Map();
  const games: Map<string, number> = new Map();

  for (const ind of population) {
    wins.set(ind.id, 0);
    games.set(ind.id, 0);
  }

  const settings = { maxCards, turnTimer: 0 };

  if (playersPerGame === 2) {
    // 1v1 round-robin: every pair plays gamesPerMatchup games
    for (let i = 0; i < population.length; i++) {
      for (let j = i + 1; j < population.length; j++) {
        const a = population[i]!;
        const b = population[j]!;

        const botConfigs: BotConfig[] = [
          { id: a.id, name: a.id, difficulty: BotDifficulty.HARD, profileConfig: a.config },
          { id: b.id, name: b.id, difficulty: BotDifficulty.HARD, profileConfig: b.config },
        ];
        const players = createBotPlayers(botConfigs);

        for (let g = 0; g < gamesPerMatchup; g++) {
          const result = runGame(players, settings, botConfigs, undefined, BotDifficulty.HARD);
          wins.set(result.winnerId, (wins.get(result.winnerId) ?? 0) + 1);
          games.set(a.id, (games.get(a.id) ?? 0) + 1);
          games.set(b.id, (games.get(b.id) ?? 0) + 1);
        }
      }
    }
  } else {
    // Multi-player: group individuals into random tables
    // Each individual plays approximately the same number of games
    const totalMatchups = Math.ceil((population.length * gamesPerMatchup) / playersPerGame);

    for (let m = 0; m < totalMatchups; m++) {
      // Pick random group of playersPerGame individuals
      const shuffled = [...population].sort(() => Math.random() - 0.5);
      const group = shuffled.slice(0, playersPerGame);

      const botConfigs: BotConfig[] = group.map(ind => ({
        id: ind.id,
        name: ind.id,
        difficulty: BotDifficulty.HARD,
        profileConfig: ind.config,
      }));
      const players = createBotPlayers(botConfigs);

      const result = runGame(players, settings, botConfigs, undefined, BotDifficulty.HARD);
      wins.set(result.winnerId, (wins.get(result.winnerId) ?? 0) + 1);
      for (const ind of group) {
        games.set(ind.id, (games.get(ind.id) ?? 0) + 1);
      }
    }
  }

  // Build results sorted by win rate
  const results: IndividualResult[] = population.map(ind => {
    const w = wins.get(ind.id) ?? 0;
    const g = games.get(ind.id) ?? 0;
    return {
      individual: ind,
      wins: w,
      games: g,
      winRate: g > 0 ? w / g : 0,
    };
  });

  results.sort((a, b) => b.winRate - a.winRate);
  return results;
}

// ── Selection & reproduction ───────────────────────────────────────────

/** Select survivors and create next generation via mutation + crossover. */
export function nextGeneration(
  results: IndividualResult[],
  populationSize: number,
  survivalRate: number,
  mutationStrength: number,
  mutationRate: number,
  generation: number,
  eliteCount: number = 2,
): Individual[] {
  const survivorCount = Math.max(2, Math.floor(populationSize * survivalRate));
  const survivors = results.slice(0, survivorCount);
  const nextGen: Individual[] = [];

  // Keep the top N survivors as-is (elitism) — ensures the best strategies
  // are never lost to mutation noise
  const actualEliteCount = Math.min(eliteCount, survivors.length);
  for (let i = 0; i < actualEliteCount; i++) {
    const elite = survivors[i]!;
    nextGen.push({
      id: makeId('elite'),
      config: { ...elite.individual.config },
      origin: `elite-from-${elite.individual.id}`,
      generation,
    });
  }

  // Fill the rest with mutations and crossovers of survivors
  while (nextGen.length < populationSize) {
    if (Math.random() < 0.7) {
      // Mutation of a random survivor
      const parent = survivors[Math.floor(Math.random() * survivors.length)]!;
      nextGen.push({
        id: makeId('child'),
        config: mutateConfig(parent.individual.config, mutationStrength, mutationRate),
        origin: `mutant-of-${parent.individual.id}`,
        generation,
      });
    } else {
      // Crossover of two random survivors + mutation
      const p1 = survivors[Math.floor(Math.random() * survivors.length)]!;
      const p2 = survivors[Math.floor(Math.random() * survivors.length)]!;
      const childConfig = crossover(p1.individual.config, p2.individual.config);
      nextGen.push({
        id: makeId('cross'),
        config: mutateConfig(childConfig, mutationStrength * 0.5, mutationRate),
        origin: `cross-${p1.individual.id}-${p2.individual.id}`,
        generation,
      });
    }
  }

  return nextGen;
}

// ── Compute parameter spread ───────────────────────────────────────────

function computeParamSpread(
  population: Individual[],
): Record<keyof BotProfileConfig, { min: number; max: number; avg: number }> {
  const spread = {} as Record<keyof BotProfileConfig, { min: number; max: number; avg: number }>;

  for (const key of PARAM_KEYS) {
    const values = population.map(ind => ind.config[key]);
    spread[key] = {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((s, v) => s + v, 0) / values.length,
    };
  }

  return spread;
}

// ── Hall of Fame ──────────────────────────────────────────────────────

/** Euclidean distance between two configs in normalized parameter space. */
function paramDistance(a: BotProfileConfig, b: BotProfileConfig): number {
  let sumSq = 0;
  for (const key of PARAM_KEYS) {
    const { min, max } = PARAM_BOUNDS[key];
    const range = max - min || 1;
    const diff = (a[key] - b[key]) / range;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq);
}

/**
 * Minimum normalized distance required for a candidate to be added to the HoF.
 * Lowered from 0.1 to 0.05 so the HoF grows more aggressively while still
 * preventing near-duplicates. This ensures the evolved bot trains against
 * diverse strong opponents rather than just one or two.
 */
const HOF_DIVERSITY_THRESHOLD = 0.05;

/**
 * Force-add the champion to the HoF every N generations regardless of diversity,
 * as long as the HoF isn't full. This ensures steady HoF growth in early evolution.
 */
const HOF_FORCED_ADD_INTERVAL = 3;

/**
 * Number of top individuals to consider for HoF addition each generation
 * (not just the champion). Increases diversity of the archive.
 */
const HOF_CANDIDATES_PER_GEN = 3;

/**
 * Evaluate a single individual against every hall-of-fame member via 1v1 games.
 * Returns the individual's win rate across all HoF matchups.
 */
function evaluateAgainstHof(
  individual: Individual,
  hof: Individual[],
  gamesPerMatchup: number,
  maxCards: number,
): number {
  if (hof.length === 0) return 0;

  const settings = { maxCards, turnTimer: 0 };
  let totalWins = 0;
  let totalGames = 0;

  for (const hofMember of hof) {
    const botConfigs: BotConfig[] = [
      { id: individual.id, name: individual.id, difficulty: BotDifficulty.HARD, profileConfig: individual.config },
      { id: hofMember.id, name: hofMember.id, difficulty: BotDifficulty.HARD, profileConfig: hofMember.config },
    ];
    const players = createBotPlayers(botConfigs);

    for (let g = 0; g < gamesPerMatchup; g++) {
      const result = runGame(players, settings, botConfigs, undefined, BotDifficulty.HARD);
      if (result.winnerId === individual.id) {
        totalWins++;
      }
      totalGames++;
    }
  }

  return totalGames > 0 ? totalWins / totalGames : 0;
}

// ── Bot profile benchmark evaluation ──────────────────────────────────

/**
 * Evaluate a single individual against a sample of the 81 bot profiles via 1v1.
 * Prevents overfitting to one playstyle by testing against the known personality
 * archetypes. Returns the individual's win rate across all profile matchups.
 */
function evaluateAgainstProfiles(
  individual: Individual,
  profileSample: readonly { key: string; config: BotProfileConfig }[],
  gamesPerMatchup: number,
  maxCards: number,
): number {
  if (profileSample.length === 0) return 0;

  const settings = { maxCards, turnTimer: 0 };
  let totalWins = 0;
  let totalGames = 0;

  for (const profile of profileSample) {
    const botConfigs: BotConfig[] = [
      { id: individual.id, name: individual.id, difficulty: BotDifficulty.HARD, profileConfig: individual.config },
      { id: `profile-${profile.key}`, name: profile.key, difficulty: BotDifficulty.HARD, profileConfig: profile.config },
    ];
    const players = createBotPlayers(botConfigs);

    for (let g = 0; g < gamesPerMatchup; g++) {
      const result = runGame(players, settings, botConfigs, undefined, BotDifficulty.HARD);
      if (result.winnerId === individual.id) {
        totalWins++;
      }
      totalGames++;
    }
  }

  return totalGames > 0 ? totalWins / totalGames : 0;
}

/**
 * Get the level 9 bot profiles as a benchmark sample for fitness evaluation.
 * Level 9 profiles are the strongest expression of each personality archetype.
 */
function getProfileBenchmarkSample(): { key: string; config: BotProfileConfig }[] {
  return BOT_PROFILES
    .filter(p => p.key.endsWith('_lvl9'))
    .map(p => ({ key: p.key, config: p.config }));
}

// ── Fitness sharing for diversity preservation ─────────────────────────

/**
 * Apply fitness sharing to prevent population convergence.
 * Individuals in crowded regions of parameter space have their fitness
 * reduced proportionally to how many neighbors they have. This encourages
 * the population to spread out and explore diverse strategies.
 *
 * Uses a sharing radius in normalized parameter space — individuals
 * within the radius share their fitness.
 */
const FITNESS_SHARING_RADIUS = 0.15;

function applyFitnessSharing(results: IndividualResult[]): IndividualResult[] {
  const n = results.length;
  const shared: IndividualResult[] = [];

  for (let i = 0; i < n; i++) {
    let nicheCount = 0;
    for (let j = 0; j < n; j++) {
      const dist = paramDistance(results[i]!.individual.config, results[j]!.individual.config);
      if (dist < FITNESS_SHARING_RADIUS) {
        // Triangular sharing function: 1 at distance 0, 0 at sharing radius
        nicheCount += 1 - (dist / FITNESS_SHARING_RADIUS);
      }
    }
    // Shared fitness = raw fitness / niche count (minimum 1 to avoid division issues)
    const sharedWinRate = results[i]!.winRate / Math.max(1, nicheCount);
    shared.push({ ...results[i]!, winRate: sharedWinRate });
  }

  shared.sort((a, b) => b.winRate - a.winRate);
  return shared;
}

// ── Main evolution loop ────────────────────────────────────────────────

/**
 * Build the JSON payload for saving current evolution state.
 * Used both for normal completion and graceful shutdown.
 */
function buildExportData(
  overallBest: IndividualResult,
  overallBestPopWinRate: number,
  overallBestHofWinRate: number | undefined,
  completedGenerations: number,
  config: EvolutionConfig,
  totalGames: number,
  durationMs: number,
  hallOfFame: Individual[],
  summaries: GenerationSummary[],
  interrupted: boolean,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    interrupted,
    // Canonical field name — evaluateEvolved.ts reads this as `generations`
    generations: completedGenerations,
    targetGenerations: config.generations,
    populationSize: config.populationSize,
    gamesPerMatchup: config.gamesPerMatchup,
    playersPerGame: config.playersPerGame,
    maxCards: config.maxCards,
    bestPopWinRate: overallBestPopWinRate,
    // Canonical field name — evaluateEvolved.ts reads this as `bestWinRate`
    bestWinRate: overallBest.winRate,
    totalGames,
    durationMs,
    config: overallBest.individual.config,
    origin: overallBest.individual.origin,
  };
  if (overallBestHofWinRate !== undefined) {
    data['bestBenchWinRate'] = overallBestHofWinRate;
    data['hofSize'] = hallOfFame.length;
  }
  if (interrupted) {
    data['generationHistory'] = summaries.map(s => ({
      generation: s.generation,
      bestPopWinRate: s.bestPopWinRate,
      bestBenchWinRate: s.bestBenchWinRate,
      avgWinRate: s.avgWinRate,
    }));
  }
  return data;
}

export function evolve(config: EvolutionConfig): EvolutionResult {
  const {
    generations,
    populationSize,
    gamesPerMatchup,
    playersPerGame,
    maxCards,
    survivalRate,
    mutationStrength,
    mutationRate,
    outputDir,
    hofSize,
    hofWeight,
    eliteCount,
    profileWeight,
    fitnessSharing,
  } = config;

  console.log(`\n${'═'.repeat(55)}`);
  console.log("  Bull 'Em Evolutionary Parameter Optimization");
  console.log(`${'═'.repeat(55)}\n`);
  console.log(`  Population size:    ${populationSize}`);
  console.log(`  Generations:        ${generations}`);
  console.log(`  Games per matchup:  ${gamesPerMatchup}`);
  console.log(`  Players per game:   ${playersPerGame}`);
  console.log(`  Max cards:          ${maxCards}`);
  console.log(`  Survival rate:      ${(survivalRate * 100).toFixed(0)}%`);
  console.log(`  Mutation strength:  ${mutationStrength}`);
  console.log(`  Mutation rate:      ${(mutationRate * 100).toFixed(0)}%`);
  console.log(`  Elite count:        ${eliteCount}`);
  if (hofSize > 0) {
    console.log(`  HoF size:           ${hofSize}`);
    console.log(`  HoF weight:         ${(hofWeight * 100).toFixed(0)}%`);
  }
  if (profileWeight > 0) {
    console.log(`  Profile weight:     ${(profileWeight * 100).toFixed(0)}%`);
  }
  if (fitnessSharing) {
    console.log(`  Fitness sharing:    ON (radius ${FITNESS_SHARING_RADIUS})`);
  }
  console.log('');

  const startTime = performance.now();
  let totalGames = 0;
  let population = seedPopulation(populationSize);
  const summaries: GenerationSummary[] = [];
  let overallBest: IndividualResult | null = null;
  let overallBestPopWinRate = 0;
  let overallBestHofWinRate: number | undefined;
  let overallBestProfileWinRate: number | undefined;
  const hallOfFame: Individual[] = [];
  const useHof = hofSize > 0 && hofWeight > 0;
  const useProfiles = profileWeight > 0;
  const profileSample = useProfiles ? getProfileBenchmarkSample() : [];
  let completedGenerations = 0;
  let shutdownRequested = false;

  // ── Graceful shutdown handler ──
  const onSigint = (): void => {
    if (shutdownRequested) {
      // Second Ctrl+C — force exit
      console.log('\n  Force exit.');
      process.exit(1);
    }
    shutdownRequested = true;
    console.log('\n\n  ⏹  SIGINT received — finishing current generation and saving...');
  };
  process.on('SIGINT', onSigint);

  for (let gen = 1; gen <= generations; gen++) {
    const genStart = performance.now();

    // Run population tournament
    const popResults = runTournament(population, gamesPerMatchup, playersPerGame, maxCards);

    // Count games this generation
    const genGames = popResults.reduce((sum, r) => sum + r.games, 0) / playersPerGame;
    totalGames += genGames;

    // Track the best population-only win rate for this generation
    const bestPopWinRate = popResults[0]!.winRate;

    // ── Compute blended fitness from multiple benchmarks ──
    // Weights are normalized: pop gets the remainder after HoF + profile weights
    const hofW = useHof && hallOfFame.length > 0 ? hofWeight : 0;
    const profW = useProfiles ? profileWeight : 0;
    const popW = Math.max(0, 1 - hofW - profW);

    let results: IndividualResult[];
    let bestBenchWinRate: number | undefined;
    let bestProfileWinRate: number | undefined;

    // Use fewer games per benchmark matchup to keep runtime reasonable
    const benchGamesPerMatchup = Math.max(1, Math.floor(gamesPerMatchup / 2));

    if (hofW > 0 || profW > 0) {
      const hofWinRates: number[] = [];
      const profileWinRates: number[] = [];

      results = popResults.map(r => {
        let blended = popW * r.winRate;

        // HoF benchmark
        if (hofW > 0) {
          const hofWinRate = evaluateAgainstHof(
            r.individual, hallOfFame, benchGamesPerMatchup, maxCards,
          );
          totalGames += benchGamesPerMatchup * hallOfFame.length;
          hofWinRates.push(hofWinRate);
          blended += hofW * hofWinRate;
        }

        // Bot profile benchmark
        if (profW > 0) {
          const profileWinRate = evaluateAgainstProfiles(
            r.individual, profileSample, benchGamesPerMatchup, maxCards,
          );
          totalGames += benchGamesPerMatchup * profileSample.length;
          profileWinRates.push(profileWinRate);
          blended += profW * profileWinRate;
        }

        return { ...r, winRate: blended };
      });

      results.sort((a, b) => b.winRate - a.winRate);

      // Extract benchmark rates for the blended-best individual
      const bestId = results[0]!.individual.id;
      const bestPopIndex = popResults.findIndex(r => r.individual.id === bestId);
      if (hofWinRates.length > 0) {
        bestBenchWinRate = bestPopIndex >= 0 ? hofWinRates[bestPopIndex] : Math.max(...hofWinRates);
      }
      if (profileWinRates.length > 0) {
        bestProfileWinRate = bestPopIndex >= 0 ? profileWinRates[bestPopIndex] : Math.max(...profileWinRates);
      }
    } else {
      results = popResults;
    }

    // Apply fitness sharing for diversity preservation (for selection only)
    const selectionResults = fitnessSharing ? applyFitnessSharing(results) : results;

    const best = results[0]!; // Use raw blended fitness for tracking best
    const avgWinRate = results.reduce((s, r) => s + r.winRate, 0) / results.length;

    // Track overall best
    if (!overallBest || best.winRate > overallBest.winRate) {
      overallBest = {
        ...best,
        individual: { ...best.individual, config: { ...best.individual.config } },
      };
      overallBestPopWinRate = bestPopWinRate;
      overallBestHofWinRate = bestBenchWinRate;
      overallBestProfileWinRate = bestProfileWinRate;
    }

    // ── Aggressive HoF growth ──
    // Try to add top-K candidates (not just champion) if they're diverse enough
    if (useHof) {
      const candidateCount = Math.min(HOF_CANDIDATES_PER_GEN, results.length);
      for (let i = 0; i < candidateCount; i++) {
        const candidate = results[i]!.individual;
        const isDiverse = hallOfFame.every(
          member => paramDistance(candidate.config, member.config) > HOF_DIVERSITY_THRESHOLD,
        );

        if (isDiverse) {
          hallOfFame.push({
            ...candidate,
            id: makeId('hof'),
            config: { ...candidate.config },
          });
        }
      }

      // Force-add champion periodically if HoF is still small, even if not diverse
      // This prevents the HoF from staying empty when the population converges
      if (gen % HOF_FORCED_ADD_INTERVAL === 0 && hallOfFame.length < hofSize) {
        const champion = best.individual;
        // Only skip if an exact near-duplicate exists (very tight threshold)
        const tooClose = hallOfFame.some(
          member => paramDistance(champion.config, member.config) < HOF_DIVERSITY_THRESHOLD * 0.5,
        );
        if (!tooClose) {
          hallOfFame.push({
            ...champion,
            id: makeId('hof-forced'),
            config: { ...champion.config },
          });
        }
      }

      // Evict oldest when over capacity
      while (hallOfFame.length > hofSize) {
        hallOfFame.shift();
      }
    }

    const paramSpread = computeParamSpread(population);
    const genDuration = performance.now() - genStart;

    completedGenerations = gen;

    summaries.push({
      generation: gen,
      bestWinRate: best.winRate,
      bestPopWinRate,
      bestBenchWinRate,
      avgWinRate,
      bestIndividual: best.individual,
      paramSpread,
    });

    // Progress output
    const benchPart = bestBenchWinRate !== undefined
      ? `  |  hof_wr: ${(bestBenchWinRate * 100).toFixed(1)}%`
      : '';
    const profPart = bestProfileWinRate !== undefined
      ? `  |  prof_wr: ${(bestProfileWinRate * 100).toFixed(1)}%`
      : '';
    const hofPart = useHof ? `  |  hof: ${hallOfFame.length}` : '';

    console.log(
      `  Gen ${String(gen).padStart(3)}/${generations}  |  ` +
      `pop: ${(bestPopWinRate * 100).toFixed(1)}%` +
      benchPart +
      profPart +
      hofPart +
      `  |  avg: ${(avgWinRate * 100).toFixed(1)}%  |  ` +
      `${(genDuration / 1000).toFixed(1)}s`,
    );

    // Check for graceful shutdown
    if (shutdownRequested) {
      console.log(`\n  Stopped after generation ${gen}.`);
      break;
    }

    // Create next generation (unless this is the last one)
    // Use fitness-sharing results for selection to preserve diversity
    if (gen < generations) {
      population = nextGeneration(
        selectionResults, populationSize, survivalRate,
        mutationStrength, mutationRate, gen + 1, eliteCount,
      );
    }
  }

  // Clean up SIGINT handler
  process.removeListener('SIGINT', onSigint);

  // Evaluate the overall best against the final HoF for reporting
  if (!shutdownRequested && useHof && hallOfFame.length > 0 && overallBest) {
    overallBestHofWinRate = evaluateAgainstHof(
      overallBest.individual, hallOfFame, gamesPerMatchup, maxCards,
    );
    totalGames += gamesPerMatchup * hallOfFame.length;
  }

  // Evaluate the overall best against profiles for reporting
  if (!shutdownRequested && useProfiles && overallBest) {
    overallBestProfileWinRate = evaluateAgainstProfiles(
      overallBest.individual, profileSample, gamesPerMatchup, maxCards,
    );
    totalGames += gamesPerMatchup * profileSample.length;
  }

  const durationMs = performance.now() - startTime;

  // Export best parameters
  if (overallBest) {
    mkdirSync(outputDir, { recursive: true });
    const suffix = shutdownRequested ? 'interrupted' : `gen${completedGenerations}`;
    const outputFile = join(outputDir, `evolved-best-${suffix}.json`);
    const exportData = buildExportData(
      overallBest, overallBestPopWinRate, overallBestHofWinRate,
      completedGenerations, config, totalGames, durationMs,
      hallOfFame, summaries, shutdownRequested,
    );
    if (overallBestProfileWinRate !== undefined) {
      exportData['bestProfileWinRate'] = overallBestProfileWinRate;
    }
    // Include HoF configs so the evaluation script can test against them
    if (hallOfFame.length > 0) {
      exportData['hallOfFame'] = hallOfFame.map(m => ({
        id: m.id,
        config: m.config,
        origin: m.origin,
        generation: m.generation,
      }));
    }
    writeFileSync(outputFile, JSON.stringify(exportData, null, 2) + '\n');
    console.log(`\n  Best parameters exported: ${outputFile}`);
  }

  // Final summary
  const header = shutdownRequested ? 'Evolution Interrupted (SIGINT)' : 'Evolution Complete';
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  ${header}`);
  console.log(`${'═'.repeat(55)}`);
  console.log(`  Completed gens:     ${completedGenerations}/${generations}`);
  console.log(`  Total games:        ${Math.round(totalGames)}`);
  console.log(`  Duration:           ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Best pop win rate:  ${(overallBestPopWinRate * 100).toFixed(1)}%`);
  if (overallBestHofWinRate !== undefined) {
    console.log(`  Best vs HoF:        ${(overallBestHofWinRate * 100).toFixed(1)}%  (${hallOfFame.length} members)`);
  }
  if (overallBestProfileWinRate !== undefined) {
    console.log(`  Best vs profiles:   ${(overallBestProfileWinRate * 100).toFixed(1)}%  (${profileSample.length} profiles)`);
  }
  console.log('');

  if (overallBest) {
    console.log('  ── Best Parameters ──');
    for (const key of PARAM_KEYS) {
      const val = overallBest.individual.config[key];
      const def = DEFAULT_BOT_PROFILE_CONFIG[key];
      const diff = val - def;
      const sign = diff >= 0 ? '+' : '';
      console.log(
        `  ${key.padEnd(24)} ${val.toFixed(4)}  (${sign}${diff.toFixed(4)} vs default)`,
      );
    }
    console.log('');
  }

  console.log(`${'═'.repeat(55)}\n`);

  return {
    bestIndividual: overallBest?.individual ?? population[0]!,
    bestWinRate: overallBest?.winRate ?? 0,
    bestHofWinRate: overallBestHofWinRate,
    generations: summaries,
    totalGames,
    durationMs,
  };
}
