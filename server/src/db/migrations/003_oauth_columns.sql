-- Add OAuth support columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id TEXT;

-- Unique index on (auth_provider, oauth_id) for OAuth lookups.
-- Partial index: only rows with a non-null oauth_id are included,
-- so email-only users (oauth_id IS NULL) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth_provider_id
  ON users (auth_provider, oauth_id)
  WHERE oauth_id IS NOT NULL;
