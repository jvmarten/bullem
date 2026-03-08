-- Analytics aggregation tables for game balance tuning.
-- These are regular tables refreshed periodically (or on-demand by admin),
-- avoiding the overhead of real-time aggregation across the events + games tables.

-- ── Win rate by starting position ──────────────────────────────────────
-- Tracks whether the first player to act has an advantage.
-- Populated from game_players + games data.
CREATE TABLE IF NOT EXISTS analytics_starting_position (
  player_count   INTEGER NOT NULL,
  starting_index INTEGER NOT NULL,  -- 0-based position in turn order
  games_played   INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_count, starting_index)
);

-- ── Hand type call frequency vs actual occurrence ──────────────────────
-- How often each hand type is called vs how often it actually exists.
CREATE TABLE IF NOT EXISTS analytics_hand_frequency (
  hand_type      INTEGER NOT NULL,  -- HandType enum (0–9)
  player_count   INTEGER NOT NULL,  -- Game size context
  times_called   INTEGER NOT NULL DEFAULT 0,
  times_existed  INTEGER NOT NULL DEFAULT 0,
  times_bluffed  INTEGER NOT NULL DEFAULT 0,  -- called but didn't exist
  bluffs_caught  INTEGER NOT NULL DEFAULT 0,  -- bluffed and penalized
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (hand_type, player_count)
);

-- ── Average game duration by player count ──────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_game_duration (
  player_count   INTEGER NOT NULL PRIMARY KEY,
  games_played   INTEGER NOT NULL DEFAULT 0,
  total_seconds  BIGINT NOT NULL DEFAULT 0,   -- sum of all game durations
  min_seconds    INTEGER,
  max_seconds    INTEGER,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Bluff success rate by hand type ────────────────────────────────────
-- Extends hand_frequency with bluff-specific metrics.
-- (Stored in analytics_hand_frequency above — bluffs_caught / times_bluffed)

-- ── Bot difficulty win rates ───────────────────────────────────────────
-- Track bot performance by difficulty level to tune AI.
CREATE TABLE IF NOT EXISTS analytics_bot_performance (
  bot_level      TEXT NOT NULL,     -- 'easy', 'medium', 'hard', 'expert'
  player_count   INTEGER NOT NULL,
  games_played   INTEGER NOT NULL DEFAULT 0,
  wins           INTEGER NOT NULL DEFAULT 0,
  avg_finish     DOUBLE PRECISION,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_level, player_count)
);

-- ── Overall balance snapshot ───────────────────────────────────────────
-- High-level metrics computed per refresh cycle.
CREATE TABLE IF NOT EXISTS analytics_balance_snapshot (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_games    INTEGER NOT NULL DEFAULT 0,
  total_rounds   INTEGER NOT NULL DEFAULT 0,
  avg_rounds_per_game  DOUBLE PRECISION,
  avg_game_duration_s  DOUBLE PRECISION,
  bull_accuracy_pct    DOUBLE PRECISION,  -- overall correct bull %
  bluff_success_pct    DOUBLE PRECISION,  -- overall bluff success %
  properties     JSONB NOT NULL DEFAULT '{}'  -- extensible metadata
);

CREATE INDEX IF NOT EXISTS idx_analytics_balance_snapshot_computed
  ON analytics_balance_snapshot (computed_at DESC);

-- ── Track starting position in events ──────────────────────────────────
-- Add index on events properties for starting position queries.
CREATE INDEX IF NOT EXISTS idx_events_properties_gin
  ON events USING GIN (properties);
