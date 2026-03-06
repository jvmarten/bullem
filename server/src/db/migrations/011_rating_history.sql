-- Rating history: stores one row per player per rated game, capturing
-- the rating before and after. Used for rating history charts on the profile.
CREATE TABLE IF NOT EXISTS rating_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('heads_up', 'multiplayer')),
  rating_before DOUBLE PRECISION NOT NULL,
  rating_after DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, user_id, mode)
);

CREATE INDEX IF NOT EXISTS idx_rating_history_user_id ON rating_history(user_id);
CREATE INDEX IF NOT EXISTS idx_rating_history_user_mode ON rating_history(user_id, mode, created_at DESC);
