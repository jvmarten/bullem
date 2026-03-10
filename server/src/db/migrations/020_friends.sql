-- 020_friends.sql
-- Persistent friends list supporting friend requests, accepted friendships, and blocks.
-- Friendships are bidirectional: when user A sends a request to user B and B accepts,
-- only one row exists (user_id=A, friend_id=B, status='accepted'). Queries must check
-- both columns to find all friendships for a given user.

CREATE TABLE IF NOT EXISTS friends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The user who initiated the relationship (sent the request or applied the block).
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The target user.
  friend_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'pending' = request sent, 'accepted' = mutual friends, 'blocked' = user_id blocked friend_id.
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Prevent duplicate relationships and self-friending.
  UNIQUE(user_id, friend_id),
  CHECK (user_id != friend_id)
);

-- Index for looking up all relationships for a user (both directions).
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends(user_id);
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends(friend_id);
-- Index for filtering by status (e.g., pending requests).
CREATE INDEX IF NOT EXISTS idx_friends_user_status ON friends(user_id, status);
CREATE INDEX IF NOT EXISTS idx_friends_friend_status ON friends(friend_id, status);
