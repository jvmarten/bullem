#!/usr/bin/env node

/**
 * CLI entry point for evaluating an evolved bot against the full 81-profile
 * bot pool.
 *
 * Tests the evolved bot heads-up against EVERY bot profile (or a configurable
 * sample) and reports aggregate stats. This gives a real picture of heads-up
 * strength across all playstyles.
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
  /** Best win rate (blended). Supports both old `bestWinRate` and new format. */
  bestWinRate?: number;
  bestBlendedWinRate?: number;
  bestPopWinRate?: number;
  bestBenchWinRate?: number;
  bestProfileWinRate?: number;
  /** Number of completed generations. Supports both `generations` and `completedGenerations`. */
  generations?: number;
  completedGenerations?: number;
  populationSize?: number;
  gamesPerMatchup?: number;
  totalGames?: number;
  hofSize?: number;
  hallOfFame?: { id: string; config: BotProfileConfig; origin: string; generation: number }[];
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

Evaluates an evolved bot parameter set against all level-9 bot profiles
heads-up and reports per-profile and aggregate win rates.

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

// Robust metadata reading — support both old and new field names
const evolvedGenerations = evolved.generations ?? evolved.completedGenerations ?? 0;
const evolvedWinRate = evolved.bestWinRate ?? evolved.bestBlendedWinRate ?? 0;

console.log(`  Evolved over ${evolvedGenerations} generations`);
console.log(`  Training win rate: ${(evolvedWinRate * 100).toFixed(1)}%`);
if (evolved.bestPopWinRate !== undefined) {
  console.log(`  Pop win rate:      ${(evolved.bestPopWinRate * 100).toFixed(1)}%`);
}
if (evolved.bestBenchWinRate !== undefined) {
  console.log(`  HoF win rate:      ${(evolved.bestBenchWinRate * 100).toFixed(1)}%`);
}
if (evolved.bestProfileWinRate !== undefined) {
  console.log(`  Profile win rate:  ${(evolved.bestProfileWinRate * 100).toFixed(1)}%`);
}
if (evolved.hofSize !== undefined) {
  console.log(`  HoF members:       ${evolved.hofSize}`);
}

const evolvedConfig = evolved.config;

// ── Heads-up evaluation against level 9 bot profiles ─────────────────
// Level 9 bots are the strongest expression of each personality archetype.
// Lower levels are weaker variants that inflate win rates without adding signal.

const lvl9Profiles = BOT_PROFILES.filter(p => p.key.endsWith('_lvl9'));

console.log(`\n${'═'.repeat(60)}`);
console.log("  Bull 'Em Evolved Bot Evaluation — Heads-Up vs Lvl9 Profiles");
console.log(`${'═'.repeat(60)}\n`);
console.log(`  Games per matchup:  ${config.games}`);
console.log(`  Profiles tested:    ${lvl9Profiles.length} (level 9 only)`);
console.log(`  Max cards:          ${config.maxCards}`);
console.log('');

interface ProfileResult {
  profile: BotProfileDefinition;
  wins: number;
  games: number;
  winRate: number;
}

const profileResults: ProfileResult[] = [];
let totalEvolvedWins = 0;
let totalGames = 0;

console.log('── Heads-Up Results ──\n');

for (const profile of lvl9Profiles) {
  const bots: BotConfig[] = [
    {
      id: 'evolved-0',
      name: 'Evolved',
      difficulty: BotDifficulty.HARD,
      profileConfig: evolvedConfig,
    },
    {
      id: `opp-${profile.key}`,
      name: profile.name,
      difficulty: BotDifficulty.HARD,
      profileConfig: profile.config,
    },
  ];

  const stats = simulate({
    games: config.games,
    players: 2,
    maxCards: config.maxCards,
    difficulty: BotDifficulty.HARD,
    botConfigs: bots,
    progressInterval: 0, // Suppress per-matchup progress for cleaner output
  });

  const wins = stats.wins['evolved-0'] ?? 0;
  const winRate = stats.totalGames > 0 ? wins / stats.totalGames : 0;
  profileResults.push({ profile, wins, games: stats.totalGames, winRate });

  totalEvolvedWins += wins;
  totalGames += stats.totalGames;

  // Compact per-profile output
  const bar = winRate >= 0.5 ? '+' : '-';
  console.log(
    `  ${bar} ${profile.name.padEnd(18)} ${(winRate * 100).toFixed(1)}%  (${wins}/${stats.totalGames})`,
  );
}

