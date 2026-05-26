/**
 * fip-draw-reconciler — auto-corrects `public.matches` rows that have
 * drifted from the latest `fip_event_page` `draw_snapshot`.
 *
 * Why this worker exists
 * ----------------------
 * The populator's UPDATE branch is a NULL-only gap-filler (see
 * fip-draw-populator.ts:999 — `fillSlot` and the seed rule at line 1049).
 * That contract is correct for first-INSERT and partial-resolve cycles
 * but does not handle a draw that *changes* after the row is already
 * populated. When FIP rewrites a quadrant — typically because a team
 * withdraws — our row stays pinned to the original mapping.
 *
 * The 2026-05-26 Albania incident hit two flavours of this:
 *
 *  - MD020: Garrido/Bergamini was the pair1 team in the original draw;
 *    FIP later swapped them out for Barahona/Alfonso (seed 9). Populator
 *    saw the new draw but NULL-only fill left pair1 pinned to
 *    Garrido/Bergamini. Crionet's OOP marked the slot `finished` (since
 *    the *real* match — with the correct teams — had been played and
 *    completed at that widget), so our row advertised an impossible
 *    scheduled match.
 *
 *  - MD011: original draw had Leal/Guerrero as the R16 walkover-bye
 *    advancer. They withdrew, FIP reassigned the slot to Garrido/Bergamini
 *    (seed 5). Populator's UPDATE never replaced pair2's FKs and our
 *    bracket kept showing the extinct team advancing.
 *
 * What this worker does
 * ---------------------
 * Per active tournament, every hour at :50 (≥15 min after the populator's
 * last tick), it iterates the latest `fip_event_page` `draw_snapshot` per
 * widget against the existing `public.matches` row and applies a
 * full-sync patch when it finds drift in teams, seeds, round labels, or
 * status (the latter only for scheduled → walkover transitions).
 *
 * Safety gates — handled at the WORKER level (the patch builder enforces
 * the status check; the has-sets check is enforced by the iterator that
 * pre-loads a Set<matchId> of matches with any sets rows and skips them
 * before invoking the patch builder):
 *
 *  - existing.status ∈ {finished, retired, live} → skip (terminal/play)
 *  - sets row exists for matches.id              → skip (play happened,
 *                                                       regardless of status)
 *
 * Slot-level skip: within an otherwise-eligible row, if the draw_snapshot
 * has a name in a slot but the resolver returns null for that slot, we
 * leave the existing FK alone — don't degrade a resolved row to thin.
 *
 * What this worker does NOT touch
 * --------------------------------
 * - Court / court_order / scheduled_at / schedule_label (fip-oop-writer)
 * - `winner_pair` for non-BYE walkovers (results-writer's domain)
 * - The populator's NULL-only fill rule (preserved unchanged)
 * - oop_snapshot-source draws (only fip_event_page is authoritative for
 *   team identity)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { paginatedSelect } from '../lib/db-paginate.js';
import {
  loadEntryListNameMap,
  loadPlayersByFipId,
  resolveDrawNamesLongForm,
  type ResolvedFour,
} from '../lib/draw-resolver.js';

// ── Public types ───────────────────────────────────────────────────────

export interface DrawForReconcile {
  match_widget_id: string;
  round_label: string | null;
  status: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
}

export interface ExistingForReconcile {
  id: string;
  status: string;
  round: string | null;
  round_canonical: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  pair1_seed: number | null;
  pair2_seed: number | null;
  winner_pair: number | null;
}

export interface FipDrawReconcilerDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** When true, log proposed updates instead of writing. */
  dryRun: boolean;
  /** When set, only tournaments in this allowlist are processed. */
  onlyTournamentIds?: Set<string>;
}

export interface FipDrawReconcilerResult {
  tournamentsProcessed: number;
  matchesConsidered: number;
  matchesSkippedTerminal: number;
  matchesSkippedLive: number;
  matchesSkippedHasSets: number;
  matchesSkippedNoDraw: number;
  matchesUnchanged: number;
  matchesUpdated: number;
  byeTransitionsApplied: number;
  dryRun: boolean;
}

