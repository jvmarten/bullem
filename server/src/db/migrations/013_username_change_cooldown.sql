-- 013_username_change_cooldown.sql
-- Tracks when a user last changed their username to enforce cooldown periods.
-- First 3 days after signup: unlimited changes. After that: once every 27 days.

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_username_change_at TIMESTAMPTZ;
