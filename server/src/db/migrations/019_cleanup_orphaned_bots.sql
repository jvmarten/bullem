-- Clean up orphaned bot rows that don't match valid bot profiles.
-- Valid profiles: {personality}_lvl{1-8}, cfr_{name}, or oracle_lvl10.
--
-- These orphaned rows may exist from earlier migrations (e.g., heuristic bots
-- that were once lvl9 before CFR bots took that level) or from the Evolved
-- personality that was added and later removed. They pollute the leaderboard
-- when no profile-based filtering is applied.

-- Define the valid bot profile pattern once as a variable.
DO $$
DECLARE
  valid_pattern TEXT := '^((rock|bluffer|grinder|wildcard|professor|shark|cannon|frost|hustler)_lvl[1-8]|cfr_(viper|ghost|reaper|specter|raptor|havoc|phantom|sentinel|vanguard)|oracle_lvl10)$';
  orphaned_ids UUID[];
BEGIN
  -- Collect orphaned bot user IDs
  SELECT array_agg(id) INTO orphaned_ids
  FROM users
  WHERE is_bot = true
    AND bot_profile IS NOT NULL
    AND bot_profile !~ valid_pattern;

  -- Nothing to clean up
  IF orphaned_ids IS NULL THEN
    RAISE NOTICE 'No orphaned bot rows found — nothing to clean up.';
    RETURN;
  END IF;

  RAISE NOTICE 'Cleaning up % orphaned bot row(s)', array_length(orphaned_ids, 1);

  -- Nullify FK references in game history (these tables don't cascade on delete)
  UPDATE games SET winner_id = NULL WHERE winner_id = ANY(orphaned_ids);
  UPDATE game_players SET user_id = NULL WHERE user_id = ANY(orphaned_ids);

  -- Cascading tables (ratings, rating_history, deck_draw_stats) are handled
  -- automatically by ON DELETE CASCADE. Events use ON DELETE SET NULL.

  -- Delete the orphaned bot user rows (cascading deletes handle the rest)
  DELETE FROM users WHERE id = ANY(orphaned_ids);
END $$;