// ── Pure helpers ───────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['finished', 'retired']);

function teamHasNames(
  p1?: string | null,
  p2?: string | null,
): boolean {
  return !!((p1 && p1.trim()) || (p2 && p2.trim()));
}

function isBye(draw: DrawForReconcile): boolean {
  if (draw.status !== 'walkover') return false;
  const t1 = teamHasNames(draw.team1_player1_name, draw.team1_player2_name);
  const t2 = teamHasNames(draw.team2_player1_name, draw.team2_player2_name);
  // BYE = walkover with exactly one side named (other is the "BYE" feeder)
  return t1 !== t2;
}

/** Same SET of resolved UUIDs (intra-pair slot order ignored). */
function pairSetEquals(
  a1: string | null,
  a2: string | null,
  b1: string | null,
  b2: string | null,
): boolean {
  const A = new Set<string>();
  if (a1) A.add(a1);
  if (a2) A.add(a2);
  const B = new Set<string>();
  if (b1) B.add(b1);
  if (b2) B.add(b2);
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

// Canonical short round forms. Inlined to keep the worker decoupled —
// same mapping as fip-oop-writer.ts:normalizeRoundShort.
function normalizeRoundShort(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === '') return null;
  const map: Record<string, string> = {
    r128: 'R128', 'round of 128': 'R128',
    r64: 'R64', 'round of 64': 'R64',
    r32: 'R32', 'round of 32': 'R32',
    r16: 'R16', 'round of 16': 'R16',
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinals: 'QF',
    'quarter-finals': 'QF', 'quarter finals': 'QF',
    sf: 'SF', semifinals: 'SF', 'semi-finals': 'SF', 'semi finals': 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  };
  return map[cleaned] ?? null;
}

