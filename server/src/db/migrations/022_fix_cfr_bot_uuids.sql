-- Fix CFR bot accounts that couldn't be created due to UUID collision.
--
-- Root cause: Migration 016 created "Evolved" personality bots at UUIDs
-- b101-b109. Migration 017 was supposed to delete them, but the rows
-- persisted. Migration 018 tried to INSERT CFR bots at the same UUIDs
-- using ON CONFLICT (username), but the conflict was on the PRIMARY KEY
-- (id), not username — so PostgreSQL threw a PK violation that ON CONFLICT
-- (username) doesn't catch.
--
-- The evolved bot rows at b101-b109 have accumulated ratings from background
-- games (because getRankedBotPool's self-heal injected CFR bots with these
-- hardcoded UUIDs, and rating updates wrote to the existing evolved rows).
--
-- Fix: UPDATE the existing rows in-place to become CFR bots. This preserves
-- all accumulated ratings, game_history references, and rating_history data.
-- The user said "it should account all their old ranked matches."

-- Step 1: Delete any stale rows with CFR usernames at WRONG UUIDs.
-- This handles the edge case where a partial previous fix created CFR bot
-- user rows at random UUIDs (not the deterministic b10x ones).
DELETE FROM ratings WHERE user_id IN (
  SELECT id FROM users
  WHERE username IN ('cfr_viper','cfr_ghost','cfr_reaper','cfr_specter','cfr_raptor','cfr_havoc','cfr_phantom','cfr_sentinel','cfr_vanguard')
    AND id NOT IN (
      '00000000-0000-4000-b101-000000000000',
      '00000000-0000-4000-b102-000000000000',
      '00000000-0000-4000-b103-000000000000',
      '00000000-0000-4000-b104-000000000000',
      '00000000-0000-4000-b105-000000000000',
      '00000000-0000-4000-b106-000000000000',
      '00000000-0000-4000-b107-000000000000',
      '00000000-0000-4000-b108-000000000000',
      '00000000-0000-4000-b109-000000000000'
    )
);
-- Nullify FK references in game history before deleting
UPDATE games SET winner_id = NULL WHERE winner_id IN (
  SELECT id FROM users
  WHERE username IN ('cfr_viper','cfr_ghost','cfr_reaper','cfr_specter','cfr_raptor','cfr_havoc','cfr_phantom','cfr_sentinel','cfr_vanguard')
    AND id NOT IN (
      '00000000-0000-4000-b101-000000000000',
      '00000000-0000-4000-b102-000000000000',
      '00000000-0000-4000-b103-000000000000',
      '00000000-0000-4000-b104-000000000000',
      '00000000-0000-4000-b105-000000000000',
      '00000000-0000-4000-b106-000000000000',
      '00000000-0000-4000-b107-000000000000',
      '00000000-0000-4000-b108-000000000000',
      '00000000-0000-4000-b109-000000000000'
    )
);
UPDATE game_players SET user_id = NULL WHERE user_id IN (
  SELECT id FROM users
  WHERE username IN ('cfr_viper','cfr_ghost','cfr_reaper','cfr_specter','cfr_raptor','cfr_havoc','cfr_phantom','cfr_sentinel','cfr_vanguard')
    AND id NOT IN (
      '00000000-0000-4000-b101-000000000000',
      '00000000-0000-4000-b102-000000000000',
      '00000000-0000-4000-b103-000000000000',
      '00000000-0000-4000-b104-000000000000',
      '00000000-0000-4000-b105-000000000000',
      '00000000-0000-4000-b106-000000000000',
      '00000000-0000-4000-b107-000000000000',
      '00000000-0000-4000-b108-000000000000',
      '00000000-0000-4000-b109-000000000000'
    )
);
DELETE FROM users
WHERE username IN ('cfr_viper','cfr_ghost','cfr_reaper','cfr_specter','cfr_raptor','cfr_havoc','cfr_phantom','cfr_sentinel','cfr_vanguard')
  AND id NOT IN (
    '00000000-0000-4000-b101-000000000000',
    '00000000-0000-4000-b102-000000000000',
    '00000000-0000-4000-b103-000000000000',
    '00000000-0000-4000-b104-000000000000',
    '00000000-0000-4000-b105-000000000000',
    '00000000-0000-4000-b106-000000000000',
    '00000000-0000-4000-b107-000000000000',
    '00000000-0000-4000-b108-000000000000',
    '00000000-0000-4000-b109-000000000000'
  );

-- Step 2: Convert existing rows at the target UUIDs to CFR bots.
-- This is the key fix: UPDATE in-place to preserve accumulated ratings.
-- Uses a single UPDATE with a VALUES list to convert all 9 in one statement.
UPDATE users SET
  username = v.username,
  display_name = v.display_name,
  auth_provider = 'bot',
  is_bot = true,
  bot_profile = v.bot_profile
