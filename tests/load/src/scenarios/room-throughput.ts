/**
 * Scenario: Room Creation Throughput
 *
 * Measures how many rooms can be created per second, the latency of
 * room:create and room:join events, and memory growth per room.
 *
 * Test flow:
 * 1. Create N rooms in rapid succession (configurable concurrency)
 * 2. Each room gets 2-4 players joining
 * 3. Measure creation latency, join latency, and server health at peak
 * 4. Clean up all rooms
 */

import { LoadTestClient, createClients } from '../client.js';
import { MetricsCollector } from '../metrics.js';
import type { ScenarioConfig, ScenarioResult } from '../types.js';

export interface RoomThroughputConfig extends ScenarioConfig {
  /** Total number of rooms to create. Default: 50 */
  totalRooms: number;
  /** Number of rooms to create concurrently per batch. Default: 10 */
  concurrency: number;
  /** Number of players per room (2-4). Default: 3 */
  playersPerRoom: number;
  /** Delay between batches in ms. Default: 100 */
  batchDelayMs: number;
}

const DEFAULT_CONFIG: RoomThroughputConfig = {
  serverUrl: 'http://localhost:3001',
  totalRooms: 50,
  concurrency: 10,
  playersPerRoom: 3,
  batchDelayMs: 100,
};

export async function run(
  userConfig: Partial<RoomThroughputConfig> = {},
): Promise<ScenarioResult> {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const metrics = new MetricsCollector();
  const allClients: LoadTestClient[] = [];

  console.log(`\n[room-throughput] Creating ${config.totalRooms} rooms`);
  console.log(`  concurrency: ${config.concurrency}, players/room: ${config.playersPerRoom}`);
  console.log(`  server: ${config.serverUrl}\n`);

  metrics.start();

  try {
    const batches = Math.ceil(config.totalRooms / config.concurrency);

    for (let batch = 0; batch < batches; batch++) {
      const batchSize = Math.min(config.concurrency, config.totalRooms - batch * config.concurrency);
      const roomPromises: Promise<void>[] = [];

      for (let i = 0; i < batchSize; i++) {
        const roomIdx = batch * config.concurrency + i;
        roomPromises.push(createAndPopulateRoom(roomIdx, config, metrics, allClients));
      }

      const results = await Promise.allSettled(roomPromises);
      const failures = results.filter(r => r.status === 'rejected');
      if (failures.length > 0) {
        console.log(`  batch ${batch + 1}/${batches}: ${batchSize - failures.length}/${batchSize} rooms OK`);
      } else {
        console.log(`  batch ${batch + 1}/${batches}: ${batchSize}/${batchSize} rooms OK`);
      }

      // Check server health mid-run
      if (batch === Math.floor(batches / 2)) {
        await checkHealth(config.serverUrl, metrics);
      }

      if (batch < batches - 1 && config.batchDelayMs > 0) {
        await delay(config.batchDelayMs);
      }
    }

    // Final health check at peak
    await checkHealth(config.serverUrl, metrics);

    console.log(`\n  Peak rooms: cleaning up ${allClients.length} connections...`);
  } finally {
    // Cleanup all clients
    await Promise.allSettled(allClients.map(c => c.cleanup()));
    metrics.stop();
  }

  const summary = metrics.summarize();
  return { scenario: 'room-throughput', config, metrics: summary };
}

async function createAndPopulateRoom(
  roomIdx: number,
  config: RoomThroughputConfig,
  metrics: MetricsCollector,
  allClients: LoadTestClient[],
): Promise<void> {
  // Create host
  const host = new LoadTestClient({
    serverUrl: config.serverUrl,
    playerName: `Host_${roomIdx}`,
    metrics,
  });
  await host.connect();
  allClients.push(host);

  const roomCode = await host.createRoom();

  // Join additional players
  const joinPromises: Promise<void>[] = [];
  for (let j = 1; j < config.playersPerRoom; j++) {
    joinPromises.push(
      (async () => {
        const player = new LoadTestClient({
          serverUrl: config.serverUrl,
          playerName: `P${roomIdx}_${j}`,
          metrics,
        });
        await player.connect();
        allClients.push(player);
        await player.joinRoom(roomCode);
      })(),
    );
  }

  await Promise.all(joinPromises);
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
