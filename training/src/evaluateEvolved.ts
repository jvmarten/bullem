#!/usr/bin/env node

/**
 * CLI entry point for evaluating an evolved bot against heuristic bots.
 *
 * Loads the best evolved parameter set and pits it against Normal and Hard
 * heuristic bots, then prints comparative win rates.
 *
 * Usage:
 *   npm run evaluate-evolved -w training
 *   npm run evaluate-evolved -w training -- --strategy training/strategies/evolved-best-gen100.json
 */

import { BotDifficulty } from '@bull-em/shared';
import type { BotProfileConfig } from '@bull-em/shared';
import { simulate } from './simulator.js';
import type { BotConfig } from './types.js';
import { readFileSync, readdirSync } from 'node:fs';

// ── Helpers ────────────────────────────────────────────────────────────

interface EvolvedStrategy {
  config: BotProfileConfig;
  bestWinRate: number;
  generations: number;
  populationSize: number;
  gamesPerMatchup: number;
  totalGames: number;
  [key: string]: unknown;
}

function findLatestEvolvedStrategy(): string | null {
  const dir = 'training/strategies';
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith('evolved-best-') && f.endsWith('.json'))
      .sort();
    if (files.length === 0) return null;
    return `${dir}/${files[files.length - 1]}`;
  } catch {
    return null;
  }
}

function loadEvolvedStrategy(path: string): EvolvedStrategy {
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as EvolvedStrategy;
}

// ── Arg parsing ────────────────────────────────────────────────────────

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
Bull 'Em Evolved Bot Evaluation

Evaluates an evolved bot parameter set against heuristic bots of various
difficulties and prints comparative win rates.

Usage:
  npm run evaluate-evolved -w training
  npx tsx training/src/evaluateEvolved.ts [options]

Options:
  --strategy, -s <path>  Path to evolved strategy JSON file (default: latest in strategies/)
  --games, -g <n>        Games per matchup (default: 1000)
  --players, -p <n>      Total players per game (default: 4, range: 2-12)
  --max-cards, -m <n>    Max cards before elimination (default: 5, range: 1-5)
  --help, -h             Show this help message

Examples:
  npm run evaluate-evolved -w training
  npm run evaluate-evolved -w training -- --games 5000
  npx tsx training/src/evaluateEvolved.ts -s training/strategies/evolved-best-gen100.json
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

// ── Main ───────────────────────────────────────────────────────────────

const config = parseArgs(process.argv);

const strategyPath = config.strategyFile ?? findLatestEvolvedStrategy();
if (!strategyPath) {
  console.error('Error: No evolved strategy file found. Run evolution first or specify --strategy.');
  process.exit(1);
}

console.log(`Loading evolved strategy: ${strategyPath}`);
const evolved = loadEvolvedStrategy(strategyPath);
console.log(`  Evolved over ${evolved.generations} generations`);
console.log(`  Tournament win rate: ${(evolved.bestWinRate * 100).toFixed(1)}%`);

const evolvedConfig = evolved.config;

// ── Matchup configurations ──────────────────────────────────────────────

interface MatchupDef {
  name: string;
  description: string;
  botConfigs: BotConfig[];
}

const evolvedPlayerCount = Math.max(1, Math.floor(config.players / 2));
const heuristicPlayerCount = config.players - evolvedPlayerCount;

const matchups: MatchupDef[] = [];

// Matchup 1: Evolved vs Normal bots
{
  const bots: BotConfig[] = [];
  for (let i = 0; i < evolvedPlayerCount; i++) {
    bots.push({
      id: `evolved-${i}`,
      name: `Evolved ${i + 1}`,
      difficulty: BotDifficulty.HARD,
      profileConfig: evolvedConfig,
    });
  }
  for (let i = 0; i < heuristicPlayerCount; i++) {
    bots.push({ id: `normal-${i}`, name: `Normal ${i + 1}`, difficulty: BotDifficulty.NORMAL });
  }
  matchups.push({
    name: 'Evolved vs Normal',
    description: `${evolvedPlayerCount} Evolved bot(s) vs ${heuristicPlayerCount} Normal bot(s)`,
    botConfigs: bots,
  });
}

// Matchup 2: Evolved vs Hard bots
{
  const bots: BotConfig[] = [];
  for (let i = 0; i < evolvedPlayerCount; i++) {
    bots.push({
      id: `evolved-${i}`,
      name: `Evolved ${i + 1}`,
      difficulty: BotDifficulty.HARD,
      profileConfig: evolvedConfig,
    });
  }
  for (let i = 0; i < heuristicPlayerCount; i++) {
    bots.push({ id: `hard-${i}`, name: `Hard ${i + 1}`, difficulty: BotDifficulty.HARD });
  }
  matchups.push({
    name: 'Evolved vs Hard',
    description: `${evolvedPlayerCount} Evolved bot(s) vs ${heuristicPlayerCount} Hard bot(s)`,
    botConfigs: bots,
  });
}

// Matchup 3: Evolved vs Mixed field (Normal + Hard)
if (config.players >= 3) {
  const bots: BotConfig[] = [];
  bots.push({
    id: 'evolved-0',
    name: 'Evolved',
    difficulty: BotDifficulty.HARD,
    profileConfig: evolvedConfig,
  });

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
    name: 'Evolved vs Mixed Field',
    description: `1 Evolved vs ${normalCount} Normal + ${hardCount} Hard`,
    botConfigs: bots,
  });
}

// ── Run evaluations ─────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log("  Bull 'Em Evolved Bot Evaluation");
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
    progressInterval: Math.max(1, Math.floor(config.games / 10)),
  });
}

console.log(`\n${'═'.repeat(50)}\n`);
