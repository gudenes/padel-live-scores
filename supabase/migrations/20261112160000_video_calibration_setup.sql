-- Saved calibration is separate from immutable analysis job inputs.
alter table public.match_video_uploads add column if not exists calibration_setup jsonb;
