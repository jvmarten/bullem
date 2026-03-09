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
}

/** Summary of a single generation's results. */
export interface GenerationSummary {
  generation: number;
  bestWinRate: number;
  avgWinRate: number;
  bestIndividual: Individual;
  paramSpread: Record<keyof BotProfileConfig, { min: number; max: number; avg: number }>;
}

/** Full result of an evolution run. */
export interface EvolutionResult {
  bestIndividual: Individual;
  bestWinRate: number;
  generations: GenerationSummary[];
  totalGames: number;
  durationMs: number;
}

// ── Parameter bounds ───────────────────────────────────────────────────

/** Min/max bounds for each parameter to keep values sensible during mutation. */
const PARAM_BOUNDS: Record<keyof BotProfileConfig, { min: number; max: number }> = {
  bluffFrequency:       { min: 0.0, max: 2.0 },
  bullThreshold:        { min: 0.0, max: 1.0 },
  riskTolerance:        { min: 0.0, max: 1.0 },
  aggressionBias:       { min: 0.0, max: 1.0 },
  lastChanceBluffRate:  { min: 0.0, max: 1.0 },
  openingBluffRate:     { min: 0.0, max: 1.0 },
  bullPhaseRaiseRate:   { min: 0.0, max: 1.0 },
  trustMultiplier:      { min: 0.0, max: 2.0 },
  bluffPlausibilityGate:{ min: 0.0, max: 1.0 },
  noiseBand:            { min: 0.0, max: 0.2 },
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

/** Mutate a config by nudging each parameter with some probability. */
function mutateConfig(
  config: BotProfileConfig,
  mutationStrength: number,
  mutationRate: number,
): BotProfileConfig {
  const mutated = { ...config };
  for (const key of PARAM_KEYS) {
    if (Math.random() < mutationRate) {
      const { min, max } = PARAM_BOUNDS[key];
      const range = max - min;
      const delta = (Math.random() * 2 - 1) * mutationStrength * range;
      mutated[key] = clampParam(key, mutated[key] + delta);
    }
  }
  return mutated;
}

/** Crossover two parent configs — uniform crossover picking each param from either parent. */
function crossover(a: BotProfileConfig, b: BotProfileConfig): BotProfileConfig {
  const child = {} as Record<keyof BotProfileConfig, number>;
  for (const key of PARAM_KEYS) {
    child[key] = Math.random() < 0.5 ? a[key] : b[key];
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
): Individual[] {
  const survivorCount = Math.max(2, Math.floor(populationSize * survivalRate));
  const survivors = results.slice(0, survivorCount);
  const nextGen: Individual[] = [];

  // Keep the top survivor as-is (elitism)
  const elite = survivors[0]!;
  nextGen.push({
    id: makeId('elite'),
    config: { ...elite.individual.config },
    origin: `elite-from-${elite.individual.id}`,
    generation,
  });

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

// ── Main evolution loop ────────────────────────────────────────────────

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
  console.log('');

  const startTime = performance.now();
  let totalGames = 0;
  let population = seedPopulation(populationSize);
  const summaries: GenerationSummary[] = [];
  let overallBest: IndividualResult | null = null;

  for (let gen = 1; gen <= generations; gen++) {
    const genStart = performance.now();

    // Run tournament
    const results = runTournament(population, gamesPerMatchup, playersPerGame, maxCards);

    // Count games this generation
    const genGames = results.reduce((sum, r) => sum + r.games, 0) / playersPerGame;
    totalGames += genGames;

    const best = results[0]!;
    const avgWinRate = results.reduce((s, r) => s + r.winRate, 0) / results.length;

    // Track overall best
    if (!overallBest || best.winRate > overallBest.winRate) {
      overallBest = {
        ...best,
        individual: { ...best.individual, config: { ...best.individual.config } },
      };
    }

    const paramSpread = computeParamSpread(population);
    const genDuration = performance.now() - genStart;

    summaries.push({
      generation: gen,
      bestWinRate: best.winRate,
      avgWinRate,
      bestIndividual: best.individual,
      paramSpread,
    });

    // Progress output
    const spreadRange = PARAM_KEYS.map(k => {
      const s = paramSpread[k];
      return (s.max - s.min).toFixed(3);
    });
    const avgSpread = spreadRange.reduce((s, v) => s + parseFloat(v), 0) / spreadRange.length;

    console.log(
      `  Gen ${String(gen).padStart(3)}/${generations}  |  ` +
      `best: ${(best.winRate * 100).toFixed(1)}%  |  ` +
      `avg: ${(avgWinRate * 100).toFixed(1)}%  |  ` +
      `spread: ${avgSpread.toFixed(3)}  |  ` +
      `${(genDuration / 1000).toFixed(1)}s`,
    );

    // Create next generation (unless this is the last one)
    if (gen < generations) {
      population = nextGeneration(
        results, populationSize, survivalRate,
        mutationStrength, mutationRate, gen + 1,
      );
    }
  }

  const durationMs = performance.now() - startTime;

  // Export best parameters
  if (overallBest) {
    mkdirSync(outputDir, { recursive: true });
    const outputFile = join(outputDir, `evolved-best-gen${generations}.json`);
    const exportData = {
      exportedAt: new Date().toISOString(),
      generations,
      populationSize,
      gamesPerMatchup,
      playersPerGame,
      maxCards,
      bestWinRate: overallBest.winRate,
      totalGames,
      durationMs,
      config: overallBest.individual.config,
      origin: overallBest.individual.origin,
    };
    writeFileSync(outputFile, JSON.stringify(exportData, null, 2) + '\n');
    console.log(`\n  Best parameters exported: ${outputFile}`);
  }

  // Final summary
  console.log(`\n${'═'.repeat(55)}`);
  console.log('  Evolution Complete');
  console.log(`${'═'.repeat(55)}`);
  console.log(`  Total generations:  ${generations}`);
  console.log(`  Total games:        ${Math.round(totalGames)}`);
  console.log(`  Duration:           ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`  Best win rate:      ${((overallBest?.winRate ?? 0) * 100).toFixed(1)}%`);
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
    generations: summaries,
    totalGames,
    durationMs,
  };
}
