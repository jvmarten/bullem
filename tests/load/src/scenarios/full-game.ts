/**
 * Scenario: Full Game Simulation
 *
 * Simulates N concurrent rooms each playing a complete game from lobby
 * to game-over. Measures end-to-end latency for all game events,
 * turn action latency, and games completed per minute.
 *
 * Test flow per room:
 * 1. Host creates room
 * 2. Host adds bots (server-side bots handle their own turns)
 * 3. Host starts game
 * 4. Host plays through rounds (bots play automatically)
 * 5. Game ends when host is eliminated or wins
 */

import { LoadTestClient } from '../client.js';
import { MetricsCollector } from '../metrics.js';
import type { ScenarioConfig, ScenarioResult } from '../types.js';

export interface FullGameConfig extends ScenarioConfig {
  /** Number of concurrent game rooms. Default: 10 */
  concurrentGames: number;
  /** Number of players per game (host + bots). Default: 4 */
  playersPerGame: number;
  /** Bot speed setting. Default: 'fast' */
  botSpeed: 'slow' | 'normal' | 'fast';
  /** Max cards setting (affects game length). Default: 3 */
  maxCards: number;
  /** Turn timer in seconds. Default: 30 */
  turnTimer: number;
  /** Maximum time to wait for a single game to complete, in ms. Default: 120000 */
  gameTimeoutMs: number;
}

const DEFAULT_CONFIG: FullGameConfig = {
  serverUrl: 'http://localhost:3001',
  concurrentGames: 10,
  playersPerGame: 4,
  botSpeed: 'fast',
  maxCards: 3,
  turnTimer: 30,
  gameTimeoutMs: 120_000,
};

export async function run(
  userConfig: Partial<FullGameConfig> = {},
): Promise<ScenarioResult> {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const metrics = new MetricsCollector();

  console.log(`\n[full-game] Running ${config.concurrentGames} concurrent games`);
  console.log(`  ${config.playersPerGame} players/game, botSpeed=${config.botSpeed}, maxCards=${config.maxCards}`);
  console.log(`  server: ${config.serverUrl}\n`);

  metrics.start();

  const gamePromises: Promise<GameResult>[] = [];
  for (let i = 0; i < config.concurrentGames; i++) {
    gamePromises.push(runSingleGame(i, config, metrics));
  }

  const results = await Promise.allSettled(gamePromises);
  const completed = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected');

  console.log(`\n  Games completed: ${completed}/${config.concurrentGames}`);
  if (failed.length > 0) {
    console.log(`  Failed: ${failed.length}`);
    for (const f of failed) {
      if (f.status === 'rejected') {
        console.log(`    ${(f.reason as Error).message}`);
      }
    }
  }

  // Check health at end
  await checkHealth(config.serverUrl, metrics);

  metrics.stop();
  const summary = metrics.summarize();
  return { scenario: 'full-game', config, metrics: summary };
}

interface GameResult {
  roomCode: string;
  rounds: number;
  winnerId: string;
  durationMs: number;
}

async function runSingleGame(
  gameIdx: number,
  config: FullGameConfig,
  metrics: MetricsCollector,
): Promise<GameResult> {
  const host = new LoadTestClient({
    serverUrl: config.serverUrl,
    playerName: `GameHost_${gameIdx}`,
    metrics,
  });

  try {
    await host.connect();
    const roomCode = await host.createRoom();

    // Configure settings — use fast bots to speed up load testing
    host.updateSettings({
      maxCards: config.maxCards,
      turnTimer: config.turnTimer,
      botSpeed: config.botSpeed,
      allowSpectators: false,
    });

    // Wait for room state to propagate
    await delay(50);

    // Add bots (server handles bot turns automatically)
    const botsNeeded = config.playersPerGame - 1;
    for (let b = 0; b < botsNeeded; b++) {
      await host.addBot();
    }

    // Wait for bots to appear in room state
    await delay(100);

    // Start the game
    const gameStart = Date.now();
    const initialState = await host.startGame();
    let rounds = initialState.roundNumber;

    // Play through the game — host takes turns, bots are server-controlled
    const winnerId = await playGameLoop(host, config, metrics);
    const durationMs = Date.now() - gameStart;

    const finalState = host.getGameState();
    if (finalState) rounds = finalState.roundNumber;

    metrics.recordGameCompleted();
    console.log(`  game ${gameIdx}: completed in ${rounds} rounds (${durationMs}ms)`);

    return { roomCode, rounds, winnerId, durationMs };
  } finally {
    await host.cleanup();
    metrics.recordRoomDestroyed();
  }
}

/**
 * Play through a game as the host. Bots move automatically (server-side).
 * When it's our turn, take a simple action.
 * Returns the winner's player ID.
 */
async function playGameLoop(
  host: LoadTestClient,
  config: FullGameConfig,
  metrics: MetricsCollector,
): Promise<string> {
  // Set up game over listener before entering loop
  const gameOverPromise = host.waitForGameOver(config.gameTimeoutMs);

  // Process game events until game ends
  const processLoop = async (): Promise<void> => {
    // Give time for initial game state
    await delay(50);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const state = host.getGameState();
      if (!state) {
        await delay(100);
        continue;
      }

      if (state.gamePhase === 'game_over' || state.gamePhase === 'finished') {
        return;
      }

      // Handle round result phase — send continue
      if (state.roundPhase === 'resolving' || state.gamePhase === 'round_result') {
        host.continue();
        // Wait for new round or game over
        try {
          await host.waitForGameState(10_000);
        } catch {
          // Might get game:over instead
          return;
        }
        continue;
      }

      // If it's our turn, take action
      if (host.isMyTurn()) {
        const actionStart = Date.now();
        const action = host.generateNextAction();

        switch (action.action) {
          case 'call':
            host.callHand(action.hand);
            break;
          case 'bull':
            host.callBull();
            break;
          case 'true':
            host.callTrue();
            break;
          case 'lastChancePass':
            host.lastChancePass();
            break;
        }

        metrics.recordEventRoundTrip(Date.now() - actionStart);
      }

      // Wait for next state update (bots take their turns server-side)
      try {
        await host.waitForGameState(15_000);
      } catch {
        // Check if game ended
        const latest = host.getGameState();
        if (latest?.gamePhase === 'game_over' || latest?.gamePhase === 'finished') {
          return;
        }
        // Timeout might mean we missed an event — check again
        continue;
      }
    }
  };

  // Race between the game loop and the game:over event
  const raceResult = await Promise.race([
    gameOverPromise,
    processLoop().then(() => 'loop-ended'),
  ]);

  // If loop ended first, wait briefly for game:over
  if (raceResult === 'loop-ended') {
    try {
      return await host.waitForGameOver(5000);
    } catch {
      return 'unknown';
    }
  }

  return raceResult;
}

async function checkHealth(serverUrl: string, metrics: MetricsCollector): Promise<void> {
  try {
    const resp = await fetch(`${serverUrl}/health`);
    const data = await resp.json() as { status: string; rooms: number; players: number };
    metrics.recordServerHealth(data);
    console.log(`  [health] status=${data.status} rooms=${data.rooms} players=${data.players}`);
  } catch {
    console.log('  [health] Failed to reach health endpoint');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
