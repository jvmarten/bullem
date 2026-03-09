-- Remove Evolved personality — its parameters are now the DEFAULT_BOT_PROFILE_CONFIG
-- baseline that all other personalities derive from. Having it as a separate
-- selectable bot was redundant with Professor (which uses the same evolved values).
-- The evolved DNA flows into every bot via the baseline, not as a separate personality.

-- Delete ratings first (FK constraint)
DELETE FROM ratings WHERE user_id IN (
  SELECT id FROM users WHERE bot_profile LIKE 'evolved_lvl%'
);

-- Delete the evolved bot users
DELETE FROM users WHERE bot_profile LIKE 'evolved_lvl%';
