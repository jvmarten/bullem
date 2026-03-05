/**
 * Metrics collector for load testing.
 * Tracks latency distributions (p50/p95/p99), throughput counters,
 * memory snapshots, and error rates.
 */

export interface LatencyStats {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricsSummary {
  duration: number;
  roomCreation: LatencyStats;
  roomJoin: LatencyStats;
  gameStart: LatencyStats;
  gameAction: LatencyStats;
  eventRoundTrip: LatencyStats;
  roomsCreated: number;
  roomsActive: number;
  gamesCompleted: number;
  peakConcurrentRooms: number;
  peakConcurrentConnections: number;
  errors: number;
  errorBreakdown: Record<string, number>;
  memorySnapshots: MemorySnapshot[];
  throughput: {
    roomsPerSecond: number;
    eventsPerSecond: number;
    gamesPerSecond: number;
  };
  serverHealth: ServerHealthSnapshot | null;
}

export interface MemorySnapshot {
  timestamp: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
}

export interface ServerHealthSnapshot {
  status: string;
  rooms: number;
  players: number;
}

/** Maintains a sorted-insert buffer of latency samples for percentile computation. */
class LatencyBuffer {
  private samples: number[] = [];

  record(ms: number): void {
    // Binary search insert to keep sorted
    let lo = 0;
    let hi = this.samples.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.samples[mid]! < ms) lo = mid + 1;
      else hi = mid;
    }
    this.samples.splice(lo, 0, ms);
  }

  stats(): LatencyStats {
    const n = this.samples.length;
    if (n === 0) {
      return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0, p99: 0 };
    }
    const sum = this.samples.reduce((a, b) => a + b, 0);
    return {
      count: n,
      min: this.samples[0]!,
      max: this.samples[n - 1]!,
      mean: Math.round((sum / n) * 100) / 100,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
    };
  }

  private percentile(p: number): number {
    const n = this.samples.length;
    if (n === 0) return 0;
    const idx = Math.ceil((p / 100) * n) - 1;
    return this.samples[Math.max(0, Math.min(idx, n - 1))]!;
  }
}

export class MetricsCollector {
  private startTime = 0;
  private roomCreation = new LatencyBuffer();
  private roomJoin = new LatencyBuffer();
  private gameStart = new LatencyBuffer();
  private gameAction = new LatencyBuffer();
  private eventRoundTrip = new LatencyBuffer();

  private roomsCreated = 0;
  private roomsActive = 0;
  private gamesCompleted = 0;
  private peakConcurrentRooms = 0;
  private peakConcurrentConnections = 0;
  private currentConnections = 0;
  private totalEvents = 0;
  private errors = 0;
  private errorBreakdown: Record<string, number> = {};
  private memorySnapshots: MemorySnapshot[] = [];
  private memoryInterval: ReturnType<typeof setInterval> | null = null;
  private serverHealth: ServerHealthSnapshot | null = null;

  start(): void {
    this.startTime = Date.now();
    // Snapshot memory every 2 seconds
    this.memoryInterval = setInterval(() => this.snapshotMemory(), 2000);
    this.snapshotMemory();
  }

  stop(): void {
    if (this.memoryInterval) {
      clearInterval(this.memoryInterval);
      this.memoryInterval = null;
    }
    this.snapshotMemory();
  }

  recordRoomCreation(ms: number): void {
    this.roomCreation.record(ms);
    this.roomsCreated++;
    this.roomsActive++;
    this.peakConcurrentRooms = Math.max(this.peakConcurrentRooms, this.roomsActive);
  }

  recordRoomDestroyed(): void {
    this.roomsActive = Math.max(0, this.roomsActive - 1);
  }

  recordRoomJoin(ms: number): void {
    this.roomJoin.record(ms);
  }

  recordGameStart(ms: number): void {
    this.gameStart.record(ms);
  }

  recordGameAction(ms: number): void {
    this.gameAction.record(ms);
    this.totalEvents++;
  }

  recordEventRoundTrip(ms: number): void {
    this.eventRoundTrip.record(ms);
    this.totalEvents++;
  }

  recordGameCompleted(): void {
    this.gamesCompleted++;
  }

  recordConnection(): void {
    this.currentConnections++;
    this.peakConcurrentConnections = Math.max(
      this.peakConcurrentConnections,
      this.currentConnections,
    );
  }

  recordDisconnection(): void {
    this.currentConnections = Math.max(0, this.currentConnections - 1);
  }

  recordError(type: string): void {
    this.errors++;
    this.errorBreakdown[type] = (this.errorBreakdown[type] ?? 0) + 1;
  }

  recordServerHealth(health: ServerHealthSnapshot): void {
    this.serverHealth = health;
  }

  private snapshotMemory(): void {
    const mem = process.memoryUsage();
    this.memorySnapshots.push({
      timestamp: Date.now(),
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
      rssMB: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
      externalMB: Math.round((mem.external / 1024 / 1024) * 100) / 100,
    });
  }

  summarize(): MetricsSummary {
    const duration = (Date.now() - this.startTime) / 1000;
    return {
      duration,
      roomCreation: this.roomCreation.stats(),
      roomJoin: this.roomJoin.stats(),
      gameStart: this.gameStart.stats(),
      gameAction: this.gameAction.stats(),
      eventRoundTrip: this.eventRoundTrip.stats(),
      roomsCreated: this.roomsCreated,
      roomsActive: this.roomsActive,
      gamesCompleted: this.gamesCompleted,
      peakConcurrentRooms: this.peakConcurrentRooms,
      peakConcurrentConnections: this.peakConcurrentConnections,
      errors: this.errors,
      errorBreakdown: { ...this.errorBreakdown },
      memorySnapshots: [...this.memorySnapshots],
      throughput: {
        roomsPerSecond: duration > 0 ? Math.round((this.roomsCreated / duration) * 100) / 100 : 0,
        eventsPerSecond: duration > 0 ? Math.round((this.totalEvents / duration) * 100) / 100 : 0,
        gamesPerSecond: duration > 0 ? Math.round((this.gamesCompleted / duration) * 100) / 100 : 0,
      },
      serverHealth: this.serverHealth,
    };
  }
}
