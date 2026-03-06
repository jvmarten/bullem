-- Add bot identity columns to the users table and seed bot profile accounts.
-- Each bot gets a real user row with ratings so they can participate in ranked
-- matchmaking using their persistent database identity.

-- Add is_bot flag and bot_profile key to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bot_profile TEXT;

-- Index for quick bot lookups (e.g., matchmaking pool queries)
CREATE INDEX IF NOT EXISTS idx_users_is_bot ON users (is_bot) WHERE is_bot = true;

-- Seed bot user accounts. ON CONFLICT allows re-running the migration safely.
-- Each bot gets a unique username matching its profile name, no email/password
-- (they never authenticate via HTTP), and auth_provider = 'bot'.
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile)
VALUES
  ('00000000-0000-4000-b000-000000000001', 'the_rock',      'The Rock',      'bot', true, 'the_rock'),
  ('00000000-0000-4000-b000-000000000002', 'maverick',       'Maverick',      'bot', true, 'maverick'),
  ('00000000-0000-4000-b000-000000000003', 'the_grinder',    'The Grinder',   'bot', true, 'the_grinder'),
  ('00000000-0000-4000-b000-000000000004', 'wildcard',       'Wildcard',      'bot', true, 'wildcard'),
  ('00000000-0000-4000-b000-000000000005', 'the_professor',  'The Professor', 'bot', true, 'the_professor'),
  ('00000000-0000-4000-b000-000000000006', 'shark',          'Shark',         'bot', true, 'shark'),
  ('00000000-0000-4000-b000-000000000007', 'loose_cannon',   'Loose Cannon',  'bot', true, 'loose_cannon'),
  ('00000000-0000-4000-b000-000000000008', 'ice_queen',      'Ice Queen',     'bot', true, 'ice_queen')
ON CONFLICT (username) DO UPDATE SET
  is_bot = EXCLUDED.is_bot,
  bot_profile = EXCLUDED.bot_profile,
  display_name = EXCLUDED.display_name;

-- Seed default ratings for each bot in both modes.
-- Starting at standard defaults — they'll diverge through actual play.
INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
VALUES
  -- heads_up ratings
  ('00000000-0000-4000-b000-000000000001', 'heads_up', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000002', 'heads_up', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000003', 'heads_up', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000004', 'heads_up', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000005', 'heads_up', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000006', 'heads_up', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000007', 'heads_up', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000008', 'heads_up', 1200, 25, 8.333, 0, 1200),
  -- multiplayer ratings
  ('00000000-0000-4000-b000-000000000001', 'multiplayer', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000002', 'multiplayer', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000003', 'multiplayer', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000004', 'multiplayer', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000005', 'multiplayer', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000006', 'multiplayer', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000007', 'multiplayer', 1200, 25, 8.333, 0, 1200),
  ('00000000-0000-4000-b000-000000000008', 'multiplayer', 1200, 25, 8.333, 0, 1200)
ON CONFLICT (user_id, mode) DO NOTHING;
