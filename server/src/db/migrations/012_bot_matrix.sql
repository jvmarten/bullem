-- Expand from 8 bot personalities to 81 bots (9 personalities × 9 levels).
-- Each bot gets a real user row with ratings so they can participate in ranked play.
--
-- Legacy bots (The Rock, Maverick, etc.) are updated to their lvl9 equivalents.
-- New bots are inserted for all 81 personality×level combinations.
--
-- Naming format: {Personality} lvl{N} (e.g., "Professor lvl3", "Bluffer lvl9")

-- ── Update legacy bots to new naming scheme ────────────────────────────
-- Map old profile keys to new format. The old 8 bots become the lvl9 variant.

UPDATE users SET bot_profile = 'rock_lvl9',      display_name = 'Rock lvl9'      WHERE username = 'the_rock'      AND is_bot = true;
UPDATE users SET bot_profile = 'bluffer_lvl9',    display_name = 'Bluffer lvl9'   WHERE username = 'maverick'       AND is_bot = true;
UPDATE users SET bot_profile = 'grinder_lvl9',    display_name = 'Grinder lvl9'   WHERE username = 'the_grinder'    AND is_bot = true;
UPDATE users SET bot_profile = 'wildcard_lvl9',   display_name = 'Wildcard lvl9'  WHERE username = 'wildcard'       AND is_bot = true;
UPDATE users SET bot_profile = 'professor_lvl9',  display_name = 'Professor lvl9' WHERE username = 'the_professor'  AND is_bot = true;
UPDATE users SET bot_profile = 'shark_lvl9',      display_name = 'Shark lvl9'     WHERE username = 'shark'          AND is_bot = true;
UPDATE users SET bot_profile = 'cannon_lvl9',     display_name = 'Cannon lvl9'    WHERE username = 'loose_cannon'   AND is_bot = true;
UPDATE users SET bot_profile = 'frost_lvl9',      display_name = 'Frost lvl9'     WHERE username = 'ice_queen'      AND is_bot = true;

-- Also update the username to match the new key
UPDATE users SET username = 'rock_lvl9'      WHERE username = 'the_rock'      AND is_bot = true;
UPDATE users SET username = 'bluffer_lvl9'   WHERE username = 'maverick'       AND is_bot = true;
UPDATE users SET username = 'grinder_lvl9'   WHERE username = 'the_grinder'    AND is_bot = true;
UPDATE users SET username = 'wildcard_lvl9'  WHERE username = 'wildcard'       AND is_bot = true;
UPDATE users SET username = 'professor_lvl9' WHERE username = 'the_professor'  AND is_bot = true;
UPDATE users SET username = 'shark_lvl9'     WHERE username = 'shark'          AND is_bot = true;
UPDATE users SET username = 'cannon_lvl9'    WHERE username = 'loose_cannon'   AND is_bot = true;
UPDATE users SET username = 'frost_lvl9'     WHERE username = 'ice_queen'      AND is_bot = true;

-- ── Seed all 81 bot accounts ────────────────────────────────────────────
-- Uses deterministic UUIDs: 00000000-0000-4000-b0{personality}{level}-000000000000
-- personality: 01=rock, 02=bluffer, 03=grinder, 04=wildcard, 05=professor,
--              06=shark, 07=cannon, 08=frost, 09=hustler
-- level: 1-9
--
-- ON CONFLICT handles re-running and the existing 8 bots (which were updated above).

