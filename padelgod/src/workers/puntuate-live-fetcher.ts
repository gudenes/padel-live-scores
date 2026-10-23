/** Puntuate live scoreboard ingestion, following the Webtuga diff/apply pipeline.
 * Only live rows are written; FIP continues to own authoritative final results.
 * Cached identities are revalidated each tick and dry-run also validates scores.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchedulerDeps } from '../scheduler.js';
import { diffLiveState } from '../lib/live-state.js';
import { applyDiff, type ResolvedPlayers } from '../lib/point-reconstruction.js';
import { fetchResultsFeed } from '../lib/puntuate-client.js';
import { resolvePuntuateMatch, type CandidateMatch } from '../lib/puntuate-resolve.js';
import { puntuateToLiveState } from '../lib/puntuate-adapter.js';
import { notifyLiveTransition } from '../lib/notify.js';
import {
  discoverPuntuateTournaments,
  loadMatchCache,
  upsertMatchCache,
  writeLastState,
  type MatchCacheEntry,
} from '../lib/puntuate-cache.js';

export interface PuntuateLiveOpts {
  dryRun: boolean;
}

export interface PuntuateLiveResult {
  tournaments: number;
  liveSeen: number;
  resolved: number;
  unresolved: number;
  ambiguous: number;
  applied: number;
  errors: number;
  dryRun: boolean;
}

/** Load the tournament's matches as resolver candidates (with player names). */
export async function loadCandidates(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<CandidateMatch[]> {
  // Names come from the players FK (canonical), with the matches.pair*_name
  // snapshot columns as a fallback. For FK-resolved draw matches the snapshot
  // columns are mostly NULL — the real names live in `players` — so resolving
  // against the snapshot alone would miss ~96% of matches.
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, category, status, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
        'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name, ' +
        'p11:players!matches_pair1_player1_id_fkey(name), ' +
        'p12:players!matches_pair1_player2_id_fkey(name), ' +
        'p21:players!matches_pair2_player1_id_fkey(name), ' +
        'p22:players!matches_pair2_player2_id_fkey(name)',
    )
    .eq('tournament_id', tournamentId);
  if (error) throw new Error(`loadCandidates failed: ${error.message}`);
  // Embedded joins return either an object or a 1-element array depending on
  // schema cardinality hints — normalize both to a name string.
  const joinName = (p: unknown): string | null => {
    if (!p) return null;
    if (Array.isArray(p)) return (p[0] as { name?: string | null })?.name ?? null;
    return (p as { name?: string | null }).name ?? null;
  };
  return (data ?? []).map((m: any) => ({
    id: m.id,
    status: m.status,
    category: m.category,
    pair1Player1Id: m.pair1_player1_id,
    pair1Player2Id: m.pair1_player2_id,
    pair2Player1Id: m.pair2_player1_id,
    pair2Player2Id: m.pair2_player2_id,
    pair1Player1Name: joinName(m.p11) ?? m.pair1_player1_name,
    pair1Player2Name: joinName(m.p12) ?? m.pair1_player2_name,
    pair2Player1Name: joinName(m.p21) ?? m.pair2_player1_name,
    pair2Player2Name: joinName(m.p22) ?? m.pair2_player2_name,
  }));
}

/**
 * Guarded scheduled→live flip. Never regresses live/finished/retired/walkover.
 * Returns true only when this call actually transitioned the row (the
 * `.eq('status','scheduled')` guard returns rows on the first such tick only),
 * so the caller can fire the on-court push exactly once per match.
 */