FROM (VALUES
  ('00000000-0000-4000-b101-000000000000'::uuid, 'cfr_viper',    'Viper',    'cfr_viper'),
  ('00000000-0000-4000-b102-000000000000'::uuid, 'cfr_ghost',    'Ghost',    'cfr_ghost'),
  ('00000000-0000-4000-b103-000000000000'::uuid, 'cfr_reaper',   'Reaper',   'cfr_reaper'),
  ('00000000-0000-4000-b104-000000000000'::uuid, 'cfr_specter',  'Specter',  'cfr_specter'),
  ('00000000-0000-4000-b105-000000000000'::uuid, 'cfr_raptor',   'Raptor',   'cfr_raptor'),
  ('00000000-0000-4000-b106-000000000000'::uuid, 'cfr_havoc',    'Havoc',    'cfr_havoc'),
  ('00000000-0000-4000-b107-000000000000'::uuid, 'cfr_phantom',  'Phantom',  'cfr_phantom'),
  ('00000000-0000-4000-b108-000000000000'::uuid, 'cfr_sentinel', 'Sentinel', 'cfr_sentinel'),
  ('00000000-0000-4000-b109-000000000000'::uuid, 'cfr_vanguard', 'Vanguard', 'cfr_vanguard')
) AS v(id, username, display_name, bot_profile)
WHERE users.id = v.id;

-- Step 3: Insert any CFR bots whose UUIDs don't exist at all.
-- This handles the case where the UUID was never created (e.g., fresh DB
-- or previous rows were deleted by migration 019 orphan cleanup).
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b101-000000000000', 'cfr_viper',    'Viper',    'bot', true, 'cfr_viper'),
  ('00000000-0000-4000-b102-000000000000', 'cfr_ghost',    'Ghost',    'bot', true, 'cfr_ghost'),
  ('00000000-0000-4000-b103-000000000000', 'cfr_reaper',   'Reaper',   'bot', true, 'cfr_reaper'),
  ('00000000-0000-4000-b104-000000000000', 'cfr_specter',  'Specter',  'bot', true, 'cfr_specter'),
  ('00000000-0000-4000-b105-000000000000', 'cfr_raptor',   'Raptor',   'bot', true, 'cfr_raptor'),
  ('00000000-0000-4000-b106-000000000000', 'cfr_havoc',    'Havoc',    'bot', true, 'cfr_havoc'),
  ('00000000-0000-4000-b107-000000000000', 'cfr_phantom',  'Phantom',  'bot', true, 'cfr_phantom'),
  ('00000000-0000-4000-b108-000000000000', 'cfr_sentinel', 'Sentinel', 'bot', true, 'cfr_sentinel'),
  ('00000000-0000-4000-b109-000000000000', 'cfr_vanguard', 'Vanguard', 'bot', true, 'cfr_vanguard')
ON CONFLICT (id) DO NOTHING;
-- DO NOTHING because Step 2 already handled existing rows.

-- Step 4: Ensure ratings exist for all CFR bots (in both modes).
-- Uses ON CONFLICT DO NOTHING to preserve existing accumulated ratings.
DO $$
DECLARE
  bot_user RECORD;
BEGIN
  FOR bot_user IN
    SELECT id, username FROM users
    WHERE is_bot = true AND bot_profile LIKE 'cfr_%'
  LOOP
    INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
    VALUES (bot_user.id, 'heads_up', 1200, 25, 8.333, 0, 1200)
    ON CONFLICT (user_id, mode) DO NOTHING;

    INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
    VALUES (bot_user.id, 'multiplayer', 1200, 25, 8.333, 0, 1200)
    ON CONFLICT (user_id, mode) DO NOTHING;
  END LOOP;
END $$;

-- Step 5: Verify — all 9 CFR bots must exist with correct bot_profile.
DO $$
DECLARE
  cfr_count INTEGER;
  rating_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO cfr_count
  FROM users WHERE bot_profile LIKE 'cfr_%' AND is_bot = true;

  SELECT COUNT(*) INTO rating_count
  FROM ratings r
  JOIN users u ON u.id = r.user_id
  WHERE u.bot_profile LIKE 'cfr_%' AND u.is_bot = true;

  IF cfr_count < 9 THEN
    RAISE WARNING 'Migration 022: only % of 9 CFR bot users exist', cfr_count;
  END IF;

  IF rating_count < 18 THEN
    RAISE WARNING 'Migration 022: only % of 18 CFR bot rating rows exist', rating_count;
  END IF;

  RAISE NOTICE 'Migration 022: % CFR bot users, % rating rows', cfr_count, rating_count;
END $$;
