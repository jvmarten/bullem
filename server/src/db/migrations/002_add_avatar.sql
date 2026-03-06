-- 002_add_avatar.sql
-- Adds avatar column to users table for profile photo templates.

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT;
