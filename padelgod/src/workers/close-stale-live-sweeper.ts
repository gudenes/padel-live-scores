// close-stale-live-sweeper — the fast closer.
//
// Why this exists
// ---------------
// The live-poller closes matches when the Crionet widget emits `status=finished`,
// but Crionet does NOT emit that terminal state in practice — it drops finished
// matches from `tournamentlive` silently. The static-reconciler picks them up
// on its twice-hourly run, but only if every name resolves (Premier tournaments
// often return empty entry-lists, which blocks the gate). In both cases, and
// after every Railway restart (which wipes the in-memory poller state), matches
// can sit stuck at `status='live'` for hours.
//
// The sweeper covers that gap. It reads purely from our own DB — no external
// calls — and closes any match that has:
//   - status IN ('live', 'ended'),
//   - updated_at older than a stale threshold (default 15 min), AND
//   - scheduled_at in the past (so we don't close scheduled-but-not-yet-started
//     matches by accident).
//
// For each candidate it infers a winner from the sets we already wrote. If
// decisive (one pair has 2 set wins counting in-progress leads as wins), the
// match is flipped to `finished`, the trailing set is extrapolated to a
// plausible final score, and all `is_current` flags are cleared on games.
// If indecisive (not enough set data to pick a winner), the match is left alone
// for the static-reconciler to handle.
//
// Idempotent: a second run is a no-op because the candidate query filters out
// `finished|walkover|retired`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  buildFinalSets,
  inferWinnerFromSets,
  type SetRow,
} from '../lib/close-stale-live.js';
import { computeFinishedAtFallback } from '../lib/match-time-stamps.js';

export interface CloseStaleLiveSweeperDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /**
   * How many minutes without an `updated_at` bump before a match is eligible
   * for sweeping. Default 15 min — matches the comment in CLAUDE.md's
   * "Stale Match Detection" section. Lower for testing.
   */
  staleMinutes?: number;
  /**
   * Injected clock for tests. Defaults to `Date.now()`.
   */
  nowMs?: () => number;
  /**
   * Safety cap — max matches to close in a single run so a pathological DB
   * state can't take down the worker. Default 50.
   */
  maxMatchesPerRun?: number;
}

export interface CloseStaleLiveSweeperResult {
  candidatesConsidered: number;
  matchesClosed: number;
  matchesIndecisive: number;
  setsWritten: number;
}

interface CandidateMatch {
  id: string;
  status: 'live' | 'ended';
  scheduled_at: string | null;
  updated_at: string | null;
  started_at: string | null;
  duration: string | null;
  finished_at: string | null;
}

