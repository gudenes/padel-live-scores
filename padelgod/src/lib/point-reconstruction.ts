/**
 * point-reconstruction — async DB-writing layer on top of the pure
 * `diffLiveState` comparator (see live-state.ts, Task 11).
 *
 * Responsibility: take a poll-tick diff plus the current LiveMatchState and
 * write canonical rows into `sets`, `games`, and `match_points`. All writes
 * are idempotent:
 *
 *   - `sets`  upsert on (match_id, set_number)
 *   - `games` upsert on (set_id, game_number)
 *   - `match_points` insert with UNIQUE(game_id, point_number), and we rely
 *     on the pre-insert point_number count so double-applying the same diff
 *     is a no-op (or at worst a UNIQUE violation caught by the DB).
 *
 * Intentionally does NOT write `matches.status` or `matches.winner_pair` —
 * that's owned by the finish-detection path (Task 13's live-poller wraps
 * this function and separately closes matches).
 *
 * V1 approximations (documented as gaps below):
 *
 *   - `server_player_id` approximates the serving player as the "Player 1"
 *     of the serving pair (pair1Player1Id when servingTeam=1,
 *     pair2Player1Id when servingTeam=2). The Crionet widget tells us which
 *     TEAM is serving but NOT which of the two players on that team actually
 *     holds the serve for this game. Fixing this needs either an explicit
 *     signal from the widget (not available today) or a rotation model that
 *     tracks which player served the previous service game on that team.
 *
 *   - `is_break_point` / `is_set_point` / `is_match_point` / `is_golden_point`
 *     are all written as `false`. Detecting them requires additional context
 *     (current score + who's serving + set/match score + best-of rules +
 *     tournaments.uses_golden_point). Plan 5+ can fill these flags by
 *     extending this module with a small pre-write classifier.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import type { LiveMatchState, LiveStateDiff, PointState } from './live-state.js';
import { type NotifyDeps, notifyLiveTransition } from './notify.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The four resolved player UUIDs for a match. Resolved at live-poller startup
 * by `tournament-dictionary` lookups; `null` entries are allowed when the
 * match row was created as a "thin" placeholder (no player assignments yet).
 */
export interface ResolvedPlayers {
  pair1Player1Id: string | null;
  pair1Player2Id: string | null;
  pair2Player1Id: string | null;
  pair2Player2Id: string | null;
}

