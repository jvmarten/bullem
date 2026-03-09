#!/usr/bin/env node

/**
 * CLI entry point for evaluating a trained CFR strategy against the full
 * 81-profile bot pool.
 *
 * Runs 1v1 matchups against each of the 9 level-9 (strongest) personality
 * archetypes, plus a 6-player reference matchup.
 *
 * Usage:
 *   npm run evaluate -w training
 *   npx tsx training/src/evaluate.ts --strategy training/strategies/cfr-strategy-100000.json
 */

import { BOT_PROFILES, BOT_PROFILE_MAP, BotDifficulty } from '@bull-em/shared';
import type { BotProfileDefinition } from '@bull-em/shared';
import { simulate } from './simulator.js';
import {
  findLatestStrategy, findLatestPlayerCountStrategies, loadStrategy,
  createCFREvaluationStrategy, createCompositeEvaluationStrategy,
} from './cfr/index.js';
import type { EvaluationStats, ExportedStrategy } from './cfr/index.js';
import type { BotConfig, BotStrategy, BotStrategyContext, BotStrategyAction } from './types.js';

/** The 9 level-9 personality keys — strongest version of each archetype. */
const LVL9_KEYS = [
  'rock_lvl9',
  'bluffer_lvl9',
  'grinder_lvl9',
  'wildcard_lvl9',
  'professor_lvl9',
  'shark_lvl9',
  'cannon_lvl9',
  'frost_lvl9',
  'hustler_lvl9',
] as const;

/** Pick `count` random profiles from the 81-profile pool (no duplicates). */
function sampleProfiles(count: number): BotProfileDefinition[] {
  const pool = [...BOT_PROFILES];
  const picked: BotProfileDefinition[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const profile = pool[idx];
    if (profile) picked.push(profile);
    pool.splice(idx, 1);
  }
  return picked;
}

function parseArgs(argv: string[]): {
  strategyFile: string | null;
  games: number;
  maxCards: number;
} {
  const args = argv.slice(2);
  let strategyFile: string | null = null;
  let games = 1000;
  let maxCards = 5;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--strategy':
      case '-s':
        strategyFile = next ?? null;
        if (!strategyFile) {
          console.error('Error: --strategy requires a file path');
          process.exit(1);
        }
        i++;
        break;
      case '--games':
      case '-g':
        games = parseInt(next ?? '', 10);
        if (isNaN(games) || games < 1) {
          console.error('Error: --games must be a positive integer');
          process.exit(1);
        }
        i++;
        break;
      case '--max-cards':
      case '-m':
        maxCards = parseInt(next ?? '', 10);
        if (isNaN(maxCards) || maxCards < 1 || maxCards > 5) {
          console.error('Error: --max-cards must be between 1 and 5');
          process.exit(1);
        }
        i++;
        break;
      case '--help':
      case '-h':
        console.log(`
Bull 'Em CFR Strategy Evaluation

Evaluates a trained CFR strategy by playing 1v1 against each of the 9 strongest
bot personalities (lvl9), plus a 6-player reference matchup.

Usage:
  npm run evaluate -w training
  npx tsx training/src/evaluate.ts [options]

Options:
  --strategy, -s <path>  Path to strategy JSON file (default: latest in strategies/)
  --games, -g <n>        Games per matchup (default: 1000)
  --max-cards, -m <n>    Max cards before elimination (default: 5, range: 1-5)
  --help, -h             Show this help message

Examples:
  npm run evaluate -w training
  npm run evaluate -w training -- --games 5000
  npx tsx training/src/evaluate.ts -s training/strategies/my-strategy.json -g 2000
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}. Use --help for usage.`);
        process.exit(1);
    }
  }

  return { strategyFile, games, maxCards };
}

const config = parseArgs(process.argv);

// ── Load strategy ───────────────────────────────────────────────────────

const evalStats: EvaluationStats = { totalDecisions: 0, hits: 0, misses: 0 };
let cfrStrategy: BotStrategy;

