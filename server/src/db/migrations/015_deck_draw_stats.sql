-- Deck Draw Minigame: stores lifetime stats for authenticated users.
-- Guest stats live in localStorage and sync on account creation/login.

CREATE TABLE IF NOT EXISTS deck_draw_stats (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  total_draws   INT NOT NULL DEFAULT 0,
  total_wagered BIGINT NOT NULL DEFAULT 0,
  total_won     BIGINT NOT NULL DEFAULT 0,
  biggest_win   BIGINT NOT NULL DEFAULT 0,
  best_hand_type INT,  -- HandType enum value (0-9), NULL if never drawn
  balance       BIGINT NOT NULL DEFAULT 1000,
  last_free_draw_at TIMESTAMPTZ,
  hand_counts   JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