// ── Worst/best matchups ─────────────────────────────────────────────

const sorted = [...profileResults].sort((a, b) => a.winRate - b.winRate);
console.log(`\n── Hardest Matchups ──`);
for (const r of sorted.slice(0, 3)) {
  console.log(`  ${r.profile.name.padEnd(18)} ${(r.winRate * 100).toFixed(1)}%`);
}

console.log(`\n── Easiest Matchups ──`);
for (const r of sorted.slice(-3).reverse()) {
  console.log(`  ${r.profile.name.padEnd(18)} ${(r.winRate * 100).toFixed(1)}%`);
}

// ── HoF evaluation (if available in strategy) ────────────────────────

if (evolved.hallOfFame && evolved.hallOfFame.length > 0) {
  console.log(`\n\n── Heads-Up vs Hall of Fame (${evolved.hallOfFame.length} members) ──`);

  let hofTotalWins = 0;
  let hofTotalGames = 0;

  for (const hofMember of evolved.hallOfFame) {
    const bots: BotConfig[] = [
      {
        id: 'evolved-0',
        name: 'Evolved',
        difficulty: BotDifficulty.HARD,
        profileConfig: evolvedConfig,
      },
      {
        id: `hof-${hofMember.id}`,
        name: `HoF-${hofMember.origin}`,
        difficulty: BotDifficulty.HARD,
        profileConfig: hofMember.config,
      },
    ];

    const stats = simulate({
      games: config.games,
      players: 2,
      maxCards: config.maxCards,
      difficulty: BotDifficulty.HARD,
      botConfigs: bots,
      progressInterval: 0,
    });

    const wins = stats.wins['evolved-0'] ?? 0;
    const winRate = stats.totalGames > 0 ? wins / stats.totalGames : 0;
    hofTotalWins += wins;
    hofTotalGames += stats.totalGames;

    const bar = winRate >= 0.5 ? '+' : '-';
    console.log(
      `  ${bar} gen${hofMember.generation} ${hofMember.origin.substring(0, 20).padEnd(20)} ${(winRate * 100).toFixed(1)}%  (${wins}/${stats.totalGames})`,
    );
  }

  const hofOverallRate = hofTotalGames > 0 ? hofTotalWins / hofTotalGames : 0;
  console.log(`  Overall vs HoF: ${(hofOverallRate * 100).toFixed(1)}%  (${hofTotalWins}/${hofTotalGames})`);

  totalEvolvedWins += hofTotalWins;
  totalGames += hofTotalGames;
}

// ── Overall summary ─────────────────────────────────────────────────────

const overallWinRate = totalGames > 0 ? totalEvolvedWins / totalGames : 0;
const profileOnlyWins = profileResults.reduce((s, r) => s + r.wins, 0);
const profileOnlyGames = profileResults.reduce((s, r) => s + r.games, 0);
const profileOnlyRate = profileOnlyGames > 0 ? profileOnlyWins / profileOnlyGames : 0;

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Heads-Up vs Lvl9:         ${(profileOnlyRate * 100).toFixed(1)}%  (${profileOnlyWins}/${profileOnlyGames})`);
if (totalGames !== profileOnlyGames) {
  console.log(`  Overall (incl. HoF):      ${(overallWinRate * 100).toFixed(1)}%  (${totalEvolvedWins}/${totalGames})`);
}
console.log(`  Profiles beaten (>50%):   ${profileResults.filter(r => r.winRate > 0.5).length}/${profileResults.length}`);
console.log(`${'═'.repeat(60)}\n`);
