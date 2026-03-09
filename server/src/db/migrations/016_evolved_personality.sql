-- Add Evolved personality (10th personality) — machine-optimized via 50-generation evolution.
-- Parameters derived from training/strategies/evolved-best-gen50.json.
-- 61% win rate vs all level-9 profiles in heads-up evaluation.
--
-- UUID pattern: 00000000-0000-4000-b{personality}{level}-000000000000
-- Evolved = personality 10, levels 1-9.

-- Evolved lvl1-9 (personality 10)
INSERT INTO users (id, username, display_name, auth_provider, is_bot, bot_profile) VALUES
  ('00000000-0000-4000-b101-000000000000', 'evolved_lvl1', 'Evolved lvl1', 'bot', true, 'evolved_lvl1'),
  ('00000000-0000-4000-b102-000000000000', 'evolved_lvl2', 'Evolved lvl2', 'bot', true, 'evolved_lvl2'),
  ('00000000-0000-4000-b103-000000000000', 'evolved_lvl3', 'Evolved lvl3', 'bot', true, 'evolved_lvl3'),
  ('00000000-0000-4000-b104-000000000000', 'evolved_lvl4', 'Evolved lvl4', 'bot', true, 'evolved_lvl4'),
  ('00000000-0000-4000-b105-000000000000', 'evolved_lvl5', 'Evolved lvl5', 'bot', true, 'evolved_lvl5'),
  ('00000000-0000-4000-b106-000000000000', 'evolved_lvl6', 'Evolved lvl6', 'bot', true, 'evolved_lvl6'),
  ('00000000-0000-4000-b107-000000000000', 'evolved_lvl7', 'Evolved lvl7', 'bot', true, 'evolved_lvl7'),
  ('00000000-0000-4000-b108-000000000000', 'evolved_lvl8', 'Evolved lvl8', 'bot', true, 'evolved_lvl8'),
  ('00000000-0000-4000-b109-000000000000', 'evolved_lvl9', 'Evolved lvl9', 'bot', true, 'evolved_lvl9')
ON CONFLICT (username) DO UPDATE SET is_bot = EXCLUDED.is_bot, bot_profile = EXCLUDED.bot_profile, display_name = EXCLUDED.display_name;

-- Seed default ratings for Evolved bots
DO $$
DECLARE
  bot_user RECORD;
BEGIN
  FOR bot_user IN SELECT id FROM users WHERE is_bot = true AND bot_profile LIKE 'evolved_lvl%'
  LOOP
    INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
    VALUES (bot_user.id, 'heads_up', 1200, 25, 8.333, 0, 1200)
    ON CONFLICT (user_id, mode) DO NOTHING;

    INSERT INTO ratings (user_id, mode, elo, mu, sigma, games_played, peak_rating)
    VALUES (bot_user.id, 'multiplayer', 1200, 25, 8.333, 0, 1200)
    ON CONFLICT (user_id, mode) DO NOTHING;
  END LOOP;
END $$;
