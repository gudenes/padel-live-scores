-- feature_flags: add per-environment toggle.
--
-- `enabled` retained as the production-environment switch. New
-- `enabled_local` mirrors it for localhost dev — both controlled
-- from the same ops UI but resolved differently at runtime
-- (hostname=localhost → enabled_local, else enabled).

BEGIN;

ALTER TABLE feature_flags
  ADD COLUMN IF NOT EXISTS enabled_local BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN feature_flags.enabled IS 'On/off in production (any host that is not localhost).';
COMMENT ON COLUMN feature_flags.enabled_local IS 'On/off in local dev (window.location.hostname = localhost / 127.0.0.1). Lets us polish a feature locally while it stays dark in prod.';

COMMIT;