async function flipStatusToLive(supabase: SupabaseClient, matchId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('matches')
    .update({ status: 'live' })
    .eq('id', matchId)
    .eq('status', 'scheduled')
    .select('id');
  if (error) throw new Error(`live status update failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function runPuntuateLiveFetcher(
  deps: SchedulerDeps,
  opts: PuntuateLiveOpts,
): Promise<PuntuateLiveResult> {
  const { supabase, httpClient, logger } = deps;
  const res: PuntuateLiveResult = {
    tournaments: 0, liveSeen: 0, resolved: 0, unresolved: 0,
    ambiguous: 0, applied: 0, errors: 0, dryRun: opts.dryRun,
  };

  const tournaments = await discoverPuntuateTournaments(supabase);
  res.tournaments = tournaments.length;

  for (const t of tournaments) {
    let feed;
    try {
      feed = await fetchResultsFeed(httpClient, t.baseUrl);
    } catch (err) {
      logger.warn({ err, tournament: t.tournamentId }, 'puntuate feed fetch failed');
      res.errors++;
      continue;
    }

    const live = feed.filter((r) => String(r.status).toLowerCase() === 'live');
    res.liveSeen += live.length;
    if (live.length === 0) continue;

    const cacheMap = await loadMatchCache(supabase, t.tournamentId);
    const candidates = await loadCandidates(supabase, t.tournamentId);

    for (const rowItem of live) {
      let entry: MatchCacheEntry;
      let resolvedFromMatcher: ResolvedPlayers;

      try { // Revalidate cached identities and terminal status on every tick.
        const r = resolvePuntuateMatch(rowItem, candidates);
        if (r === null) {
          res.unresolved++;
          logger.warn({ puntuateId: rowItem.id }, 'puntuate match unresolved');
          continue;
        }
        if ('ambiguous' in r) {
          res.ambiguous++;
          logger.warn({ puntuateId: rowItem.id }, 'puntuate match ambiguous');
          continue;
        }
        const cached = cacheMap.get(r.matchId);
        entry = { matchId: r.matchId, orientation: r.orientation, lastState: cached?.orientation === r.orientation ? cached.lastState : null };
        resolvedFromMatcher = r.resolvedPlayers;
        if (!opts.dryRun) {
          await upsertMatchCache(supabase, t.tournamentId, r.matchId, r.matchId, r.orientation, entry.lastState);
        }
      } catch (err) {
        res.errors++;
        logger.warn({ err, puntuateId: rowItem.id }, 'puntuate resolution failed');
        continue;
      }
      res.resolved++;
      try {
        // Explicit live presence is authoritative even before the scoreboard
        // appears. Do not manufacture 0-0 sets or reset a previously cached score.
        if (rowItem.setsA.length === 0 && rowItem.setsB.length === 0) {
          if (opts.dryRun) continue;
          const flipped = await flipStatusToLive(supabase, entry.matchId);
          if (flipped && deps.notify) notifyLiveTransition(entry.matchId, deps.notify);
          res.applied++;
          continue;
        }
        const curr = puntuateToLiveState(rowItem, entry.matchId, entry.orientation);
        if (opts.dryRun) continue;
        const prev = entry.lastState;
        const diff = diffLiveState(prev, curr);
        await applyDiff(supabase, entry.matchId, prev, curr, diff, resolvedFromMatcher);
        const flipped = await flipStatusToLive(supabase, entry.matchId);
        if (flipped && deps.notify) {
          // Reuse the same on-court push the Premier live-poller fires.
          // Fire-and-forget: returns immediately, never throws.
          notifyLiveTransition(entry.matchId, deps.notify);
        }
        await writeLastState(supabase, t.tournamentId, entry.matchId, entry.orientation, curr);
        res.applied++;
      } catch (err) {
        // A throw here (bad point label, transient DB error, or — if the process
        // died mid-row last tick — a stale `prev` replaying points that were
        // already written) is isolated to this row. applyDiff's match_points
        // UNIQUE(game_id, point_number) makes the replay idempotent: it may log
        // a constraint warn on restart but never double-counts.
        res.errors++;
        logger.warn({ err, puntuateId: rowItem.id, matchId: entry.matchId }, 'puntuate row processing failed');
      }
    }
  }

  logger.info({ ...res }, 'puntuate-live-fetcher tick complete');
  return res;
}
