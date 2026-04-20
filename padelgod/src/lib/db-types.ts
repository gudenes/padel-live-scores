// TypeScript types reflecting Padelgod-relevant fields on Supabase tables.
// Hand-maintained for now — sync with migrations under supabase/migrations/2026042000000*.
// When this gets unwieldy, generate via `supabase gen types typescript`.

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'retired'
  | 'walkover'
  | 'suspended'
  | 'cancelled';

export type LiveSource = 'padelapi' | 'padelgod';

export type LastUpdatedBy = 'padelapi' | 'padelgod' | 'manual';

export interface Tournament {
  id: string;
  public_id: string;
  slug: string | null;
  name: string;
  level: string;
  starts_at: string | null;
  ends_at: string | null;
  live_source: LiveSource;
  uses_golden_point: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: string;
  public_id: string;
  slug: string | null;
  name: string;
  fip_id: string | null;
  country: string | null;
  ranking: number | null;
  points: number | null;
  created_at: string;
  updated_at: string;
}

export interface Match {
  id: string;
  public_id: string;
  status: MatchStatus;
  tournament_id: string;
  serving_player_id: string | null;
  last_updated_by: LastUpdatedBy | null;
  created_at: string;
  updated_at: string;
}

export interface Set {
  id: string;
  public_id: string;
  match_id: string;
  set_number: number;
  set_score: string | null;
  pair1_games: number;
  pair2_games: number;
  is_current: boolean;
  created_at: string;
  updated_at: string;
}

export interface Game {
  id: string;
  public_id: string;
  match_id: string;
  set_id: string;
  game_number: number;
  game_score: string | null;
  is_current: boolean;
  is_tiebreak: boolean;
  server_player_id: string | null;
  winner_pair: number | null;
  created_at: string;
  updated_at: string;
}

export interface MatchPoint {
  id: string;
  public_id: string;
  match_id: string;
  set_id: string;
  game_id: string;
  point_number: number;
  server_player_id: string | null;
  winner_pair: 1 | 2;
  score_after: string;
  is_break_point: boolean;
  is_set_point: boolean;
  is_match_point: boolean;
  is_golden_point: boolean;
  source: 'padelgod' | 'padelapi' | 'inferred';
  created_at: string;
  updated_at: string;
}

// padelgod schema types
export type ScrapeJobType =
  | 'discover'
  | 'widget_id'
  | 'draw'
  | 'oop'
  | 'live'
  | 'tournamentlive'
  | 'rankings'
  | 'profile'
  | 'article'
  | 'youtube'
  | 'match_stats';

export type ScrapeJobStatus = 'queued' | 'running' | 'success' | 'failed';

export interface ScrapeJob {
  id: string;
  job_type: ScrapeJobType;
  tournament_id: string | null;
  target_url: string | null;
  status: ScrapeJobStatus;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  error_message: string | null;
  parser_version: string | null;
}

export interface WidgetIdCacheRow {
  tournament_id: string;
  widget_id: string;
  extracted_at: string;
  last_validated_at: string;
  is_active: boolean;
  extraction_method: 'search' | 'iframe' | 'page_regex' | 'manual';
}

export interface UnresolvedPlayer {
  id: string;
  tournament_id: string;
  widget_short_name: string;
  partner_short_name: string | null;
  match_id: string | null;
  candidate_player_ids: string[] | null;
  first_seen_at: string;
  status: 'pending' | 'resolved' | 'created_new' | 'ignored';
  resolved_player_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

export interface UnresolvedMatch {
  id: string;
  match_id: string;
  tournament_id: string;
  reason: 'point_count_divergence' | 'set_score_mismatch' | 'parser_error' | 'other';
  details: Record<string, unknown>;
  status: 'pending' | 'resolved' | 'ignored';
  first_seen_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}
