#!/usr/bin/env node

/**
 * CLI entry point for evaluating a trained CFR strategy against the full
 * 81-profile bot pool.
 *
 * Runs games between CFR agents and randomly sampled heuristic bot profiles
 * across 2-player and 4-player games, then prints comparative win rates.
 *
 * Usage:
 *   npm run evaluate -w training
 *   npx tsx training/src/evaluate.ts --strategy training/strategies/cfr-strategy-100000.json
 */

import { BOT_PROFILES, BotDifficulty } from '@bull-em/shared';
import type { BotProfileDefinition } from '@bull-em/shared';
import { simulate } from './simulator.js';
import {
  findLatestStrategy, loadStrategy,
  createCFREvaluationStrategy,
} from './cfr/index.js';
import type { BotConfig, BotStrategy, BotStrategyContext, BotStrategyAction } from './types.js';

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

Runs a trained CFR strategy against randomly sampled opponents from the
full 81-profile bot pool and compares win rates.

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

const strategyPath = config.strategyFile ?? findLatestStrategy();
if (!strategyPath) {
  console.error('Error: No strategy file found. Run training first or specify --strategy.');
  process.exit(1);
}

console.log(`Loading strategy: ${strategyPath}`);
const exportedStrategy = loadStrategy(strategyPath);
console.log(`  Trained for ${exportedStrategy.iterations} iterations`);
console.log(`  ${exportedStrategy.infoSetCount} info sets`);
console.log(`  Avg regret: ${exportedStrategy.avgRegret.toFixed(6)}`);

const cfrStrategy = createCFREvaluationStrategy(exportedStrategy);

// ── Matchup configurations ──────────────────────────────────────────────

interface MatchupDef {
  name: string;
  description: string;
  playerCount: number;
}

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

const matchups: MatchupDef[] = [
  { name: 'Heads-up (2P)', description: '1 CFR vs 1 random profile', playerCount: 2 },
  { name: '6-Player', description: '1 CFR vs 5 random profiles', playerCount: 6 },
];

// ── Run evaluations ─────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log("  Bull 'Em CFR Strategy Evaluation");
console.log(`${'═'.repeat(50)}\n`);
console.log(`  Games per matchup:  ${config.games}`);
console.log(`  Opponent pool:      ${BOT_PROFILES.length} profiles`);
console.log(`  Max cards:          ${config.maxCards}`);
console.log('');

let totalCfrWins = 0;
let totalGames = 0;

for (const matchup of matchups) {
  console.log(`\n── ${matchup.name} ──`);
  console.log(`  ${matchup.description}\n`);

  const opponentCount = matchup.playerCount - 1;
  const opponents = sampleProfiles(opponentCount);
  const opponentNames = opponents.map(p => `${p.name}`).join(', ');
  console.log(`  Opponents: ${opponentNames}\n`);

  const cfrIds = new Set<string>(['cfr-0']);
  const bots: BotConfig[] = [
    { id: 'cfr-0', name: 'CFR', difficulty: BotDifficulty.HARD },
    ...opponents.map((p, i) => ({
      id: `opp-${i}`,
      name: p.name,
      difficulty: BotDifficulty.HARD,
      profileConfig: p.config,
    })),
  ];

  const stats = simulate({
    games: config.games,
    players: bots.length,
    maxCards: config.maxCards,
    difficulty: BotDifficulty.HARD,
    botConfigs: bots,
    strategy: createMixedStrategy(cfrIds),
    progressInterval: Math.max(1, Math.floor(config.games / 10)),
  });

  totalCfrWins += stats.wins['cfr-0'] ?? 0;
  totalGames += stats.totalGames;
}

// ── Overall summary ─────────────────────────────────────────────────────

const overallWinRate = totalGames > 0 ? totalCfrWins / totalGames : 0;
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Overall: CFR won ${totalCfrWins}/${totalGames} (${(overallWinRate * 100).toFixed(1)}%)`);
console.log(`${'═'.repeat(50)}\n`);
