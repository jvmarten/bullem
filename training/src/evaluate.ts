#!/usr/bin/env node

/**
 * CLI entry point for evaluating a trained CFR strategy against the
 * heuristic bot pool.
 *
 * Runs 1v1 matchups against each of the 9 level-8 (strongest heuristic)
 * personality archetypes, plus a 6-player reference matchup.
 *
 * Usage:
 *   npm run evaluate -w training
 *   npx tsx training/src/evaluate.ts --strategy training/strategies/cfr-strategy-100000.json
 */

import { BOT_PROFILES, BOT_PROFILE_MAP, BotDifficulty } from '@bull-em/shared';
import type { BotProfileDefinition, JokerCount, LastChanceMode, GameSettings } from '@bull-em/shared';
import { simulate } from './simulator.js';
import {
  findLatestStrategy, findLatestPlayerCountStrategies, loadStrategy,
  createCFREvaluationStrategy, createCompositeEvaluationStrategy,
} from './cfr/index.js';
import type { EvaluationStats, ExportedStrategy } from './cfr/index.js';
import type { BotConfig, BotStrategy, BotStrategyContext, BotStrategyAction } from './types.js';

/** The 9 level-8 personality keys — strongest heuristic version of each archetype. */
const LVL8_KEYS = [
  'rock_lvl8',
  'bluffer_lvl8',
  'grinder_lvl8',
  'wildcard_lvl8',
  'professor_lvl8',
  'shark_lvl8',
  'cannon_lvl8',
  'frost_lvl8',
  'hustler_lvl8',
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
  allConfigs: boolean;
  jokerCount: JokerCount;
  lastChanceMode: LastChanceMode;
} {
  const args = argv.slice(2);
  let strategyFile: string | null = null;
  let games = 1000;
  let maxCards = 5;
  let allConfigs = false;
  let jokerCount: JokerCount = 0;
  let lastChanceMode: LastChanceMode = 'classic';

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
      case '--all-configs':
        allConfigs = true;
        break;
      case '--jokers':
      case '-j': {
        const jc = parseInt(next ?? '', 10);
        if (isNaN(jc) || (jc !== 0 && jc !== 1 && jc !== 2)) {
          console.error('Error: --jokers must be 0, 1, or 2');
          process.exit(1);
        }
        jokerCount = jc as JokerCount;
        i++;
        break;
      }
      case '--last-chance-mode':
      case '--lcm': {
        const val = (next ?? '').toLowerCase();
        if (val !== 'classic' && val !== 'strict') {
          console.error('Error: --last-chance-mode must be "classic" or "strict"');
          process.exit(1);
        }
        lastChanceMode = val;
        i++;
        break;
      }
      case '--help':
      case '-h':
        console.log(`
Bull 'Em CFR Strategy Evaluation

Evaluates a trained CFR strategy by playing 1v1 against each of the 9 strongest
heuristic bot personalities (lvl8), plus multiplayer reference matchups.

Usage:
  npm run evaluate -w training
  npx tsx training/src/evaluate.ts [options]

Options:
  --strategy, -s <path>  Path to strategy JSON file (default: latest in strategies/)
  --games, -g <n>        Games per matchup (default: 1000)
  --max-cards, -m <n>    Max cards before elimination (default: 5, range: 1-5)
  --jokers, -j <n>       Jokers in deck: 0, 1, or 2 (default: 0)
  --last-chance-mode <m>  Last chance raise mode: classic or strict (default: classic)
  --all-configs          Run evaluation across all joker/LCR configurations
  --help, -h             Show this help message

Examples:
  npm run evaluate -w training
  npm run evaluate -w training -- --all-configs --games 500
  npm run evaluate -w training -- --jokers 2 --lcm strict
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}. Use --help for usage.`);
        process.exit(1);
    }
  }

  return { strategyFile, games, maxCards, allConfigs, jokerCount, lastChanceMode };
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

// ── Resolve lvl8 profiles ───────────────────────────────────────────────

const lvl8Profiles: BotProfileDefinition[] = [];
for (const key of LVL8_KEYS) {
  const profile = BOT_PROFILE_MAP.get(key);
  if (!profile) {
    console.error(`Error: profile '${key}' not found in BOT_PROFILE_MAP`);
    process.exit(1);
  }
  lvl8Profiles.push(profile);
}

// ── Run evaluations ─────────────────────────────────────────────────────

/** Configuration variant to evaluate. */
interface EvalVariant {
  label: string;
  jokerCount: JokerCount;
  lastChanceMode: LastChanceMode;
}

const evalVariants: EvalVariant[] = config.allConfigs
  ? [
      { label: 'Standard (0j, classic)', jokerCount: 0, lastChanceMode: 'classic' },
      { label: '1 Joker, classic', jokerCount: 1, lastChanceMode: 'classic' },
      { label: '2 Jokers, classic', jokerCount: 2, lastChanceMode: 'classic' },
      { label: 'Standard (0j, strict)', jokerCount: 0, lastChanceMode: 'strict' },
      { label: '1 Joker, strict', jokerCount: 1, lastChanceMode: 'strict' },
      { label: '2 Jokers, strict', jokerCount: 2, lastChanceMode: 'strict' },
    ]
  : [{ label: `${config.jokerCount}j, ${config.lastChanceMode}`, jokerCount: config.jokerCount, lastChanceMode: config.lastChanceMode }];

