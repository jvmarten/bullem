/**
 * Shared types for load testing scenarios.
 */

import type { MetricsSummary } from './metrics.js';

export interface ScenarioConfig {
  /** Target server URL. Default: http://localhost:3001 */
  serverUrl: string;
}

export interface ScenarioResult {
  scenario: string;
  config: ScenarioConfig;
  metrics: MetricsSummary;
}
