-- Play the Next — per-user access whitelist.
--
-- The feature ships to production before it is ready for everyone, so the
-- route and its APIs exist publicly but answer only for named users. Two
-- independent switches, both required:
--
--   1. feature_flags.play_enabled   — global kill switch, flip in ops, no deploy
--   2. play_access (this table)     — the per-user allowlist
--
-- Access is the AND of the two. Killing the feature for everyone is one
-- toggle; revoking one tester is one row. Neither needs a deploy, which is
-- the whole point of not doing this with an env var.
--
-- Enforcement is SERVER-SIDE ONLY (src/lib/play-access.ts), in both the
-- route layout and every /api/play/* handler. Hiding the nav tab is
-- cosmetic — a non-whitelisted user who types the URL must get a 404.

CREATE TABLE IF NOT EXISTS play_access (
  user_id    uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text,
  note       text
);

COMMENT ON TABLE play_access IS
  'Allowlist for the Play prediction market. Presence = access, subject to the play_enabled feature flag.';
COMMENT ON COLUMN play_access.granted_by IS
  'Operator identifier, for audit. Free text — this table predates any admin UI for it.';
COMMENT ON COLUMN play_access.note IS
  'Why this user was added (e.g. "internal QA", "beta wave 1").';

-- There is no admin UI for this table yet. Granting access is one statement:
--
--   INSERT INTO play_access (user_id, granted_by, note)
--   SELECT id, 'gustavo', 'internal QA'
--   FROM profiles WHERE id = (SELECT id FROM users WHERE email = 'someone@example.com')
--   ON CONFLICT (user_id) DO NOTHING;
--
-- Revoking is a DELETE on one row. Killing it for everyone at once is the
-- play_enabled flag, not a TRUNCATE here.

-- RLS on with ZERO policies: invisible to anon and authenticated alike.
-- Every read goes through a service-role client, matching the rest of the
-- Play tables. Note that the app authenticates with Auth.js, not Supabase
-- Auth, so an auth.uid()-based policy would evaluate NULL and deny anyway.
ALTER TABLE play_access ENABLE ROW LEVEL SECURITY;

-- The global switch.
--
-- `enabled` FALSE: applying this migration grants nobody access in
-- production, not even users already listed in play_access. Turning the
-- feature on is a deliberate, separate act in the ops Feature Flags tab.
--
-- `enabled_local` TRUE: local dev talks to this same Supabase project, so a
-- single column would force "switch it on in production" as the price of
-- testing. The server-side gate picks the column from the request's Host
-- header, mirroring what src/lib/feature-flags.ts does in the browser.
INSERT INTO feature_flags (key, enabled, enabled_local, label, description)
VALUES (
  'play_enabled',
  false,
  true,
  'Play — prediction market',
  'Master switch for the Play the Next prediction market. Users must ALSO be listed in play_access.'
)
ON CONFLICT (key) DO NOTHING;
