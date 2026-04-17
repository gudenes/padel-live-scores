-- Per-user notification preferences: one JSONB keyed by category,
-- each value is { push: bool, inApp: bool }. Missing keys fall back
-- to defaults in src/lib/notification-categories.ts, so adding new
-- categories requires no migration.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profiles.notification_prefs IS
  'Per-category, per-channel notification prefs. Shape: { [category]: { push: bool, inApp: bool } }. Missing keys fall back to defaults defined in code.';
