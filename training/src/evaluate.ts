#!/usr/bin/env node

/**
 * CLI entry point for evaluating a trained CFR strategy against heuristic bots.
 *
 * Runs games between CFR agents and heuristic bots of various difficulties,
 * then prints comparative win rates.
 *
 * Usage:
 *   npm run evaluate -w training
 *   npx tsx training/src/evaluate.ts --strategy training/strategies/cfr-strategy-100000.json
 */

import { BotDifficulty } from '@bull-em/shared';
import { simulate } from './simulator.js';
import {
  findLatestStrategy, loadStrategy,
  createCFREvaluationStrategy,
} from './cfr/index.js';
import type { BotConfig, BotStrategy, BotStrategyContext, BotStrategyAction } from './types.js';

function parseArgs(argv: string[]): {
  strategyFile: string | null;
  games: number;
  players: number;
  maxCards: number;
} {
  const args = argv.slice(2);
  let strategyFile: string | null = null;
  let games = 1000;
  let players = 4;
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
      case '--players':
      case '-p':
        players = parseInt(next ?? '', 10);
        if (isNaN(players) || players < 2 || players > 12) {
          console.error('Error: --players must be between 2 and 12');
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

Runs a trained CFR strategy against heuristic bots and compares win rates.

Usage:
  npm run evaluate -w training
  npx tsx training/src/evaluate.ts [options]

Options:
  --strategy, -s <path>  Path to strategy JSON file (default: latest in strategies/)
  --games, -g <n>        Games per matchup (default: 1000)
  --players, -p <n>      Total players per game (default: 4, range: 2-12)
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

  return { strategyFile, games, players, maxCards };
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

interface MatchupConfig {
  name: string;
  description: string;
  botConfigs: BotConfig[];
  strategy: BotStrategy;
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

const cfrPlayerCount = Math.max(1, Math.floor(config.players / 2));
const heuristicPlayerCount = config.players - cfrPlayerCount;

const matchups: MatchupConfig[] = [];

// Matchup 1: CFR vs Normal bots
{
  const bots: BotConfig[] = [];
  const cfrIds = new Set<string>();
  for (let i = 0; i < cfrPlayerCount; i++) {
    const id = `cfr-${i}`;
    bots.push({ id, name: `CFR ${i + 1}`, difficulty: BotDifficulty.HARD });
    cfrIds.add(id);
  }
  for (let i = 0; i < heuristicPlayerCount; i++) {
    bots.push({ id: `normal-${i}`, name: `Normal ${i + 1}`, difficulty: BotDifficulty.NORMAL });
  }
  matchups.push({
    name: 'CFR vs Normal',
    description: `${cfrPlayerCount} CFR bot(s) vs ${heuristicPlayerCount} Normal bot(s)`,
    botConfigs: bots,
    strategy: createMixedStrategy(cfrIds),
  });
}

// Matchup 2: CFR vs Hard bots
{
  const bots: BotConfig[] = [];
  const cfrIds = new Set<string>();
  for (let i = 0; i < cfrPlayerCount; i++) {
    const id = `cfr-${i}`;
    bots.push({ id, name: `CFR ${i + 1}`, difficulty: BotDifficulty.HARD });
    cfrIds.add(id);
  }
  for (let i = 0; i < heuristicPlayerCount; i++) {
    bots.push({ id: `hard-${i}`, name: `Hard ${i + 1}`, difficulty: BotDifficulty.HARD });
  }
  matchups.push({
    name: 'CFR vs Hard',
    description: `${cfrPlayerCount} CFR bot(s) vs ${heuristicPlayerCount} Hard bot(s)`,
    botConfigs: bots,
    strategy: createMixedStrategy(cfrIds),
  });
}

// Matchup 3: CFR vs Mixed field (Normal + Hard)
if (config.players >= 3) {
  const bots: BotConfig[] = [];
  const cfrIds = new Set<string>();
  const id = 'cfr-0';
  bots.push({ id, name: 'CFR', difficulty: BotDifficulty.HARD });
  cfrIds.add(id);

  const remaining = config.players - 1;
  const normalCount = Math.ceil(remaining / 2);
  const hardCount = remaining - normalCount;

  for (let i = 0; i < normalCount; i++) {
    bots.push({ id: `normal-${i}`, name: `Normal ${i + 1}`, difficulty: BotDifficulty.NORMAL });
  }
  for (let i = 0; i < hardCount; i++) {
    bots.push({ id: `hard-${i}`, name: `Hard ${i + 1}`, difficulty: BotDifficulty.HARD });
  }
  matchups.push({
    name: 'CFR vs Mixed Field',
    description: `1 CFR vs ${normalCount} Normal + ${hardCount} Hard`,
    botConfigs: bots,
    strategy: createMixedStrategy(cfrIds),
  });
}

// ── Run evaluations ─────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log("  Bull 'Em CFR Strategy Evaluation");
console.log(`${'═'.repeat(50)}\n`);
console.log(`  Games per matchup:  ${config.games}`);
console.log(`  Players per game:   ${config.players}`);
console.log(`  Max cards:          ${config.maxCards}`);
console.log('');

for (const matchup of matchups) {
  console.log(`\n── ${matchup.name} ──`);
  console.log(`  ${matchup.description}\n`);

  simulate({
    games: config.games,
    players: matchup.botConfigs.length,
    maxCards: config.maxCards,
    difficulty: BotDifficulty.HARD,
    botConfigs: matchup.botConfigs,
    strategy: matchup.strategy,
    progressInterval: Math.max(1, Math.floor(config.games / 10)),
  });
}

console.log(`\n${'═'.repeat(50)}\n`);
