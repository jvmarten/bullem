-- Add role column to users table for admin role system.
-- Values: 'user' (default) or 'admin'.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Set the initial admin account.
UPDATE users SET role = 'admin' WHERE username = 'jv';
