-- Ranked match history: stores detailed per-match data so ratings can be
-- recalculated from scratch if the rating algorithm changes. Also supports
-- future leaderboards segmented by player count or game settings.

CREATE TABLE ranked_matches (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id       UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('heads_up', 'multiplayer')),
  player_count  INTEGER NOT NULL,
  human_player_count INTEGER NOT NULL,
  from_matchmaking   BOOLEAN NOT NULL DEFAULT false,
  settings      JSONB NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_id)
);

CREATE TABLE ranked_match_players (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id       UUID NOT NULL REFERENCES ranked_matches(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL,
  display_name   TEXT NOT NULL,
  finish_position INTEGER NOT NULL,
  is_bot         BOOLEAN NOT NULL DEFAULT false,
  -- Rating snapshots for recalculation: store both before and after values.
  -- Elo fields (heads_up mode)
  elo_before     DOUBLE PRECISION,
  elo_after      DOUBLE PRECISION,
  -- OpenSkill fields (multiplayer mode)
  mu_before      DOUBLE PRECISION,
  sigma_before   DOUBLE PRECISION,
  mu_after       DOUBLE PRECISION,
  sigma_after    DOUBLE PRECISION,
  UNIQUE (match_id, user_id)
);

-- Indexes for common queries: leaderboards, user history, recalculation
CREATE INDEX idx_ranked_matches_mode ON ranked_matches (mode);
CREATE INDEX idx_ranked_matches_ended_at ON ranked_matches (ended_at DESC);
CREATE INDEX idx_ranked_matches_player_count ON ranked_matches (player_count);
CREATE INDEX idx_ranked_match_players_user_id ON ranked_match_players (user_id);
CREATE INDEX idx_ranked_match_players_match_id ON ranked_match_players (match_id);
