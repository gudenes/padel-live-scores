-- Auth.js required tables (standard @auth/pg-adapter schema)
-- See: https://authjs.dev/getting-started/adapters/pg
-- Table names MUST match exactly what the adapter expects: users, accounts, sessions, verification_token.
-- These live in the "public" schema — no conflict with Supabase's auth.users (in "auth" schema).
-- We use UUID PKs instead of SERIAL to match Supabase conventions and our profiles table.

CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT,
  email TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image TEXT
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  UNIQUE(provider, "providerAccountId")
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "sessionToken" TEXT NOT NULL UNIQUE,
  "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires TIMESTAMPTZ NOT NULL,
  UNIQUE(identifier, token)
);

-- Indexes for session lookups
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions("sessionToken");
CREATE INDEX IF NOT EXISTS idx_sessions_userid ON sessions("userId");
CREATE INDEX IF NOT EXISTS idx_accounts_userid ON accounts("userId");

-- Drop RLS on user-data tables (all access now goes through service key via API routes)
ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_bookmarks DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges DISABLE ROW LEVEL SECURITY;
ALTER TABLE match_ratings DISABLE ROW LEVEL SECURITY;
ALTER TABLE feature_interest DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_activity_log DISABLE ROW LEVEL SECURITY;

-- Drop old RLS policies (they reference auth.uid() which won't exist for Auth.js users)
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can read own bookmarks" ON user_bookmarks;
DROP POLICY IF EXISTS "Users can insert own bookmarks" ON user_bookmarks;
DROP POLICY IF EXISTS "Users can delete own bookmarks" ON user_bookmarks;
DROP POLICY IF EXISTS "Users can read own badges" ON user_badges;
DROP POLICY IF EXISTS "Users can insert own badges" ON user_badges;
DROP POLICY IF EXISTS "Users can read own ratings" ON match_ratings;
DROP POLICY IF EXISTS "Users can insert own ratings" ON match_ratings;
DROP POLICY IF EXISTS "Users can update own ratings" ON match_ratings;
DROP POLICY IF EXISTS "Users can read own feature interests" ON feature_interest;
DROP POLICY IF EXISTS "Users can insert own feature interests" ON feature_interest;
DROP POLICY IF EXISTS "Users can delete own feature interests" ON feature_interest;
DROP POLICY IF EXISTS "Users can read own activity log" ON user_activity_log;
DROP POLICY IF EXISTS "Users can insert own activity log" ON user_activity_log;

-- Update profiles FK: remove the foreign key to auth.users if it exists,
-- so profiles.id can reference Auth.js users table instead.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
