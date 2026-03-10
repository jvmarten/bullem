-- Ensure all 9 CFR bot user accounts and their ratings exist.
-- This is a safety net for the case where migration 018 ran but the CFR bot
-- INSERT partially failed, or where the data was lost for any reason.
-- Uses ON CONFLICT so it's idempotent and safe to run multiple times.

-- Step 1: Upsert CFR bot user rows with deterministic UUIDs.
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
ON CONFLICT (username) DO UPDATE
  SET is_bot = true,
      bot_profile = EXCLUDED.bot_profile,
      display_name = EXCLUDED.display_name;

-- Step 2: Seed default ratings for each CFR bot in both modes.
-- Uses the ACTUAL user ID from the database (not hardcoded UUIDs) to handle
-- the edge case where ON CONFLICT kept an existing row with a different UUID.
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

-- Step 3: Verify — fail loudly if any CFR bot is missing ratings.
DO $$
DECLARE
  bot_count INTEGER;
  rating_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bot_count
  FROM users WHERE is_bot = true AND bot_profile LIKE 'cfr_%';

  SELECT COUNT(*) INTO rating_count
  FROM ratings r
  JOIN users u ON u.id = r.user_id
  WHERE u.is_bot = true AND u.bot_profile LIKE 'cfr_%';

  IF bot_count < 9 THEN
    RAISE WARNING 'Only % of 9 CFR bot users exist after migration 021', bot_count;
  END IF;

  IF rating_count < 18 THEN
    RAISE WARNING 'Only % of 18 CFR bot rating rows exist after migration 021 (expected 9 bots x 2 modes)', rating_count;
  END IF;

  RAISE NOTICE 'Migration 021: % CFR bot users, % rating rows verified', bot_count, rating_count;
END $$;
