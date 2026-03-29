-- Normalize heuristic bot UUIDs to match the deterministic formula in code.
--
-- Root cause: getBotUserIdByKey() generated INVALID 37-char UUIDs (b0{code}{level}
-- = 5-char 4th segment instead of 4). This caused every game_players batch INSERT
-- to fail when any heuristic bot was present, silently dropping ALL player records
-- (including the human player's), so games never showed in profiles or replays.
--
-- Additionally, migration 018 shifted bot levels (old lvl2→lvl1, etc.) without
-- updating UUIDs, so the database UUIDs drifted from the code-generated ones.
--
-- Fix: reassign all heuristic bot UUIDs to the canonical format:
--   00000000-0000-4000-b{personality_code}{level}-000000000000
-- where personality_code is 01-09 and level is 1-8.
--
-- This migration updates the primary key AND all foreign key references.

DO $$
DECLARE
  personality TEXT;
  personality_code TEXT;
  lvl INT;
  target_uuid UUID;
  current_uuid UUID;
  bot_key TEXT;
BEGIN
  -- Personality → 2-digit code mapping (matches PERSONALITY_UUID_CODES in botProfiles.ts)
  FOR personality, personality_code IN
    SELECT * FROM (VALUES
      ('rock','01'), ('bluffer','02'), ('grinder','03'), ('wildcard','04'),
      ('professor','05'), ('shark','06'), ('cannon','07'), ('frost','08'), ('hustler','09')
    ) AS t(p, c)
  LOOP
    FOR lvl IN 1..8 LOOP
      bot_key := personality || '_lvl' || lvl;
      target_uuid := ('00000000-0000-4000-b' || personality_code || lvl || '-000000000000')::uuid;

      -- Find the current UUID for this bot by bot_profile key
      SELECT id INTO current_uuid FROM users WHERE bot_profile = bot_key AND is_bot = true;

      IF current_uuid IS NULL THEN
        -- Bot doesn't exist — create it with the correct UUID
        INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile)
        VALUES (target_uuid, bot_key, initcap(personality) || ' lvl' || lvl, 'bot', true, bot_key)
        ON CONFLICT (id) DO NOTHING;

        -- Seed default ratings
        INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
        VALUES (target_uuid, 'heads_up', 1200, 25, 8.333, 0, 1200)
        ON CONFLICT (user_id, mode) DO NOTHING;
        INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
        VALUES (target_uuid, 'multiplayer', 1200, 25, 8.333, 0, 1200)
        ON CONFLICT (user_id, mode) DO NOTHING;

        CONTINUE;
      END IF;

      -- If already at target UUID, nothing to do
      IF current_uuid = target_uuid THEN
        CONTINUE;
      END IF;

      -- Check if target UUID is already taken by a different row
      IF EXISTS (SELECT 1 FROM users WHERE id = target_uuid AND bot_profile != bot_key) THEN
        -- Target UUID occupied by another entity — skip and log
        RAISE WARNING 'Migration 025: target UUID % for % is occupied by another user — skipping', target_uuid, bot_key;
        CONTINUE;
      END IF;

      -- Reassign: update all FK references from current_uuid → target_uuid,
      -- then update the user row's primary key.

      -- 1. Update FK references in all tables that reference users(id)
      UPDATE game_players SET user_id = target_uuid WHERE user_id = current_uuid;
      UPDATE games SET winner_id = target_uuid WHERE winner_id = current_uuid;
      UPDATE ratings SET user_id = target_uuid WHERE user_id = current_uuid;
      UPDATE rating_history SET user_id = target_uuid WHERE user_id = current_uuid;
      UPDATE ranked_match_players SET user_id = target_uuid WHERE user_id = current_uuid;
      UPDATE events SET user_id = target_uuid WHERE user_id = current_uuid;
      UPDATE friends SET user_id = target_uuid WHERE user_id = current_uuid;
      UPDATE friends SET friend_id = target_uuid WHERE friend_id = current_uuid;

      -- 2. Delete the old user row (FKs already moved away)
      DELETE FROM users WHERE id = current_uuid;

      -- 3. Insert with the target UUID (or update if target exists from a previous partial run)
      INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile)
      VALUES (target_uuid, bot_key, initcap(personality) || ' lvl' || lvl, 'bot', true, bot_key)
      ON CONFLICT (id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        bot_profile = EXCLUDED.bot_profile,
        is_bot = true;

      -- 4. Ensure ratings exist at the new UUID
      INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
      VALUES (target_uuid, 'heads_up', 1200, 25, 8.333, 0, 1200)
      ON CONFLICT (user_id, mode) DO NOTHING;
      INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
      VALUES (target_uuid, 'multiplayer', 1200, 25, 8.333, 0, 1200)
      ON CONFLICT (user_id, mode) DO NOTHING;

      RAISE NOTICE 'Migration 025: reassigned % from % to %', bot_key, current_uuid, target_uuid;
    END LOOP;
  END LOOP;
END $$;

-- Verify: all 72 heuristic bots should exist with correct UUIDs
DO $$
DECLARE
  bot_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bot_count
  FROM users
  WHERE is_bot = true
    AND bot_profile ~ '^(rock|bluffer|grinder|wildcard|professor|shark|cannon|frost|hustler)_lvl[1-8]$';

  IF bot_count < 72 THEN
    RAISE WARNING 'Migration 025: only % of 72 heuristic bots exist after normalization', bot_count;
  ELSE
    RAISE NOTICE 'Migration 025: all 72 heuristic bots verified';
  END IF;
END $$;