export async function runCloseStaleLiveSweeper(
  deps: CloseStaleLiveSweeperDeps,
): Promise<CloseStaleLiveSweeperResult> {
  const {
    supabase,
    logger,
    staleMinutes = 15,
    nowMs = () => Date.now(),
    maxMatchesPerRun = 50,
  } = deps;

  const now = nowMs();
  const nowIso = new Date(now).toISOString();
  const staleCutoffIso = new Date(now - staleMinutes * 60_000).toISOString();

  // Step 1: candidate matches. Union of two patterns:
  //
  //   Path A — "stale live/ended" (the original):
  //     status IN ('live','ended') AND updated_at < now - staleMinutes
  //     AND (started_at IS NOT NULL OR scheduled_at < now)
  //   Catches matches dropped from the live feed without padelgod
  //   having a chance to close them (poller wasn't running, missed the
  //   terminal tick, etc.). Conservative 15-min threshold avoids
  //   false-closing matches with legitimate long breaks.
  //
  //   The "started" guard is `started_at IS NOT NULL OR scheduled_at < now`,
  //   not a bare `scheduled_at < now`. A bare comparison silently drops
  //   rows where scheduled_at IS NULL (Postgres: NULL < now is NULL, not
  //   true), which is exactly how the 2026-05-31 ITALY MAJOR Q1 match
  //   evaded the sweeper while stuck on 'live'. started_at being set is
  //   unambiguous proof the match began, so it qualifies regardless of
  //   whether a scheduled time was ever recorded. A row with neither
  //   started_at nor a past scheduled_at has no evidence of starting and
  //   is left alone (preserves the don't-close-not-yet-started safety).
  //
  //   Path B — "regression repair" (added 2026-04-23):
  //     status IN ('live','ended') AND finished_at IS NOT NULL
  //   Catches matches where padelgod's closeMatch successfully wrote
  //   finished_at (terminal state), but a subsequent writer reverted
  //   status back to 'live' while leaving finished_at intact. Observed
  //   on Brussels P2: scores/sync crons or static-reconciler writing
  //   status='live' without touching finished_at. finished_at NOT NULL
  //   is a strong signal the match was once closed and should be
  //   re-closed immediately — no staleness wait needed.
  //
  // We union client-side rather than building a single OR query so each
  // path stays independently debuggable in logs and the scheduled_at
  // guard only applies to Path A (regression repair doesn't need it —
  // finished_at being set already implies the match started and ended).

  const { data: pathARaw, error: candErrA } = await supabase
    .from('matches')
    .select('id, status, scheduled_at, updated_at, started_at, duration, finished_at')
    .in('status', ['live', 'ended'])
    .lt('updated_at', staleCutoffIso)
    .or(`started_at.not.is.null,scheduled_at.lt.${nowIso}`)
    .order('updated_at', { ascending: true })
    .limit(maxMatchesPerRun);

  if (candErrA) {
    throw new Error(`close-stale-live-sweeper: Path A (stale) read failed: ${candErrA.message}`);
  }

  const { data: pathBRaw, error: candErrB } = await supabase
    .from('matches')
    .select('id, status, scheduled_at, updated_at, started_at, duration, finished_at')
    .in('status', ['live', 'ended'])
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: true })
    .limit(maxMatchesPerRun);

  if (candErrB) {
    throw new Error(`close-stale-live-sweeper: Path B (regression) read failed: ${candErrB.message}`);
  }

  // Dedup by id — a row can qualify under both paths.
  const dedup = new Map<string, CandidateMatch>();
  for (const r of (pathARaw ?? []) as CandidateMatch[]) dedup.set(r.id, r);
  for (const r of (pathBRaw ?? []) as CandidateMatch[]) if (!dedup.has(r.id)) dedup.set(r.id, r);
  const candidates = [...dedup.values()].slice(0, maxMatchesPerRun);

  if (candidates.length === 0) {
    logger?.info(
      { staleMinutes, staleCutoffIso },
      'close-stale-live-sweeper: no stale matches',
    );
    return {
      candidatesConsidered: 0,
      matchesClosed: 0,
      matchesIndecisive: 0,
      setsWritten: 0,
    };
  }

  logger?.info(
    {
      pathA: pathARaw?.length ?? 0,
      pathB: pathBRaw?.length ?? 0,
      total: candidates.length,
    },
    'close-stale-live-sweeper: candidates identified',
  );

  // Step 2: fetch sets for every candidate in one round-trip.
  const matchIds = candidates.map((c) => c.id);
  const { data: setsRaw, error: setsErr } = await supabase
    .from('sets')
    .select('match_id, set_number, pair1_games, pair2_games, set_score, is_current')
    .in('match_id', matchIds);
  if (setsErr) {
    throw new Error(`close-stale-live-sweeper: sets read failed: ${setsErr.message}`);
  }

  const setsByMatch = new Map<string, SetRow[]>();
  for (const row of (setsRaw ?? []) as Array<SetRow & { match_id: string }>) {
    const bucket = setsByMatch.get(row.match_id) ?? [];
    bucket.push({
      set_number: row.set_number,
      pair1_games: row.pair1_games,
      pair2_games: row.pair2_games,
      set_score: row.set_score,
      is_current: row.is_current,
    });
    setsByMatch.set(row.match_id, bucket);
  }

  let matchesClosed = 0;
  let matchesIndecisive = 0;
  let setsWritten = 0;

  for (const match of candidates) {
    const sets = setsByMatch.get(match.id) ?? [];
    const winner = inferWinnerFromSets(sets);

    if (winner === null) {
      matchesIndecisive += 1;
      logger?.warn(
        {
          matchId: match.id,
          status: match.status,
          setCount: sets.length,
          updatedAt: match.updated_at,
        },
        'close-stale-live-sweeper: indecisive — skipping',
      );
      continue;
    }

    // Step 3a: flip the match to finished. Guard by `.in('status', ...)` so
    // a concurrent live-poller close (status already moved to finished) loses
    // the race without producing a spurious overwrite.
    const finishedAt =
      match.finished_at ??
      computeFinishedAtFallback(
        match.started_at,
        match.duration,
        match.updated_at ?? nowIso,
      );

    const { error: mErr } = await supabase
      .from('matches')
      .update({
        status: 'finished',
        winner_pair: winner,
        finished_at: finishedAt,
        last_updated_by: 'padelgod-sweeper',
        updated_at: nowIso,
      })
      .eq('id', match.id)
      .in('status', ['live', 'ended']);

    if (mErr) {
      logger?.warn(
        { matchId: match.id, err: mErr.message },
        'close-stale-live-sweeper: matches update failed',
      );
      continue;
    }

    // Step 3b: upsert the final set rows (including the extrapolated trailing
    // set) and clear is_current.
    const finalSets = buildFinalSets(sets, winner);
    for (const row of finalSets) {
      const { error: sErr } = await supabase
        .from('sets')
        .upsert(
          {
            match_id: match.id,
            set_number: row.set_number,
            pair1_games: row.pair1_games,
            pair2_games: row.pair2_games,
            set_score: row.set_score,
            is_current: false,
            updated_at: nowIso,
          },
          { onConflict: 'match_id,set_number' },
        );
      if (sErr) {
        logger?.warn(
          {
            matchId: match.id,
            setNumber: row.set_number,
            err: sErr.message,
          },
          'close-stale-live-sweeper: sets upsert failed',
        );
      } else {
        setsWritten += 1;
      }
    }

    // Step 3c: clear is_current on every game for this match so the "serving"
    // indicator stops pulsing in the UI. Safe blanket update — the match is
    // terminal now, no game is "current" anymore.
    const { error: gErr } = await supabase
      .from('games')
      .update({ is_current: false, updated_at: nowIso })
      .eq('match_id', match.id)
      .eq('is_current', true);
    if (gErr) {
      logger?.warn(
        { matchId: match.id, err: gErr.message },
        'close-stale-live-sweeper: games is_current clear failed',
      );
    }

    matchesClosed += 1;
    logger?.info(
      {
        matchId: match.id,
        winner,
        extrapolatedSets: finalSets.filter((s) => s.extrapolated).length,
        totalSets: finalSets.length,
        finishedAt,
      },
      'close-stale-live-sweeper: closed stale match',
    );
  }

  logger?.info(
    {
      candidatesConsidered: candidates.length,
      matchesClosed,
      matchesIndecisive,
      setsWritten,
    },
    'close-stale-live-sweeper: run complete',
  );

  return {
    candidatesConsidered: candidates.length,
    matchesClosed,
    matchesIndecisive,
    setsWritten,
  };
}