export interface ApplyDiffOpts {
  logger?: Logger;
  /**
   * Write routing:
   *   - `'canonical'` (default): writes go to public.sets / public.games /
   *     public.match_points, exactly as before.
   *   - `'shadow'`: writes go to padelgod.shadow_sets and
   *     padelgod.shadow_match_points. The games table and the is_current
   *     clearing steps are SKIPPED (no shadow_games table, no is_current
   *     column on shadow_sets).
   *
   * Shadow mode is used by the Padelgod Shadow Mode plan to run the live
   * poller against a parallel dataset without disturbing canonical rows.
   */
  mode?: 'canonical' | 'shadow';
  /**
   * Only consulted when `mode === 'shadow'`. When true, shadow writes are
   * dual-written: `padelgod.shadow_sets` AND `public.sets` (with
   * `score_source='shadow'`), plus a `public.matches.status = 'live'` flip
   * on the first point of a match that's still `'scheduled'`.
   *
   * Why this exists: padelapi.org's `/api/live` can go dark (e.g. HTTP 402).
   * When it does, shadow-enabled tournaments have no other route to the
   * public UI. Dual-writing promotes shadow data to the canonical schema so
   * padelnachos.com keeps rendering live scores.
   *
   * Safe by construction:
   *   - public.sets writes are skipped when the existing row has
   *     `score_source IN ('api','live')` — the canonical pipeline always
   *     wins when it catches up.
   *   - status flip is guarded by `.eq('status','scheduled')` so we never
   *     regress `'live'`/`'finished'`/`'retired'`/`'walkover'`.
   */
  dualWritePublic?: boolean;
  /**
   * Optional web-push notification hook. When set and `dualWritePublic` is
   * also true, `dualWriteShadowToPublic` reads the existing match status
   * before its UPDATE and — if the prev status was `'scheduled'` — fires
   * `/api/push/notify` on padelnachos.com so bookmark + player-follow
   * pushes go out.
   *
   * Without this, padelgod-initiated `scheduled → live` transitions silently
   * land in the DB; the Vercel scores/sync crons would only fire notify when
   * THEY wrote the transition, which never happens once padelgod has already
   * flipped the row. Incident 2026-04-23: Brussels P2 fd345282 went live via
   * padelgod at 15:26 UTC with both Vercel crons rate-limited → zero
   * notifications despite active bookmarks.
   *
   * See `./notify.ts::notifyLiveTransition` for behavior. Fire-and-forget,
   * never throws, never blocks the live-poller tick.
   */
  notify?: import('./notify.js').NotifyDeps;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a PointState as a short string suitable for the
 * `games.game_score` and `match_points.score_after` columns.
 *
 * Design calls:
 *   - Deuce is written as `"Deuce"` (padel/tennis-idiomatic; also
 *     unambiguously distinguishable from regular 40-x).
 *   - Advantage: `"AD-40"` / `"40-AD"`.
 *   - Golden point: `"GP"`.
 *   - Tiebreak: `"T1-T2"` (numeric, e.g. `"5-3"`).
 *   - Regular: `"T1-T2"` (e.g. `"15-0"`).
 */
export function formatPointScore(p: PointState): string {
  switch (p.kind) {
    case 'regular':
      return `${p.team1}-${p.team2}`;
    case 'deuce':
      // Emit numeric "40-40" instead of the English "Deuce" word. The public
      // UI's point-parser maps '40' → 40 and derives scorer by diffing
      // consecutive values; keeping it numeric lets the momentum chart +
      // Live Feed treat deuce like any other regular score instead of
      // needing a special case. Also works across locales — no translation
      // needed for the string "40-40".
      return '40-40';
    case 'advantage':
      return p.side === 1 ? 'AD-40' : '40-AD';
    case 'golden_point':
      return 'GP';
    case 'tiebreak':
      return `${p.team1}-${p.team2}`;
  }
}

/** Index of the last non-null set entry, or -1 if none. */
function lastSetIndex(sets: Array<{ games: number } | null>): number {
  for (let i = sets.length - 1; i >= 0; i--) {
    if (sets[i] != null) return i;
  }
  return -1;
}

/**
 * Map a 1/2 team id onto the resolved-player slot for that team's "player 1".
 * V1 approximation — see module header.
 */
function serverPlayerId(
  servingTeam: 1 | 2 | null,
  players: ResolvedPlayers,
): string | null {
  if (servingTeam === 1) return players.pair1Player1Id;
  if (servingTeam === 2) return players.pair2Player1Id;
  return null;
}

/**
 * True when the diff has any effect that needs a DB write. First-poll
 * (prev=null) also returns an empty diff from `diffLiveState`, which
 * lands here as false.
 */
function diffHasEffect(diff: LiveStateDiff): boolean {
  return (
    diff.pointsAdded.length > 0 ||
    diff.gameChanged ||
    diff.setChanged ||
    diff.serverChanged ||
    diff.statusChanged
  );
}

// ---------------------------------------------------------------------------
// Main apply function
// ---------------------------------------------------------------------------

/**
 * Apply a single poll-tick diff to the DB.
 *
 * Writes (when applicable):
 *   - `sets` row for the current set with latest games + is_current=true
 *   - Clears `is_current` on all other sets of the match
 *   - `games` row for the current game with game_score / server_player_id /
 *     is_tiebreak / is_current=true
 *   - Clears `is_current` on all other games of the current set
 *   - One `match_points` row per point in `diff.pointsAdded`
 *
 * Idempotent: double-calling with the same diff MAY duplicate sets/games
 * upserts (harmless — same content) but will NOT duplicate match_points
 * rows (UNIQUE(game_id, point_number) + computed point_number).
 */
export async function applyDiff(
  supabase: SupabaseClient,
  matchId: string,
  prev: LiveMatchState | null,
  curr: LiveMatchState,
  diff: LiveStateDiff,
  resolvedPlayers: ResolvedPlayers,
  opts: ApplyDiffOpts = {},
): Promise<void> {
  const logger = opts.logger;
  const mode = opts.mode ?? 'canonical';

  // First poll — no prev state — nothing to write. The initial "we exist"
  // writes come from elsewhere (the reconciler creates the match row).
  if (prev === null) return;

  // No-op diff — bail early before touching the DB.
  if (!diffHasEffect(diff)) return;

  // ── Identify the current set ──────────────────────────────────────────
  const currIdxA = lastSetIndex(curr.team1Sets);
  const currIdxB = lastSetIndex(curr.team2Sets);
  const currIdxMax = Math.max(currIdxA, currIdxB);
  if (currIdxMax < 0) {
    logger?.warn({ matchId }, 'applyDiff: no active set — nothing to write');
    return;
  }
  const currentSetNumber = currIdxMax + 1;
  const currPair1Games = curr.team1Sets[currIdxMax]?.games ?? 0;
  const currPair2Games = curr.team2Sets[currIdxMax]?.games ?? 0;

  // ── Shadow-mode write routing ────────────────────────────────────────
  // When mode='shadow' we bypass public.sets/games/match_points entirely
  // and write to padelgod.shadow_sets + padelgod.shadow_match_points.
  // Game-level rows + is_current bookkeeping are skipped: shadow_sets has
  // no is_current column, and there is no shadow_games table.
  if (mode === 'shadow') {
    await applyDiffShadow(
      supabase,
      matchId,
      curr,
      diff,
      currentSetNumber,
      currPair1Games,
      currPair2Games,
      logger,
    );
    if (opts.dualWritePublic) {
      await dualWriteShadowToPublic(
        supabase,
        matchId,
        curr,
        currentSetNumber,
        resolvedPlayers,
        logger,
        opts.notify,
      );
    }
    return;
  }

  // ── Clear is_current on other sets when the active set advanced ──────
  // Idempotent: issue unconditionally when there could be other sets.
  // (For set 1 this updates zero rows.)
  if (currentSetNumber > 1) {
    const { error: clearSetErr } = await supabase
      .from('sets')
      .update({ is_current: false })
      .eq('match_id', matchId)
      .neq('set_number', currentSetNumber);
    if (clearSetErr) {
      logger?.warn(
        { matchId, err: clearSetErr.message },
        'applyDiff: failed to clear is_current on old sets',
      );
    }
  }

  // ── Upsert the current set row ───────────────────────────────────────
  const { data: setRow, error: setErr } = await supabase
    .from('sets')
    .upsert(
      {
        match_id: matchId,
        set_number: currentSetNumber,
        pair1_games: currPair1Games,
        pair2_games: currPair2Games,
        is_current: true,
        score_source: 'live' as const,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'match_id, set_number' },
    )
    .select('id')
    .single();

  if (setErr || !setRow) {
    logger?.warn(
      { matchId, err: setErr?.message },
      'applyDiff: failed to upsert sets row',
    );
    return;
  }
  const setId = setRow.id as string;

  // ── Identify the current game ────────────────────────────────────────
  // game_number = games completed on BOTH sides + 1 (the in-progress game).
  const gameNumber = currPair1Games + currPair2Games + 1;
  const isTiebreak = curr.pointState.kind === 'tiebreak';
  const gameScore = formatPointScore(curr.pointState);
  const serverId = serverPlayerId(curr.servingTeam, resolvedPlayers);

  // ── Clear is_current on other games in this set ──────────────────────
  // Scoped by set_id so we don't touch games from other sets.
  const { error: clearGameErr } = await supabase
    .from('games')
    .update({ is_current: false })
    .eq('set_id', setId)
    .neq('game_number', gameNumber);
  if (clearGameErr) {
    logger?.warn(
      { matchId, setId, err: clearGameErr.message },
      'applyDiff: failed to clear is_current on old games',
    );
  }

  // ── Upsert the current game row ──────────────────────────────────────
  const { data: gameRow, error: gameErr } = await supabase
    .from('games')
    .upsert(
      {
        set_id: setId,
        match_id: matchId,
        game_number: gameNumber,
        game_score: gameScore,
        server_player_id: serverId,
        is_tiebreak: isTiebreak,
        is_current: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'set_id, game_number' },
    )
    .select('id')
    .single();

  if (gameErr || !gameRow) {
    logger?.warn(
      { matchId, setId, err: gameErr?.message },
      'applyDiff: failed to upsert games row',
    );
    return;
  }
  const gameId = gameRow.id as string;

  // ── Insert a match_points row per detected point ─────────────────────
  // At most one in V1 (the comparator only ever emits 0 or 1 points per
  // tick), but we loop to keep the contract clean for the future.
  if (diff.pointsAdded.length > 0) {
    // Count current rows for this game to compute point_number. The UNIQUE
    // constraint makes duplicate inserts safe even without explicit
    // `ON CONFLICT DO NOTHING` — Supabase's .insert() will return an
    // error for duplicates, which we swallow below.
    const { count: existingCount, error: countErr } = await supabase
      .from('match_points')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', gameId);
    if (countErr) {
      logger?.warn(
        { matchId, gameId, err: countErr.message },
        'applyDiff: failed to count existing match_points',
      );
      return;
    }

    const basePointNumber = existingCount ?? 0;

    for (let i = 0; i < diff.pointsAdded.length; i++) {
      const pt = diff.pointsAdded[i]!;
      const pointNumber = basePointNumber + i + 1;
      const { error: insertErr } = await supabase.from('match_points').insert({
        match_id: matchId,
        set_id: setId,
        game_id: gameId,
        point_number: pointNumber,
        server_player_id: serverId,
        winner_pair: pt.winnerTeam,
        score_after: gameScore,
        is_break_point: false,
        is_set_point: false,
        is_match_point: false,
        is_golden_point: false,
        source: 'padelgod' as const,
      });

      if (insertErr) {
        // UNIQUE(game_id, point_number) violations on replay are benign —
        // PG error code 23505. Log at warn level but don't throw.
        const isDuplicate =
          (insertErr as { code?: string }).code === '23505' ||
          /duplicate key/i.test(insertErr.message ?? '');
        if (isDuplicate) {
          logger?.warn(
            { matchId, gameId, pointNumber },
            'applyDiff: match_points row already exists (replay — ignored)',
          );
        } else {
          logger?.warn(
            { matchId, gameId, pointNumber, err: insertErr.message },
            'applyDiff: failed to insert match_points row',
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Shadow-mode apply (mode='shadow')
// ---------------------------------------------------------------------------

/**
 * Shadow-mode equivalent of `applyDiff`. Writes go to
 * `padelgod.shadow_sets` (set-level aggregates) and
 * `padelgod.shadow_match_points` (per-point log).
 *
 * Differences vs canonical mode:
 *   - No `games` table (there is no shadow_games); game-level rows are skipped.
 *   - No `is_current` bookkeeping (shadow_sets has no such column).
 *   - No `score_source` (shadow rows are always "live" by construction).
 *   - `shadow_match_points` keys on (match_id, set_number, game_number,
 *     point_number) — no set_id / game_id / server_player_id. `server_team`
 *     is the 1/2 team index directly; `is_golden_point` is populated from
 *     `curr.pointState.kind`.
 *
 * Idempotency: double-calls are safe because of
 *   UNIQUE (match_id, set_number, game_number, point_number).
 * We compute `point_number` by counting existing rows for the (match, set,
 * game) triple; a race between concurrent inserts would resolve to a UNIQUE
 * violation that we swallow (benign on replay).
 */
async function applyDiffShadow(
  supabase: SupabaseClient,
  matchId: string,
  curr: LiveMatchState,
  diff: LiveStateDiff,
  currentSetNumber: number,
  currPair1Games: number,
  currPair2Games: number,
  logger: Logger | undefined,
): Promise<void> {
  const setScore = `${currPair1Games}-${currPair2Games}`;

  // ── Upsert padelgod.shadow_sets ──────────────────────────────────────
  const { error: setErr } = await supabase
    .schema('padelgod')
    .from('shadow_sets')
    .upsert(
      {
        match_id: matchId,
        set_number: currentSetNumber,
        set_score: setScore,
        pair1_games: currPair1Games,
        pair2_games: currPair2Games,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'match_id,set_number' },
    );

  if (setErr) {
    logger?.warn(
      { matchId, err: setErr.message },
      'applyDiff(shadow): failed to upsert shadow_sets row',
    );
    // Non-fatal — still try to record the point below.
  }

  // Games writes are skipped entirely in shadow mode.

  // ── Insert shadow_match_points ───────────────────────────────────────
  if (diff.pointsAdded.length === 0) return;

  // game_number = completed games on both sides + 1 (in-progress game).
  const gameNumber = currPair1Games + currPair2Games + 1;
  const scoreAfter = formatPointScore(curr.pointState);
  const isGoldenPoint = curr.pointState.kind === 'golden_point';

  // Count existing rows for this (match, set, game) to compute point_number.
  const { count: existingCount, error: countErr } = await supabase
    .schema('padelgod')
    .from('shadow_match_points')
    .select('id', { count: 'exact', head: true })
    .eq('match_id', matchId)
    .eq('set_number', currentSetNumber)
    .eq('game_number', gameNumber);
  if (countErr) {
    logger?.warn(
      { matchId, currentSetNumber, gameNumber, err: countErr.message },
      'applyDiff(shadow): failed to count existing shadow_match_points',
    );
    return;
  }

  const basePointNumber = existingCount ?? 0;

  for (let i = 0; i < diff.pointsAdded.length; i++) {
    const pt = diff.pointsAdded[i]!;
    const pointNumber = basePointNumber + i + 1;
    const { error: insertErr } = await supabase
      .schema('padelgod')
      .from('shadow_match_points')
      .insert({
        match_id: matchId,
        set_number: currentSetNumber,
        game_number: gameNumber,
        point_number: pointNumber,
        winner_pair: pt.winnerTeam,
        score_after: scoreAfter,
        server_team: curr.servingTeam,
        is_golden_point: isGoldenPoint,
      });

    if (insertErr) {
      const isDuplicate =
        (insertErr as { code?: string }).code === '23505' ||
        /duplicate key/i.test(insertErr.message ?? '');
      if (isDuplicate) {
        logger?.warn(
          { matchId, currentSetNumber, gameNumber, pointNumber },
          'applyDiff(shadow): shadow_match_points row already exists (replay — ignored)',
        );
      } else {
        logger?.warn(
          { matchId, currentSetNumber, gameNumber, pointNumber, err: insertErr.message },
          'applyDiff(shadow): failed to insert shadow_match_points row',
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Dual-write: padelgod shadow data → public.* (for shadow-enabled tournaments)
// ---------------------------------------------------------------------------

/**
 * Mirror shadow-mode set data into `public.sets` and flip
 * `public.matches.status → 'live'` when the match is still `'scheduled'`.
 * Opt-in via `ApplyDiffOpts.dualWritePublic = true` — see that field's docs
 * for why this exists (padelapi /live 402s leave shadow-enabled tournaments
 * with no other route to the public UI).
 *
 * Writes EVERY set present in `curr.team1Sets / team2Sets` each tick, not
 * just the currently-in-progress set. Rationale: padelgod's shadow_sets
 * table only updates the current set per tick, so completed sets end up
 * frozen at whatever value they had the last time they were "current"
 * (which isn't necessarily their final score — the set-closing point is
 * often missed). The live-poller's parsed `curr` state always reflects
 * what the widget is showing RIGHT NOW for every set, which is more
 * authoritative than shadow_sets for completed sets. Writing all sets
 * keeps public.sets in sync with the live widget HTML.
 *
 * Source priority on `public.sets.score_source`: `api > live > shadow > inferred`.
 * Skips upsert when an existing row has `score_source IN ('api','live')`
 * so the canonical pipeline always wins once it catches up.
 *
 * Called AFTER the padelgod shadow writes — dual-write failures here are
 * non-fatal, logged at `warn`. Never overwrites terminal match statuses.
 */
async function dualWriteShadowToPublic(
  supabase: SupabaseClient,
  matchId: string,
  curr: LiveMatchState,
  currentSetNumber: number,
  resolvedPlayers: ResolvedPlayers,
  logger: Logger | undefined,
  notify: NotifyDeps | undefined,
): Promise<void> {
  // 0. Capture the current status BEFORE the flip so we can fire notify on
  //    the first transition out of `scheduled`. One extra SELECT per tick
  //    is acceptable — this path only runs for shadow-mode tournaments
  //    during their live window. Non-fatal on error: if the read fails we
  //    fall through without notify rather than blocking the status flip.
  let prevStatus: string | null = null;
  if (notify) {
    const { data: prevRow, error: prevErr } = await supabase
      .from('matches')
      .select('status')
      .eq('id', matchId)
      .maybeSingle();
    if (prevErr) {
      logger?.warn(
        { matchId, err: prevErr.message },
        'applyDiff(shadow dual-write): prev-status read for notify failed; skipping notify',
      );
    } else {
      prevStatus = (prevRow?.status as string | null) ?? null;
    }
  }

  // 1. Status flip + liveness ping.
  //
  //    Writes the observed status (`on_court` or `live`) + bumps
  //    `updated_at` on EVERY tick where the match is still non-terminal.
  //    Serves three purposes:
  //
  //      a) One-shot transition `scheduled` → `on_court`/`live` on the first
  //         tick we observe the match in the widget. Pre-match matches go
  //         to `on_court`; in-progress matches go straight to `live`.
  //      b) Phase transition `on_court` → `live` when the match actually
  //         starts (first point scored and Crionet flips the label).
  //      c) Per-tick heartbeat when status is already `on_court` or `live`.
  //         Without this, `public.matches.updated_at` goes stale 15+ min
  //         after the transition and the close-stale-live-sweeper wrongly
  //         closes the match as "stuck" even though the live-poller is
  //         still writing sets every tick.
  //
  //    Guarded with `.in('status', ['scheduled','on_court','live'])` so
  //    terminal statuses (`finished`/`walkover`/`retired`) are never
  //    regressed. Writing the same non-terminal value twice is a harmless
  //    no-op for the status column itself — the value we care about is
  //    `updated_at`.
  //
  //    We derive the target status from `curr.status`: pre-match phases
  //    collapse to `on_court`, live ticks collapse to `live`. `finished`
  //    from the parser is handled by closeMatch, not this dual-write, so
  //    it's not a valid value here.
  const targetStatus: 'on_court' | 'live' =
    curr.status === 'on_court' ? 'on_court' : 'live';
  const { error: statusErr } = await supabase
    .from('matches')
    .update({ status: targetStatus, updated_at: new Date().toISOString() })
    .eq('id', matchId)
    .in('status', ['scheduled', 'on_court', 'live']);
  if (statusErr) {
    logger?.warn(
      { matchId, err: statusErr.message },
      'applyDiff(shadow dual-write): status flip failed',
    );
  }

  // 1b. Web-push notification on the first transition out of `scheduled`.
  //
  //     We fire regardless of whether the new status is `on_court` or
  //     `live` — bookmarkers + player-followers want to know the moment
  //     a match leaves the scheduled state. On subsequent ticks
  //     (`on_court` → `live`, or per-tick heartbeats on already-live
  //     rows) prevStatus won't be `'scheduled'` so this no-ops.
  //
  //     Fire-and-forget: never awaits, never throws. Skipped entirely if
  //     `notify` deps aren't configured (NOTIFY_BASE_URL / CRON_SECRET
  //     unset) or the status flip itself errored (avoid false-positive
  //     notifications on failed writes).
  if (notify && !statusErr && prevStatus === 'scheduled') {
    notifyLiveTransition(matchId, notify);
  }

  // 2. Read existing score_source per set — used to skip rows owned by a
  //    higher-priority pipeline ('api' / 'live'). One query for the match
  //    covers all sets instead of per-set round-trips.
  const { data: existingRows, error: selErr } = await supabase
    .from('sets')
    .select('set_number, score_source')
    .eq('match_id', matchId);
  if (selErr) {
    logger?.warn(
      { matchId, err: selErr.message },
      'applyDiff(shadow dual-write): failed to read existing public.sets',
    );
    return;
  }
  const existingSource = new Map<number, string | null>();
  for (const row of existingRows ?? []) {
    existingSource.set(
      row.set_number as number,
      (row.score_source as string | null | undefined) ?? null,
    );
  }

  // 3. Iterate every set slot in curr, upsert those with data. Slot index i
  //    maps to set_number = i + 1. A slot is "empty" when both pairs' entries
  //    are null (happens for future sets that haven't started).
  //    Capture set_id for EVERY set (not just current) — we need them all
  //    when writing games.points[] history for completed games below.
  const setIdBySetNumber = new Map<number, string>();
  let currentPair1Games = 0;
  let currentPair2Games = 0;

  const numSlots = Math.max(curr.team1Sets.length, curr.team2Sets.length);
  for (let i = 0; i < numSlots; i++) {
    const t1 = curr.team1Sets[i];
    const t2 = curr.team2Sets[i];
    if (!t1 && !t2) continue;

    const setNumber = i + 1;
    const src = existingSource.get(setNumber) ?? null;
    if (src === 'api' || src === 'live') continue; // canonical source owns this set

    const pair1Games = t1?.games ?? 0;
    const pair2Games = t2?.games ?? 0;
    const isCurrent = setNumber === currentSetNumber;

    const payload = {
      match_id: matchId,
      set_number: setNumber,
      set_score: `${pair1Games}-${pair2Games}`,
      pair1_games: pair1Games,
      pair2_games: pair2Games,
      is_current: isCurrent,
      score_source: 'shadow' as const,
      updated_at: new Date().toISOString(),
    };

    const { data: setRow, error: upsertErr } = await supabase
      .from('sets')
      .upsert(payload, { onConflict: 'match_id,set_number' })
      .select('id')
      .single();

    if (upsertErr || !setRow) {
      logger?.warn(
        { matchId, setNumber, isCurrent, err: upsertErr?.message },
        'applyDiff(shadow dual-write): failed to upsert public.sets row',
      );
      continue;
    }

    setIdBySetNumber.set(setNumber, setRow.id as string);
    if (isCurrent) {
      currentPair1Games = pair1Games;
      currentPair2Games = pair2Games;
    }
  }

  // 4. Mirror padelgod.shadow_match_points → public.games.points[] for every
  //    (set, game) with captured points. This is what powers the Live Feed
  //    tab + Match Journey (momentum chart) on the match detail page — both
  //    read games.points[] and diff consecutive elements to derive scorers.
  //
  //    Each game's points[] is the full sequence of `score_after` values in
  //    chronological order, normalized to colon-separated format ("15:0").
  //    When the current game has no shadow points captured yet, we seed it
  //    with the current pointState so the card still shows live score.
  //
  //    Skips (set, game) pairs where the parent public.sets row has
  //    score_source IN ('api','live') — canonical always wins.
  //
  //    Does NOT write public.match_points — the UI consumes games.points[],
  //    not the per-point table. match_points stays owned by the canonical
  //    pipeline (via /api/cron/scores when padelapi recovers).
  const currentSetId = setIdBySetNumber.get(currentSetNumber) ?? null;
  const currentGameNumber = currentPair1Games + currentPair2Games + 1;

  const { data: shadowPts, error: ptsErr } = await supabase
    .schema('padelgod')
    .from('shadow_match_points')
    .select('set_number, game_number, point_number, score_after, server_team')
    .eq('match_id', matchId)
    .order('set_number')
    .order('game_number')
    .order('point_number');

  if (ptsErr) {
    logger?.warn(
      { matchId, err: ptsErr.message },
      'applyDiff(shadow dual-write): failed to read shadow_match_points for games mirror',
    );
    return;
  }

  type GameAgg = { points: string[]; lastServer: 1 | 2 | null };
  const byGame = new Map<string, GameAgg>();
  for (const p of (shadowPts ?? []) as Array<{
    set_number: number;
    game_number: number;
    point_number: number;
    score_after: string | null;
    server_team: 1 | 2 | null;
  }>) {
    const key = `${p.set_number}:${p.game_number}`;
    const entry = byGame.get(key) ?? { points: [], lastServer: null };
    const score = (p.score_after ?? '').replace('-', ':');
    if (score) entry.points.push(score);
    if (p.server_team != null) entry.lastServer = p.server_team;
    byGame.set(key, entry);
  }

  // Seed the current game from curr.pointState when shadow captured no points
  // for it yet — keeps the "Pts" column rendering from tick 1 of a new game.
  const currentKey = `${currentSetNumber}:${currentGameNumber}`;
  if (!byGame.has(currentKey)) {
    const fallback = formatPointScore(curr.pointState).replace('-', ':');
    byGame.set(currentKey, {
      points: [fallback],
      lastServer: curr.servingTeam,
    });
  }

  // Clear is_current on every game for this match first — the upsert loop
  // below sets is_current=true on exactly one row (the current game). This
  // avoids stale is_current=true flags left behind when a game transitions
  // from current → completed and we never re-upsert it.
  if (setIdBySetNumber.size > 0) {
    const { error: clearErr } = await supabase
      .from('games')
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq('match_id', matchId);
    if (clearErr) {
      logger?.warn(
        { matchId, err: clearErr.message },
        'applyDiff(shadow dual-write): failed to clear is_current on games',
      );
    }
  }

  // Upsert one public.games row per (set, game) entry. current game is the
  // one whose (set_number, game_number) matches (currentSetNumber, currentGameNumber).
  const isTiebreakForCurrent = curr.pointState.kind === 'tiebreak';
  for (const [key, agg] of byGame) {
    const parts = key.split(':').map(Number);
    const setNum = parts[0]!;
    const gameNum = parts[1]!;
    const setId = setIdBySetNumber.get(setNum);
    if (!setId) continue;
    // Defensive: parent set might have been skipped for canonical-source reasons.
    const src = existingSource.get(setNum) ?? null;
    if (src === 'api' || src === 'live') continue;

    const isCurrent = setNum === currentSetNumber && gameNum === currentGameNumber;
    const lastScore = agg.points[agg.points.length - 1] ?? '0:0';
    const serverId = serverPlayerId(agg.lastServer, resolvedPlayers);

    const { error: upsertErr } = await supabase.from('games').upsert(
      {
        set_id: setId,
        match_id: matchId,
        game_number: gameNum,
        game_score: lastScore,
        points: agg.points,
        is_current: isCurrent,
        // is_tiebreak only reliably known for the current game (from pointState).
        // Completed tiebreak games default to false — acceptable approximation.
        is_tiebreak: isCurrent ? isTiebreakForCurrent : false,
        server_player_id: serverId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'set_id,game_number' },
    );

    if (upsertErr) {
      logger?.warn(
        { matchId, setNum, gameNum, err: upsertErr.message },
        'applyDiff(shadow dual-write): failed to upsert public.games row',
      );
    }
  }
}
