#!/usr/bin/env node

/**
 * Benchmark CFR bots against level-8 heuristic bots and validate win rates
 * against minimum thresholds.
 *
 * Runs three benchmark categories:
 *   1. Heads-up (2P): CFR vs each of the 9 lvl8 heuristic profiles
 *   2. 4-player: 1 CFR + 3 random lvl8 opponents
 *   3. 6-player: 1 CFR + 5 random lvl8 opponents
 *
 * Exits with code 1 if any threshold is not met, code 0 if all pass.
 *
 * Usage:
 *   npm run benchmark-cfr -w training
 *   npm run benchmark-cfr -w training -- --games 1000
 *   npm run benchmark-cfr -w training -- --quick
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BOT_PROFILE_MAP, BotDifficulty,
  setCFRStrategyData, decideCFRWithSearch,
} from '@bull-em/shared';
import type { BotProfileDefinition, CompactCFRStrategy } from '@bull-em/shared';
import { simulate } from './simulator.js';
import type { BotConfig, BotStrategy, BotStrategyContext, BotStrategyAction } from './types.js';

// ── Constants ────────────────────────────────────────────────────────────

const LVL8_KEYS = [
  'rock_lvl8', 'bluffer_lvl8', 'grinder_lvl8', 'wildcard_lvl8',
  'professor_lvl8', 'shark_lvl8', 'cannon_lvl8', 'frost_lvl8', 'hustler_lvl8',
] as const;

const DEFAULT_STRATEGY_PATH = path.resolve(
  import.meta.dirname ?? process.cwd(),
  '../../client/public/data/cfr-strategy.json',
);

// ── Thresholds ───────────────────────────────────────────────────────────

const THRESHOLD_HEADS_UP = 0.55;   // 55% average win rate in 1v1
const THRESHOLD_4P = 0.30;         // 30% win rate (above 25% random baseline)
const THRESHOLD_6P = 0.20;         // 20% win rate (above 16.7% random baseline)

// ── CLI parsing ──────────────────────────────────────────────────────────

interface CLIConfig {
  games: number;
  maxCards: number;
  strategyPath: string;
}

function parseArgs(argv: string[]): CLIConfig {
  const args = argv.slice(2);
  let games = 500;
  let maxCards = 5;
  let strategyPath = DEFAULT_STRATEGY_PATH;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--games':
      case '-g':
        games = parseInt(next ?? '', 10);
        if (isNaN(games) || games < 1) {
          console.error('Error: --games must be a positive integer');
          process.exit(1);
        }
        i++;
        break;
      case '--quick':
        games = 100;
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
      case '--strategy':
      case '-s':
        strategyPath = next ?? strategyPath;
        i++;
        break;
      case '--help':
      case '-h':
        console.log(`
Bull 'Em CFR Benchmark

Runs CFR bots against level-8 heuristic bots and validates win rates
against minimum thresholds. Exits with code 1 on failure.

Usage:
  npm run benchmark-cfr -w training
  npm run benchmark-cfr -w training -- --games 1000
  npm run benchmark-cfr -w training -- --quick

Options:
  --games, -g <n>        Games per matchup (default: 500)
  --quick                Use 100 games per matchup for fast CI runs
  --max-cards, -m <n>    Max cards before elimination (default: 5, range: 1-5)
  --strategy, -s <path>  Path to compact v2 strategy JSON
  --help, -h             Show this help message

Thresholds:
  Heads-up average:  >= ${(THRESHOLD_HEADS_UP * 100).toFixed(0)}%
  4-player:          >= ${(THRESHOLD_4P * 100).toFixed(0)}%
  6-player:          >= ${(THRESHOLD_6P * 100).toFixed(0)}%
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}. Use --help for usage.`);
        process.exit(1);
    }
  }

  return { games, maxCards, strategyPath };
}

// ── Load strategy ────────────────────────────────────────────────────────

function loadCompactStrategy(filePath: string): void {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    console.error(`Error: Strategy file not found: ${absPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  const data = JSON.parse(raw) as CompactCFRStrategy;
  setCFRStrategyData(data);
  const sizeKB = (Buffer.byteLength(raw, 'utf-8') / 1024).toFixed(0);
  console.log(`  Strategy: ${absPath}`);
  console.log(`  Size: ${sizeKB} KB (compact v2)`);
}

// ── Strategy wrapper ─────────────────────────────────────────────────────

function createSearchStrategy(cfrBotIds: Set<string>): BotStrategy {
  return (context: BotStrategyContext): BotStrategyAction | undefined => {
    if (!cfrBotIds.has(context.botId)) return undefined;

    const result = decideCFRWithSearch(
      context.state,
      context.botCards,
      context.totalCards,
      context.activePlayers,
      context.jokerCount ?? 0,
      context.lastChanceMode ?? 'classic',
      context.botId,
      false, // wasPenalizedLastRound — not tracked in simulator
    );

    if (!result) return undefined;
    return result as BotStrategyAction;
  };
}

// ── Benchmark categories ─────────────────────────────────────────────────

interface HeadsUpResult {
  opponentName: string;
  cfrWinRate: number;
}

function runHeadsUp(
  lvl8Profiles: BotProfileDefinition[],
  config: CLIConfig,
): HeadsUpResult[] {
  const results: HeadsUpResult[] = [];
  const cfrIds = new Set<string>(['cfr-0']);
  const strategy = createSearchStrategy(cfrIds);

  for (const opponent of lvl8Profiles) {
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
      strategy,
      progressInterval: 0,
    });

    results.push({
      opponentName: opponent.name,
      cfrWinRate: (stats.wins['cfr-0'] ?? 0) / stats.totalGames,
    });
  }

  return results;
}

function runMultiplayer(
  tableSize: number,
  lvl8Profiles: BotProfileDefinition[],
  config: CLIConfig,
): number {
  const cfrIds = new Set<string>(['cfr-0']);
  const strategy = createSearchStrategy(cfrIds);

  // Pick random lvl8 opponents
  const shuffled = [...lvl8Profiles].sort(() => Math.random() - 0.5);
  const opponents = shuffled.slice(0, tableSize - 1);
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
    strategy,
    progressInterval: 0,
  });

  return (stats.wins['cfr-0'] ?? 0) / stats.totalGames;
}

// ── Output formatting ────────────────────────────────────────────────────

function printHeadsUpTable(results: HeadsUpResult[]): void {
  const nameWidth = Math.max(...results.map(r => r.opponentName.length), 10);
  const sorted = [...results].sort((a, b) => b.cfrWinRate - a.cfrWinRate);

  console.log(`\n  ${'Opponent'.padEnd(nameWidth)}  ${'CFR Win%'.padStart(8)}`);
  console.log(`  ${'─'.repeat(nameWidth)}  ${'─'.repeat(8)}`);
  for (const r of sorted) {
    const pct = (r.cfrWinRate * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(r.cfrWinRate * 20));
    console.log(`  ${r.opponentName.padEnd(nameWidth)}  ${(pct + '%').padStart(8)}  ${bar}`);
  }
}

function statusLabel(pass: boolean): string {
  return pass ? 'PASS' : 'FAIL';
}

// ── Main ─────────────────────────────────────────────────────────────────

const config = parseArgs(process.argv);

// Resolve lvl8 profiles
const lvl8Profiles: BotProfileDefinition[] = [];
for (const key of LVL8_KEYS) {
  const profile = BOT_PROFILE_MAP.get(key);
  if (!profile) {
    console.error(`Error: profile '${key}' not found`);
    process.exit(1);
  }
  lvl8Profiles.push(profile);
}

// Header
console.log(`\n${'═'.repeat(60)}`);
console.log("  Bull 'Em CFR Benchmark");
console.log(`${'═'.repeat(60)}\n`);

loadCompactStrategy(config.strategyPath);
console.log(`  Games per matchup:  ${config.games}`);
console.log(`  Max cards:          ${config.maxCards}`);

// ── Category 1: Heads-up ─────────────────────────────────────────────────

console.log(`\n  ── Heads-Up (1v1 vs each lvl8 profile) ──`);

const headsUpResults = runHeadsUp(lvl8Profiles, config);
printHeadsUpTable(headsUpResults);

const headsUpAvg = headsUpResults.reduce((s, r) => s + r.cfrWinRate, 0) / headsUpResults.length;
const headsUpPass = headsUpAvg >= THRESHOLD_HEADS_UP;

console.log(`\n  Average 1v1 win rate: ${(headsUpAvg * 100).toFixed(1)}%  (threshold: ${(THRESHOLD_HEADS_UP * 100).toFixed(0)}%)  [${statusLabel(headsUpPass)}]`);

// ── Category 2: 4-player ────────────────────────────────────────────────

console.log(`\n  ── 4-Player (1 CFR + 3 random lvl8) ──`);

const fourPlayerWinRate = runMultiplayer(4, lvl8Profiles, config);
const fourPlayerPass = fourPlayerWinRate >= THRESHOLD_4P;

console.log(`\n  CFR win rate: ${(fourPlayerWinRate * 100).toFixed(1)}%  (threshold: ${(THRESHOLD_4P * 100).toFixed(0)}%, random baseline: 25.0%)  [${statusLabel(fourPlayerPass)}]`);

// ── Category 3: 6-player ────────────────────────────────────────────────

console.log(`\n  ── 6-Player (1 CFR + 5 random lvl8) ──`);

const sixPlayerWinRate = runMultiplayer(6, lvl8Profiles, config);
const sixPlayerPass = sixPlayerWinRate >= THRESHOLD_6P;

console.log(`\n  CFR win rate: ${(sixPlayerWinRate * 100).toFixed(1)}%  (threshold: ${(THRESHOLD_6P * 100).toFixed(0)}%, random baseline: 16.7%)  [${statusLabel(sixPlayerPass)}]`);

// ── Summary ──────────────────────────────────────────────────────────────

const allPass = headsUpPass && fourPlayerPass && sixPlayerPass;

console.log(`\n${'═'.repeat(60)}`);
console.log('  BENCHMARK SUMMARY');
console.log(`${'═'.repeat(60)}`);
console.log(`  Heads-up avg:   ${(headsUpAvg * 100).toFixed(1)}%  (>= ${(THRESHOLD_HEADS_UP * 100).toFixed(0)}%)  [${statusLabel(headsUpPass)}]`);
console.log(`  4-player:       ${(fourPlayerWinRate * 100).toFixed(1)}%  (>= ${(THRESHOLD_4P * 100).toFixed(0)}%)  [${statusLabel(fourPlayerPass)}]`);
console.log(`  6-player:       ${(sixPlayerWinRate * 100).toFixed(1)}%  (>= ${(THRESHOLD_6P * 100).toFixed(0)}%)  [${statusLabel(sixPlayerPass)}]`);
console.log(`${'─'.repeat(60)}`);
console.log(`  Overall: ${allPass ? 'ALL BENCHMARKS PASSED' : 'BENCHMARK FAILURE — one or more thresholds not met'}`);
console.log(`${'═'.repeat(60)}\n`);

process.exit(allPass ? 0 : 1);
