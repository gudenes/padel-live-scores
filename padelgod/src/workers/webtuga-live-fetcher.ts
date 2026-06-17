/**
 * webtuga-live-fetcher — stateless cron worker that ingests live point-by-point
 * from the ad-hoc webtuga tracker for FIP-tier events configured via an
 * entity_external_ids `source='webtuga_live'` row.
 *
 * Per tick, per tournament:
 *   1. fetch results-feed
 *   2. for each LIVE row: resolve → our match (cache or surname matcher)
 *   3. adapt → LiveMatchState; diff vs persisted lastState; applyDiff
 *   4. flip matches.status scheduled→live (guarded)
 *   5. persist lastState in the cache row metadata
 *
 * Writes sets/games with score_source='live' (lowest priority — applyDiff's
 * canonical mode default) so Crionet's fip-results-writer keeps owning the
 * authoritative final. Never finishes a match. On a genuine scheduled→live
 * flip it fires the existing on-court push (notifyLiveTransition) — the same
 * one the Premier live-poller sends.
 *
 * The adapter THROWS on an unrecognised point label, so the per-row adapt→write
 * block is wrapped in try/catch — one bad feed row must not abort the tick.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchedulerDeps } from '../scheduler.js';
import { diffLiveState } from '../lib/live-state.js';
import { applyDiff, type ResolvedPlayers } from '../lib/point-reconstruction.js';
import { fetchResultsFeed } from '../lib/webtuga-client.js';
import { resolveWebtugaMatch, type CandidateMatch } from '../lib/webtuga-resolve.js';
import { webtugaToLiveState } from '../lib/webtuga-adapter.js';
import { notifyLiveTransition } from '../lib/notify.js';
import {
  discoverWebtugaTournaments,
  loadMatchCache,
  upsertMatchCache,
  writeLastState,
  type MatchCacheEntry,
} from '../lib/webtuga-cache.js';

export interface WebtugaLiveOpts {
  dryRun: boolean;
}

export interface WebtugaLiveResult {
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
async function loadCandidates(
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
      'id, category, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
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

/** Re-derive the four player UUIDs for a match (used on a cache hit). */
async function loadResolvedPlayers(
  supabase: SupabaseClient,
  matchId: string,
): Promise<ResolvedPlayers | null> {
  const { data, error } = await supabase
    .from('matches')
    .select('pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .eq('id', matchId);
  if (error || !data || data.length === 0) return null;
  const row = data[0] as any;
  return {
    pair1Player1Id: row.pair1_player1_id,
    pair1Player2Id: row.pair1_player2_id,
    pair2Player1Id: row.pair2_player1_id,
    pair2Player2Id: row.pair2_player2_id,
  };
}

/**
 * Guarded scheduled→live flip. Never regresses live/finished/retired/walkover.
 * Returns true only when this call actually transitioned the row (the
 * `.eq('status','scheduled')` guard returns rows on the first such tick only),
 * so the caller can fire the on-court push exactly once per match.
 */
async function flipStatusToLive(supabase: SupabaseClient, matchId: string): Promise<boolean> {
  const { data } = await supabase
    .from('matches')
    .update({ status: 'live' })
    .eq('id', matchId)
    .eq('status', 'scheduled')
    .select('id');
  return (data?.length ?? 0) > 0;
}

export async function runWebtugaLiveFetcher(
  deps: SchedulerDeps,
  opts: WebtugaLiveOpts,
): Promise<WebtugaLiveResult> {
  const { supabase, httpClient, logger } = deps;
  const res: WebtugaLiveResult = {
    tournaments: 0, liveSeen: 0, resolved: 0, unresolved: 0,
    ambiguous: 0, applied: 0, errors: 0, dryRun: opts.dryRun,
  };

  const tournaments = await discoverWebtugaTournaments(supabase);
  res.tournaments = tournaments.length;

  for (const t of tournaments) {
    let feed;
    try {
      feed = await fetchResultsFeed(httpClient, t.baseUrl);
    } catch (err) {
      logger.warn({ err, tournament: t.tournamentId }, 'webtuga feed fetch failed');
      continue;
    }

    const live = feed.filter((r) => String(r.status).toLowerCase() === 'live');
    res.liveSeen += live.length;
    if (live.length === 0) continue;

    const cacheMap = await loadMatchCache(supabase, t.tournamentId);
    let candidates: CandidateMatch[] | null = null; // lazy-load only on a cache miss

    for (const rowItem of live) {
      let entry: MatchCacheEntry | undefined = cacheMap.get(rowItem.id);
      // When we resolve a match this tick the matcher hands back the four player
      // UUIDs, so we reuse them directly instead of re-reading the match row.
      // On a cache HIT we don't have them in memory and fall back to a DB read.
      let resolvedFromMatcher: ResolvedPlayers | null = null;

      if (!entry) {
        if (candidates === null) candidates = await loadCandidates(supabase, t.tournamentId);
        const r = resolveWebtugaMatch(rowItem, candidates);
        if (r === null) {
          res.unresolved++;
          logger.warn({ webtugaId: rowItem.id }, 'webtuga match unresolved');
          continue;
        }
        if ('ambiguous' in r) {
          res.ambiguous++;
          logger.warn({ webtugaId: rowItem.id }, 'webtuga match ambiguous');
          continue;
        }
        entry = { matchId: r.matchId, orientation: r.orientation, lastState: null };
        resolvedFromMatcher = r.resolvedPlayers;
        if (!opts.dryRun) {
          await upsertMatchCache(supabase, t.tournamentId, rowItem.id, r.matchId, r.orientation, null);
        }
      }
      res.resolved++;
      if (opts.dryRun) continue;

      try {
        const curr = webtugaToLiveState(rowItem, entry.matchId, entry.orientation);
        const prev = entry.lastState;
        const diff = diffLiveState(prev, curr);
        const rp = resolvedFromMatcher
          ?? (await loadResolvedPlayers(supabase, entry.matchId))
          ?? {
            pair1Player1Id: null, pair1Player2Id: null,
            pair2Player1Id: null, pair2Player2Id: null,
          };
        await applyDiff(supabase, entry.matchId, prev, curr, diff, rp);
        const flipped = await flipStatusToLive(supabase, entry.matchId);
        if (flipped && deps.notify) {
          // Reuse the same on-court push the Premier live-poller fires.
          // Fire-and-forget: returns immediately, never throws.
          notifyLiveTransition(entry.matchId, deps.notify);
        }
        await writeLastState(supabase, t.tournamentId, rowItem.id, entry.orientation, curr);
        res.applied++;
      } catch (err) {
        // A throw here (bad point label, transient DB error, or — if the process
        // died mid-row last tick — a stale `prev` replaying points that were
        // already written) is isolated to this row. applyDiff's match_points
        // UNIQUE(game_id, point_number) makes the replay idempotent: it may log
        // a constraint warn on restart but never double-counts.
        res.errors++;
        logger.warn({ err, webtugaId: rowItem.id, matchId: entry.matchId }, 'webtuga row processing failed');
      }
    }
  }

  logger.info({ ...res }, 'webtuga-live-fetcher tick complete');
  return res;
}