function computeByePatch(
  draw: DrawForReconcile,
  existing: ExistingForReconcile,
  resolved: ResolvedFour,
): Record<string, unknown> | null {
  // Which side carries the bye recipient.
  const t1HasNames = teamHasNames(draw.team1_player1_name, draw.team1_player2_name);
  const byePair = t1HasNames ? 1 : 2;
  const otherPair = byePair === 1 ? 2 : 1;
  const recip1 = t1HasNames ? resolved.p1p1 : resolved.p2p1;
  const recip2 = t1HasNames ? resolved.p1p2 : resolved.p2p2;
  const recipSeed = t1HasNames ? draw.team1_seed : draw.team2_seed;
  const drawHadName1 = t1HasNames ? !!draw.team1_player1_name : !!draw.team2_player1_name;
  const drawHadName2 = t1HasNames ? !!draw.team1_player2_name : !!draw.team2_player2_name;

  const patch: Record<string, unknown> = {};

  // Bye pair: per-slot overwrite with slot-level skip on unresolved name.
  const existingByeP1 = pairFkAt(existing, byePair, 1);
  const existingByeP2 = pairFkAt(existing, byePair, 2);
  if (recip1 !== null && recip1 !== existingByeP1) {
    patch[`pair${byePair}_player1_id`] = recip1;
    patch[`pair${byePair}_player1_name`] = null;
    patch[`pair${byePair}_player1_country`] = null;
  } else if (recip1 === null && drawHadName1 && existingByeP1 !== null) {
    // slot-level skip: keep the resolved FK we already have
  }
  if (recip2 !== null && recip2 !== existingByeP2) {
    patch[`pair${byePair}_player2_id`] = recip2;
    patch[`pair${byePair}_player2_name`] = null;
    patch[`pair${byePair}_player2_country`] = null;
  } else if (recip2 === null && drawHadName2 && existingByeP2 !== null) {
    // slot-level skip
  }

  // Bye-side seed
  const existingByeSeed = pairSeedAt(existing, byePair);
  if ((recipSeed ?? null) !== existingByeSeed) {
    patch[`pair${byePair}_seed`] = recipSeed;
  }

  // Other pair: clear FKs / names / countries / seed if any are set.
  const existingOtherP1 = pairFkAt(existing, otherPair, 1);
  const existingOtherP2 = pairFkAt(existing, otherPair, 2);
  const existingOtherSeed = pairSeedAt(existing, otherPair);
  if (existingOtherP1 !== null || existingOtherP2 !== null) {
    patch[`pair${otherPair}_player1_id`] = null;
    patch[`pair${otherPair}_player2_id`] = null;
    patch[`pair${otherPair}_player1_name`] = null;
    patch[`pair${otherPair}_player2_name`] = null;
    patch[`pair${otherPair}_player1_country`] = null;
    patch[`pair${otherPair}_player2_country`] = null;
  }
  if (existingOtherSeed !== null) {
    patch[`pair${otherPair}_seed`] = null;
  }

  // Status + winner_pair
  //
  // BYE-through cells get our schema's `status='bye'`, NOT `'walkover'`.
  // The FIP draw_snapshot encodes both "real walkover" (both teams named,
  // one withdrew) and "BYE-through" (one side empty, seeded team auto-
  // advances) as `status='walkover'`. Our schema has separate semantics:
  //
  //   - `walkover` → match was scheduled, opponent withdrew, team won by W/O
  //   - `bye`      → team auto-advanced because no opponent assigned
  //
  // The match-detail page in the Next.js app treats `walkover` as
  // `isFinished` and renders a "WINNER" banner with a W/O badge
  // (src/app/[locale]/match/[id]/page.tsx:480). For a BYE row that
  // representation is wrong — the team didn't win anything; they just
  // had no opponent. MatchCard already renders `'bye'` with a
  // distinct "Bye" label (src/app/components/MatchCard.tsx:56). Using
  // `'bye'` here keeps the bracket honest. `winner_pair` is still set
  // on the bye side so fip-winner-propagator can advance the team to
  // the next round.
  if (existing.status !== 'bye') patch.status = 'bye';
  if (existing.winner_pair !== byePair) patch.winner_pair = byePair;

  // Round drift
  applyRoundPatch(patch, draw, existing);

  return Object.keys(patch).length > 0 ? patch : null;
}