if (config.strategyFile) {
  // Explicit single strategy file
  console.log(`Loading strategy: ${config.strategyFile}`);
  const exportedStrategy = loadStrategy(config.strategyFile);
  console.log(`  Trained for ${exportedStrategy.iterations} iterations`);
  console.log(`  ${exportedStrategy.infoSetCount} info sets`);
  console.log(`  Avg regret: ${exportedStrategy.avgRegret.toFixed(6)}`);
  cfrStrategy = createCFREvaluationStrategy(exportedStrategy, evalStats);
} else {
  // Try per-player-count strategies first, then fall back to global
  const perPlayerPaths = findLatestPlayerCountStrategies();
  if (perPlayerPaths && perPlayerPaths.size > 0) {
    console.log('Loading per-player-count strategies:');
    const perPlayerStrategies = new Map<string, ExportedStrategy>();
    let totalInfoSets = 0;
    for (const [bucket, filepath] of [...perPlayerPaths].sort(([a], [b]) => a.localeCompare(b))) {
      const strategy = loadStrategy(filepath);
      perPlayerStrategies.set(bucket, strategy);
      totalInfoSets += strategy.infoSetCount;
      console.log(`  ${bucket}: ${filepath} (${strategy.infoSetCount} info sets)`);
    }
    console.log(`  Total: ${totalInfoSets} info sets across ${perPlayerStrategies.size} table sizes`);
    cfrStrategy = createCompositeEvaluationStrategy(perPlayerStrategies, evalStats);
  } else {
    const strategyPath = findLatestStrategy();
    if (!strategyPath) {
      console.error('Error: No strategy file found. Run training first or specify --strategy.');
      process.exit(1);
    }
    console.log(`Loading strategy: ${strategyPath}`);
    const exportedStrategy = loadStrategy(strategyPath);
    console.log(`  Trained for ${exportedStrategy.iterations} iterations`);
    console.log(`  ${exportedStrategy.infoSetCount} info sets`);
    console.log(`  Avg regret: ${exportedStrategy.avgRegret.toFixed(6)}`);
    cfrStrategy = createCFREvaluationStrategy(exportedStrategy, evalStats);
  }
}

// ── Strategy wrapper ────────────────────────────────────────────────────

/**
 * Create a strategy wrapper that applies CFR only to CFR bots,
 * falling back to undefined (heuristic) for non-CFR bots.
 */
function createMixedStrategy(cfrBotIds: Set<string>): BotStrategy {
  return (context: BotStrategyContext): BotStrategyAction | undefined => {
    if (cfrBotIds.has(context.botId)) {
      return cfrStrategy(context);
    }
    return undefined; // Fall back to built-in heuristic
  };
}

// ── Resolve lvl9 profiles ───────────────────────────────────────────────

const lvl9Profiles: BotProfileDefinition[] = [];
for (const key of LVL9_KEYS) {
  const profile = BOT_PROFILE_MAP.get(key);
  if (!profile) {
    console.error(`Error: profile '${key}' not found in BOT_PROFILE_MAP`);
    process.exit(1);
  }
  lvl9Profiles.push(profile);
}

// ── Run evaluations ─────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log("  Bull 'Em CFR Strategy Evaluation");
console.log(`${'═'.repeat(50)}\n`);
console.log(`  Games per matchup:  ${config.games}`);
console.log(`  Max cards:          ${config.maxCards}`);
console.log('');

let totalCfrWins = 0;
let totalGames = 0;

// ── 1v1: CFR vs each lvl9 personality ───────────────────────────────────

interface HeadsUpResult {
  opponentName: string;
  cfrWins: number;
  oppWins: number;
  cfrWinRate: number;
}

const headsUpResults: HeadsUpResult[] = [];

console.log(`── Heads-up (2P): CFR vs all 9 lvl9 personalities ──\n`);

for (const opponent of lvl9Profiles) {
  const cfrIds = new Set<string>(['cfr-0']);
  const bots: BotConfig[] = [
    { id: 'cfr-0', name: 'CFR', difficulty: BotDifficulty.HARD },
    {
      id: 'opp-0',
      name: opponent.name,
      difficulty: BotDifficulty.HARD,
      profileConfig: opponent.config,
    },
  ];

  const stats = simulate({
    games: config.games,
    players: 2,
    maxCards: config.maxCards,
    difficulty: BotDifficulty.HARD,
    botConfigs: bots,
    strategy: createMixedStrategy(cfrIds),
    progressInterval: 0, // Suppress per-matchup progress for cleaner output
  });

  const cfrWins = stats.wins['cfr-0'] ?? 0;
  const oppWins = stats.wins['opp-0'] ?? 0;
  headsUpResults.push({
    opponentName: opponent.name,
    cfrWins,
    oppWins,
    cfrWinRate: cfrWins / config.games,
  });

  totalCfrWins += cfrWins;
  totalGames += config.games;
}

// ── Print heads-up summary table ────────────────────────────────────────

const nameWidth = Math.max(...headsUpResults.map(r => r.opponentName.length), 10);

console.log(`\n${'═'.repeat(50)}`);
console.log('  Heads-up Results: CFR vs lvl9 Personalities');
console.log(`${'═'.repeat(50)}\n`);
console.log(
  `  ${'Opponent'.padEnd(nameWidth)}  ${'CFR Win%'.padStart(8)}  ${'W'.padStart(5)} / ${'L'.padStart(5)}  Bar`,
);
console.log(`  ${'─'.repeat(nameWidth)}  ${'─'.repeat(8)}  ${'─'.repeat(5)}${'─'.repeat(5)}${'──'}  ${'─'.repeat(20)}`);

