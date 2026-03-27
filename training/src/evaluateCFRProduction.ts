#!/usr/bin/env node

/**
 * Evaluate CFR bots using the PRODUCTION decision pipeline (decideCFRWithSearch)
 * against all 9 level-8 heuristic bot personalities.
 *
 * Unlike evaluate.ts (which uses raw ExportedStrategy format), this script:
 * 1. Loads the compact v2 strategy file (same as production)
 * 2. Calls decideCFRWithSearch() (same as production BotPlayer)
 * 3. Measures actual in-game performance with all safety adjustments
 *
 * Usage:
 *   npm run evaluate-cfr -w training
 *   npm run evaluate-cfr -w training -- --games 2000
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { decode } from '@msgpack/msgpack';
import {
  BOT_PROFILE_MAP, BotDifficulty,
  setCFRBucketData, decideCFRWithSearch, decideCFR,
} from '@bull-em/shared';
import type { BotProfileDefinition, JokerCount, LastChanceMode, GameSettings, CompactCFRBucket } from '@bull-em/shared';
import { simulate } from './simulator.js';
import type { BotConfig, BotStrategy, BotStrategyContext, BotStrategyAction } from './types.js';

// ── Constants ────────────────────────────────────────────────────────────

const LVL8_KEYS = [
  'rock_lvl8', 'bluffer_lvl8', 'grinder_lvl8', 'wildcard_lvl8',
  'professor_lvl8', 'shark_lvl8', 'cannon_lvl8', 'frost_lvl8', 'hustler_lvl8',
] as const;

const DEFAULT_DATA_DIR = path.resolve(
  import.meta.dirname ?? process.cwd(),
  '../../client/public/data',
);

// ── CLI parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  dataDir: string;
  games: number;
  maxCards: number;
  useSearch: boolean;
  baseline: boolean;
} {
  const args = argv.slice(2);
  let dataDir = DEFAULT_DATA_DIR;
  let games = 1000;
  let maxCards = 5;
  let useSearch = true;
  let baseline = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--strategy':
      case '-s':
        dataDir = next ?? dataDir;
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
      case '--no-search':
        useSearch = false;
        break;
      case '--baseline':
        baseline = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Bull 'Em CFR Production Evaluation

Evaluates CFR bots using the production decision pipeline (decideCFRWithSearch)
against all 9 level-8 heuristic bot personalities, plus multiplayer matchups.

Usage:
  npm run evaluate-cfr -w training
  npm run evaluate-cfr -w training -- --games 2000

Options:
  --strategy, -s <path>  Path to data directory with .bin files (default: client/public/data/)
  --games, -g <n>        Games per matchup (default: 1000)
  --max-cards, -m <n>    Max cards before elimination (default: 5, range: 1-5)
  --no-search            Use decideCFR() instead of decideCFRWithSearch() (for comparison)
  --baseline             Run both with and without search, show comparison
  --help, -h             Show this help message
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}. Use --help for usage.`);
        process.exit(1);
    }
  }

  return { dataDir, games, maxCards, useSearch, baseline };
}

// ── Load strategy ────────────────────────────────────────────────────────

function loadBucketFiles(dataDir: string): void {
  const absDir = path.resolve(dataDir);
  const buckets = [
    { name: 'p2', file: 'cfr-p2.bin' },
    { name: 'p34', file: 'cfr-p34.bin' },
    { name: 'p5+', file: 'cfr-p5plus.bin' },
  ];
  let loaded = 0;
  for (const { name, file } of buckets) {
    const binPath = path.join(absDir, file);
    if (!fs.existsSync(binPath)) {
      console.warn(`  ${name}: not found at ${binPath}`);
      continue;
    }
    const raw = fs.readFileSync(binPath);
    const data = decode(raw) as CompactCFRBucket;
    setCFRBucketData(name, data);
    const sizeMB = (raw.length / 1024 / 1024).toFixed(1);
    console.log(`  ${name}: ${file} (${sizeMB} MB)`);
    loaded++;
  }
  if (loaded === 0) {
    console.error('Error: No strategy bucket files found');
    process.exit(1);
  }
}

// ── Strategy wrappers ────────────────────────────────────────────────────

/** Create a BotStrategy that calls decideCFRWithSearch (production pipeline). */
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

/** Create a BotStrategy that calls decideCFR (no Monte Carlo search). */
function createBaseStrategy(cfrBotIds: Set<string>): BotStrategy {
  return (context: BotStrategyContext): BotStrategyAction | undefined => {
    if (!cfrBotIds.has(context.botId)) return undefined;

    const result = decideCFR(
      context.state,
      context.botCards,
      context.totalCards,
      context.activePlayers,
      context.jokerCount ?? 0,
      context.lastChanceMode ?? 'classic',
      context.botId,
      false,
    );

    if (!result) return undefined;
    return result as BotStrategyAction;
  };
}

// ── Evaluation runner ────────────────────────────────────────────────────

interface MatchupResult {
  opponentName: string;
  cfrWinRate: number;
}

