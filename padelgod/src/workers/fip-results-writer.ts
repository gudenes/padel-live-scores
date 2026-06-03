import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { parseSetScores } from './static-reconciler.js';
import { computeFinishedAtFallback } from '../lib/match-time-stamps.js';
import { paginatedSelect } from '../lib/db-paginate.js';
import { activeTournamentArgs } from '../lib/active-tournament-args.js';

/**
 * fip-results-writer — simplified-pipeline writer #3.
 *
 * Reads `padelgod.results_snapshots` (populated by `results-fetcher`
 * every hour at :55) and UPDATEs `public.matches` status / winner_pair
 * + UPSERTs `public.sets` rows for composite-keyed matches (created by
 * `fip-draw-populator`).
 *
 * One job only
 * ------------
 * - Composite lookup per tournament (batched prefix query)
 * - UPDATE matches.status, winner_pair, duration (if provided)
 * - UPDATE matches.finished_at NULL-only (live-poller's precise stamp
 *   wins when it got there first)
 * - UPSERT public.sets rows from parsed `set_scores` string
 *
 * Terminal-status regression guard
 * --------------------------------
 * Only flips status when current is in {'scheduled', 'on_court',
 * 'live'}. Protects against the "live→finished in-flight" race
 * observed on Brussels 2026-04-23: results widget briefly reports
 * status='live' during the transition, and without this guard the
 * writer could flip a completed match back to 'live' while keeping
 * finished_at set. Same guard the legacy reconciler uses.
 *
 * What this writer does NOT touch
 * -------------------------------
 * - pair_player_ids (populator owns)
 * - court, court_order (oop-writer owns)
 * - scheduled_at (padelapi narrow sync owns)
 * - Matches keyed by synthetic composite (widget_id_composite NULL;
 *   invisible to the LIKE lookup)
 * - `public.games` (point-by-point level — out of scope for V1; the
 *   live-poller and padelapi Pusher relay remain sources for that)
 *
 * Parallel-safety during migration
 * --------------------------------
 *   - ENABLE_FIP_RESULTS_WRITER=false   ← default
 *   - FIP_RESULTS_WRITER_DRY_RUN=true   ← default
 *   - Cron :57 — runs after results-fetcher (:55). Independent of
 *     reconciler's :05/:35.
 */

export interface FipResultsWriterDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** When true (default), log proposed writes but don't actually write. */
  dryRun: boolean;
  /** When set, only tournaments whose UUID is in the allowlist are
   *  processed. Used by the on-demand refresh endpoint. */
  onlyTournamentIds?: Set<string>;
}

export interface FipResultsWriterResult {
  tournamentsProcessed: number;
  tournamentsSkippedNoWidget: number;
  resultsRowsConsidered: number;
  matchesUpdated: number;
  setsWritten: number;
  finishedAtBackfilled: number;
  /** Matches resolved through the entity_external_ids sidecar because the
   *  widget_id_composite hot column was NULL (prefix lookup missed them). */
  resolvedViaSidecar: number;
  skippedNoMatch: number;
  skippedTerminalStatus: number;
  skippedNoWidgetId: number;
  dryRun: boolean;
}

interface TournamentRow {
  tournament_id: string;
  tournament_name: string;
  slug: string;
}

