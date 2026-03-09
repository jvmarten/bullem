#!/usr/bin/env node

/**
 * CLI entry point for evaluating an evolved bot against the full 81-profile
 * bot pool.
 *
 * Loads the best evolved parameter set and pits it against randomly sampled
 * opponents from the 81-profile matrix across 2-player and 4-player games,
 * then prints win rates.
 *
 * Usage:
 *   npm run evaluate-evolved -w training
 *   npm run evaluate-evolved -w training -- --strategy training/strategies/evolved-best-gen100.json
 */

import { BOT_PROFILES, BotDifficulty } from '@bull-em/shared';
import type { BotProfileConfig, BotProfileDefinition } from '@bull-em/shared';
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

// ── Arg parsing ────────────────────────────────────────────────────────

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
Bull 'Em Evolved Bot Evaluation

Evaluates an evolved bot parameter set against randomly sampled opponents
from the full 81-profile bot pool and prints comparative win rates.

Usage:
  npm run evaluate-evolved -w training
  npx tsx training/src/evaluateEvolved.ts [options]

Options:
  --strategy, -s <path>  Path to evolved strategy JSON file (default: latest in strategies/)
  --games, -g <n>        Games per matchup (default: 1000)
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

  return { strategyFile, games, maxCards };
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
  playerCount: number;
}

const matchups: MatchupDef[] = [
  { name: 'Heads-up (2P)', description: '1 Evolved vs 1 random profile', playerCount: 2 },
  { name: '4-Player', description: '1 Evolved vs 3 random profiles', playerCount: 4 },
];

// ── Run evaluations ─────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log("  Bull 'Em Evolved Bot Evaluation");
console.log(`${'═'.repeat(50)}\n`);
console.log(`  Games per matchup:  ${config.games}`);
console.log(`  Opponent pool:      ${BOT_PROFILES.length} profiles`);
console.log(`  Max cards:          ${config.maxCards}`);
console.log('');

let totalEvolvedWins = 0;
let totalGames = 0;

for (const matchup of matchups) {
  console.log(`\n── ${matchup.name} ──`);
  console.log(`  ${matchup.description}\n`);

  const opponentCount = matchup.playerCount - 1;
  const opponents = sampleProfiles(opponentCount);
  const opponentNames = opponents.map(p => `${p.name}`).join(', ');
  console.log(`  Opponents: ${opponentNames}\n`);

  const bots: BotConfig[] = [
    {
      id: 'evolved-0',
      name: 'Evolved',
      difficulty: BotDifficulty.HARD,
      profileConfig: evolvedConfig,
    },
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
    progressInterval: Math.max(1, Math.floor(config.games / 10)),
  });

  totalEvolvedWins += stats.wins['evolved-0'] ?? 0;
  totalGames += stats.totalGames;
}

// ── Overall summary ─────────────────────────────────────────────────────

const overallWinRate = totalGames > 0 ? totalEvolvedWins / totalGames : 0;
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Overall: Evolved won ${totalEvolvedWins}/${totalGames} (${(overallWinRate * 100).toFixed(1)}%)`);
console.log(`${'═'.repeat(50)}\n`);