-- Rock lvl1-9 (personality 01)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b011-000000000000', 'rock_lvl1', 'Rock lvl1', 'bot', true, 'rock_lvl1'),
  ('00000000-0000-4000-b012-000000000000', 'rock_lvl2', 'Rock lvl2', 'bot', true, 'rock_lvl2'),
  ('00000000-0000-4000-b013-000000000000', 'rock_lvl3', 'Rock lvl3', 'bot', true, 'rock_lvl3'),
  ('00000000-0000-4000-b014-000000000000', 'rock_lvl4', 'Rock lvl4', 'bot', true, 'rock_lvl4'),
  ('00000000-0000-4000-b015-000000000000', 'rock_lvl5', 'Rock lvl5', 'bot', true, 'rock_lvl5'),
  ('00000000-0000-4000-b016-000000000000', 'rock_lvl6', 'Rock lvl6', 'bot', true, 'rock_lvl6'),
  ('00000000-0000-4000-b017-000000000000', 'rock_lvl7', 'Rock lvl7', 'bot', true, 'rock_lvl7'),
  ('00000000-0000-4000-b018-000000000000', 'rock_lvl8', 'Rock lvl8', 'bot', true, 'rock_lvl8')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;
-- rock_lvl9 already exists (updated from the_rock above)

-- Bluffer lvl1-9 (personality 02)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b021-000000000000', 'bluffer_lvl1', 'Bluffer lvl1', 'bot', true, 'bluffer_lvl1'),
  ('00000000-0000-4000-b022-000000000000', 'bluffer_lvl2', 'Bluffer lvl2', 'bot', true, 'bluffer_lvl2'),
  ('00000000-0000-4000-b023-000000000000', 'bluffer_lvl3', 'Bluffer lvl3', 'bot', true, 'bluffer_lvl3'),
  ('00000000-0000-4000-b024-000000000000', 'bluffer_lvl4', 'Bluffer lvl4', 'bot', true, 'bluffer_lvl4'),
  ('00000000-0000-4000-b025-000000000000', 'bluffer_lvl5', 'Bluffer lvl5', 'bot', true, 'bluffer_lvl5'),
  ('00000000-0000-4000-b026-000000000000', 'bluffer_lvl6', 'Bluffer lvl6', 'bot', true, 'bluffer_lvl6'),
  ('00000000-0000-4000-b027-000000000000', 'bluffer_lvl7', 'Bluffer lvl7', 'bot', true, 'bluffer_lvl7'),
  ('00000000-0000-4000-b028-000000000000', 'bluffer_lvl8', 'Bluffer lvl8', 'bot', true, 'bluffer_lvl8')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- Grinder lvl1-9 (personality 03)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b031-000000000000', 'grinder_lvl1', 'Grinder lvl1', 'bot', true, 'grinder_lvl1'),
  ('00000000-0000-4000-b032-000000000000', 'grinder_lvl2', 'Grinder lvl2', 'bot', true, 'grinder_lvl2'),
  ('00000000-0000-4000-b033-000000000000', 'grinder_lvl3', 'Grinder lvl3', 'bot', true, 'grinder_lvl3'),
  ('00000000-0000-4000-b034-000000000000', 'grinder_lvl4', 'Grinder lvl4', 'bot', true, 'grinder_lvl4'),
  ('00000000-0000-4000-b035-000000000000', 'grinder_lvl5', 'Grinder lvl5', 'bot', true, 'grinder_lvl5'),
  ('00000000-0000-4000-b036-000000000000', 'grinder_lvl6', 'Grinder lvl6', 'bot', true, 'grinder_lvl6'),
  ('00000000-0000-4000-b037-000000000000', 'grinder_lvl7', 'Grinder lvl7', 'bot', true, 'grinder_lvl7'),
  ('00000000-0000-4000-b038-000000000000', 'grinder_lvl8', 'Grinder lvl8', 'bot', true, 'grinder_lvl8')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- Wildcard lvl1-9 (personality 04)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b041-000000000000', 'wildcard_lvl1', 'Wildcard lvl1', 'bot', true, 'wildcard_lvl1'),
  ('00000000-0000-4000-b042-000000000000', 'wildcard_lvl2', 'Wildcard lvl2', 'bot', true, 'wildcard_lvl2'),
  ('00000000-0000-4000-b043-000000000000', 'wildcard_lvl3', 'Wildcard lvl3', 'bot', true, 'wildcard_lvl3'),
  ('00000000-0000-4000-b044-000000000000', 'wildcard_lvl4', 'Wildcard lvl4', 'bot', true, 'wildcard_lvl4'),
  ('00000000-0000-4000-b045-000000000000', 'wildcard_lvl5', 'Wildcard lvl5', 'bot', true, 'wildcard_lvl5'),
  ('00000000-0000-4000-b046-000000000000', 'wildcard_lvl6', 'Wildcard lvl6', 'bot', true, 'wildcard_lvl6'),
  ('00000000-0000-4000-b047-000000000000', 'wildcard_lvl7', 'Wildcard lvl7', 'bot', true, 'wildcard_lvl7'),
  ('00000000-0000-4000-b048-000000000000', 'wildcard_lvl8', 'Wildcard lvl8', 'bot', true, 'wildcard_lvl8')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- Professor lvl1-9 (personality 05)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b051-000000000000', 'professor_lvl1', 'Professor lvl1', 'bot', true, 'professor_lvl1'),
  ('00000000-0000-4000-b052-000000000000', 'professor_lvl2', 'Professor lvl2', 'bot', true, 'professor_lvl2'),
  ('00000000-0000-4000-b053-000000000000', 'professor_lvl3', 'Professor lvl3', 'bot', true, 'professor_lvl3'),
  ('00000000-0000-4000-b054-000000000000', 'professor_lvl4', 'Professor lvl4', 'bot', true, 'professor_lvl4'),
  ('00000000-0000-4000-b055-000000000000', 'professor_lvl5', 'Professor lvl5', 'bot', true, 'professor_lvl5'),
  ('00000000-0000-4000-b056-000000000000', 'professor_lvl6', 'Professor lvl6', 'bot', true, 'professor_lvl6'),
  ('00000000-0000-4000-b057-000000000000', 'professor_lvl7', 'Professor lvl7', 'bot', true, 'professor_lvl7'),
  ('00000000-0000-4000-b058-000000000000', 'professor_lvl8', 'Professor lvl8', 'bot', true, 'professor_lvl8')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- Shark lvl1-9 (personality 06)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b061-000000000000', 'shark_lvl1', 'Shark lvl1', 'bot', true, 'shark_lvl1'),
  ('00000000-0000-4000-b062-000000000000', 'shark_lvl2', 'Shark lvl2', 'bot', true, 'shark_lvl2'),
  ('00000000-0000-4000-b063-000000000000', 'shark_lvl3', 'Shark lvl3', 'bot', true, 'shark_lvl3'),
  ('00000000-0000-4000-b064-000000000000', 'shark_lvl4', 'Shark lvl4', 'bot', true, 'shark_lvl4'),
  ('00000000-0000-4000-b065-000000000000', 'shark_lvl5', 'Shark lvl5', 'bot', true, 'shark_lvl5'),
  ('00000000-0000-4000-b066-000000000000', 'shark_lvl6', 'Shark lvl6', 'bot', true, 'shark_lvl6'),
  ('00000000-0000-4000-b067-000000000000', 'shark_lvl7', 'Shark lvl7', 'bot', true, 'shark_lvl7'),
  ('00000000-0000-4000-b068-000000000000', 'shark_lvl8', 'Shark lvl8', 'bot', true, 'shark_lvl8')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- Cannon lvl1-9 (personality 07)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b071-000000000000', 'cannon_lvl1', 'Cannon lvl1', 'bot', true, 'cannon_lvl1'),
  ('00000000-0000-4000-b072-000000000000', 'cannon_lvl2', 'Cannon lvl2', 'bot', true, 'cannon_lvl2'),
  ('00000000-0000-4000-b073-000000000000', 'cannon_lvl3', 'Cannon lvl3', 'bot', true, 'cannon_lvl3'),
  ('00000000-0000-4000-b074-000000000000', 'cannon_lvl4', 'Cannon lvl4', 'bot', true, 'cannon_lvl4'),
  ('00000000-0000-4000-b075-000000000000', 'cannon_lvl5', 'Cannon lvl5', 'bot', true, 'cannon_lvl5'),
  ('00000000-0000-4000-b076-000000000000', 'cannon_lvl6', 'Cannon lvl6', 'bot', true, 'cannon_lvl6'),
  ('00000000-0000-4000-b077-000000000000', 'cannon_lvl7', 'Cannon lvl7', 'bot', true, 'cannon_lvl7'),
  ('00000000-0000-4000-b078-000000000000', 'cannon_lvl8', 'Cannon lvl8', 'bot', true, 'cannon_lvl8')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- Frost lvl1-9 (personality 08)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b081-000000000000', 'frost_lvl1', 'Frost lvl1', 'bot', true, 'frost_lvl1'),
  ('00000000-0000-4000-b082-000000000000', 'frost_lvl2', 'Frost lvl2', 'bot', true, 'frost_lvl2'),
  ('00000000-0000-4000-b083-000000000000', 'frost_lvl3', 'Frost lvl3', 'bot', true, 'frost_lvl3'),
  ('00000000-0000-4000-b084-000000000000', 'frost_lvl4', 'Frost lvl4', 'bot', true, 'frost_lvl4'),
  ('00000000-0000-4000-b085-000000000000', 'frost_lvl5', 'Frost lvl5', 'bot', true, 'frost_lvl5'),
  ('00000000-0000-4000-b086-000000000000', 'frost_lvl6', 'Frost lvl6', 'bot', true, 'frost_lvl6'),
  ('00000000-0000-4000-b087-000000000000', 'frost_lvl7', 'Frost lvl7', 'bot', true, 'frost_lvl7'),
  ('00000000-0000-4000-b088-000000000000', 'frost_lvl8', 'Frost lvl8', 'bot', true, 'frost_lvl8')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- Hustler lvl1-9 (personality 09 — new personality)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b091-000000000000', 'hustler_lvl1', 'Hustler lvl1', 'bot', true, 'hustler_lvl1'),
  ('00000000-0000-4000-b092-000000000000', 'hustler_lvl2', 'Hustler lvl2', 'bot', true, 'hustler_lvl2'),
  ('00000000-0000-4000-b093-000000000000', 'hustler_lvl3', 'Hustler lvl3', 'bot', true, 'hustler_lvl3'),
  ('00000000-0000-4000-b094-000000000000', 'hustler_lvl4', 'Hustler lvl4', 'bot', true, 'hustler_lvl4'),
  ('00000000-0000-4000-b095-000000000000', 'hustler_lvl5', 'Hustler lvl5', 'bot', true, 'hustler_lvl5'),
  ('00000000-0000-4000-b096-000000000000', 'hustler_lvl6', 'Hustler lvl6', 'bot', true, 'hustler_lvl6'),
  ('00000000-0000-4000-b097-000000000000', 'hustler_lvl7', 'Hustler lvl7', 'bot', true, 'hustler_lvl7'),
  ('00000000-0000-4000-b098-000000000000', 'hustler_lvl8', 'Hustler lvl8', 'bot', true, 'hustler_lvl8'),
  ('00000000-0000-4000-b099-000000000000', 'hustler_lvl9', 'Hustler lvl9', 'bot', true, 'hustler_lvl9')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- ── Seed default ratings for all new bots ────────────────────────────────
-- Only insert ratings that don't exist yet (the old 8 bots already have ratings).
-- Starting at standard defaults — they'll diverge through calibration play.

DO $$
DECLARE
  bot_user RECORD;
BEGIN
  FOR bot_user IN SELECT id FROM users WHERE is_bot = true AND bot_profile IS NOT NULL
  LOOP
    INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
    VALUES (bot_user.id, 'heads_up', 1200, 25, 8.333, 0, 1200)
    ON CONFLICT (user_id, mode) DO NOTHING;

    INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
    VALUES (bot_user.id, 'multiplayer', 1200, 25, 8.333, 0, 1200)
    ON CONFLICT (user_id, mode) DO NOTHING;
  END LOOP;
END $$;
