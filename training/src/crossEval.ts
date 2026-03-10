/**
 * Cross-player-count evaluation: tests a BotProfileConfig against lvl8 profiles
 * at 2P, 4P, and 6P to measure universal strength.
 */
import {
  BotDifficulty,
  BOT_PROFILES,
  type BotProfileConfig,
  type GameSettings,
  DEFAULT_BOT_PROFILE_CONFIG,
} from '@bull-em/shared';
import { createBotPlayers, runGame } from './gameLoop.js';
import type { BotConfig } from './types.js';

interface CrossEvalResult {
  playerCount: number;
  overallWinRate: number;
  perProfile: Record<string, number>;
}

function evaluateAtPlayerCount(
  config: BotProfileConfig,
  playerCount: number,
  gamesPerMatchup: number,
  maxCards: number,
): CrossEvalResult {
  const level8Profiles = BOT_PROFILES.filter(p => p.key.endsWith('_lvl8'));
  const perProfile: Record<string, number> = {};
  let totalWins = 0;
  let totalGames = 0;

  const settings: GameSettings = { maxCards, turnTimer: 0 };

  for (const profile of level8Profiles) {
    let wins = 0;

    if (playerCount === 2) {
      // 1v1 against each profile
      const botConfigs: BotConfig[] = [
        { id: 'evolved', name: 'Evolved', difficulty: BotDifficulty.HARD, profileConfig: config },
        { id: profile.key, name: profile.key, difficulty: BotDifficulty.HARD, profileConfig: profile.config },
      ];
      const players = createBotPlayers(botConfigs);

      for (let g = 0; g < gamesPerMatchup; g++) {
        const result = runGame(players, settings, botConfigs, undefined, BotDifficulty.HARD);
        if (result.winnerId === 'evolved') wins++;
      }
      totalGames += gamesPerMatchup;
    } else {
      // Multi-player: evolved + (playerCount-1) copies of the profile
      const botConfigs: BotConfig[] = [
        { id: 'evolved', name: 'Evolved', difficulty: BotDifficulty.HARD, profileConfig: config },
      ];
      for (let i = 0; i < playerCount - 1; i++) {
        botConfigs.push({
          id: `${profile.key}-${i}`,
          name: `${profile.key}-${i}`,
          difficulty: BotDifficulty.HARD,
          profileConfig: profile.config,
        });
      }
      const players = createBotPlayers(botConfigs);

      for (let g = 0; g < gamesPerMatchup; g++) {
        const result = runGame(players, settings, botConfigs, undefined, BotDifficulty.HARD);
        if (result.winnerId === 'evolved') wins++;
      }
      totalGames += gamesPerMatchup;
    }

    totalWins += wins;
    perProfile[profile.key] = wins / gamesPerMatchup;
  }

  return {
    playerCount,
    overallWinRate: totalWins / totalGames,
    perProfile,
  };
}

// ── Main ──

const gamesPerMatchup = parseInt(process.argv.find(a => a.startsWith('--games='))?.split('=')[1] ?? '1000', 10);
const maxCards = 5;

// Parse command-line config or use default
let testConfig: BotProfileConfig;
const configArg = process.argv.find(a => a.startsWith('--config='));
if (configArg) {
  const configPath = configArg.split('=')[1]!;
  const fs = await import('node:fs');
  const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  testConfig = data.config ?? data;
} else {
  testConfig = { ...DEFAULT_BOT_PROFILE_CONFIG };
}

console.log('\n═══════════════════════════════════════════════════════');
console.log('  Cross-Player-Count Evaluation');
console.log('═══════════════════════════════════════════════════════\n');
console.log('  Config:', JSON.stringify(testConfig, null, 2));
console.log(`\n  Games per matchup: ${gamesPerMatchup}`);
console.log(`  Max cards: ${maxCards}\n`);

const playerCounts = [2, 4, 6];
const results: CrossEvalResult[] = [];

for (const pc of playerCounts) {
  const expectedWR = pc === 2 ? 0.5 : 1.0 / pc;
  console.log(`  Testing ${pc}-player (baseline: ${(expectedWR * 100).toFixed(1)}%)...`);
  const start = performance.now();
  const result = evaluateAtPlayerCount(testConfig, pc, gamesPerMatchup, maxCards);
  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  results.push(result);

  const beaten = Object.values(result.perProfile).filter(wr => wr > expectedWR).length;
  console.log(`    Win rate: ${(result.overallWinRate * 100).toFixed(1)}% (${beaten}/9 beaten)  [${elapsed}s]`);

  for (const [key, wr] of Object.entries(result.perProfile)) {
    const marker = wr > expectedWR ? '+' : '-';
    console.log(`      ${marker} ${key}: ${(wr * 100).toFixed(1)}%`);
  }
  console.log('');
}

// Composite score: weighted average across player counts
// Weight 2P more since it's the hardest to differentiate
const weights = { 2: 0.5, 4: 0.3, 6: 0.2 };
let compositeScore = 0;
for (const r of results) {
  const pc = r.playerCount as 2 | 4 | 6;
  const expectedWR = pc === 2 ? 0.5 : 1.0 / pc;
  // Normalized: how much above random baseline
  const edge = r.overallWinRate - expectedWR;
  compositeScore += weights[pc] * edge;
}

console.log('═══════════════════════════════════════════════════════');
console.log(`  COMPOSITE EDGE: ${(compositeScore * 100).toFixed(2)}% above baseline`);
console.log('═══════════════════════════════════════════════════════\n');
