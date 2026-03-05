-- 001_initial_schema.sql
-- Sets up the core tables for player accounts, game history, and replay data.
-- Designed to work with guest players (nullable user_id) so games can be
-- recorded before the accounts feature (2B) is implemented.

-- Users table (for future 2B: Player Accounts)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  password_hash TEXT,           -- null for OAuth users
  auth_provider TEXT,           -- 'email', 'google', etc.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Games table (one row per completed game)
CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL,
  winner_id UUID REFERENCES users(id),   -- null for guest games
  winner_name TEXT NOT NULL,              -- denormalized for guest support
  player_count INTEGER NOT NULL,
  settings JSONB NOT NULL,               -- GameSettings snapshot
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER
  ) STORED
);

-- Game participants (links users to games, stores per-game stats)
CREATE TABLE IF NOT EXISTS game_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),     -- null for guests
  player_name TEXT NOT NULL,              -- denormalized
  finish_position INTEGER NOT NULL,       -- 1 = winner, 2 = second out, etc.
  final_card_count INTEGER NOT NULL,
  stats JSONB NOT NULL,                   -- PlayerGameStats snapshot
  UNIQUE(game_id, user_id)
);

-- Rounds table (for future 2D: Replay System)
CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  snapshot JSONB NOT NULL,                -- GameEngineSnapshot at round start
  UNIQUE(game_id, round_number)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_games_ended_at ON games(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_winner_id ON games(winner_id) WHERE winner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_players_user_id ON game_players(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_game_players_game_id ON game_players(game_id);
CREATE INDEX IF NOT EXISTS idx_rounds_game_id ON rounds(game_id);
