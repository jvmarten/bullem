/**
 * Lightweight Prometheus-compatible metrics collection.
 *
 * Exposes counters, gauges, and histograms without pulling in a heavy
 * dependency like prom-client. Outputs standard Prometheus text format
 * via `serializeMetrics()`.
 *
 * // TODO(scale): When the server runs multiple instances behind a load
 * // balancer, each instance exposes its own /metrics. A Prometheus server
 * // scrapes all instances and aggregates. If we need cross-instance
 * // aggregation without Prometheus, switch to prom-client with a push
 * // gateway or Redis-backed metrics store.
 */

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

class Counter {
  private value = 0;
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(amount = 1): void {
    this.value += amount;
  }

  serialize(): string {
    return (
      `# HELP ${this.name} ${this.help}\n` +
      `# TYPE ${this.name} counter\n` +
      `${this.name} ${this.value}\n`
    );
  }
}

// ---------------------------------------------------------------------------
// Labeled Counter — counter with a single label dimension
// ---------------------------------------------------------------------------

class LabeledCounter {
  private values = new Map<string, number>();
  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelName: string,
  ) {}

  inc(labelValue: string, amount = 1): void {
    this.values.set(labelValue, (this.values.get(labelValue) ?? 0) + amount);
  }

  serialize(): string {
    let out =
      `# HELP ${this.name} ${this.help}\n` +
      `# TYPE ${this.name} counter\n`;
    for (const [label, value] of this.values) {
      out += `${this.name}{${this.labelName}="${label}"} ${value}\n`;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Gauge — set by a callback at scrape time
// ---------------------------------------------------------------------------

class Gauge {
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly getValue: () => number,
  ) {}

  serialize(): string {
    return (
      `# HELP ${this.name} ${this.help}\n` +
      `# TYPE ${this.name} gauge\n` +
      `${this.name} ${this.getValue()}\n`
    );
  }
}

// ---------------------------------------------------------------------------
// Histogram — pre-defined buckets, track sum and count
// ---------------------------------------------------------------------------

class Histogram {
  private bucketCounts: number[];
  private sum = 0;
  private count = 0;

  constructor(
    readonly name: string,
    readonly help: string,
    readonly buckets: number[],
  ) {
    this.bucketCounts = new Array(buckets.length).fill(0) as number[];
  }

  observe(value: number): void {
    this.sum += value;
    this.count++;
    for (let i = 0; i < this.buckets.length; i++) {
      const bucket = this.buckets[i];
      if (bucket !== undefined && value <= bucket) {
        (this.bucketCounts[i] as number)++;
      }
    }
  }

  serialize(): string {
    let out =
      `# HELP ${this.name} ${this.help}\n` +
      `# TYPE ${this.name} histogram\n`;
    for (let i = 0; i < this.buckets.length; i++) {
      out += `${this.name}_bucket{le="${this.buckets[i]}"} ${this.bucketCounts[i]}\n`;
    }
    out += `${this.name}_bucket{le="+Inf"} ${this.count}\n`;
    out += `${this.name}_sum ${this.sum}\n`;
    out += `${this.name}_count ${this.count}\n`;
    return out;
  }
}

// ---------------------------------------------------------------------------
// Metric instances
// ---------------------------------------------------------------------------

/** Callbacks registered by external modules to supply gauge values. */
let activeRoomsGetter: (() => number) | null = null;
let connectedPlayersGetter: (() => number) | null = null;

/** Register gauge callbacks. Called once during server startup. */
export function registerGaugeCallbacks(
  getRooms: () => number,
  getPlayers: () => number,
): void {
  activeRoomsGetter = getRooms;
  connectedPlayersGetter = getPlayers;
}

const activeRooms = new Gauge(
  'bullem_active_rooms',
  'Number of active game rooms',
  () => activeRoomsGetter?.() ?? 0,
);

const connectedPlayers = new Gauge(
  'bullem_connected_players',
  'Number of currently connected WebSocket clients',
  () => connectedPlayersGetter?.() ?? 0,
);

export const socketEventsTotal = new LabeledCounter(
  'bullem_socket_events_total',
  'Total socket events received by event name',
  'event',
);

export const socketErrorsTotal = new Counter(
  'bullem_socket_errors_total',
  'Total socket errors',
);

export const rateLimitRejectsTotal = new Counter(
  'bullem_rate_limit_rejects_total',
  'Total socket events rejected by rate limiter',
);

export const gameActionsTotal = new LabeledCounter(
  'bullem_game_actions_total',
  'Total game actions by type (call, bull, true, etc.)',
  'action',
);

export const roundDurationSeconds = new Histogram(
  'bullem_round_duration_seconds',
  'Duration of game rounds in seconds',
  [5, 10, 30, 60, 120, 300, 600],
);

export const gamesCompletedTotal = new Counter(
  'bullem_games_completed_total',
  'Total games that reached game_over',
);

export const roomsCreatedTotal = new Counter(
  'bullem_rooms_created_total',
  'Total rooms created',
);

export const playersJoinedTotal = new Counter(
  'bullem_players_joined_total',
  'Total players who joined rooms',
);

export const httpRequestsTotal = new LabeledCounter(
  'bullem_http_requests_total',
  'Total HTTP requests by endpoint',
  'endpoint',
);

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const allMetrics = [
  activeRooms,
  connectedPlayers,
  socketEventsTotal,
  socketErrorsTotal,
  rateLimitRejectsTotal,
  gameActionsTotal,
  roundDurationSeconds,
  gamesCompletedTotal,
  roomsCreatedTotal,
  playersJoinedTotal,
  httpRequestsTotal,
];

/** Serialize all metrics in Prometheus text exposition format. */
export function serializeMetrics(): string {
  return allMetrics.map(m => m.serialize()).join('\n');
}