console.log(`\n${'═'.repeat(60)}`);
console.log("  Bull 'Em CFR Strategy Evaluation");
console.log(`${'═'.repeat(60)}\n`);
console.log(`  Games per matchup:  ${config.games}`);
console.log(`  Max cards:          ${config.maxCards}`);
console.log(`  Configurations:     ${evalVariants.length}`);
console.log('');

interface VariantResult {
  label: string;
  avgHeadsUp: number;
  mpEdges: { playerCount: number; edge: number }[];
}

let grandTotalWins = 0;
let grandTotalGames = 0;
const allVariantResults: VariantResult[] = [];

for (const variant of evalVariants) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`  Config: ${variant.label}`);
  console.log(`${'━'.repeat(60)}\n`);

  const gameSettings: Partial<GameSettings> = {
    jokerCount: variant.jokerCount > 0 ? variant.jokerCount : undefined,
    lastChanceMode: variant.lastChanceMode,
  };

  let variantWins = 0;
  let variantGames = 0;

  // ── 1v1: CFR vs each lvl8 personality
  const headsUpResults: { opponentName: string; cfrWinRate: number }[] = [];

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
      strategy: createMixedStrategy(cfrIds),
      gameSettings,
      progressInterval: 0,
    });

    const cfrWins = stats.wins['cfr-0'] ?? 0;
    headsUpResults.push({
      opponentName: opponent.name,
      cfrWinRate: cfrWins / config.games,
    });
    variantWins += cfrWins;
    variantGames += config.games;
  }

  // Print heads-up summary
  const nameWidth = Math.max(...headsUpResults.map(r => r.opponentName.length), 10);
  const sortedHu = [...headsUpResults].sort((a, b) => b.cfrWinRate - a.cfrWinRate);
  console.log(`  ${'Opponent'.padEnd(nameWidth)}  ${'CFR Win%'.padStart(8)}`);
  console.log(`  ${'─'.repeat(nameWidth)}  ${'─'.repeat(8)}`);
  for (const r of sortedHu) {
    const pct = (r.cfrWinRate * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(r.cfrWinRate * 20));
    console.log(`  ${r.opponentName.padEnd(nameWidth)}  ${(pct + '%').padStart(8)}  ${bar}`);
  }
  const avgHeadsUp = headsUpResults.reduce((s, r) => s + r.cfrWinRate, 0) / headsUpResults.length;
  console.log(`\n  Average 1v1: ${(avgHeadsUp * 100).toFixed(1)}%`);

  // ── Multiplayer matchups
  const mpEdges: { playerCount: number; edge: number }[] = [];
  for (const tableSize of [3, 4, 5, 6]) {
    const opponents = sampleProfiles(tableSize - 1);
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
      gameSettings,
      progressInterval: 0,
    });

    const cfrWins = statsMp.wins['cfr-0'] ?? 0;
    const winRate = cfrWins / statsMp.totalGames;
    const edge = winRate - (1 / tableSize);
    mpEdges.push({ playerCount: tableSize, edge });
    variantWins += cfrWins;
    variantGames += statsMp.totalGames;
  }

  console.log(`\n  Multiplayer edges: ${mpEdges.map(e => `${e.playerCount}P: ${(e.edge >= 0 ? '+' : '')}${(e.edge * 100).toFixed(1)}%`).join('  ')}`);
  console.log(`  Variant total: ${variantWins}/${variantGames} (${((variantWins / variantGames) * 100).toFixed(1)}%)`);

  allVariantResults.push({ label: variant.label, avgHeadsUp, mpEdges });
  grandTotalWins += variantWins;
  grandTotalGames += variantGames;
}

// ── Summary across all configurations ─────────────────────────────────

if (evalVariants.length > 1) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  Summary Across All Configurations');
  console.log(`${'═'.repeat(60)}\n`);

  const labelWidth = Math.max(...allVariantResults.map(r => r.label.length), 10);
  console.log(`  ${'Config'.padEnd(labelWidth)}  ${'1v1 Avg'.padStart(8)}  ${'3P Edge'.padStart(8)}  ${'4P Edge'.padStart(8)}  ${'5P Edge'.padStart(8)}  ${'6P Edge'.padStart(8)}`);
  console.log(`  ${'─'.repeat(labelWidth)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}`);

  for (const r of allVariantResults) {
    const h = (r.avgHeadsUp * 100).toFixed(1) + '%';
    const edges = [3, 4, 5, 6].map(pc => {
      const e = r.mpEdges.find(m => m.playerCount === pc);
      if (!e) return '   N/A';
      const val = (e.edge * 100).toFixed(1);
      return (e.edge >= 0 ? '+' : '') + val + '%';
    });
    console.log(`  ${r.label.padEnd(labelWidth)}  ${h.padStart(8)}  ${edges.map(e => e.padStart(8)).join('  ')}`);
  }
}

// ── Overall summary ─────────────────────────────────────────────────────

const overallWinRate = grandTotalGames > 0 ? grandTotalWins / grandTotalGames : 0;
const hitRate = evalStats.totalDecisions > 0
  ? (evalStats.hits / evalStats.totalDecisions * 100).toFixed(1)
  : '0.0';
console.log(`\n${'═'.repeat(60)}`);
console.log(`  Overall: CFR won ${grandTotalWins}/${grandTotalGames} (${(overallWinRate * 100).toFixed(1)}%)`);
console.log(`  Strategy coverage: ${evalStats.hits}/${evalStats.totalDecisions} decisions (${hitRate}% hit rate)`);
console.log(`  Missed info sets: ${evalStats.misses} (fell back to heuristic)`);
console.log(`${'═'.repeat(60)}\n`);
