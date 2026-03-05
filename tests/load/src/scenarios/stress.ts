/**
 * Scenario: Stress Test
 *
 * Ramps up concurrent connections and rooms to find the breaking point.
 * Starts with a small number of rooms and increases over configurable
 * stages, measuring latency degradation, error rates, and memory growth.
 *
 * Test flow:
 * 1. Stage 1: N rooms with M players each
 * 2. Stage 2: 2N rooms (previous rooms still active)
 * 3. Stage 3: 3N rooms
 * 4. Continue until max stages or error threshold exceeded
 * 5. Report where latency/errors degraded
 */

import { LoadTestClient } from '../client.js';
import { MetricsCollector } from '../metrics.js';
import type { ScenarioConfig, ScenarioResult } from '../types.js';

export interface StressConfig extends ScenarioConfig {
  /** Rooms added per stage. Default: 10 */
  roomsPerStage: number;
  /** Players per room (including host). Default: 3 */
  playersPerRoom: number;
  /** Number of ramp-up stages. Default: 5 */
  stages: number;
  /** Time to hold at each stage (ms) before moving to next. Default: 5000 */
  holdTimeMs: number;
  /** Error rate threshold (0-1) that triggers early stop. Default: 0.1 */
  errorThreshold: number;
  /** P95 latency threshold (ms) that triggers early stop. Default: 5000 */
  latencyThresholdMs: number;
}

const DEFAULT_CONFIG: StressConfig = {
  serverUrl: 'http://localhost:3001',
  roomsPerStage: 10,
  playersPerRoom: 3,
  stages: 5,
  holdTimeMs: 5000,
  errorThreshold: 0.1,
  latencyThresholdMs: 5000,
};

interface StageResult {
  stage: number;
  totalRooms: number;
  totalConnections: number;
  roomCreateP95: number;
  joinP95: number;
  errors: number;
  memoryMB: number;
  serverRooms: number;
  serverPlayers: number;
}

export async function run(
  userConfig: Partial<StressConfig> = {},
): Promise<ScenarioResult & { stageResults: StageResult[] }> {
  const config = { ...DEFAULT_CONFIG, ...userConfig };
  const metrics = new MetricsCollector();
  const allClients: LoadTestClient[] = [];
  const stageResults: StageResult[] = [];

  console.log(`\n[stress] Ramping ${config.stages} stages x ${config.roomsPerStage} rooms/stage`);
  console.log(`  ${config.playersPerRoom} players/room, hold=${config.holdTimeMs}ms`);
  console.log(`  thresholds: error=${config.errorThreshold * 100}%, p95=${config.latencyThresholdMs}ms`);
  console.log(`  server: ${config.serverUrl}\n`);

  metrics.start();
  let stoppedEarly = false;

  try {
    for (let stage = 1; stage <= config.stages; stage++) {
      console.log(`  === Stage ${stage}/${config.stages} ===`);

      // Create rooms for this stage
      const stageMetrics = new MetricsCollector();
      stageMetrics.start();

      const roomPromises: Promise<void>[] = [];
      for (let r = 0; r < config.roomsPerStage; r++) {
        const roomIdx = (stage - 1) * config.roomsPerStage + r;
        roomPromises.push(createRoom(roomIdx, config, metrics, stageMetrics, allClients));
      }

      const results = await Promise.allSettled(roomPromises);
      const failures = results.filter(r => r.status === 'rejected').length;
      stageMetrics.stop();

      // Check health
      const health = await getHealth(config.serverUrl);

      const stageSummary = stageMetrics.summarize();
      const mem = process.memoryUsage();

      const result: StageResult = {
        stage,
        totalRooms: stage * config.roomsPerStage,
        totalConnections: allClients.length,
        roomCreateP95: stageSummary.roomCreation.p95,
        joinP95: stageSummary.roomJoin.p95,
        errors: failures,
        memoryMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
        serverRooms: health?.rooms ?? 0,
        serverPlayers: health?.players ?? 0,
      };
      stageResults.push(result);

      console.log(`  rooms: ${result.totalRooms} | connections: ${result.totalConnections}`);
      console.log(`  create p95: ${result.roomCreateP95}ms | join p95: ${result.joinP95}ms`);
      console.log(`  errors: ${failures} | mem: ${result.memoryMB}MB`);
      if (health) {
        console.log(`  server: rooms=${health.rooms} players=${health.players}`);
      }

      // Check thresholds
      const totalAttempts = config.roomsPerStage;
      const errorRate = totalAttempts > 0 ? failures / totalAttempts : 0;

      if (errorRate > config.errorThreshold) {
        console.log(`\n  STOPPED: Error rate ${(errorRate * 100).toFixed(1)}% exceeded threshold`);
        stoppedEarly = true;
        break;
      }

      if (result.roomCreateP95 > config.latencyThresholdMs) {
        console.log(`\n  STOPPED: P95 latency ${result.roomCreateP95}ms exceeded threshold`);
        stoppedEarly = true;
        break;
      }

      // Hold at this stage
      if (stage < config.stages) {
        console.log(`  holding for ${config.holdTimeMs}ms...\n`);
        await delay(config.holdTimeMs);
      }
    }

    if (!stoppedEarly) {
      console.log('\n  All stages completed successfully');
    }
  } finally {
    console.log(`\n  Cleaning up ${allClients.length} connections...`);
    await Promise.allSettled(allClients.map(c => c.cleanup()));
    metrics.stop();
  }

  const summary = metrics.summarize();
  return { scenario: 'stress', config, metrics: summary, stageResults };
}

async function createRoom(
  roomIdx: number,
  config: StressConfig,
  globalMetrics: MetricsCollector,
  stageMetrics: MetricsCollector,
  allClients: LoadTestClient[],
): Promise<void> {
  const host = new LoadTestClient({
    serverUrl: config.serverUrl,
    playerName: `Stress_Host_${roomIdx}`,
    metrics: globalMetrics,
  });
  await host.connect();
  allClients.push(host);

  const roomCode = await host.createRoom();
  stageMetrics.recordRoomCreation(0); // Just track count

  for (let j = 1; j < config.playersPerRoom; j++) {
    const player = new LoadTestClient({
      serverUrl: config.serverUrl,
      playerName: `Stress_P${roomIdx}_${j}`,
      metrics: globalMetrics,
    });
    await player.connect();
    allClients.push(player);
    await player.joinRoom(roomCode);
    stageMetrics.recordRoomJoin(0);
  }
}

async function getHealth(
  serverUrl: string,
): Promise<{ status: string; rooms: number; players: number } | null> {
  try {
    const resp = await fetch(`${serverUrl}/health`);
    return await resp.json() as { status: string; rooms: number; players: number };
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