interface ResultsRow {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women';
  day_number: number;
  round_label: string | null;
  court: string | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  set_scores: string | null;
  winner_team: 1 | 2 | null;
  status: 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

interface ExistingMatch {
  id: string;
  widget_id_composite: string;
  status: string | null;
  winner_pair: number | null;
  duration: string | null;
  finished_at: string | null;
  started_at: string | null;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFipResultsWriter(
  deps: FipResultsWriterDeps
): Promise<FipResultsWriterResult> {
  const { supabase, logger, dryRun } = deps;

  const result: FipResultsWriterResult = {
    tournamentsProcessed: 0,
    tournamentsSkippedNoWidget: 0,
    resultsRowsConsidered: 0,
    matchesUpdated: 0,
    setsWritten: 0,
    finishedAtBackfilled: 0,
    resolvedViaSidecar: 0,
    skippedNoMatch: 0,
    skippedTerminalStatus: 0,
    skippedNoWidgetId: 0,
    dryRun,
  };

  const { data: tours, error: toursErr } = await supabase.rpc(
    'padelgod_active_tournaments_with_slug',
    activeTournamentArgs(deps.onlyTournamentIds),
  );
  if (toursErr) {
    throw new Error(
      `padelgod_active_tournaments_with_slug RPC failed: ${toursErr.message}`
    );
  }
  const allTournaments = (tours ?? []) as TournamentRow[];
  const tournaments = deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0
    ? allTournaments.filter((t) => deps.onlyTournamentIds!.has(t.tournament_id))
    : allTournaments;

  const tournamentStartsAt = await loadTournamentStartsAt(
    supabase,
    tournaments.map((t) => t.tournament_id),
  );

  for (const t of tournaments) {
    const tournamentWidgetId = await getActiveWidgetIdCode(
      supabase,
      t.tournament_id
    );
    if (!tournamentWidgetId) {
      result.tournamentsSkippedNoWidget += 1;
      continue;
    }

    const latestResults = await loadLatestResultsRows(
      supabase,
      t.tournament_id
    );
    if (latestResults.length === 0) continue;

    result.tournamentsProcessed += 1;
    const startsAtIso = tournamentStartsAt.get(t.tournament_id) ?? null;

    const compositePrefix = `${tournamentWidgetId}:`;
    const matchByComposite = await loadExistingMatchesByPrefix(
      supabase,
      compositePrefix
    );

    for (const r of latestResults) {
      result.resultsRowsConsidered += 1;

      if (!r.match_widget_id) {
        result.skippedNoWidgetId += 1;
        continue;
      }

      const composite = `${tournamentWidgetId}:${r.match_widget_id}`;
      let existing = matchByComposite.get(composite);

      // Sidecar fallback. The prefix lookup only sees rows whose
      // widget_id_composite hot column is set. A match can carry the
      // crionet_widget mapping in entity_external_ids while the column is
      // still NULL (created/linked via match-identifier's live/twin/pairs
      // path). Resolve through the sidecar and backfill the column so the
      // next run hits the fast path. See 2026-05-31 ITALY MAJOR Q1 incident.
      if (!existing) {
        const viaSidecar = await resolveMatchViaSidecar(supabase, composite);
        if (viaSidecar) {
          existing = viaSidecar;
          result.resolvedViaSidecar += 1;
          if (!dryRun) {
            await backfillCompositeColumn(supabase, viaSidecar.id, composite);
          }
        }
      }

      if (!existing) {
        result.skippedNoMatch += 1;
        continue;
      }

      // Terminal-status regression guard. See docblock.
      const currentStatus = existing.status ?? 'scheduled';
      if (!['scheduled', 'on_court', 'live'].includes(currentStatus)) {
        result.skippedTerminalStatus += 1;
        continue;
      }

      const nowIso = new Date().toISOString();

      // Build match UPDATE patch
      const matchPatch: Record<string, unknown> = {
        status: r.status,
        winner_pair: r.winner_team,
        last_updated_by: 'padelgod',
        updated_at: nowIso,
      };

      // Backfill finished_at NULL-only. live-poller's precise stamp
      // wins when present. Fallback: started_at+duration → tournament day
      // cursor → captured_at. See computeFinishedAtFallback docblock.
      if (existing.finished_at === null) {
        const finishedAt = computeFinishedAt(existing, r.captured_at, {
          dayNumber: r.day_number,
          tournamentStartsAtIso: startsAtIso,
        });
        if (finishedAt) {
          matchPatch.finished_at = finishedAt;
          result.finishedAtBackfilled += 1;
        }
      }

      if (dryRun) {
        logger?.info(
          { composite, matchId: existing.id, matchPatch, setsCount: (r.set_scores ? parseSetScores(r.set_scores).length : 0) },
          'fip-results-writer [dry-run]: would UPDATE match + UPSERT sets'
        );
      } else {
        const { error: updErr } = await supabase
          .from('matches')
          .update(matchPatch)
          .eq('id', existing.id)
          .in('status', ['scheduled', 'on_court', 'live']);
        if (updErr) {
          throw new Error(
            `matches update failed (id=${existing.id}, results widget=${r.match_widget_id}): ${updErr.message}`
          );
        }
      }
      result.matchesUpdated += 1;

      // UPSERT sets
      if (r.set_scores) {
        const parsedSets = parseSetScores(r.set_scores);
        for (const s of parsedSets) {
          const row = {
            match_id: existing.id,
            set_number: s.set_number,
            set_score: s.set_score,
            pair1_games: s.pair1_games,
            pair2_games: s.pair2_games,
            is_current: false,
            score_source: 'api',
            updated_at: nowIso,
          };
          if (dryRun) {
            // already logged above in aggregate
          } else {
            const { error: sUpErr } = await supabase
              .from('sets')
              .upsert(row, { onConflict: 'match_id,set_number' });
            if (sUpErr) {
              throw new Error(
                `sets upsert failed (match=${existing.id}, set=${s.set_number}): ${sUpErr.message}`
              );
            }
          }
          result.setsWritten += 1;
        }
      }
    }
  }

  logger?.info(result, 'fip-results-writer run complete');
  return result;
}

// ── Helpers (exported for testing) ─────────────────────────────────────

/**
 * Resolve the timestamp to stamp as finished_at when live-poller didn't
 * handle this match (the usual case for non-Premier tournaments).
 *
 * Delegates to {@link computeFinishedAtFallback}; see that helper's docblock
 * for the full priority chain (started_at+duration → tournament day cursor →
 * captured_at).
 */
export function computeFinishedAt(
  existing: { started_at: string | null; duration: string | null },
  capturedAt: string,
  dayContext?: { dayNumber: number | null; tournamentStartsAtIso: string | null },
): string {
  return computeFinishedAtFallback(
    existing.started_at,
    existing.duration,
    capturedAt,
    dayContext
      ? {
          dayNumber: dayContext.dayNumber,
          tournamentStartsAtIso: dayContext.tournamentStartsAtIso,
        }
      : undefined,
  );
}

// ── DB helpers ─────────────────────────────────────────────────────────

async function getActiveWidgetIdCode(
  supabase: SupabaseClient,
  tournamentId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .select('widget_id')
    .eq('tournament_id', tournamentId)
    .eq('is_active', true)
    .maybeSingle();
  if (error) {
    throw new Error(
      `widget_id_cache read failed (tournament=${tournamentId}): ${error.message}`
    );
  }
  return (data?.widget_id as string | undefined) ?? null;
}

/**
 * How far back (hours) `loadLatestResultsRows` looks. Bounds the scan so
 * tournaments with a tall snapshot history (results-fetcher writes ~80
 * widgets × 288 ticks/day) don't blow the PostgREST statement timeout.
 * Any match that needs the writer's attention has by definition had a
 * recent snapshot — the terminal-status regression guard makes older
 * already-applied snapshots no-ops anyway.
 */
const RESULTS_LOOKBACK_HOURS = 24;

async function loadLatestResultsRows(
  supabase: SupabaseClient,
  tournamentId: string
): Promise<ResultsRow[]> {
  // Pagination + recent-window filter are required: per-tournament
  // `results_snapshots` rows accumulate at ~80 widgets × 288 ticks/day,
  // so a multi-day tournament holds 50k–100k rows. Two problems land on
  // top of each other:
  //
  //   1. PostgREST's `db_max_rows` cap (10k) silently truncates any
  //      unranged read. Without an ORDER BY the returned slice is
  //      roughly insertion order (oldest first) — for long events that
  //      means the LATEST captures (today's Finals) are exactly what
  //      gets dropped, and the dedup-by-widget Map below never sees the
  //      terminal row. FIP BRONZE LATINA 2026-05-24 hit this on the
  //      men's Final retirement (21k+ rows at the time).
  //   2. Even with pagination, sorting captured_at DESC across the full
  //      table requires a full scan + sort and exceeds Supabase's
  //      statement timeout on the biggest tournaments (FIP BRONZE
  //      YOGYAKARTA was at 66k+ rows in the same incident).
  //
  // The recent-window filter (captured_at >= now() - 24h) bounds the
  // scan to a few hundred rows per tournament and plays nicely with
  // `idx_results_snap_recent (captured_at DESC)`. See CLAUDE.md →
  // "PostgREST 10k cap" for the project policy, and
  // `fip-oop-writer.ts::loadLatestOopRows` for the sibling pagination
  // pattern (oop_snapshots is small enough to skip the window filter).
  const sinceIso = new Date(
    Date.now() - RESULTS_LOOKBACK_HOURS * 3600_000
  ).toISOString();
  const rows = await paginatedSelect<ResultsRow>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('results_snapshots')
        .select(
          'tournament_id, match_widget_id, category, day_number, round_label, court, ' +
            'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, ' +
            'set_scores, winner_team, status, captured_at'
        )
        .eq('tournament_id', tournamentId)
        .gte('captured_at', sinceIso)
        .order('captured_at', { ascending: false })
        .range(start, end),
    {
      what: `results_snapshots (tournament=${tournamentId})`,
      pageSize: 10_000,
    },
  );

