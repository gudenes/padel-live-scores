import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { parseSetScores } from './static-reconciler.js';
import { computeFinishedAtFallback } from '../lib/match-time-stamps.js';

/**
 * fip-draw-results-writer — settles pre-match walkovers visible only
 * on the FIP event page.
 *
 * Why this exists
 * ---------------
 * `fip-results-writer` reads `padelgod.results_snapshots`
 * (matchscorerlive). When a pair withdraws *before* the match is
 * dispatched on matchscorerlive, no results row is ever published — so
 * the writer has nothing to act on and the row stays `status=scheduled`
 * forever, even after the bracket has advanced the surviving pair into
 * the next round.
 *
 * The FIP federation's own event-page draw HTML captures this exactly:
 * the Q2 row shows a checkmark on one team with `winner_team` set and
 * `set_scores` empty. `fip-draw-fetcher` already writes those rows into
 * `padelgod.draw_snapshots` with `source='fip_event_page'`. This writer
 * promotes them to `public.matches`.
 *
 * One job only
 * ------------
 * - Composite lookup per tournament (batched prefix query)
 * - UPDATE matches.status + winner_pair when:
 *     draw_snapshots.source='fip_event_page' AND winner_team IS NOT NULL
 *     AND the latest snapshot's status is finished/walkover/retired
 * - UPSERT public.sets only when `set_scores` parses to at least one set
 *
 * Translation rules
 * -----------------
 *   draw status='walkover'                                  → walkover
 *   draw status='finished' + set_scores empty/unparseable   → walkover
 *   draw status='finished' + set_scores parses              → finished
 *   draw status='retired'                                   → retired
 *   draw status='scheduled' / unknown / winner_team NULL    → skip
 *
 * The "finished + empty scores = walkover" branch is the actual gap.
 * FIP's event page labels pre-match no-shows as `finished`, but our
 * convention (and matchscorerlive's own labelling for the same kind of
 * row) is `walkover`. See sibling matches MQ015 / MQ008 on FIP Platinum
 * Albania 2026 for the precedent.
 *
 * Terminal-status regression guard
 * --------------------------------
 * Only flips when current is in {'scheduled', 'on_court', 'live'}.
 * Mirrors `fip-results-writer`. This is what keeps matchscorerlive (5
 * min cadence) and the FIP draw scrape (hourly) from fighting: whoever
 * settles first wins, and the other becomes a no-op.
 *
 * What this writer does NOT touch
 * -------------------------------
 * - pair_player_ids (populator owns)
 * - court, court_order (oop-writer owns)
 * - scheduled_at (padelapi narrow sync / OOP schedule review own)
 * - Rows where `widget_id_composite` is null (legacy / synthetic)
 * - draw_snapshots rows from non-FIP sources (Crionet bracket scrape
 *   feeds results_snapshots instead)
 *
 * Parallel-safety during migration
 * --------------------------------
 *   - ENABLE_FIP_DRAW_RESULTS_WRITER=false     ← default
 *   - FIP_DRAW_RESULTS_WRITER_DRY_RUN=true     ← default
 *   - Cron `40 * * * *` — runs 5 min after fip-draw-fetcher (:35) so
 *     snapshots are fresh. No upstream contention with fip-results-writer
 *     (every 5 min from :02) thanks to the terminal-status guard.
 */

export interface FipDrawResultsWriterDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** When true (default), log proposed writes but don't actually write. */
  dryRun: boolean;
  /** When set, only tournaments whose UUID is in the allowlist are
   *  processed. Used by the on-demand refresh endpoint. */
  onlyTournamentIds?: Set<string>;
}

export interface FipDrawResultsWriterResult {
  tournamentsProcessed: number;
  tournamentsSkippedNoWidget: number;
  drawRowsConsidered: number;
  matchesUpdated: number;
  setsWritten: number;
  finishedAtBackfilled: number;
  skippedNoMatch: number;
  skippedTerminalStatus: number;
  skippedNoWidgetId: number;
  skippedNoActionable: number;
  dryRun: boolean;
}

interface TournamentRow {
  tournament_id: string;
  tournament_name: string;
  slug: string;
}