function computeNonByePatch(
  draw: DrawForReconcile,
  existing: ExistingForReconcile,
  resolved: ResolvedFour,
): Record<string, unknown> | null {
  const orientation = pickOrientation(existing, resolved);
  const patch: Record<string, unknown> = {};

  for (const pairNum of [1, 2] as const) {
    const m = mapForPair(draw, resolved, orientation, pairNum);
    const existingP1 = pairFkAt(existing, pairNum, 1);
    const existingP2 = pairFkAt(existing, pairNum, 2);
    const existingSeed = pairSeedAt(existing, pairNum);

    // Same SET of UUIDs means no slot drift (handles intra-pair ordering
    // flips without writing).
    const setMatches = pairSetEquals(existingP1, existingP2, m.r1, m.r2);

    if (!setMatches) {
      if (m.r1 !== null && m.r1 !== existingP1) {
        patch[`pair${pairNum}_player1_id`] = m.r1;
        patch[`pair${pairNum}_player1_name`] = null;
        patch[`pair${pairNum}_player1_country`] = null;
      } else if (m.r1 === null && m.drawN1 && existingP1 !== null) {
        // slot-level skip
      }
      if (m.r2 !== null && m.r2 !== existingP2) {
        patch[`pair${pairNum}_player2_id`] = m.r2;
        patch[`pair${pairNum}_player2_name`] = null;
        patch[`pair${pairNum}_player2_country`] = null;
      } else if (m.r2 === null && m.drawN2 && existingP2 !== null) {
        // slot-level skip
      }
    }

    if ((m.seed ?? null) !== existingSeed) {
      patch[`pair${pairNum}_seed`] = m.seed;
    }
  }

  applyRoundPatch(patch, draw, existing);

  if (draw.status === 'walkover' && existing.status === 'scheduled') {
    patch.status = 'walkover';
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

interface Orientation { swapped: boolean }

function pickOrientation(
  existing: ExistingForReconcile,
  resolved: ResolvedFour,
): Orientation {
  const direct =
    (pairSetEquals(existing.pair1_player1_id, existing.pair1_player2_id, resolved.p1p1, resolved.p1p2) ? 1 : 0) +
    (pairSetEquals(existing.pair2_player1_id, existing.pair2_player2_id, resolved.p2p1, resolved.p2p2) ? 1 : 0);
  const swapped =
    (pairSetEquals(existing.pair1_player1_id, existing.pair1_player2_id, resolved.p2p1, resolved.p2p2) ? 1 : 0) +
    (pairSetEquals(existing.pair2_player1_id, existing.pair2_player2_id, resolved.p1p1, resolved.p1p2) ? 1 : 0);
  return { swapped: swapped > direct };
}

function mapForPair(
  draw: DrawForReconcile,
  resolved: ResolvedFour,
  orientation: Orientation,
  pairNum: 1 | 2,
): {
  r1: string | null; r2: string | null;
  drawN1: string | null; drawN2: string | null;
  seed: number | null;
} {
  if (!orientation.swapped) {
    return pairNum === 1
      ? { r1: resolved.p1p1, r2: resolved.p1p2,
          drawN1: draw.team1_player1_name, drawN2: draw.team1_player2_name,
          seed: draw.team1_seed }
      : { r1: resolved.p2p1, r2: resolved.p2p2,
          drawN1: draw.team2_player1_name, drawN2: draw.team2_player2_name,
          seed: draw.team2_seed };
  }
  return pairNum === 1
    ? { r1: resolved.p2p1, r2: resolved.p2p2,
        drawN1: draw.team2_player1_name, drawN2: draw.team2_player2_name,
        seed: draw.team2_seed }
    : { r1: resolved.p1p1, r2: resolved.p1p2,
        drawN1: draw.team1_player1_name, drawN2: draw.team1_player2_name,
        seed: draw.team1_seed };
}

function pairFkAt(
  existing: ExistingForReconcile,
  pairNum: 1 | 2,
  slot: 1 | 2,
): string | null {
  if (pairNum === 1 && slot === 1) return existing.pair1_player1_id;
  if (pairNum === 1 && slot === 2) return existing.pair1_player2_id;
  if (pairNum === 2 && slot === 1) return existing.pair2_player1_id;
  return existing.pair2_player2_id;
}

function pairSeedAt(
  existing: ExistingForReconcile,
  pairNum: 1 | 2,
): number | null {
  return pairNum === 1 ? existing.pair1_seed : existing.pair2_seed;
}

function applyRoundPatch(
  patch: Record<string, unknown>,
  draw: DrawForReconcile,
  existing: ExistingForReconcile,
): void {
  const drawCanon = normalizeRoundShort(draw.round_label);
  const existingCanon = normalizeRoundShort(existing.round_canonical ?? existing.round);
  if (drawCanon !== null && drawCanon !== existingCanon) {
    patch.round = draw.round_label;
    patch.round_canonical = drawCanon;
  }
}

export function computeReconciliationPatch(
  draw: DrawForReconcile,
  existing: ExistingForReconcile,
  resolved: ResolvedFour,
): Record<string, unknown> | null {
  if (TERMINAL_STATUSES.has(existing.status)) return null;
  // `live` is its own gate so the result counter can split out
  // skippedTerminal vs skippedLive at the worker level. The pure builder
  // collapses both — only the orchestrator distinguishes them.
  if (existing.status === 'live') return null;
  if (isBye(draw)) return computeByePatch(draw, existing, resolved);
  return computeNonByePatch(draw, existing, resolved);
}

// ── Orchestrator ───────────────────────────────────────────────────────

interface TournamentRow {
  tournament_id: string;
  tournament_name: string;
  slug: string;
}

interface DrawSnapshotRow {
  match_widget_id: string | null;
  round_label: string | null;
  status: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  captured_at: string;
}

interface ExistingMatchRow {
  id: string;
  status: string;
  round: string | null;
  round_canonical: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  pair1_seed: number | null;
  pair2_seed: number | null;
  winner_pair: number | null;
  widget_id_composite: string | null;
}

export async function runFipDrawReconciler(
  deps: FipDrawReconcilerDeps,
): Promise<FipDrawReconcilerResult> {
  const { supabase, logger, dryRun } = deps;

  const result: FipDrawReconcilerResult = {
    tournamentsProcessed: 0,
    matchesConsidered: 0,
    matchesSkippedTerminal: 0,
    matchesSkippedLive: 0,
    matchesSkippedHasSets: 0,
    matchesSkippedNoDraw: 0,
    matchesUnchanged: 0,
    matchesUpdated: 0,
    byeTransitionsApplied: 0,
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
  const tournaments = deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0
    ? allTournaments.filter((t) => deps.onlyTournamentIds!.has(t.tournament_id))
    : allTournaments;

  for (const t of tournaments) {
    const tournamentWidgetId = await getActiveWidgetIdCode(supabase, t.tournament_id);
    if (!tournamentWidgetId) continue;

    // Latest fip_event_page draw snapshot per widget
    const latestDraw = await loadLatestFipDrawSnapshots(supabase, t.tournament_id);
    if (latestDraw.size === 0) continue;

    // Existing public.matches for the tournament, keyed by widget_id_composite suffix
    const existingByWidget = await loadExistingMatchesByPrefix(
      supabase,
      `${tournamentWidgetId}:`,
    );

    // Pre-resolve everything the draws name
    const nameToFipId = await loadEntryListNameMap(supabase, t.tournament_id);
    const wantedFipIds = new Set<string>();
    for (const d of latestDraw.values()) {
      for (const n of [d.team1_player1_name, d.team1_player2_name, d.team2_player1_name, d.team2_player2_name]) {
        if (!n) continue;
        const fipId = nameToFipId.get(normalizeForLookup(n));
        if (fipId) wantedFipIds.add(fipId);
      }
    }
    const fipIdToPlayerId = await loadPlayersByFipId(supabase, wantedFipIds);

    // Sets-existence per match_id — load once for the tournament
    const matchIdsWithSets = await loadMatchIdsWithSets(
      supabase,
      Array.from(existingByWidget.values()).map((m) => m.id),
    );

    result.tournamentsProcessed += 1;

    for (const [widget, existing] of existingByWidget) {
      result.matchesConsidered += 1;

      const drawWidget = widget.startsWith(`${tournamentWidgetId}:`)
        ? widget.slice(tournamentWidgetId.length + 1)
        : null;
      const draw = drawWidget ? latestDraw.get(drawWidget) : undefined;
      if (!draw) { result.matchesSkippedNoDraw += 1; continue; }

      if (TERMINAL_STATUSES.has(existing.status)) {
        result.matchesSkippedTerminal += 1;
        continue;
      }
      if (existing.status === 'live') {
        result.matchesSkippedLive += 1;
        continue;
      }
      if (matchIdsWithSets.has(existing.id)) {
        result.matchesSkippedHasSets += 1;
        continue;
      }

      const resolved = resolveDrawNamesLongForm(
        {
          team1_player1_name: draw.team1_player1_name,
          team1_player2_name: draw.team1_player2_name,
          team2_player1_name: draw.team2_player1_name,
          team2_player2_name: draw.team2_player2_name,
        },
        nameToFipId,
        fipIdToPlayerId,
      );

      const drawForReconcile: DrawForReconcile = {
        match_widget_id: drawWidget!,
        round_label: draw.round_label,
        status: draw.status,
        team1_seed: draw.team1_seed,
        team2_seed: draw.team2_seed,
        team1_player1_name: draw.team1_player1_name,
        team1_player2_name: draw.team1_player2_name,
        team2_player1_name: draw.team2_player1_name,
        team2_player2_name: draw.team2_player2_name,
      };

      const patch = computeReconciliationPatch(drawForReconcile, existing, resolved);
      if (!patch) { result.matchesUnchanged += 1; continue; }

      const bye = isBye(drawForReconcile);
      if (dryRun) {
        logger?.info(
          { matchId: existing.id, widget, patch, bye },
          'fip-draw-reconciler [dry-run]: would UPDATE match',
        );
      } else {
        const { error: updErr } = await supabase
          .from('matches')
          .update(patch)
          .eq('id', existing.id);
        if (updErr) {
          throw new Error(`matches update failed (id=${existing.id}): ${updErr.message}`);
        }
        logger?.info(
          { matchId: existing.id, widget, patch, bye },
          'fip-draw-reconciler: UPDATE',
        );
      }
      result.matchesUpdated += 1;
      if (bye) result.byeTransitionsApplied += 1;
    }
  }

  logger?.info(result, 'fip-draw-reconciler run complete');
  return result;
}

// Local normalizer kept in lockstep with loadEntryListNameMap's keys.
// Imported from draw-resolver would require pulling normalizeName too;
// it's two lines, inline copy is cheaper than another import.
function normalizeForLookup(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

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

async function loadLatestFipDrawSnapshots(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Map<string, DrawSnapshotRow>> {
  const rows = await paginatedSelect<DrawSnapshotRow>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('draw_snapshots')
        .select(
          'match_widget_id, round_label, status, team1_seed, team2_seed, ' +
            'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, captured_at',
        )
        .eq('tournament_id', tournamentId)
        .eq('source', 'fip_event_page')
        .order('captured_at', { ascending: false })
        .range(start, end),
    { what: `draw_snapshots (tournament=${tournamentId})` },
  );

  const latest = new Map<string, DrawSnapshotRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const prev = latest.get(r.match_widget_id);
    if (!prev || r.captured_at > prev.captured_at) latest.set(r.match_widget_id, r);
  }
  return latest;
}

async function loadExistingMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string,
): Promise<Map<string, ExistingForReconcile>> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, status, round, round_canonical, ' +
        'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
        'pair1_seed, pair2_seed, winner_pair, widget_id_composite',
    )
    .like('widget_id_composite', `${compositePrefix}%`);
  if (error) {
    throw new Error(
      `matches read failed (prefix=${compositePrefix}): ${error.message}`,
    );
  }
  const map = new Map<string, ExistingForReconcile>();
  for (const row of ((data ?? []) as unknown) as ExistingMatchRow[]) {
    if (row.widget_id_composite) {
      map.set(row.widget_id_composite, {
        id: row.id,
        status: row.status,
        round: row.round,
        round_canonical: row.round_canonical,
        pair1_player1_id: row.pair1_player1_id,
        pair1_player2_id: row.pair1_player2_id,
        pair2_player1_id: row.pair2_player1_id,
        pair2_player2_id: row.pair2_player2_id,
        pair1_seed: row.pair1_seed,
        pair2_seed: row.pair2_seed,
        winner_pair: row.winner_pair,
      });
    }
  }
  return map;
}

async function loadMatchIdsWithSets(
  supabase: SupabaseClient,
  matchIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  if (matchIds.length === 0) return result;
  // Batch in 100s — PostgREST `in` lists get unwieldy past a few hundred.
  const BATCH = 100;
  for (let i = 0; i < matchIds.length; i += BATCH) {
    const slice = matchIds.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('sets')
      .select('match_id')
      .in('match_id', slice);
    if (error) {
      throw new Error(`sets existence read failed: ${error.message}`);
    }
    for (const row of (data ?? []) as { match_id: string }[]) {
      if (row.match_id) result.add(row.match_id);
    }
  }
  return result;
}
