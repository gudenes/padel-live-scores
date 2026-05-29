-- Supabase cost Pass 1: dedup state for padelgod.raw_payloads.
-- One row per active scrape target (job_type, target_url). The scrape
-- pipeline consults this to skip storing a body identical to the
-- target's last stored body (with a heartbeat re-store every N days).
-- Bounded: a few thousand rows; never grows with scrape history.

CREATE TABLE padelgod.raw_payload_latest (
  job_type          TEXT NOT NULL,
  target_url        TEXT NOT NULL,
  tournament_id     UUID,                 -- informational only, not in key
  last_content_hash TEXT NOT NULL,
  last_stored_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (job_type, target_url)
);

COMMENT ON TABLE padelgod.raw_payload_latest IS
  'Dedup state for raw_payloads. Latest stored content_hash + timestamp per (job_type, target_url). Written by runScrapeJob when it stores a body.';
