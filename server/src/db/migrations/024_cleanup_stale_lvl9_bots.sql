-- Clean up stale heuristic *_lvl9 bot rows left over from migration 012.
--
-- Root cause: Migration 012 renamed the original 8 bots (from migration 009)
-- to *_lvl9 at UUIDs b000-000000000001 through b000-000000000008. Migration
-- 018 was supposed to shift these down to *_lvl8, but the DO block's level
-- shift didn't update these rows (likely due to a conflict with the separately
-- seeded *_lvl8 rows at different UUIDs). Migration 019's orphan cleanup
-- also missed them (possibly ran before 018 in the migration order).
--
-- These rows are truly stale: BOT_PROFILE_MAP only has heuristic bots at
-- levels 1-8 and CFR bots with cfr_* keys. The *_lvl9 rows cause a warn-level
-- log on every getRankedBotPool() call ("Bot profile not found in BOT_PROFILE_MAP").
--
-- Fix: Delete these 8 specific stale rows. Nullify FK references first to
-- avoid constraint violations. Their ratings cascade via ON DELETE CASCADE.

DO $$
DECLARE
  stale_ids UUID[];
  stale_count INT;
BEGIN
  -- Find bot rows with *_lvl9 profile (heuristic personality at level 9).
  -- These are invalid since heuristic bots max at level 8 after migration 018.
  SELECT array_agg(id) INTO stale_ids
  FROM users
  WHERE is_bot = true
    AND bot_profile ~ '^(rock|bluffer|grinder|wildcard|professor|shark|cannon|frost|hustler)_lvl9$';

  IF stale_ids IS NULL THEN
    RAISE NOTICE 'No stale *_lvl9 bot rows found — nothing to clean up.';
    RETURN;
  END IF;

  stale_count := array_length(stale_ids, 1);
  RAISE NOTICE 'Cleaning up % stale *_lvl9 bot row(s)', stale_count;

  -- Nullify FK references in game history (these tables don't cascade on delete)
  UPDATE games SET winner_id = NULL WHERE winner_id = ANY(stale_ids);
  UPDATE game_players SET user_id = NULL WHERE user_id = ANY(stale_ids);

  -- Delete the stale rows (ratings, rating_history, deck_draw_stats cascade;
  -- events use ON DELETE SET NULL)
  DELETE FROM users WHERE id = ANY(stale_ids);

  RAISE NOTICE 'Deleted % stale *_lvl9 bot row(s)', stale_count;
END $$;
