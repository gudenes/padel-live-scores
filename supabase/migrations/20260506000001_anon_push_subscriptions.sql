-- Anonymous push notification subscriptions.
--
-- Mirrors the user-scoped push_subscriptions + user_bookmarks shape but
-- keyed by a random localStorage UUID (pn_device_id) instead of user_id.
-- Lets pre-auth visitors receive Web Push for players/matches they follow
-- on the device they're using. Spec: 2026-05-06-anonymous-push-notifications-design.md.

CREATE TABLE anon_push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       UUID NOT NULL,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh_key      TEXT NOT NULL,
  auth_key        TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX anon_push_subscriptions_device_id_idx
  ON anon_push_subscriptions (device_id);

CREATE INDEX anon_push_subscriptions_last_seen_at_idx
  ON anon_push_subscriptions (last_seen_at);

CREATE TABLE anon_bookmarks (
  device_id       UUID NOT NULL,
  bookmark_type   TEXT NOT NULL CHECK (bookmark_type IN ('player','match')),
  target_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, bookmark_type, target_id)
);

-- Lookup index for the push-sender JOIN: "who follows player X" /
-- "who bookmarked match Y".
CREATE INDEX anon_bookmarks_target_idx
  ON anon_bookmarks (bookmark_type, target_id);

-- RLS: anon-key + auth-key clients get NO access. Only the service role
-- (used by API routes + crons) reads/writes these tables.
ALTER TABLE anon_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE anon_bookmarks         ENABLE ROW LEVEL SECURITY;

-- Cascade delete: when a subscription row is removed (manual unsubscribe,
-- 410-from-push-service cleanup, or the 90-day cron), drop the
-- corresponding anon_bookmarks rows for that device — but only when no
-- other subscription rows for the same device_id remain. (A device with
-- multiple browsers / PWA installs may have multiple subscription rows;
-- bookmarks should survive until the last one goes.)
CREATE OR REPLACE FUNCTION delete_anon_bookmarks_for_device()
RETURNS trigger AS $$
BEGIN
  DELETE FROM anon_bookmarks
   WHERE device_id = OLD.device_id
     AND NOT EXISTS (
       SELECT 1 FROM anon_push_subscriptions
        WHERE device_id = OLD.device_id AND id <> OLD.id
     );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER anon_subs_cleanup_bookmarks
AFTER DELETE ON anon_push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION delete_anon_bookmarks_for_device();

COMMENT ON TABLE anon_push_subscriptions IS
  'Anonymous Web Push subscriptions, keyed by localStorage device_id (UUID). Spec 2026-05-06.';
COMMENT ON TABLE anon_bookmarks IS
  'Anonymous follows for push delivery. Migrated to user_bookmarks on sign-in.';
