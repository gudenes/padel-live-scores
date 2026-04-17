-- User notifications: durable in-app log of events shown to a user.
-- Written by the notify endpoint + future event triggers (match_finished,
-- badge_earned, etc.). Read by the /notifications page and the header bell.
-- Rows cascade-deleted when the Auth.js user is deleted.

CREATE TABLE IF NOT EXISTS user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  url         TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON user_notifications(user_id)
  WHERE read_at IS NULL;

COMMENT ON TABLE user_notifications IS
  'Durable in-app notification log. One row per user per event. Retention target: 60 days (cleanup cron TBD).';
COMMENT ON COLUMN user_notifications.category IS
  'Free-text category key; see src/lib/notification-categories.ts for valid values.';
COMMENT ON COLUMN user_notifications.metadata IS
  'Category-specific extras (match_id, badge_id, reason, etc.). Shape depends on category.';
