#!/usr/bin/env node

/**
 * CLI entry point for evolutionary bot parameter optimization.
 *
 * Evolves BotProfileConfig parameters through tournament-based selection,
 * using the existing headless simulator infrastructure.
 *
 * Usage:
 *   npm run evolve -w training
 *   npm run evolve -w training -- --generations 100 --population 30 --games-per-matchup 50
 */

import { evolve } from './evolution.js';

function parseArgs(argv: string[]): {
  generations: number;
  populationSize: number;
  gamesPerMatchup: number;
  playersPerGame: number;
  maxCards: number;
  survivalRate: number;
  mutationStrength: number;
  mutationRate: number;
  outputDir: string;
  hofSize: number;
  hofWeight: number;
  eliteCount: number;
  profileWeight: number;
  fitnessSharing: boolean;
} {
  const args = argv.slice(2);
  let generations = 50;
  let populationSize = 30;
  let gamesPerMatchup = 50;
  let playersPerGame = 2;
  let maxCards = 5;
  let survivalRate = 0.3;
  let mutationStrength = 0.15;
  let mutationRate = 0.8;
  let outputDir = 'training/strategies';
  let hofSize = 20;
  let hofWeight = 0.3;
  let eliteCount = 2;
  let profileWeight = 0.2;
  let fitnessSharing = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case '--generations':
      case '-g':
        generations = parseInt(next ?? '', 10);
        if (isNaN(generations) || generations < 1) {
          console.error('Error: --generations must be a positive integer');
          process.exit(1);
        }
        i++;
        break;
      case '--population':
      case '-n':
        populationSize = parseInt(next ?? '', 10);
        if (isNaN(populationSize) || populationSize < 4) {
          console.error('Error: --population must be at least 4');
          process.exit(1);
        }
        i++;
        break;
      case '--games-per-matchup':
        gamesPerMatchup = parseInt(next ?? '', 10);
        if (isNaN(gamesPerMatchup) || gamesPerMatchup < 1) {
          console.error('Error: --games-per-matchup must be a positive integer');
          process.exit(1);
        }
        i++;
        break;
      case '--players':
      case '-p':
        playersPerGame = parseInt(next ?? '', 10);
        if (isNaN(playersPerGame) || playersPerGame < 2 || playersPerGame > 12) {
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
      case '--survival-rate':
        survivalRate = parseFloat(next ?? '');
        if (isNaN(survivalRate) || survivalRate <= 0 || survivalRate >= 1) {
          console.error('Error: --survival-rate must be between 0 and 1 (exclusive)');
          process.exit(1);
        }
        i++;
        break;
      case '--mutation-strength':
        mutationStrength = parseFloat(next ?? '');
        if (isNaN(mutationStrength) || mutationStrength <= 0) {
          console.error('Error: --mutation-strength must be a positive number');
          process.exit(1);
        }
        i++;
        break;
      case '--mutation-rate':
        mutationRate = parseFloat(next ?? '');
        if (isNaN(mutationRate) || mutationRate <= 0 || mutationRate > 1) {
          console.error('Error: --mutation-rate must be between 0 and 1');
          process.exit(1);
        }
        i++;
        break;
      case '--output-dir':
      case '-o':
        outputDir = next ?? outputDir;
        i++;
        break;
      case '--hof-size':
        hofSize = parseInt(next ?? '', 10);
        if (isNaN(hofSize) || hofSize < 0) {
          console.error('Error: --hof-size must be a non-negative integer');
          process.exit(1);
        }
        i++;
        break;
      case '--hof-weight':
        hofWeight = parseFloat(next ?? '');
        if (isNaN(hofWeight) || hofWeight < 0 || hofWeight > 1) {
          console.error('Error: --hof-weight must be between 0 and 1');
          process.exit(1);
        }
        i++;
        break;
      case '--elite-count':
        eliteCount = parseInt(next ?? '', 10);
        if (isNaN(eliteCount) || eliteCount < 1) {
          console.error('Error: --elite-count must be a positive integer');
          process.exit(1);
        }
        i++;
        break;
      case '--profile-weight':
        profileWeight = parseFloat(next ?? '');
        if (isNaN(profileWeight) || profileWeight < 0 || profileWeight > 1) {
          console.error('Error: --profile-weight must be between 0 and 1');
          process.exit(1);
        }
        i++;
        break;
      case '--no-fitness-sharing':
        fitnessSharing = false;
        break;
      case '--help':
      case '-h':
        console.log(`
Bull 'Em Evolutionary Parameter Optimization

Evolves bot parameters through tournament-based selection to find
stronger heuristic bot configurations.

Usage:
  npm run evolve -w training
  npm run evolve -w training -- [options]

Options:
  --generations, -g <n>       Number of generations (default: 50)
  --population, -n <n>        Population size (default: 30, min: 4)
  --games-per-matchup <n>     Games per matchup in round-robin (default: 50)
  --players, -p <n>           Players per game (default: 2, range: 2-12)
  --max-cards, -m <n>         Max cards before elimination (default: 5, range: 1-5)
  --survival-rate <f>         Fraction of population to keep (default: 0.3)
  --mutation-strength <f>     Max parameter nudge fraction (default: 0.15)
  --mutation-rate <f>         Probability of mutating each param (default: 0.8)
  --output-dir, -o <path>     Output directory for results (default: training/strategies)
  --hof-size <n>              Hall-of-fame archive size, 0 to disable (default: 20)
  --hof-weight <f>            Weight of HoF win rate in fitness, 0-1 (default: 0.3)
  --elite-count <n>           Number of top individuals preserved each gen (default: 2)
  --profile-weight <f>        Weight of bot profile benchmark in fitness, 0-1 (default: 0.2)
  --no-fitness-sharing        Disable fitness sharing for diversity preservation
  --help, -h                  Show this help message

Examples:
  npm run evolve -w training -- --generations 100 --population 30 --games-per-matchup 50
  npm run evolve -w training -- -g 20 -n 10 --games-per-matchup 20
  npm run evolve -w training -- --players 4 --mutation-strength 0.2
  npm run evolve -w training -- --elite-count 3 --profile-weight 0.3
`);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}. Use --help for usage.`);
        process.exit(1);
    }
  }

  return {
    generations, populationSize, gamesPerMatchup, playersPerGame,
    maxCards, survivalRate, mutationStrength, mutationRate, outputDir,
    hofSize, hofWeight, eliteCount, profileWeight, fitnessSharing,
  };
}

const opts = parseArgs(process.argv);

evolve({
  generations: opts.generations,
  populationSize: opts.populationSize,
  gamesPerMatchup: opts.gamesPerMatchup,
  playersPerGame: opts.playersPerGame,
  maxCards: opts.maxCards,
  survivalRate: opts.survivalRate,
  mutationStrength: opts.mutationStrength,
  mutationRate: opts.mutationRate,
  outputDir: opts.outputDir,
  hofSize: opts.hofSize,
  hofWeight: opts.hofWeight,
  eliteCount: opts.eliteCount,
  profileWeight: opts.profileWeight,
  fitnessSharing: opts.fitnessSharing,
});
