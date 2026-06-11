-- supabase/migrations/20260611120000_matches_prediction_columns.sql
-- Denormalized "latest" Elo win-probability per match, mirrored from the
-- append-only model_predictions table by the hourly model-prediction-snapshot
-- worker. Lets anon/browser code read the current prediction via the existing
-- (anon-readable) matches row — no new RLS surface, no per-card N+1.
-- pair2 probability is implied as (1 - pred_pair1_prob).
alter table public.matches
  add column if not exists pred_pair1_prob   numeric,        -- 0..1, null = no prediction
  add column if not exists pred_model_version text,
  add column if not exists pred_computed_at  timestamptz;

comment on column public.matches.pred_pair1_prob is
  'Latest Elo model win probability for pair 1 (0..1). Mirror of model_predictions; written by padelgod model-prediction-snapshot. Null when no prediction.';
