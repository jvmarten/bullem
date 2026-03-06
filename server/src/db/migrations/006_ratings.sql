-- Dual-track rating system: Elo for heads-up (1v1), OpenSkill for multiplayer (3-9 players).
CREATE TABLE ratings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('heads_up', 'multiplayer')),
  -- Elo fields (used for heads_up mode)
  elo           DOUBLE PRECISION NOT NULL DEFAULT 1200,
  -- OpenSkill fields (used for multiplayer mode)
  mu            DOUBLE PRECISION NOT NULL DEFAULT 25,
  sigma         DOUBLE PRECISION NOT NULL DEFAULT 8.333,
  games_played  INTEGER NOT NULL DEFAULT 0,
  peak_rating   DOUBLE PRECISION NOT NULL DEFAULT 1200,
  last_updated  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, mode)
);

CREATE INDEX idx_ratings_user_id ON ratings (user_id);
CREATE INDEX idx_ratings_mode_elo ON ratings (mode, elo DESC) WHERE mode = 'heads_up';
CREATE INDEX idx_ratings_mode_mu ON ratings (mode, mu DESC) WHERE mode = 'multiplayer';
