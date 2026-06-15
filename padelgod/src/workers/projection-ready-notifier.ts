import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { pairSlugFromNames } from '../lib/projection-slug.js';
import { notifyEventAwait, type NotifyDeps, type NotifyEventPayload } from '../lib/notify.js';

const ICON_BASE = 'https://padelnachos.com';
// Mirror of the app's isPremierTier (src/lib/tournament-tier.ts) — circuit-icon fallback only.
function isPremierTier(level: string | null | undefined): boolean {
  if (!level) return false;
  const n = level.toLowerCase();
  return (
    n.startsWith('p1') ||
    n.startsWith('p2') ||
    n.startsWith('major') ||
    n.startsWith('premier')
  );
}
function circuitIcon(level: string | null): string {
  return isPremierTier(level)
    ? `${ICON_BASE}/branding/premier-padel-star.png`
    : `${ICON_BASE}/branding/fip-tour-icon.png`;
}
function surname(name: string): string {
  const t = name.trim().split(/\s+/);
  // noUncheckedIndexedAccess: t is always non-empty (split on a string always yields ≥1 element).
  // Use length > 0 guard + non-null assertion to satisfy tsc without altering behaviour.
  return (t.length > 0 ? t[t.length - 1]! : name) || name;
}

export type ProjCategory = 'men' | 'women';
export interface ActiveTournament { id: string; name: string; level: string | null }
export interface ProjectionPairRow {
  tournament_id: string;
  category: ProjCategory;
  pair_key: string;
  pair_player_ids: string[];
  champion_prob: number;
}
export interface PlayerLite { id: string; name: string; avatar_url: string | null }
export interface Candidate { tournamentId: string; category: ProjCategory }

/** (tournament,category) that have projection rows, are active, and unclaimed. */
export function selectProjectionCandidates(
  active: ActiveTournament[],
  pairs: ProjectionPairRow[],
  claimed: Set<string>,
): Candidate[] {
  const activeIds = new Set(active.map((t) => t.id));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const p of pairs) {
    if (!activeIds.has(p.tournament_id)) continue;
    const key = `${p.tournament_id}:${p.category}`;
    if (claimed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ tournamentId: p.tournament_id, category: p.category });
  }
  return out;
}

/** Ordered NotifyEventPayloads for one claimed (tournament,category). */
export function buildProjectionPayloads(
  candidate: Candidate,
  tournament: ActiveTournament,
  allPairs: ProjectionPairRow[],
  playersById: Record<string, PlayerLite>,
): NotifyEventPayload[] {
  const pairs = allPairs
    .filter((p) => p.tournament_id === candidate.tournamentId && p.category === candidate.category)
    // stable sort (Node ≥12) → equal-prob pairs keep input order; firing order drives the per-user "top pair" dedup.
    .sort((a, b) => b.champion_prob - a.champion_prob);

  const dedupeKey = `projection_ready:tournament:${candidate.tournamentId}`;
  const title = `Predictions for ${tournament.name} are ready`;
  const out: NotifyEventPayload[] = [];

  for (const pair of pairs) {
    const lookups = pair.pair_player_ids.map((id) => playersById[id]);
    if (lookups.some((p) => !p?.name)) continue;  // skip pairs we can't name (orphan/data gap)
    const slugPlayers = pair.pair_player_ids.map((id) => ({ id, name: playersById[id]!.name }));
    const slug = pairSlugFromNames(slugPlayers);
    const label = slugPlayers.map((p) => surname(p.name)).join(' / ');
    const body = `See ${label}'s road to the title →`;
    const url = `/tournaments/${candidate.tournamentId}/projection/${slug}`;
    for (const id of pair.pair_player_ids) {
      const player = playersById[id];
      out.push({
        category: 'projection_ready',
        entityType: 'player',
        entityId: id,
        title,
        body,
        url,
        icon: player?.avatar_url ?? circuitIcon(tournament.level),
        metadata: { tournament_id: candidate.tournamentId, category: candidate.category, pair_key: pair.pair_key, player_id: id },
        dedupeKey,
      });
    }
  }
  return out;
}

export interface ProjectionReadyNotifierDeps {
  supabase: SupabaseClient;
  logger: Logger;
  notify?: NotifyDeps;
}
export interface ProjectionReadyNotifierResult { claimed: number; pushed: number }

