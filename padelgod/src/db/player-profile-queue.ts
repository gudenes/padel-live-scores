import type { SupabaseClient } from '@supabase/supabase-js';

export type QueueMode = 'tournament' | 'ranked' | 'all';

export interface QueueOptions {
  mode: QueueMode;
  limit: number;
  retryAfterDays: number;
  rankCap?: number;
}

export interface QueueRow {
  id: string;
  fip_id: string;
  profile_url: string;
  profile_attempt_at: string | null;
}

interface SnapshotRow {
  fip_id: string;
  tournament_id: string;
}

const TIER_RANKS: Record<string, number> = {
  premier: 1,
  fip_gold: 2,
  fip_silver: 3,
  fip_bronze: 4,
};
const UNKNOWN_TIER_RANK = 5;

export function tierRank(level: string | null | undefined): number {
  if (!level) return UNKNOWN_TIER_RANK;
  return TIER_RANKS[level] ?? UNKNOWN_TIER_RANK;
}

export function pickBestTier(
  snapshots: SnapshotRow[],
  tierByTournament: Map<string, number>,
): Map<string, number> {
  const best = new Map<string, number>();
  for (const s of snapshots) {
    const t = tierByTournament.get(s.tournament_id) ?? UNKNOWN_TIER_RANK;
    const prev = best.get(s.fip_id);
    if (prev === undefined || t < prev) best.set(s.fip_id, t);
  }
  return best;
}

export function computeRetryCutoffIso(days: number, nowMs: number = Date.now()): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

export function rankAndSliceByTier(
  rows: QueueRow[],
  tierByFipId: Map<string, number>,
  limit: number,
): QueueRow[] {
  const sorted = [...rows].sort((a, b) => {
    const ta = tierByFipId.get(a.fip_id) ?? UNKNOWN_TIER_RANK;
    const tb = tierByFipId.get(b.fip_id) ?? UNKNOWN_TIER_RANK;
    if (ta !== tb) return ta - tb;
    if (a.profile_attempt_at === null && b.profile_attempt_at === null) return 0;
    if (a.profile_attempt_at === null) return -1;
    if (b.profile_attempt_at === null) return 1;
    return a.profile_attempt_at.localeCompare(b.profile_attempt_at);
  });
  return sorted.slice(0, limit);
}

/**
 * Fetch the next batch of players to enrich.
 * - tournament: distinct players in entry-list snapshots of active tournaments,
 *   prioritized by tournament tier then attempt_at NULLS FIRST.
 * - ranked: top-N ranked players, attempt_at NULLS FIRST.
 * - all: every fip_id'd player, attempt_at NULLS FIRST.
 */
export async function fetchProfileQueueBatch(
  supabase: SupabaseClient,
  opts: QueueOptions,
): Promise<QueueRow[]> {
  const cutoff = computeRetryCutoffIso(opts.retryAfterDays);

  if (opts.mode === 'tournament') {
    const now = Date.now();
    const upcomingIso = new Date(now + 14 * 86_400_000).toISOString();
    const recentIso = new Date(now - 2 * 86_400_000).toISOString();

    const { data: tours, error: toursErr } = await supabase
      .from('tournaments')
      .select('id, level')
      .lte('starts_at', upcomingIso)
      .gte('ends_at', recentIso);
    if (toursErr) throw new Error(`profile queue: tournaments fetch failed: ${toursErr.message}`);
    if (!tours || tours.length === 0) return [];

    const tierByTournament = new Map<string, number>(
      tours.map((t: { id: string; level: string | null }) => [t.id, tierRank(t.level)]),
    );

    const tournamentIds = tours.map((t: { id: string }) => t.id);
    const { data: snapshots, error: snapErr } = await supabase
      .schema('padelgod')
      .from('entry_list_snapshots')
      .select('fip_id, tournament_id')
      .in('tournament_id', tournamentIds);
    if (snapErr) throw new Error(`profile queue: entry_list_snapshots fetch failed: ${snapErr.message}`);
    if (!snapshots || snapshots.length === 0) return [];

    const tierByFipId = pickBestTier(snapshots as SnapshotRow[], tierByTournament);
    const fipIds = [...tierByFipId.keys()];
    if (fipIds.length === 0) return [];

    const { data: players, error: playersErr } = await supabase
      .from('players')
      .select('id, fip_id, profile_url, profile_attempt_at')
      .in('fip_id', fipIds)
      .not('profile_url', 'is', null)
      .or(`profile_status.is.null,profile_status.neq.permanent_failure`)
      .or(`profile_attempt_at.is.null,profile_attempt_at.lt.${cutoff}`)
      .limit(opts.limit * 3);
    if (playersErr) throw new Error(`profile queue: players fetch failed: ${playersErr.message}`);

    return rankAndSliceByTier((players ?? []) as QueueRow[], tierByFipId, opts.limit);
  }

  if (opts.mode === 'ranked') {
    const cap = opts.rankCap ?? 1000;
    const { data, error } = await supabase
      .from('players')
      .select('id, fip_id, profile_url, profile_attempt_at')
      .not('fip_id', 'is', null)
      .not('profile_url', 'is', null)
      .not('ranking', 'is', null)
      .lte('ranking', cap)
      .or(`profile_status.is.null,profile_status.neq.permanent_failure`)
      .or(`profile_attempt_at.is.null,profile_attempt_at.lt.${cutoff}`)
      .order('profile_attempt_at', { ascending: true, nullsFirst: true })
      .limit(opts.limit);
    if (error) throw new Error(`profile queue (ranked) fetch failed: ${error.message}`);
    return (data ?? []) as QueueRow[];
  }

  // mode === 'all'
  const { data, error } = await supabase
    .from('players')
    .select('id, fip_id, profile_url, profile_attempt_at')
    .not('fip_id', 'is', null)
    .not('profile_url', 'is', null)
    .or(`profile_status.is.null,profile_status.neq.permanent_failure`)
    .or(`profile_attempt_at.is.null,profile_attempt_at.lt.${cutoff}`)
    .order('profile_attempt_at', { ascending: true, nullsFirst: true })
    .limit(opts.limit);
  if (error) throw new Error(`profile queue (all) fetch failed: ${error.message}`);
  return (data ?? []) as QueueRow[];
}