  const latest = new Map<string, ResultsRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const key = r.match_widget_id;
    const prev = latest.get(key);
    if (!prev || r.captured_at > prev.captured_at) latest.set(key, r);
  }
  return Array.from(latest.values());
}

async function loadTournamentStartsAt(
  supabase: SupabaseClient,
  tournamentIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  if (tournamentIds.length === 0) return map;
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, starts_at')
    .in('id', tournamentIds);
  if (error) {
    throw new Error(`tournaments starts_at read failed: ${error.message}`);
  }
  for (const row of (data ?? []) as Array<{ id: string; starts_at: string | null }>) {
    map.set(row.id, row.starts_at ?? null);
  }
  return map;
}

/**
 * Resolve a match via the `entity_external_ids` sidecar when the
 * widget_id_composite prefix lookup missed it. Returns the same shape as
 * the prefix path so the caller can treat both uniformly. Null when no
 * sidecar mapping exists or the referenced match row is gone.
 */
async function resolveMatchViaSidecar(
  supabase: SupabaseClient,
  composite: string
): Promise<ExistingMatch | null> {
  const { data: eid, error: eidErr } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', 'match')
    .eq('source', 'crionet_widget')
    .eq('external_id', composite)
    .maybeSingle();
  if (eidErr) {
    throw new Error(
      `entity_external_ids lookup failed (composite=${composite}): ${eidErr.message}`
    );
  }
  const matchId = (eid as { entity_id?: string } | null)?.entity_id;
  if (!matchId) return null;

  const { data: row, error: mErr } = await supabase
    .from('matches')
    .select(
      'id, widget_id_composite, status, winner_pair, duration, finished_at, started_at'
    )
    .eq('id', matchId)
    .maybeSingle();
  if (mErr) {
    throw new Error(
      `matches lookup by sidecar id failed (id=${matchId}): ${mErr.message}`
    );
  }
  return (row as ExistingMatch | null) ?? null;
}

/**
 * Backfill `matches.widget_id_composite` for a row resolved via the
 * sidecar. Guarded `IS NULL` so we never clobber a populator-owned value,
 * and the partial unique index's 23505 is tolerated (another writer raced
 * us to the same composite — harmless).
 */
async function backfillCompositeColumn(
  supabase: SupabaseClient,
  matchId: string,
  composite: string
): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({ widget_id_composite: composite })
    .eq('id', matchId)
    .is('widget_id_composite', null);
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error(
      `widget_id_composite backfill failed (id=${matchId}, composite=${composite}): ${error.message}`
    );
  }
}

async function loadExistingMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string
): Promise<Map<string, ExistingMatch>> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, widget_id_composite, status, winner_pair, duration, finished_at, started_at'
    )
    .like('widget_id_composite', `${compositePrefix}%`);
  if (error) {
    throw new Error(
      `matches read failed (prefix=${compositePrefix}): ${error.message}`
    );
  }
  const map = new Map<string, ExistingMatch>();
  for (const row of (data ?? []) as ExistingMatch[]) {
    if (row.widget_id_composite) map.set(row.widget_id_composite, row);
  }
  return map;
}
