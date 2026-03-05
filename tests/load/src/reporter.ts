/**
 * Report formatter for load test results.
 * Outputs a human-readable summary and optionally writes JSON for CI consumption.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { MetricsSummary, LatencyStats } from './metrics.js';
import type { ScenarioResult } from './types.js';

export function printReport(results: ScenarioResult[]): void {
  console.log('\n' + '='.repeat(72));
  console.log('  LOAD TEST RESULTS');
  console.log('='.repeat(72));

  for (const result of results) {
    const m = result.metrics;
    console.log(`\n${'─'.repeat(72)}`);
    console.log(`  Scenario: ${result.scenario}`);
    console.log(`  Duration: ${m.duration.toFixed(1)}s`);
    console.log(`${'─'.repeat(72)}`);

    // Throughput
    console.log('\n  Throughput:');
    console.log(`    Rooms created/sec:  ${m.throughput.roomsPerSecond}`);
    console.log(`    Events/sec:         ${m.throughput.eventsPerSecond}`);
    console.log(`    Games completed/sec: ${m.throughput.gamesPerSecond}`);

    // Concurrency peaks
    console.log('\n  Peaks:');
    console.log(`    Rooms created:       ${m.roomsCreated}`);
    console.log(`    Peak concurrent rooms: ${m.peakConcurrentRooms}`);
    console.log(`    Peak connections:     ${m.peakConcurrentConnections}`);
    console.log(`    Games completed:      ${m.gamesCompleted}`);

    // Latency tables
    if (m.roomCreation.count > 0) {
      printLatencyTable('Room Creation', m.roomCreation);
    }
    if (m.roomJoin.count > 0) {
      printLatencyTable('Room Join', m.roomJoin);
    }
    if (m.gameStart.count > 0) {
      printLatencyTable('Game Start', m.gameStart);
    }
    if (m.gameAction.count > 0) {
      printLatencyTable('Game Action (emit)', m.gameAction);
    }
    if (m.eventRoundTrip.count > 0) {
      printLatencyTable('Event Round-Trip', m.eventRoundTrip);
    }

    // Errors
    if (m.errors > 0) {
      console.log('\n  Errors:');
      console.log(`    Total: ${m.errors}`);
      for (const [type, count] of Object.entries(m.errorBreakdown)) {
        console.log(`    ${type}: ${count}`);
      }
    } else {
      console.log('\n  Errors: 0');
    }

    // Memory
    if (m.memorySnapshots.length > 0) {
      const first = m.memorySnapshots[0]!;
      const last = m.memorySnapshots[m.memorySnapshots.length - 1]!;
      const peak = m.memorySnapshots.reduce(
        (max, s) => (s.heapUsedMB > max.heapUsedMB ? s : max),
        first,
      );
      console.log('\n  Client Memory (heap used):');
      console.log(`    Start:  ${first.heapUsedMB}MB`);
      console.log(`    Peak:   ${peak.heapUsedMB}MB`);
      console.log(`    End:    ${last.heapUsedMB}MB`);
      console.log(`    RSS:    ${last.rssMB}MB`);
    }

    // Server health (if captured)
    if (m.serverHealth) {
      console.log('\n  Server Health (last check):');
      console.log(`    Status:  ${m.serverHealth.status}`);
      console.log(`    Rooms:   ${m.serverHealth.rooms}`);
      console.log(`    Players: ${m.serverHealth.players}`);
    }

    // Stage results for stress tests
    const stressResult = result as ScenarioResult & { stageResults?: unknown[] };
    if (stressResult.stageResults && stressResult.stageResults.length > 0) {
      console.log('\n  Stage Breakdown:');
      console.log('    Stage | Rooms | Conns | Create P95 | Join P95 | Errors | Memory');
      console.log('    ' + '─'.repeat(64));
      for (const stage of stressResult.stageResults as Array<{
        stage: number; totalRooms: number; totalConnections: number;
        roomCreateP95: number; joinP95: number; errors: number; memoryMB: number;
      }>) {
        console.log(
          `    ${String(stage.stage).padStart(5)} | ` +
          `${String(stage.totalRooms).padStart(5)} | ` +
          `${String(stage.totalConnections).padStart(5)} | ` +
          `${String(stage.roomCreateP95 + 'ms').padStart(10)} | ` +
          `${String(stage.joinP95 + 'ms').padStart(8)} | ` +
          `${String(stage.errors).padStart(6)} | ` +
          `${stage.memoryMB}MB`,
        );
      }
    }
  }

  console.log('\n' + '='.repeat(72) + '\n');
}

function printLatencyTable(label: string, stats: LatencyStats): void {
  console.log(`\n  ${label} Latency (${stats.count} samples):`);
  console.log(`    min: ${stats.min}ms | p50: ${stats.p50}ms | p95: ${stats.p95}ms | p99: ${stats.p99}ms | max: ${stats.max}ms | mean: ${stats.mean}ms`);
}

/** Write results to a JSON file for CI/tooling consumption. */
export function writeJsonReport(results: ScenarioResult[], outputPath: string): void {
  const report = {
    timestamp: new Date().toISOString(),
    results: results.map(r => ({
      scenario: r.scenario,
      config: r.config,
      metrics: r.metrics,
      ...('stageResults' in r ? { stageResults: (r as Record<string, unknown>).stageResults } : {}),
    })),
  };

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`JSON report written to: ${outputPath}`);
}

/**
 * Check results against baseline thresholds for CI pass/fail.
 * Returns an array of threshold violations.
 */
export function checkThresholds(
  results: ScenarioResult[],
  thresholds: ThresholdConfig,
): ThresholdViolation[] {
  const violations: ThresholdViolation[] = [];

  for (const result of results) {
    const m = result.metrics;

    if (thresholds.maxRoomCreateP95Ms !== undefined && m.roomCreation.p95 > thresholds.maxRoomCreateP95Ms) {
      violations.push({
        scenario: result.scenario,
        metric: 'roomCreation.p95',
        value: m.roomCreation.p95,
        threshold: thresholds.maxRoomCreateP95Ms,
      });
    }

    if (thresholds.maxJoinP95Ms !== undefined && m.roomJoin.p95 > thresholds.maxJoinP95Ms) {
      violations.push({
        scenario: result.scenario,
        metric: 'roomJoin.p95',
        value: m.roomJoin.p95,
        threshold: thresholds.maxJoinP95Ms,
      });
    }

    if (thresholds.maxErrorRate !== undefined) {
      const totalOps = m.roomCreation.count + m.roomJoin.count + m.gameAction.count;
      const errorRate = totalOps > 0 ? m.errors / totalOps : 0;
      if (errorRate > thresholds.maxErrorRate) {
        violations.push({
          scenario: result.scenario,
          metric: 'errorRate',
          value: errorRate,
          threshold: thresholds.maxErrorRate,
        });
      }
    }

    if (thresholds.minRoomsPerSecond !== undefined && m.throughput.roomsPerSecond < thresholds.minRoomsPerSecond) {
      violations.push({
        scenario: result.scenario,
        metric: 'throughput.roomsPerSecond',
        value: m.throughput.roomsPerSecond,
        threshold: thresholds.minRoomsPerSecond,
      });
    }
  }

  return violations;
}

export interface ThresholdConfig {
  maxRoomCreateP95Ms?: number;
  maxJoinP95Ms?: number;
  maxErrorRate?: number;
  minRoomsPerSecond?: number;
}

export interface ThresholdViolation {
  scenario: string;
  metric: string;
  value: number;
  threshold: number;
}
