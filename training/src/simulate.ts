#!/usr/bin/env node

/**
 * CLI entry point for headless Bull 'Em game simulation.
 *
 * Usage:
 *   npx tsx training/src/simulate.ts --games 1000 --players 4
 *   npx tsx training/src/simulate.ts --games 500 --players 2 --max-cards 3 --difficulty hard
 */

import { BotDifficulty } from '@bull-em/shared';
import { simulate } from './simulator.js';

function parseArgs(argv: string[]): {
  games: number;
  players: number;
  maxCards: number;
  difficulty: BotDifficulty;
  progressInterval: number;
} {
  const args = argv.slice(2);
  let games = 1000;
  let players = 4;
  let maxCards = 5;
  let difficulty: BotDifficulty = BotDifficulty.HARD;
  let progressInterval = 100;

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
      case '--difficulty':
      case '-d': {
        const val = (next ?? '').toLowerCase();
        if (val === 'normal') difficulty = BotDifficulty.NORMAL;
        else if (val === 'hard') difficulty = BotDifficulty.HARD;
        else if (val === 'impossible') difficulty = BotDifficulty.IMPOSSIBLE;
        else {
          console.error('Error: --difficulty must be normal, hard, or impossible');
          process.exit(1);
        }
        i++;
        break;
      }
      case '--progress':
        progressInterval = parseInt(next ?? '', 10);
        if (isNaN(progressInterval) || progressInterval < 0) {
          console.error('Error: --progress must be a non-negative integer');
          process.exit(1);
        }
        i++;
        break;
      case '--help':
      case '-h':
        console.log(`
Bull 'Em Headless Game Simulator

Usage:
  npx tsx training/src/simulate.ts [options]

Options:
  --games, -g <n>         Number of games to simulate (default: 1000)
  --players, -p <n>       Number of bot players per game (default: 4, range: 2-12)
  --max-cards, -m <n>     Max cards before elimination (default: 5, range: 1-5)
  --difficulty, -d <lvl>  Bot difficulty: normal, hard, impossible (default: hard)
  --progress <n>          Log progress every N games (default: 100, 0 = disabled)
  --help, -h              Show this help message

Examples:
  npx tsx training/src/simulate.ts --games 1000 --players 2
  npx tsx training/src/simulate.ts -g 5000 -p 6 -d normal
  npx tsx training/src/simulate.ts --games 100 --players 4 --max-cards 3
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}. Use --help for usage.`);
        process.exit(1);
    }
  }

  // Validate player/card combo doesn't exceed deck
  const maxPlayersForCards = Math.floor(52 / maxCards);
  if (players > maxPlayersForCards) {
    console.error(
      `Error: ${players} players with max ${maxCards} cards requires ${players * maxCards} cards, ` +
      `but the deck only has 52. Max players for ${maxCards} cards: ${maxPlayersForCards}`,
    );
    process.exit(1);
  }

  return { games, players, maxCards, difficulty, progressInterval };
}

const config = parseArgs(process.argv);

console.log(`Starting simulation: ${config.games} games, ${config.players} players, ` +
  `max ${config.maxCards} cards, difficulty: ${config.difficulty}`);

simulate({
  ...config,
});
