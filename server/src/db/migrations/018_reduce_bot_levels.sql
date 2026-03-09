-- Reduce heuristic bots from 9 levels (1-9) to 8 levels (1-8).
-- CFR bots take over level 9.
--
-- Changes:
-- 1. Delete old lvl1 heuristic bots (they become unnecessary)
-- 2. Shift levels down: old lvl2→lvl1, lvl3→lvl2, ..., lvl9→lvl8
-- 3. Seed 9 CFR bot accounts for ranked play
--
-- The level shift is a renaming operation on existing rows — no data is lost,
-- just reassigned to the new level scheme where heuristic bots are 1-8 and
-- CFR bots occupy level 9.

-- ── Step 1: Delete old lvl1 bots ──────────────────────────────────────────
-- These are the weakest bots and are being dropped from the matrix.
-- Delete ratings first (FK constraint), then users.

DELETE FROM ratings WHERE user_id IN (
  SELECT id FROM users WHERE is_bot = true AND bot_profile LIKE '%_lvl1'
);
DELETE FROM users WHERE is_bot = true AND bot_profile LIKE '%_lvl1';

-- ── Step 2: Shift levels down (lvl2→lvl1, lvl3→lvl2, ..., lvl9→lvl8) ────
-- Process from lowest to highest to avoid key conflicts.
-- Must update bot_profile, username, and display_name for each level.

DO $$
DECLARE
  personality TEXT;
  old_level INT;
  new_level INT;
  old_key TEXT;
  new_key TEXT;
  old_display TEXT;
  new_display TEXT;
  personality_name TEXT;
BEGIN
  FOR personality IN SELECT unnest(ARRAY['rock','bluffer','grinder','wildcard','professor','shark','cannon','frost','hustler'])
  LOOP
    -- Get display name prefix from current data
    SELECT split_part(display_name, ' lvl', 1) INTO personality_name
    FROM users WHERE bot_profile = personality || '_lvl2' AND is_bot = true;

    -- If not found (shouldn't happen), derive from key
    IF personality_name IS NULL THEN
      personality_name := initcap(personality);
    END IF;

    FOR old_level IN 2..9 LOOP
      new_level := old_level - 1;
      old_key := personality || '_lvl' || old_level;
      new_key := personality || '_lvl' || new_level;
      old_display := personality_name || ' lvl' || old_level;
      new_display := personality_name || ' lvl' || new_level;

      UPDATE users
      SET bot_profile = new_key,
          username = new_key,
          display_name = new_display
      WHERE bot_profile = old_key AND is_bot = true;
    END LOOP;
  END LOOP;
END $$;

-- ── Step 3: Seed CFR bot accounts ─────────────────────────────────────────
-- 9 CFR bots with deterministic UUIDs.
-- personality code 10 for CFR bots.

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
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- ── Step 4: Seed default ratings for CFR bots ─────────────────────────────

DO $$
DECLARE
  bot_user RECORD;
BEGIN
  FOR bot_user IN SELECT id FROM users WHERE is_bot = true AND bot_profile LIKE 'cfr_%'
  LOOP
    INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
    VALUES (bot_user.id, 'heads_up', 1200, 25, 8.333, 0, 1200)
    ON CONFLICT (user_id, mode) DO NOTHING;

    INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
    VALUES (bot_user.id, 'multiplayer', 1200, 25, 8.333, 0, 1200)
    ON CONFLICT (user_id, mode) DO NOTHING;
  END LOOP;
END $$;