const FINISHED = ['finished', 'completed'];

export async function runProjectionReadyNotifier(
  deps: ProjectionReadyNotifierDeps,
): Promise<ProjectionReadyNotifierResult> {
  const { supabase, logger } = deps;
  const notifyDeps: NotifyDeps = deps.notify ?? { baseUrl: undefined, cronSecret: undefined, logger };

  // 1. Active (non-finished) tournaments.
  const { data: tRows, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, level, status')
    // keep null-status tournaments (null ≠ finished); exclude only finished/completed.
    .or(`status.is.null,status.not.in.(${FINISHED.join(',')})`);
  if (tErr) { logger.warn({ err: tErr.message }, '[projection-ready-notifier] tournaments read failed'); return { claimed: 0, pushed: 0 }; }
  const active: ActiveTournament[] = (tRows ?? [])
    .filter((t) => t.name)
    .map((t) => ({ id: t.id as string, name: t.name as string, level: (t.level as string | null) ?? null }));
  if (active.length === 0) return { claimed: 0, pushed: 0 };
  const activeIds = active.map((t) => t.id);
  const tournamentById = new Map(active.map((t) => [t.id, t]));

  // 2. Projection pairs for active tournaments + existing claims.
  const [pairsRes, claimsRes] = await Promise.all([
    supabase.from('tournament_projections')
      .select('tournament_id, category, pair_key, pair_player_ids, champion_prob')
      .in('tournament_id', activeIds),
    supabase.from('projection_ready_notifications')
      .select('tournament_id, category')
      .in('tournament_id', activeIds),
  ]);
  if (pairsRes.error) { logger.warn({ err: pairsRes.error.message }, '[projection-ready-notifier] projections read failed'); return { claimed: 0, pushed: 0 }; }
  if (claimsRes.error) logger.warn({ err: claimsRes.error.message }, '[projection-ready-notifier] claims read failed — assuming empty, upsert will guard');
  const pairs = (pairsRes.data ?? []) as ProjectionPairRow[];
  const claimed = new Set((claimsRes.data ?? []).map((r) => `${r.tournament_id}:${r.category}`));

  const candidates = selectProjectionCandidates(active, pairs, claimed);
  if (candidates.length === 0) return { claimed: 0, pushed: 0 };

  // Player identity for all pair players across candidates (chunked .in()).
  const candidateIds = new Set(candidates.map((c) => c.tournamentId));
  const playerIds = [...new Set(
    pairs.filter((p) => candidateIds.has(p.tournament_id)).flatMap((p) => p.pair_player_ids),
  )];
  const playersById: Record<string, PlayerLite> = {};
  for (let i = 0; i < playerIds.length; i += 200) {
    const { data: pl } = await supabase.from('players').select('id, name, avatar_url').in('id', playerIds.slice(i, i + 200));
    for (const p of pl ?? []) playersById[p.id as string] = { id: p.id as string, name: (p.name as string | null) ?? (p.id as string), avatar_url: (p.avatar_url as string | null) ?? null };
  }

  let claimedCount = 0;
  let pushed = 0;
  for (const cand of candidates) {
    // 3. Atomic claim — only proceed if WE inserted the row.
    const { data: claimRow, error: claimErr } = await supabase
      .from('projection_ready_notifications')
      .upsert({ tournament_id: cand.tournamentId, category: cand.category }, { onConflict: 'tournament_id,category', ignoreDuplicates: true })
      .select('tournament_id');
    if (claimErr) { logger.warn({ ...cand, err: claimErr.message }, '[projection-ready-notifier] claim failed'); continue; }
    if (!claimRow || claimRow.length === 0) continue;  // already claimed by an overlapping tick
    claimedCount++;

    // 4. Fan out — sequential, champion% desc, tournament-scoped dedupe.
    const tournament = tournamentById.get(cand.tournamentId);
    if (!tournament) continue;  // impossible (candidate came from active), guarded defensively
    const payloads = buildProjectionPayloads(cand, tournament, pairs, playersById);
    for (const payload of payloads) {
      const res = await notifyEventAwait(payload, notifyDeps);
      if (res.ok) pushed++;
    }
    logger.info({ ...cand, payloads: payloads.length }, '[projection-ready-notifier] fired');
  }
  return { claimed: claimedCount, pushed };
}
