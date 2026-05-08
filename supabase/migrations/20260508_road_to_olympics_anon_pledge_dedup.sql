-- supabase/migrations/20260508_road_to_olympics_anon_pledge_dedup.sql
-- Follow-up to 20260508_road_to_olympics_soft_launch.sql.
--
-- The original migration enforces "one pledge per email" via a partial unique
-- index on email WHERE email IS NOT NULL. Anonymous pledges (email = NULL)
-- have no uniqueness constraint, so a script could rotate IPs and inflate
-- the public counter to any number.
--
-- This index limits anonymous pledges to one per ip_hash. ip_hash is computed
-- as sha256(ip + RTO_IP_SALT) on insert, so rotating IPs would still match
-- to the same hash for the same client. (For different clients, hashes
-- differ — so legitimate users on shared NATs/CGNAT can pledge once each
-- under their respective egress IP at the time of submission.)
--
-- Hardening Wave will replace this with proper rate limiting + optional
-- CAPTCHA on the anon path.

CREATE UNIQUE INDEX IF NOT EXISTS idx_rto_pledges_anon_iphash
  ON road_to_olympics_pledges (ip_hash)
  WHERE email IS NULL;
