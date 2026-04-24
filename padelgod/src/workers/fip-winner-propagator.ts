import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * fip-winner-propagator — simplified-pipeline writer #4.
 *
 * Pure bracket math. When a match is marked finished + winner_pair is
 * set, the winning team's 2 player UUIDs are propagated to the
 * corresponding slot of the next-round match. No external I/O — all
 * reads from our own Supabase, all writes to `public.matches` on
 * composite-keyed rows.
 *
 * How the bracket math works
 * --------------------------
 * `padelgod.draw_snapshots` rows carry a `draw_position` (global 1..N
 * across the whole draw type) and a `round_label`. Matches in one draw
 * type (MD / WD / MQ / WQ) share a continuous `draw_position` space —
 * earlier rounds (more matches) have lower positions, later rounds
 * have higher.
 *
 * For example Isla MD (31 total matches):
 *   R32: positions 1..16   (16 matches)
 *   R16: positions 17..24  (8 matches)
 *   QF : positions 25..28  (4 matches)
 *   SF : positions 29..30  (2 matches)
 *   F  : position  31       (1 match)
 *
 * Winner of match at position N flows to next round as follows:
 *   let P = N - round_start + 1         // 1-indexed position WITHIN round
 *   next_position_in_round = ceil(P/2)  // two matches feed one next
 *   next_global_position = next_round_start + next_position_in_round - 1
 *   team_slot = (P % 2 === 1) ? 1 : 2   // odd→team 1, even→team 2
 *
 * If the source match is in the final round (no next_round_start),
 * propagation is a no-op.
 *
 * Safety rails
 * ------------
 *   - Source match must have widget_id_composite set AND winner_pair set
 *     AND all 4 pair_player_ids populated (otherwise we can't propagate).
 *   - Target slot must be NULL (never clobber). If target already has
 *     IDs set (e.g. operator fixed it manually, or padelapi sync wrote
 *     them), skip and leave alone.
 *   - Target match must exist via composite lookup; if not (populator
 *     hasn't created it yet), skip and retry next run.
 *   - Each run is idempotent: if both slots are already filled, nothing
 *     happens.
 *
 * What this writer does NOT touch
 * -------------------------------
 *   - Creating matches (populator owns)
 *   - status / winner_pair / sets (results-writer owns)
 *   - court / court_order (oop-writer owns)
 *   - Matches with widget_id_composite IS NULL (legacy rows)
 *
 * Parallel-safety
 * ---------------
 *   - ENABLE_FIP_WINNER_PROPAGATOR=false    ← default
 *   - FIP_WINNER_PROPAGATOR_DRY_RUN=true    ← default
 *   - Cron `2 * * * *` (:02) — clean window between the prior hour's
 *     results-writer (:57) and the next hour's reconciler (:05).
 *     Independent cadence; the propagator is cheap (no external calls)
 *     so running every hour is fine even when most finished matches
 *     have already been propagated.
 */

export interface FipWinnerPropagatorDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  dryRun: boolean;
}

export interface FipWinnerPropagatorResult {
  tournamentsProcessed: number;
  tournamentsSkippedNoWidget: number;
  finishedMatchesConsidered: number;
  propagationsWritten: number;
  skippedFinalRound: number;
  skippedNoTargetMatch: number;
  skippedTargetSlotFilled: number;
  skippedSourceIncomplete: number;
  skippedNoDrawRow: number;
  dryRun: boolean;
}

interface TournamentRow {
  tournament_id: string;
  tournament_name: string;
  slug: string;
}

interface DrawSlot {
  widget_id: string;
  round_label: string;
  draw_position: number;
  draw_type_prefix: string; // "MD" / "WD" / "MQ" / "WQ"
}

interface MatchState {
  id: string;
  widget_id_composite: string;
  widget_id: string; // parsed from composite ("MD017")
  status: string | null;
  winner_pair: number | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

// ── Bracket math (exported for testing) ────────────────────────────────

/**
 * Given the full set of slots for ONE draw type (MD/WD/MQ/WQ), compute
 * a lookup map of `draw_position` → `next_draw_position` AND
 * `next_team_slot`. When a match has no next round (the final), it's
 * absent from the map.
 *
 * Pure function — input is the slot set, output is the transitions.
 * Written this way so the worker can call it once per tournament+type
 * and reuse for every match.
 */
export function buildPropagationMap(
  slots: DrawSlot[]
): Map<number, { nextPosition: number; targetTeam: 1 | 2 }> {
  // Group slots by round_label to find round boundaries.
  const byRound = new Map<string, DrawSlot[]>();
  for (const s of slots) {
    const arr = byRound.get(s.round_label) ?? [];
    arr.push(s);
    byRound.set(s.round_label, arr);
  }

  // For each round, compute {start, size}. Sort rounds by start (smallest
  // = earliest round = first to be played).
  interface RoundBounds {
    label: string;
    start: number;
    size: number;
  }
  const rounds: RoundBounds[] = [];
  for (const [label, arr] of byRound) {
    const positions = arr.map((s) => s.draw_position);
    rounds.push({
      label,
      start: Math.min(...positions),
      size: positions.length,
    });
  }
  rounds.sort((a, b) => a.start - b.start);

  // Build round lookup: position → round_index
  const positionToRound = new Map<number, number>();
  rounds.forEach((r, idx) => {
    for (let i = 0; i < r.size; i++) {
      positionToRound.set(r.start + i, idx);
    }
  });

  // Compute transitions
  const transitions = new Map<
    number,
    { nextPosition: number; targetTeam: 1 | 2 }
  >();
  for (const [position, roundIdx] of positionToRound) {
    const round = rounds[roundIdx]!;
    const nextRound = rounds[roundIdx + 1];
    if (!nextRound) continue; // final round — no propagation

    const positionInRound = position - round.start + 1;
    const nextPositionInRound = Math.ceil(positionInRound / 2);
    const nextPosition = nextRound.start + nextPositionInRound - 1;
    const targetTeam = (positionInRound % 2 === 1 ? 1 : 2) as 1 | 2;

    transitions.set(position, { nextPosition, targetTeam });
  }
  return transitions;
}

/**
 * Extract the draw-type prefix from a widget id: "MD017" → "MD",
 * "WQ008" → "WQ". Returns null on malformed input (shouldn't happen
 * for rows sourced from our parser but defensive).
 */
export function drawTypePrefix(widgetId: string): string | null {
  const m = widgetId.match(/^([A-Z]{2})\d+$/);
  return m?.[1] ?? null;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFipWinnerPropagator(
  deps: FipWinnerPropagatorDeps
): Promise<FipWinnerPropagatorResult> {
  const { supabase, logger, dryRun } = deps;

  const result: FipWinnerPropagatorResult = {
    tournamentsProcessed: 0,
    tournamentsSkippedNoWidget: 0,
    finishedMatchesConsidered: 0,
    propagationsWritten: 0,
    skippedFinalRound: 0,
    skippedNoTargetMatch: 0,
    skippedTargetSlotFilled: 0,
    skippedSourceIncomplete: 0,
    skippedNoDrawRow: 0,
    dryRun,
  };

  const { data: tours, error: toursErr } = await supabase.rpc(
    'padelgod_active_tournaments_with_slug'
  );
  if (toursErr) {
    throw new Error(
      `padelgod_active_tournaments_with_slug RPC failed: ${toursErr.message}`
    );
  }
  const tournaments = (tours ?? []) as TournamentRow[];

  for (const t of tournaments) {
    const tournamentWidgetId = await getActiveWidgetIdCode(
      supabase,
      t.tournament_id
    );
    if (!tournamentWidgetId) {
      result.tournamentsSkippedNoWidget += 1;
      continue;
    }

    // Load all draw slots for this tournament
    const allSlots = await loadDrawSlots(supabase, t.tournament_id);
    if (allSlots.length === 0) continue;

    result.tournamentsProcessed += 1;

    // Group slots by draw_type_prefix + build per-draw-type propagation maps
    const slotsByDrawType = new Map<string, DrawSlot[]>();
    for (const s of allSlots) {
      const arr = slotsByDrawType.get(s.draw_type_prefix) ?? [];
      arr.push(s);
      slotsByDrawType.set(s.draw_type_prefix, arr);
    }
    const transitionsByType = new Map<
      string,
      Map<number, { nextPosition: number; targetTeam: 1 | 2 }>
    >();
    for (const [prefix, slots] of slotsByDrawType) {
      transitionsByType.set(prefix, buildPropagationMap(slots));
    }

    // Build widget_id → DrawSlot map for fast lookup
    const slotByWidgetId = new Map<string, DrawSlot>();
    for (const s of allSlots) slotByWidgetId.set(s.widget_id, s);

    // Build draw_position → widget_id map PER draw type (for finding
    // the target match's widget id from its position)
    const widgetIdByPosition = new Map<string, string>(); // key: "prefix:position"
    for (const s of allSlots) {
      widgetIdByPosition.set(`${s.draw_type_prefix}:${s.draw_position}`, s.widget_id);
    }

    // Load composite-keyed matches for this tournament
    const compositePrefix = `${tournamentWidgetId}:`;
    const matchByComposite = await loadExistingMatchesByPrefix(
      supabase,
      compositePrefix
    );

    // For each finished match with winner, propagate
    for (const [, match] of matchByComposite) {
      if (match.status !== 'finished' && match.status !== 'walkover' && match.status !== 'retired') {
        continue;
      }
      if (match.winner_pair !== 1 && match.winner_pair !== 2) continue;
      result.finishedMatchesConsidered += 1;

      // Must have all 4 FKs populated to have a winning pair to propagate
      if (
        !match.pair1_player1_id ||
        !match.pair1_player2_id ||
        !match.pair2_player1_id ||
        !match.pair2_player2_id
      ) {
        result.skippedSourceIncomplete += 1;
        continue;
      }

      const slot = slotByWidgetId.get(match.widget_id);
      if (!slot) {
        result.skippedNoDrawRow += 1;
        continue;
      }

      const transitions = transitionsByType.get(slot.draw_type_prefix);
      if (!transitions) {
        result.skippedNoDrawRow += 1;
        continue;
      }

      const transition = transitions.get(slot.draw_position);
      if (!transition) {
        result.skippedFinalRound += 1;
        continue;
      }

      const targetWidgetId = widgetIdByPosition.get(
        `${slot.draw_type_prefix}:${transition.nextPosition}`
      );
      if (!targetWidgetId) {
        // Shouldn't happen — buildPropagationMap should only emit
        // transitions to positions that exist. Defensive.
        result.skippedNoDrawRow += 1;
        continue;
      }

      const targetComposite = `${tournamentWidgetId}:${targetWidgetId}`;
      const targetMatch = matchByComposite.get(targetComposite);
      if (!targetMatch) {
        result.skippedNoTargetMatch += 1;
        continue;
      }

      // Determine winning pair's 2 player UUIDs
      const [winA, winB] = match.winner_pair === 1
        ? [match.pair1_player1_id, match.pair1_player2_id]
        : [match.pair2_player1_id, match.pair2_player2_id];

      // Target slot: pair1 or pair2
      const targetSlotA =
        transition.targetTeam === 1 ? 'pair1_player1_id' : 'pair2_player1_id';
      const targetSlotB =
        transition.targetTeam === 1 ? 'pair1_player2_id' : 'pair2_player2_id';

      const currentA = transition.targetTeam === 1
        ? targetMatch.pair1_player1_id
        : targetMatch.pair2_player1_id;
      const currentB = transition.targetTeam === 1
        ? targetMatch.pair1_player2_id
        : targetMatch.pair2_player2_id;

      // NULL-only: skip if target already has any player set there
      if (currentA !== null || currentB !== null) {
        result.skippedTargetSlotFilled += 1;
        continue;
      }

      const patch: Record<string, string> = {
        [targetSlotA]: winA,
        [targetSlotB]: winB,
      };

      if (dryRun) {
        logger?.info(
          {
            sourceComposite: match.widget_id_composite,
            targetComposite,
            targetTeam: transition.targetTeam,
            patch,
          },
          'fip-winner-propagator [dry-run]: would propagate winner'
        );
      } else {
        const { error: updErr } = await supabase
          .from('matches')
          .update(patch)
          .eq('id', targetMatch.id);
        if (updErr) {
          throw new Error(
            `propagation update failed (source=${match.widget_id}, target=${targetWidgetId}): ${updErr.message}`
          );
        }
        // Reflect in our in-memory cache so a downstream propagation
        // within the same run sees the filled slot.
        if (transition.targetTeam === 1) {
          targetMatch.pair1_player1_id = winA;
          targetMatch.pair1_player2_id = winB;
        } else {
          targetMatch.pair2_player1_id = winA;
          targetMatch.pair2_player2_id = winB;
        }
      }
      result.propagationsWritten += 1;
    }
  }

  logger?.info(result, 'fip-winner-propagator run complete');
  return result;
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

async function loadDrawSlots(
  supabase: SupabaseClient,
  tournamentId: string
): Promise<DrawSlot[]> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .select('match_widget_id, round_label, draw_position, captured_at')
    .eq('tournament_id', tournamentId)
    .eq('source', 'fip_event_page');
  if (error) {
    throw new Error(
      `draw_snapshots read failed (tournament=${tournamentId}): ${error.message}`
    );
  }
  interface RawRow {
    match_widget_id: string | null;
    round_label: string | null;
    draw_position: number | null;
    captured_at: string;
  }
  const rows = (data ?? []) as unknown as RawRow[];

  // Dedupe to latest per widget_id
  const latest = new Map<string, RawRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const prev = latest.get(r.match_widget_id);
    if (!prev || r.captured_at > prev.captured_at) {
      latest.set(r.match_widget_id, r);
    }
  }

  const slots: DrawSlot[] = [];
  for (const r of latest.values()) {
    if (!r.match_widget_id || r.draw_position == null || !r.round_label) continue;
    const prefix = drawTypePrefix(r.match_widget_id);
    if (!prefix) continue;
    slots.push({
      widget_id: r.match_widget_id,
      round_label: r.round_label,
      draw_position: r.draw_position,
      draw_type_prefix: prefix,
    });
  }
  return slots;
}

async function loadExistingMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string
): Promise<Map<string, MatchState>> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, widget_id_composite, status, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id'
    )
    .like('widget_id_composite', `${compositePrefix}%`);
  if (error) {
    throw new Error(
      `matches read failed (prefix=${compositePrefix}): ${error.message}`
    );
  }
  interface RawMatch {
    id: string;
    widget_id_composite: string;
    status: string | null;
    winner_pair: number | null;
    pair1_player1_id: string | null;
    pair1_player2_id: string | null;
    pair2_player1_id: string | null;
    pair2_player2_id: string | null;
  }
  const map = new Map<string, MatchState>();
  for (const row of (data ?? []) as RawMatch[]) {
    if (!row.widget_id_composite) continue;
    const widget_id = row.widget_id_composite.split(':')[1] ?? '';
    map.set(row.widget_id_composite, {
      ...row,
      widget_id,
    });
  }
  return map;
}
