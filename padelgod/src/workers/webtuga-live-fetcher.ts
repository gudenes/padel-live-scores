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
 * authoritative final. Never finishes a match. No live-notify in v1.
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
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, category, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
        'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name',
    )
    .eq('tournament_id', tournamentId);
  if (error) throw new Error(`loadCandidates failed: ${error.message}`);
  return (data ?? []).map((m: any) => ({
    id: m.id,
    category: m.category,
    pair1Player1Id: m.pair1_player1_id,
    pair1Player2Id: m.pair1_player2_id,
    pair2Player1Id: m.pair2_player1_id,
    pair2Player2Id: m.pair2_player2_id,
    pair1Player1Name: m.pair1_player1_name,
    pair1Player2Name: m.pair1_player2_name,
    pair2Player1Name: m.pair2_player1_name,
    pair2Player2Name: m.pair2_player2_name,
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

/** Guarded scheduled→live flip. Never regresses live/finished/retired/walkover. */
async function flipStatusToLive(supabase: SupabaseClient, matchId: string): Promise<void> {
  await supabase
    .from('matches')
    .update({ status: 'live' })
    .eq('id', matchId)
    .eq('status', 'scheduled');
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
        const rp = (await loadResolvedPlayers(supabase, entry.matchId)) ?? {
          pair1Player1Id: null, pair1Player2Id: null,
          pair2Player1Id: null, pair2Player2Id: null,
        };
        await applyDiff(supabase, entry.matchId, prev, curr, diff, rp);
        await flipStatusToLive(supabase, entry.matchId);
        await writeLastState(supabase, t.tournamentId, rowItem.id, entry.orientation, curr);
        res.applied++;
      } catch (err) {
        res.errors++;
        logger.warn({ err, webtugaId: rowItem.id, matchId: entry.matchId }, 'webtuga row processing failed');
      }
    }
  }

  logger.info({ ...res }, 'webtuga-live-fetcher tick complete');
  return res;
}