export interface DrawSnapshotRow {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women' | null;
  round_label: string | null;
  draw_position: number | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  set_scores: string | null;
  winner_team: 1 | 2 | null;
  status: string | null;
  source: string | null;
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

export interface DrawTranslation {
  /** Status to write to `public.matches.status`. */
  status: 'walkover' | 'finished' | 'retired';
  /** Winner pair number, 1 or 2 — never null (we only translate when winner_team is set). */
  winnerPair: 1 | 2;
  /** Parsed set rows ready for upsert. Empty array for walkovers and unparseable scores. */
  parsedSets: ReturnType<typeof parseSetScores>;
}

// ── Pure translation core (exported for unit testing) ─────────────────

/**
 * Decide what (if anything) to write to `public.matches` given a single
 * latest `padelgod.draw_snapshots` row. Returns `null` when the row is
 * not actionable (no winner team, scheduled, unknown status).
 *
 * Encodes the "finished + empty scores = walkover" rule that's the
 * whole reason this writer exists. See docblock at top of file.
 */
export function translateDrawSnapshotToMatchPatch(
  row: Pick<DrawSnapshotRow, 'status' | 'winner_team' | 'set_scores'>,
): DrawTranslation | null {
  if (row.winner_team !== 1 && row.winner_team !== 2) return null;

  const rawStatus = (row.status ?? '').toLowerCase();
  const parsedSets = parseSetScores(row.set_scores ?? '');

  if (rawStatus === 'walkover') {
    return { status: 'walkover', winnerPair: row.winner_team, parsedSets: [] };
  }
  if (rawStatus === 'retired') {
    return { status: 'retired', winnerPair: row.winner_team, parsedSets };
  }
  if (rawStatus === 'finished') {
    if (parsedSets.length === 0) {
      // FIP's event page labels pre-match no-shows as 'finished' with no
      // scores. Our convention is walkover.
      return { status: 'walkover', winnerPair: row.winner_team, parsedSets: [] };
    }
    return { status: 'finished', winnerPair: row.winner_team, parsedSets };
  }
  return null;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFipDrawResultsWriter(
  deps: FipDrawResultsWriterDeps,
): Promise<FipDrawResultsWriterResult> {
  const { supabase, logger, dryRun } = deps;

  const result: FipDrawResultsWriterResult = {
    tournamentsProcessed: 0,
    tournamentsSkippedNoWidget: 0,
    drawRowsConsidered: 0,
    matchesUpdated: 0,
    setsWritten: 0,
    finishedAtBackfilled: 0,
    skippedNoMatch: 0,
    skippedTerminalStatus: 0,
    skippedNoWidgetId: 0,
    skippedNoActionable: 0,
    dryRun,
  };

  const { data: tours, error: toursErr } = await supabase.rpc(
    'padelgod_active_tournaments_with_slug',
  );
  if (toursErr) {
    throw new Error(
      `padelgod_active_tournaments_with_slug RPC failed: ${toursErr.message}`,
    );
  }
  const allTournaments = (tours ?? []) as TournamentRow[];
  const tournaments =
    deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0
      ? allTournaments.filter((t) => deps.onlyTournamentIds!.has(t.tournament_id))
      : allTournaments;

  const tournamentStartsAt = await loadTournamentStartsAt(
    supabase,
    tournaments.map((t) => t.tournament_id),
  );

  for (const t of tournaments) {
    const tournamentWidgetId = await getActiveWidgetIdCode(
      supabase,
      t.tournament_id,
    );
    if (!tournamentWidgetId) {
      result.tournamentsSkippedNoWidget += 1;
      continue;
    }

    const latestDraws = await loadLatestDrawRows(supabase, t.tournament_id);
    if (latestDraws.length === 0) continue;

    result.tournamentsProcessed += 1;
    const startsAtIso = tournamentStartsAt.get(t.tournament_id) ?? null;

    const compositePrefix = `${tournamentWidgetId}:`;
    const matchByComposite = await loadExistingMatchesByPrefix(
      supabase,
      compositePrefix,
    );

    for (const r of latestDraws) {
      result.drawRowsConsidered += 1;

      if (!r.match_widget_id) {
        result.skippedNoWidgetId += 1;
        continue;
      }

      const translation = translateDrawSnapshotToMatchPatch(r);
      if (!translation) {
        result.skippedNoActionable += 1;
        continue;
      }

      const composite = `${tournamentWidgetId}:${r.match_widget_id}`;
      const existing = matchByComposite.get(composite);
      if (!existing) {
        result.skippedNoMatch += 1;
        continue;
      }

      const currentStatus = existing.status ?? 'scheduled';
      if (!['scheduled', 'on_court', 'live'].includes(currentStatus)) {
        result.skippedTerminalStatus += 1;
        continue;
      }

      const nowIso = new Date().toISOString();
      const matchPatch: Record<string, unknown> = {
        status: translation.status,
        winner_pair: translation.winnerPair,
        last_updated_by: 'padelgod',
        updated_at: nowIso,
      };

      if (existing.finished_at === null) {
        const finishedAt = computeFinishedAtFallback(
          existing.started_at,
          existing.duration,
          r.captured_at,
          // No day_number on draw_snapshots — let the helper fall back
          // to captured_at when started_at+duration aren't available.
          undefined,
        );
        if (finishedAt) {
          matchPatch.finished_at = finishedAt;
          result.finishedAtBackfilled += 1;
        }
      }

      if (dryRun) {
        logger?.info(
          {
            composite,
            matchId: existing.id,
            matchPatch,
            setsCount: translation.parsedSets.length,
            drawStatus: r.status,
            drawSetScores: r.set_scores,
          },
          'fip-draw-results-writer [dry-run]: would UPDATE match + UPSERT sets',
        );
      } else {
        const { error: updErr } = await supabase
          .from('matches')
          .update(matchPatch)
          .eq('id', existing.id)
          .in('status', ['scheduled', 'on_court', 'live']);
        if (updErr) {
          throw new Error(
            `matches update failed (id=${existing.id}, draw widget=${r.match_widget_id}): ${updErr.message}`,
          );
        }
      }
      result.matchesUpdated += 1;

      for (const s of translation.parsedSets) {
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
        if (!dryRun) {
          const { error: sUpErr } = await supabase
            .from('sets')
            .upsert(row, { onConflict: 'match_id,set_number' });
          if (sUpErr) {
            throw new Error(
              `sets upsert failed (match=${existing.id}, set=${s.set_number}): ${sUpErr.message}`,
            );
          }
        }
        result.setsWritten += 1;
      }
    }
  }

  logger?.info(result, 'fip-draw-results-writer run complete');
  return result;
}

// ── DB helpers ─────────────────────────────────────────────────────────

async function getActiveWidgetIdCode(
  supabase: SupabaseClient,
  tournamentId: string,
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
      `widget_id_cache read failed (tournament=${tournamentId}): ${error.message}`,
    );
  }
  return (data?.widget_id as string | undefined) ?? null;
}

async function loadLatestDrawRows(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<DrawSnapshotRow[]> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .select(
      'tournament_id, match_widget_id, category, round_label, draw_position, ' +
        'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, ' +
        'set_scores, winner_team, status, source, captured_at',
    )
    .eq('tournament_id', tournamentId)
    .eq('source', 'fip_event_page');
  if (error) {
    throw new Error(
      `draw_snapshots read failed (tournament=${tournamentId}): ${error.message}`,
    );
  }
  const rows = (data ?? []) as unknown as DrawSnapshotRow[];

  const latest = new Map<string, DrawSnapshotRow>();
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

async function loadExistingMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string,
): Promise<Map<string, ExistingMatch>> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, widget_id_composite, status, winner_pair, duration, finished_at, started_at',
    )
    .like('widget_id_composite', `${compositePrefix}%`);
  if (error) {
    throw new Error(
      `matches read failed (prefix=${compositePrefix}): ${error.message}`,
    );
  }
  const map = new Map<string, ExistingMatch>();
  for (const row of (data ?? []) as ExistingMatch[]) {
    if (row.widget_id_composite) map.set(row.widget_id_composite, row);
  }
  return map;
}
