-- Push notification subscriptions, persisted so they survive server restarts
-- and work across multiple server instances.
CREATE TABLE push_subscriptions (
  player_id   TEXT PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  key_p256dh  TEXT NOT NULL,
  key_auth    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index on endpoint for cleanup queries (e.g., removing expired subscriptions).
CREATE INDEX idx_push_subscriptions_endpoint ON push_subscriptions (endpoint);