function runEvaluation(
  label: string,
  strategyFactory: (cfrIds: Set<string>) => BotStrategy,
  lvl8Profiles: BotProfileDefinition[],
  config: { games: number; maxCards: number },
): { headsUp: MatchupResult[]; mpEdges: { pc: number; edge: number }[] } {
  const headsUpResults: MatchupResult[] = [];

  // 1v1 matchups
  for (const opponent of lvl8Profiles) {
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
      strategy: strategyFactory(cfrIds),
      progressInterval: 0,
    });

    headsUpResults.push({
      opponentName: opponent.name,
      cfrWinRate: (stats.wins['cfr-0'] ?? 0) / config.games,
    });
  }

  // Multiplayer matchups
  const mpEdges: { pc: number; edge: number }[] = [];
  for (const tableSize of [3, 4, 5, 6]) {
    const cfrIds = new Set<string>(['cfr-0']);
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
      strategy: strategyFactory(cfrIds),
      progressInterval: 0,
    });

    const winRate = (stats.wins['cfr-0'] ?? 0) / stats.totalGames;
    mpEdges.push({ pc: tableSize, edge: winRate - (1 / tableSize) });
  }

  return { headsUp: headsUpResults, mpEdges };
}

function printResults(
  label: string,
  headsUp: MatchupResult[],
  mpEdges: { pc: number; edge: number }[],
): number {
  console.log(`\n  ── ${label} ──\n`);

  const nameWidth = Math.max(...headsUp.map(r => r.opponentName.length), 10);
  const sorted = [...headsUp].sort((a, b) => b.cfrWinRate - a.cfrWinRate);

  console.log(`  ${'Opponent'.padEnd(nameWidth)}  ${'CFR Win%'.padStart(8)}`);
  console.log(`  ${'─'.repeat(nameWidth)}  ${'─'.repeat(8)}`);
  for (const r of sorted) {
    const pct = (r.cfrWinRate * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(r.cfrWinRate * 20));
    console.log(`  ${r.opponentName.padEnd(nameWidth)}  ${(pct + '%').padStart(8)}  ${bar}`);
  }

  const avg = headsUp.reduce((s, r) => s + r.cfrWinRate, 0) / headsUp.length;
  console.log(`\n  Average 1v1: ${(avg * 100).toFixed(1)}%`);
  console.log(`  Multiplayer edges: ${mpEdges.map(e => `${e.pc}P: ${e.edge >= 0 ? '+' : ''}${(e.edge * 100).toFixed(1)}%`).join('  ')}`);

  return avg;
}

// ── Main ─────────────────────────────────────────────────────────────────

const cliConfig = parseArgs(process.argv);

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

// Load strategy
console.log(`\n${'═'.repeat(60)}`);
console.log("  Bull 'Em CFR Production Evaluation");
console.log(`${'═'.repeat(60)}\n`);
loadBucketFiles(cliConfig.dataDir);
console.log(`  Games per matchup:  ${cliConfig.games}`);
console.log(`  Max cards:          ${cliConfig.maxCards}`);
console.log(`  Mode:               ${cliConfig.baseline ? 'Baseline comparison (with vs without search)' : cliConfig.useSearch ? 'decideCFRWithSearch (production)' : 'decideCFR (no search)'}`);

if (cliConfig.baseline) {
  // Run both and compare
  const baseResult = runEvaluation('decideCFR (base)', createBaseStrategy, lvl8Profiles, cliConfig);
  const baseAvg = printResults('decideCFR (base — no Monte Carlo)', baseResult.headsUp, baseResult.mpEdges);

  const searchResult = runEvaluation('decideCFRWithSearch', createSearchStrategy, lvl8Profiles, cliConfig);
  const searchAvg = printResults('decideCFRWithSearch (production — with Monte Carlo)', searchResult.headsUp, searchResult.mpEdges);

  const delta = searchAvg - baseAvg;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  Search improvement: ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} percentage points`);
  console.log(`  Base avg 1v1:   ${(baseAvg * 100).toFixed(1)}%`);
  console.log(`  Search avg 1v1: ${(searchAvg * 100).toFixed(1)}%`);
  console.log(`${'═'.repeat(60)}\n`);
} else {
  const factory = cliConfig.useSearch ? createSearchStrategy : createBaseStrategy;
  const result = runEvaluation(
    cliConfig.useSearch ? 'decideCFRWithSearch' : 'decideCFR',
    factory, lvl8Profiles, cliConfig,
  );
  printResults(
    cliConfig.useSearch ? 'Production (decideCFRWithSearch)' : 'Base (decideCFR, no search)',
    result.headsUp, result.mpEdges,
  );

  console.log(`\n${'═'.repeat(60)}`);
  const totalWins = result.headsUp.reduce((s, r) => s + r.cfrWinRate * cliConfig.games, 0);
  const totalGames = result.headsUp.length * cliConfig.games + result.mpEdges.length * cliConfig.games;
  console.log(`  1v1 wins: ${Math.round(totalWins)}/${result.headsUp.length * cliConfig.games}`);
  console.log(`${'═'.repeat(60)}\n`);
}