// Sort by CFR win rate descending for readability
const sorted = [...headsUpResults].sort((a, b) => b.cfrWinRate - a.cfrWinRate);

for (const r of sorted) {
  const pct = (r.cfrWinRate * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(r.cfrWinRate * 20));
  console.log(
    `  ${r.opponentName.padEnd(nameWidth)}  ${(pct + '%').padStart(8)}  ${String(r.cfrWins).padStart(5)} / ${String(r.oppWins).padStart(5)}  ${bar}`,
  );
}

const avgHeadsUp = headsUpResults.reduce((s, r) => s + r.cfrWinRate, 0) / headsUpResults.length;
console.log(`\n  Average CFR win rate (1v1): ${(avgHeadsUp * 100).toFixed(1)}%`);
console.log(`${'═'.repeat(50)}`);

// ── Multiplayer matchups: 3P, 4P, 6P ────────────────────────────────────

interface MultiplayerResult {
  playerCount: number;
  cfrWins: number;
  totalGames: number;
  cfrWinRate: number;
  expectedRandom: number;
}

const mpResults: MultiplayerResult[] = [];

for (const tableSize of [3, 4, 6]) {
  const oppCount = tableSize - 1;
  console.log(`\n── ${tableSize}-Player: 1 CFR vs ${oppCount} random profiles ──\n`);

  const opponents = sampleProfiles(oppCount);
  const opponentNames = opponents.map(p => p.name).join(', ');
  console.log(`  Opponents: ${opponentNames}\n`);

  const cfrIdsMp = new Set<string>(['cfr-0']);
  const botsMp: BotConfig[] = [
    { id: 'cfr-0', name: 'CFR', difficulty: BotDifficulty.HARD },
    ...opponents.map((p, i) => ({
      id: `opp-${i}`,
      name: p.name,
      difficulty: BotDifficulty.HARD,
      profileConfig: p.config,
    })),
  ];

  const statsMp = simulate({
    games: config.games,
    players: botsMp.length,
    maxCards: config.maxCards,
    difficulty: BotDifficulty.HARD,
    botConfigs: botsMp,
    strategy: createMixedStrategy(cfrIdsMp),
    progressInterval: Math.max(1, Math.floor(config.games / 10)),
  });

  const cfrWins = statsMp.wins['cfr-0'] ?? 0;
  const expectedRandom = 1 / tableSize;
  mpResults.push({
    playerCount: tableSize,
    cfrWins,
    totalGames: statsMp.totalGames,
    cfrWinRate: cfrWins / statsMp.totalGames,
    expectedRandom,
  });

  totalCfrWins += cfrWins;
  totalGames += statsMp.totalGames;
}

// Print multiplayer summary
console.log(`\n${'═'.repeat(50)}`);
console.log('  Multiplayer Results: CFR vs Random Profiles');
console.log(`${'═'.repeat(50)}\n`);
console.log('  Table   CFR Win%   Random%   Edge     W /     L');
console.log(`  ${'─'.repeat(44)}`);

for (const r of mpResults) {
  const pct = (r.cfrWinRate * 100).toFixed(1);
  const rnd = (r.expectedRandom * 100).toFixed(1);
  const edge = ((r.cfrWinRate - r.expectedRandom) * 100).toFixed(1);
  const edgeSign = r.cfrWinRate >= r.expectedRandom ? '+' : '';
  const losses = r.totalGames - r.cfrWins;
  console.log(
    `  ${String(r.playerCount) + 'P'}${' '.repeat(4)}` +
    `${(pct + '%').padStart(8)}  ${(rnd + '%').padStart(7)}  ${(edgeSign + edge).padStart(5)}  ${String(r.cfrWins).padStart(5)} / ${String(losses).padStart(5)}`,
  );
}

// ── Overall summary ─────────────────────────────────────────────────────

const overallWinRate = totalGames > 0 ? totalCfrWins / totalGames : 0;
const hitRate = evalStats.totalDecisions > 0
  ? (evalStats.hits / evalStats.totalDecisions * 100).toFixed(1)
  : '0.0';
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Overall: CFR won ${totalCfrWins}/${totalGames} (${(overallWinRate * 100).toFixed(1)}%)`);
console.log(`  Strategy coverage: ${evalStats.hits}/${evalStats.totalDecisions} decisions (${hitRate}% hit rate)`);
console.log(`  Missed info sets: ${evalStats.misses} (fell back to uniform random)`);
console.log(`${'═'.repeat(50)}\n`);
