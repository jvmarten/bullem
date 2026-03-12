-- Add avatar background color column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_bg_color TEXT;
