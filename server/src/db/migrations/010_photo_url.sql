-- Add optional profile photo URL (set by admin)
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
