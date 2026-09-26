/**
 * padeldev-live-fetcher — stateless cron worker that ingests live
 * point-by-point from the padeldev feed behind FIP's `Live Score` tab, for
 * tournaments seeded via an entity_external_ids `source='padeldev_live'` row.
 *
 * Why this exists: FIP Platinum Lyon 2026's Live Score tab moved to a new
 * vendor, and Crionet's tournamentlive endpoint reports no live matches for it.
 * Our UI already treats fip_platinum as a point-by-point tier, so without this
 * the match page shows a LIVE pill with nothing behind it.
 *
 * Per tick, per tournament:
 *   1. fetch the tournament feed
 *   2. select unfinished, started matches
 *   3. fetch each per-match feed, SKIPPING any whose `lastupdate` is unchanged
 *   4. resolve → our match (cache, else surname matcher)
 *   5. adapt → LiveMatchState; diff vs persisted lastState; applyDiff
 *   6. guarded scheduled→live flip; fire the on-court push exactly once
 *   7. persist lastState + lastupdate on the cache row
 *
 * Writes sets/games/match_points with score_source='live' (applyDiff's
 * canonical-mode default, the lowest priority) so Crionet's fip-results-writer
 * keeps owning the authoritative final. NEVER finishes a match — `winningteam`
 * and `retiredteam` are read but not acted upon.
 *
 * The adapter THROWS on a malformed score or point label, so the per-match
 * adapt→write block is wrapped in try/catch: one bad row must not abort a tick.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchedulerDeps } from '../scheduler.js';
import { diffLiveState } from '../lib/live-state.js';
import { applyDiff, type ResolvedPlayers } from '../lib/point-reconstruction.js';
import { fetchMatchFeed, fetchTournamentFeed } from '../lib/padeldev-client.js';
import { flattenTournamentFeed, selectLiveEntries } from '../lib/padeldev-feed.js';
import { resolvePadeldevMatch, type CandidateMatch } from '../lib/padeldev-resolve.js';
import { padeldevToLiveState } from '../lib/padeldev-adapter.js';
import { notifyLiveTransition } from '../lib/notify.js';
import {
  discoverPadeldevTournaments,
  loadMatchCache,
  upsertMatchCache,
  writeLastState,
  type MatchCacheEntry,
} from '../lib/padeldev-cache.js';

export interface PadeldevLiveOpts {
  dryRun: boolean;
}

export interface PadeldevLiveResult {
  tournaments: number;
  liveSeen: number;
  /** Per-match feeds skipped because `lastupdate` had not moved. */
  unchanged: number;
  resolved: number;
  unresolved: number;
  ambiguous: number;
  applied: number;
  errors: number;
  dryRun: boolean;
}

/** Load the tournament's matches as resolver candidates, with player names. */
async function loadCandidates(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<CandidateMatch[]> {
  // Names come from the players FK (canonical), with the matches.pair*_name
  // snapshot columns as fallback — on FK-resolved draw matches the snapshot
  // columns are mostly NULL, so resolving against them alone would miss most
  // matches.
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
  // Embedded joins come back as an object or a 1-element array depending on
  // cardinality hints — normalize both to a name string.
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
 * Returns true only on the tick that actually transitioned the row, so the
 * caller fires the on-court push exactly once per match.
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

export async function runPadeldevLiveFetcher(
  deps: SchedulerDeps,
  opts: PadeldevLiveOpts,
): Promise<PadeldevLiveResult> {
  const { supabase, httpClient, logger } = deps;
  const res: PadeldevLiveResult = {
    tournaments: 0, liveSeen: 0, unchanged: 0, resolved: 0,
    unresolved: 0, ambiguous: 0, applied: 0, errors: 0, dryRun: opts.dryRun,
  };

  const tournaments = await discoverPadeldevTournaments(supabase);
  res.tournaments = tournaments.length;

  for (const t of tournaments) {
    let feed;
    try {
      feed = await fetchTournamentFeed(httpClient, t.key);
    } catch (err) {
      logger.warn({ err, tournament: t.tournamentId }, 'padeldev tournament feed fetch failed');
      continue;
    }
    if (!feed) {
      logger.warn({ tournament: t.tournamentId }, 'padeldev tournament feed empty');
      continue;
    }

    const live = selectLiveEntries(flattenTournamentFeed(feed));
    res.liveSeen += live.length;
    if (live.length === 0) continue;

    const cacheMap = await loadMatchCache(supabase, t.tournamentId);
    let candidates: CandidateMatch[] | null = null; // lazy — only on a cache miss

    for (const item of live) {
      let entry: MatchCacheEntry | undefined = cacheMap.get(item.matchRef);
      // When the matcher resolves a match this tick it hands back the four
      // player UUIDs, so we reuse them instead of re-reading the match row.
      let resolvedFromMatcher: ResolvedPlayers | null = null;

      if (!entry) {
        if (candidates === null) candidates = await loadCandidates(supabase, t.tournamentId);
        const r = resolvePadeldevMatch(item.entry, candidates);
        if (r === null) {
          res.unresolved++;
          logger.warn(
            { matchRef: item.matchRef, court: item.court, category: item.entry.category },
            'padeldev match unresolved',
          );
          continue;
        }
        if ('ambiguous' in r) {
          res.ambiguous++;
          logger.warn({ matchRef: item.matchRef, court: item.court }, 'padeldev match ambiguous');
          continue;
        }
        entry = {
          matchId: r.matchId, orientation: r.orientation,
          lastState: null, lastUpdate: null,
        };
        resolvedFromMatcher = r.resolvedPlayers;
        if (!opts.dryRun) {
          await upsertMatchCache(
            supabase, t.tournamentId, item.matchRef,
            r.matchId, r.orientation, null, null,
          );
        }
      }
      res.resolved++;
      if (opts.dryRun) continue;

      try {
        const detail = await fetchMatchFeed(httpClient, item.matchRef);
        if (!detail) {
          logger.warn({ matchRef: item.matchRef }, 'padeldev match feed empty');
          continue;
        }
        // The feed only moves `lastupdate` when the match state actually
        // changes, so an unchanged value means there is nothing to diff.
        const lastUpdate = Number(detail.lastupdate);
        if (entry.lastUpdate != null && lastUpdate === entry.lastUpdate) {
          res.unchanged++;
          continue;
        }

        const curr = padeldevToLiveState(detail, entry.matchId, entry.orientation);
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
          // Same on-court push the Premier live-poller fires.
          // Fire-and-forget: returns immediately, never throws.
          notifyLiveTransition(entry.matchId, deps.notify);
        }
        await writeLastState(
          supabase, t.tournamentId, item.matchRef,
          entry.orientation, curr, lastUpdate,
        );
        res.applied++;
      } catch (err) {
        // A throw here (malformed score, transient DB error, or — if the
        // process died mid-row last tick — a stale `prev` replaying points
        // already written) is isolated to this match. applyDiff's
        // match_points UNIQUE(game_id, point_number) makes the replay
        // idempotent: it may warn on restart but never double-counts.
        res.errors++;
        logger.warn(
          { err, matchRef: item.matchRef, matchId: entry.matchId },
          'padeldev match processing failed',
        );
      }
    }
  }

  logger.info({ ...res }, 'padeldev-live-fetcher tick complete');
  return res;
}
