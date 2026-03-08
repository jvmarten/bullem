-- Track when a user last changed their username (for cooldown enforcement)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
