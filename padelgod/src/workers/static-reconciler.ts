import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  buildTournamentDictionary,
  resolveShortName,
  type DictionaryPlayer,
  type ResolveResult,
} from '../lib/tournament-dictionary.js';
import { findOrCreateMatch } from '../lib/match-identifier.js';
import { computeFinishedAtFallback } from '../lib/match-time-stamps.js';

export interface StaticReconcilerDeps {
  supabase: SupabaseClient;
  logger?: Logger;
}

export interface StaticReconcilerResult {
  tournamentsProcessed: number;
  playersUpserted: number;
  playersSkipped: number;
  drawMatchesWritten: number;
  drawTeamsWritten: number;
  drawsUnresolved: number;
  oopMatchesUpdated: number;
  oopUnresolved: number;
  resultsMatchesUpdated: number;
  setsWritten: number;
  resultsUnresolved: number;
}

const SNAPSHOT_LOOKBACK_DAYS = 14;

interface EntryListSnapshotRow {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string | null;
  name: string | null;
  country: string | null;
  captured_at: string;
  // Optional — present in the real snapshot schema (migration 013). Used
  // when building the tournament-dictionary for the draw phase so that
  // partner-based disambiguation works. Absent from the entry-list phase's
  // select list (kept minimal there), read explicitly by the draw phase.
  partner_fip_id?: string | null;
  partner_name?: string | null;
}

interface ExistingPlayerRow {
  id: string;
  fip_id: string;
  name: string | null;
  country: string | null;
  category: string | null;
}

interface DrawSnapshotRow {
  id: string;
  tournament_id: string;
  category: 'men' | 'women';
  draw_type: 'main_draw' | 'qualifying';
  round_label: string;
  draw_position: number | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
  team1_country: string | null;
  team2_country: string | null;
  captured_at: string;
}

/**
 * Top-level entry point. Runs the reconciler phases in order:
 *   1. `reconcileEntryLists` — entry-list snapshots → `public.players`
 *   2. `reconcileDraws`      — draw snapshots → `public.matches` +
 *                              `public.tournament_draws` (+ unresolved queue)
 *
 * Phases intentionally share a single cutoff window but are otherwise
 * independent; a failure in phase 2 does not roll back phase 1.
 */
export async function runStaticReconciler(
  deps: StaticReconcilerDeps
): Promise<StaticReconcilerResult> {
  const cutoff = new Date(
    Date.now() - SNAPSHOT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const entryListResult = await reconcileEntryLists(deps, cutoff);
  const drawResult = await reconcileDraws(deps, cutoff);
  const oopResult = await reconcileOOP(deps, cutoff);
  const resultsResult = await reconcileResults(deps, cutoff);

  deps.logger?.info(
    { ...entryListResult, ...drawResult, ...oopResult, ...resultsResult },
    'static-reconciler run complete'
  );

  return {
    ...entryListResult,
    ...drawResult,
    ...oopResult,
    ...resultsResult,
  };
}

/**
 * Phase 1: entry list → players.
 *
 * For each (tournament_id, category) with recent entry list snapshots, pick
 * the latest snapshot batch and upsert `public.players` by `fip_id` (hot
 * column — no sidecar write needed).
 *
 * - Rows with a null fip_id are skipped (can't safely create thin records).
 * - Rows duplicated within the same snapshot (same fip_id) are deduplicated
 *   before writing.
 * - Every write records `last_updated_by='padelgod'` for the source-of-truth
 *   audit trail.
 */
async function reconcileEntryLists(
  deps: StaticReconcilerDeps,
  cutoff: string
): Promise<{
  tournamentsProcessed: number;
  playersUpserted: number;
  playersSkipped: number;
}> {
  const { supabase, logger } = deps;

  const { data: snapshotRows, error: snapErr } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select('tournament_id, category, fip_id, name, country, captured_at')
    .gte('captured_at', cutoff);

  if (snapErr) {
    throw new Error(`entry_list_snapshots read failed: ${snapErr.message}`);
  }

  const rows = (snapshotRows ?? []) as EntryListSnapshotRow[];

  // Group by (tournament_id, category) and keep only rows from the latest
  // captured_at per group.
  const groups = new Map<string, EntryListSnapshotRow[]>();
  for (const row of rows) {
    const key = `${row.tournament_id}::${row.category}`;
    const arr = groups.get(key);
    if (arr) arr.push(row);
    else groups.set(key, [row]);
  }

  const latestRows: EntryListSnapshotRow[] = [];
  for (const groupRows of groups.values()) {
    let maxCapturedAt = '';
    for (const r of groupRows) {
      if (r.captured_at > maxCapturedAt) maxCapturedAt = r.captured_at;
    }
    for (const r of groupRows) {
      if (r.captured_at === maxCapturedAt) latestRows.push(r);
    }
  }

  const tournamentsProcessed = new Set(latestRows.map((r) => r.tournament_id))
    .size;

  // Dedup by fip_id within the latest-snapshot rows. Keep the first
  // occurrence. Skip rows with null fip_id entirely.
  const byFipId = new Map<string, EntryListSnapshotRow>();
  let playersSkipped = 0;
  for (const r of latestRows) {
    if (!r.fip_id) {
      playersSkipped += 1;
      continue;
    }
    if (byFipId.has(r.fip_id)) continue;
    byFipId.set(r.fip_id, r);
  }

  if (byFipId.size === 0) {
    return { tournamentsProcessed, playersUpserted: 0, playersSkipped };
  }

  const fipIds = Array.from(byFipId.keys());

  // Fetch existing player rows so we can decide insert vs update.
  const { data: existing, error: existErr } = await supabase
    .from('players')
    .select('id, fip_id, name, country, category')
    .in('fip_id', fipIds);

  if (existErr) {
    throw new Error(`players read failed: ${existErr.message}`);
  }

  const existingByFipId = new Map<string, ExistingPlayerRow>();
  for (const row of (existing ?? []) as ExistingPlayerRow[]) {
    if (row.fip_id) existingByFipId.set(row.fip_id, row);
  }

  const now = new Date().toISOString();
  let playersUpserted = 0;

  for (const [fipId, snap] of byFipId.entries()) {
    const match = existingByFipId.get(fipId);

    if (match) {
      const nameDiffers = snap.name != null && snap.name !== match.name;
      const countryDiffers =
        snap.country != null && snap.country !== match.country;
      const categoryDiffers = snap.category !== match.category;

      if (!nameDiffers && !countryDiffers && !categoryDiffers) {
        continue;
      }

      const update: Record<string, unknown> = {
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (nameDiffers) update.name = snap.name;
      if (countryDiffers) update.country = snap.country;
      if (categoryDiffers) update.category = snap.category;

      const { error: updErr } = await supabase
        .from('players')
        .update(update)
        .eq('id', match.id);

      if (updErr) {
        throw new Error(
          `players update failed (fip_id=${fipId}): ${updErr.message}`
        );
      }
      playersUpserted += 1;
    } else {
      if (!snap.name) {
        playersSkipped += 1;
        continue;
      }

      const insert: Record<string, unknown> = {
        fip_id: fipId,
        name: snap.name,
        category: snap.category,
        source: 'fip',
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (snap.country != null) insert.country = snap.country;

      const { error: insErr } = await supabase.from('players').insert(insert);

      if (insErr) {
        throw new Error(
          `players insert failed (fip_id=${fipId}): ${insErr.message}`
        );
      }
      playersUpserted += 1;
    }
  }

  logger?.info(
    { tournamentsProcessed, playersUpserted, playersSkipped },
    'static-reconciler entry-list phase complete'
  );

  return { tournamentsProcessed, playersUpserted, playersSkipped };
}

// ─── Draw phase ──────────────────────────────────────────────────────────────

interface EntryListDictRow {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string | null;
  name: string | null;
  country: string | null;
  partner_fip_id: string | null;
  partner_name: string | null;
  captured_at: string;
}

/**
 * Phase 2: draw → matches + tournament_draws.
 *
 * For each (tournament_id, category) with recent draw snapshots, use the
 * latest entry-list snapshot for that pair to build a dictionary, then
 * resolve the 4 short names on each draw row. If all 4 resolve:
 *   - call `findOrCreateMatch` with a synthetic widget id
 *     (`draw:<category>:<draw_type>:<round_label>:<draw_position>`). When
 *     OOP/results later provides a real widget id, match-identifier's
 *     pair-based fallback links the existing record.
 *   - UPSERT two rows into `public.tournament_draws` — one per team. The
 *     existing ops UI (`/api/ops/seed-draw`) uses one row per team/pair, so
 *     each draw_snapshot MATCH becomes TWO tournament_draws rows.
 * If any name is unresolved: queue all unresolved raw names in
 * `padelgod.unresolved_players` and skip the draw row entirely. No partial
 * match rows are written.
 */
async function reconcileDraws(
  deps: StaticReconcilerDeps,
  cutoff: string
): Promise<{
  drawMatchesWritten: number;
  drawTeamsWritten: number;
  drawsUnresolved: number;
}> {
  const { supabase, logger } = deps;

  // 1. Fetch recent draw snapshots.
  const { data: drawRows, error: drawErr } = await supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .select(
      'id, tournament_id, category, draw_type, round_label, draw_position, ' +
        'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, ' +
        'team1_seed, team2_seed, team1_country, team2_country, captured_at'
    )
    .gte('captured_at', cutoff);

  if (drawErr) {
    throw new Error(`draw_snapshots read failed: ${drawErr.message}`);
  }

  const draws = (drawRows ?? []) as unknown as DrawSnapshotRow[];
  if (draws.length === 0) {
    return { drawMatchesWritten: 0, drawTeamsWritten: 0, drawsUnresolved: 0 };
  }

  // 2. Keep only the latest draw snapshot per
  // (tournament_id, category, draw_type, round_label, draw_position).
  const drawKey = (d: DrawSnapshotRow) =>
    `${d.tournament_id}::${d.category}::${d.draw_type}::${d.round_label}::${d.draw_position ?? 'null'}`;
  const latestDrawByKey = new Map<string, DrawSnapshotRow>();
  for (const d of draws) {
    const k = drawKey(d);
    const prev = latestDrawByKey.get(k);
    if (!prev || d.captured_at > prev.captured_at) {
      latestDrawByKey.set(k, d);
    }
  }
  const latestDraws = Array.from(latestDrawByKey.values());

  // 3. For each (tournament_id, category) in the draw set, fetch the
  //    latest entry-list snapshot — we'll need it to build the dictionary.
  const tourCatPairs = new Set<string>();
  for (const d of latestDraws) {
    tourCatPairs.add(`${d.tournament_id}::${d.category}`);
  }

  const dictionaries = new Map<
    string,
    ReturnType<typeof buildTournamentDictionary>
  >();
  const tournamentIds = new Set<string>();
  for (const key of tourCatPairs) {
    const [tournamentId, category] = key.split('::') as [
      string,
      'men' | 'women',
    ];
    tournamentIds.add(tournamentId);
    const { data: elRows, error: elErr } = await supabase
      .schema('padelgod')
      .from('entry_list_snapshots')
      .select(
        'tournament_id, category, fip_id, name, country, partner_fip_id, partner_name, captured_at'
      )
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .gte('captured_at', cutoff);

    if (elErr) {
      throw new Error(
        `entry_list_snapshots read failed for dict build (tournament=${tournamentId}, category=${category}): ${elErr.message}`
      );
    }

    const rows = (elRows ?? []) as EntryListDictRow[];
    if (rows.length === 0) {
      // No entry list for this (tournament, category) — dict is empty.
      // Every draw row for this pair will be flagged unresolved.
      dictionaries.set(key, buildTournamentDictionary([]));
      continue;
    }

    // Latest captured_at filter.
    let maxAt = '';
    for (const r of rows) {
      if (r.captured_at > maxAt) maxAt = r.captured_at;
    }
    const latest = rows.filter((r) => r.captured_at === maxAt);

    const dictPlayers: DictionaryPlayer[] = [];
    const seenFipIds = new Set<string>();
    for (const r of latest) {
      if (!r.fip_id || !r.name) continue;
      if (seenFipIds.has(r.fip_id)) continue;
      seenFipIds.add(r.fip_id);
      dictPlayers.push({
        fipId: r.fip_id,
        name: r.name,
        country: r.country,
        partnerFipId: r.partner_fip_id ?? null,
        partnerName: r.partner_name ?? null,
      });
    }

    dictionaries.set(key, buildTournamentDictionary(dictPlayers));
  }

  // 4. Batch-fetch fip_id → players.id for all fip_ids in all dictionaries.
  const allFipIds = new Set<string>();
  for (const dict of dictionaries.values()) {
    for (const fipId of dict.players.keys()) allFipIds.add(fipId);
  }
  const fipIdToPlayerId = new Map<string, string>();
  if (allFipIds.size > 0) {
    const { data: playerRows, error: plErr } = await supabase
      .from('players')
      .select('id, fip_id')
      .in('fip_id', Array.from(allFipIds));
    if (plErr) {
      throw new Error(
        `players read for fip_id → UUID map failed: ${plErr.message}`
      );
    }
    for (const row of (playerRows ?? []) as { id: string; fip_id: string }[]) {
      if (row.fip_id && row.id) fipIdToPlayerId.set(row.fip_id, row.id);
    }
  }

  // 5. Iterate draws, resolve players, and write.
  let drawMatchesWritten = 0;
  let drawTeamsWritten = 0;
  let drawsUnresolved = 0;

  for (const d of latestDraws) {
    if (d.draw_position == null) {
      // Without a position, we can't key tournament_draws rows or build a
      // stable synthetic widget id. Skip.
      continue;
    }

    const dictKey = `${d.tournament_id}::${d.category}`;
    const dict = dictionaries.get(dictKey) ?? buildTournamentDictionary([]);

    const names: Array<{
      raw: string | null;
      partnerHint: string | null;
      position: 'team1_p1' | 'team1_p2' | 'team2_p1' | 'team2_p2';
    }> = [
      {
        raw: d.team1_player1_name,
        partnerHint: d.team1_player2_name,
        position: 'team1_p1',
      },
      {
        raw: d.team1_player2_name,
        partnerHint: d.team1_player1_name,
        position: 'team1_p2',
      },
      {
        raw: d.team2_player1_name,
        partnerHint: d.team2_player2_name,
        position: 'team2_p1',
      },
      {
        raw: d.team2_player2_name,
        partnerHint: d.team2_player1_name,
        position: 'team2_p2',
      },
    ];

    const resolved: Array<{ fipId: string | null; result: ResolveResult }> = [];
    const unresolvedNames: Array<{
      raw: string;
      partnerHint: string | null;
    }> = [];

    let allResolved = true;
    for (const n of names) {
      if (!n.raw) {
        // A null name on a draw row means the slot is still a bye/TBD.
        // Treat this as an unresolved draw row (skip writing) — we can't
        // construct a full pair-match without all 4 names.
        allResolved = false;
        continue;
      }
      const r = resolveShortName(dict, n.raw, n.partnerHint ?? undefined);
      resolved.push({ fipId: r.fipId, result: r });
      if (!r.fipId) {
        allResolved = false;
        unresolvedNames.push({
          raw: n.raw,
          partnerHint: n.partnerHint ?? null,
        });
      }
    }

    if (!allResolved) {
      // Write every unresolved raw name to the queue. The UNIQUE key is
      // (tournament_id, widget_short_name, partner_short_name) so re-runs
      // update `first_seen_at` via onConflict + ignoreDuplicates.
      for (const u of unresolvedNames) {
        const { error: uErr } = await supabase
          .schema('padelgod')
          .from('unresolved_players')
          .upsert(
            {
              tournament_id: d.tournament_id,
              widget_short_name: u.raw,
              partner_short_name: u.partnerHint,
              candidate_player_ids: null,
              status: 'pending',
            },
            {
              onConflict: 'tournament_id,widget_short_name,partner_short_name',
              ignoreDuplicates: true,
            }
          );
        if (uErr) {
          throw new Error(
            `unresolved_players upsert failed (tournament=${d.tournament_id}, name="${u.raw}"): ${uErr.message}`
          );
        }
      }
      drawsUnresolved += 1;
      continue;
    }

    // All 4 resolved to fipIds. Look up canonical UUIDs.
    // (resolved has exactly 4 entries because we only get here when every
    // non-null name resolved AND no name was null.)
    if (resolved.length !== 4) {
      // Defensive: shouldn't happen, but skip to be safe.
      drawsUnresolved += 1;
      continue;
    }
    const [t1p1, t1p2, t2p1, t2p2] = resolved;
    const t1p1Uuid = fipIdToPlayerId.get(t1p1!.fipId!) ?? null;
    const t1p2Uuid = fipIdToPlayerId.get(t1p2!.fipId!) ?? null;
    const t2p1Uuid = fipIdToPlayerId.get(t2p1!.fipId!) ?? null;
    const t2p2Uuid = fipIdToPlayerId.get(t2p2!.fipId!) ?? null;

    // If the dictionary knew the fipId but phase 1 hadn't run yet (or the
    // player record was missing for some other reason), we can't drive the
    // pair-based fallback in match-identifier — findOrCreateMatch will just
    // insert a thin match row without player UUIDs. That's OK — the next run
    // (after phase 1 catches up) will still work because the synthetic
    // widget id is stable across runs.

    const matchWidgetId = `${d.category}:${d.draw_type}:${d.round_label}:${d.draw_position}`;
    const { matchId } = await findOrCreateMatch(supabase, {
      tournamentId: d.tournament_id,
      tournamentWidgetId: 'draw',
      matchWidgetId,
      category: d.category,
      roundLabel: d.round_label,
      pair1PlayerIds: [t1p1Uuid, t1p2Uuid],
      pair2PlayerIds: [t2p1Uuid, t2p2Uuid],
    });

    drawMatchesWritten += 1;

    // Write two tournament_draws rows — one per team. Position mapping:
    //   team1 → 2*draw_position - 1
    //   team2 → 2*draw_position
    // This matches the existing /api/ops/seed-draw convention where each row
    // represents one PAIR (two players) at one bracket slot.
    const teamRows = [
      {
        tournament_id: d.tournament_id,
        category: d.category,
        draw_position: 2 * d.draw_position - 1,
        seed: d.team1_seed,
        marker: null,
        player1_name: d.team1_player1_name,
        player1_country: d.team1_country,
        player1_id: t1p1Uuid,
        player2_name: d.team1_player2_name,
        player2_country: d.team1_country,
        player2_id: t1p2Uuid,
        team_points: null,
      },
      {
        tournament_id: d.tournament_id,
        category: d.category,
        draw_position: 2 * d.draw_position,
        seed: d.team2_seed,
        marker: null,
        player1_name: d.team2_player1_name,
        player1_country: d.team2_country,
        player1_id: t2p1Uuid,
        player2_name: d.team2_player2_name,
        player2_country: d.team2_country,
        player2_id: t2p2Uuid,
        team_points: null,
      },
    ];

    for (const teamRow of teamRows) {
      const { error: tdErr } = await supabase
        .from('tournament_draws')
        .upsert(teamRow, {
          onConflict: 'tournament_id,category,draw_position',
        });
      if (tdErr) {
        throw new Error(
          `tournament_draws upsert failed (tournament=${d.tournament_id}, position=${teamRow.draw_position}): ${tdErr.message}`
        );
      }
      drawTeamsWritten += 1;
    }

    // matchId is intentionally unused past this point — the draw phase does
    // not write to `sets` or touch match status. Results/OOP reconcilers
    // (Task 7) own those.
    void matchId;
  }

  logger?.info(
    { drawMatchesWritten, drawTeamsWritten, drawsUnresolved },
    'static-reconciler draw phase complete'
  );

  return { drawMatchesWritten, drawTeamsWritten, drawsUnresolved };
}

// ─── Shared helpers for OOP + results phases ─────────────────────────────────

/**
 * Build an in-memory player dictionary for (tournament_id, category) using the
 * latest entry-list snapshot batch. Shared by the draw, OOP, and results
 * phases. Returns an empty dictionary if the entry list hasn't been captured
 * yet — callers must decide how to handle that (OOP/results currently skip
 * rows that can't be resolved, same as the draw phase).
 */
async function buildDictForTournamentCategory(
  supabase: SupabaseClient,
  tournamentId: string,
  category: 'men' | 'women',
  cutoff: string
): Promise<ReturnType<typeof buildTournamentDictionary>> {
  const { data: elRows, error: elErr } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select(
      'tournament_id, category, fip_id, name, country, partner_fip_id, partner_name, captured_at'
    )
    .eq('tournament_id', tournamentId)
    .eq('category', category)
    .gte('captured_at', cutoff);

  if (elErr) {
    throw new Error(
      `entry_list_snapshots read failed for dict build (tournament=${tournamentId}, category=${category}): ${elErr.message}`
    );
  }

  const rows = (elRows ?? []) as EntryListDictRow[];
  if (rows.length === 0) return buildTournamentDictionary([]);

  let maxAt = '';
  for (const r of rows) {
    if (r.captured_at > maxAt) maxAt = r.captured_at;
  }
  const latest = rows.filter((r) => r.captured_at === maxAt);

  const dictPlayers: DictionaryPlayer[] = [];
  const seenFipIds = new Set<string>();
  for (const r of latest) {
    if (!r.fip_id || !r.name) continue;
    if (seenFipIds.has(r.fip_id)) continue;
    seenFipIds.add(r.fip_id);
    dictPlayers.push({
      fipId: r.fip_id,
      name: r.name,
      country: r.country,
      partnerFipId: r.partner_fip_id ?? null,
      partnerName: r.partner_name ?? null,
    });
  }

  return buildTournamentDictionary(dictPlayers);
}

/**
 * Parse a Crionet-style set score string into structured per-set objects.
 *
 * Examples:
 *   "6-4 4-6 6-2"        → three straight sets, no tiebreak
 *   "7-6(3) 4-6 6-2"     → set 1 tiebreak, loser (pair2) took 3 points
 *   "6(5)-7 6-4 6-3"     → set 1 tiebreak, loser (pair1) took 5 points
 *
 * For `set_score` we always return the clean "7-6" format (without the
 * tiebreak digit) to match the main app convention — per-game tiebreak
 * details belong in the `games` table which is out of scope for V1.
 */
export interface ParsedSet {
  set_number: number;
  pair1_games: number;
  pair2_games: number;
  set_score: string;
  tiebreak_loser_points: number | null;
}

export function parseSetScores(text: string): ParsedSet[] {
  const out: ParsedSet[] = [];
  if (!text) return out;
  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Token shape: "G[(T)]-G[(T)]" — e.g. "6-4", "7-6(3)", "6(5)-7"
  const RE = /^(\d+)(?:\((\d+)\))?-(\d+)(?:\((\d+)\))?$/;

  tokens.forEach((tok, i) => {
    const m = RE.exec(tok);
    if (!m) return;
    const pair1 = Number(m[1]);
    const tb1 = m[2] != null ? Number(m[2]) : null;
    const pair2 = Number(m[3]);
    const tb2 = m[4] != null ? Number(m[4]) : null;
    if (!Number.isFinite(pair1) || !Number.isFinite(pair2)) return;

    // Only one side may carry the tiebreak digit — whichever side is the
    // LOSER of the tiebreak. If both are present (malformed), prefer the
    // loser-side digit.
    let tbLoser: number | null = null;
    if (pair1 > pair2 && tb2 != null) tbLoser = tb2;
    else if (pair2 > pair1 && tb1 != null) tbLoser = tb1;
    else if (tb1 != null) tbLoser = tb1;
    else if (tb2 != null) tbLoser = tb2;

    out.push({
      set_number: i + 1,
      pair1_games: pair1,
      pair2_games: pair2,
      set_score: `${pair1}-${pair2}`,
      tiebreak_loser_points: tbLoser,
    });
  });

  return out;
}

/**
 * Resolve the four widget short names on an OOP/results snapshot row against
 * the dictionary, then canonicalize fip_ids → UUIDs via the batch map. Returns
 * null if any of the four names is missing or doesn't resolve.
 */
interface ResolvedPair {
  p1p1: string;
  p1p2: string;
  p2p1: string;
  p2p2: string;
}

function resolveFourNames(
  dict: ReturnType<typeof buildTournamentDictionary>,
  fipIdToPlayerId: Map<string, string>,
  names: {
    t1p1: string | null;
    t1p2: string | null;
    t2p1: string | null;
    t2p2: string | null;
  }
): ResolvedPair | null {
  if (!names.t1p1 || !names.t1p2 || !names.t2p1 || !names.t2p2) return null;
  const r1 = resolveShortName(dict, names.t1p1, names.t1p2);
  const r2 = resolveShortName(dict, names.t1p2, names.t1p1);
  const r3 = resolveShortName(dict, names.t2p1, names.t2p2);
  const r4 = resolveShortName(dict, names.t2p2, names.t2p1);
  if (!r1.fipId || !r2.fipId || !r3.fipId || !r4.fipId) return null;

  const u1 = fipIdToPlayerId.get(r1.fipId);
  const u2 = fipIdToPlayerId.get(r2.fipId);
  const u3 = fipIdToPlayerId.get(r3.fipId);
  const u4 = fipIdToPlayerId.get(r4.fipId);
  if (!u1 || !u2 || !u3 || !u4) return null;
  return { p1p1: u1, p1p2: u2, p2p1: u3, p2p2: u4 };
}

/**
 * Batch-fetch the fip_id → players.id map for every fip_id present in the
 * supplied dictionaries.
 */
async function buildFipIdToPlayerIdMap(
  supabase: SupabaseClient,
  dictionaries: Iterable<ReturnType<typeof buildTournamentDictionary>>
): Promise<Map<string, string>> {
  const allFipIds = new Set<string>();
  for (const dict of dictionaries) {
    for (const fipId of dict.players.keys()) allFipIds.add(fipId);
  }
  const fipIdToPlayerId = new Map<string, string>();
  if (allFipIds.size === 0) return fipIdToPlayerId;

  const { data: playerRows, error: plErr } = await supabase
    .from('players')
    .select('id, fip_id')
    .in('fip_id', Array.from(allFipIds));
  if (plErr) {
    throw new Error(
      `players read for fip_id → UUID map failed: ${plErr.message}`
    );
  }
  for (const row of (playerRows ?? []) as { id: string; fip_id: string }[]) {
    if (row.fip_id && row.id) fipIdToPlayerId.set(row.fip_id, row.id);
  }
  return fipIdToPlayerId;
}

/**
 * Fetch the active `widget_id_cache.widget_id` for a tournament, or null if
 * widget-code-lookup hasn't resolved it yet. OOP + results phases skip
 * tournaments where this is null — reconciliation will pick up on the next
 * tick once the code is cached.
 */
async function getActiveWidgetId(
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
  return (data as { widget_id?: string } | null)?.widget_id ?? null;
}

// ─── OOP phase ───────────────────────────────────────────────────────────────

interface OopSnapshotRow {
  id: string;
  tournament_id: string;
  category: 'men' | 'women';
  day_number: number;
  round_label: string | null;
  court: string;
  court_position: number | null;
  scheduled_label: string | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  match_widget_id: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

/**
 * Phase 3: OOP → matches.
 *
 * For each recent `oop_snapshots` row, resolve its four widget short names
 * against the latest entry-list dictionary and locate-or-create the match via
 * the REAL tournament widget id from `padelgod.widget_id_cache`. Then UPDATE
 * the match's `court` and `round`.
 *
 * **scheduled_at is intentionally not written in V1.** Widget time labels
 * ("Starting at 10:00 AM", "Followed by", etc.) need tournament-timezone
 * handling that this worker doesn't have — the main app's OOP review workflow
 * (human-in-the-loop) owns scheduled_at writes. We only emit the structural
 * fields (court + round) that don't depend on timezone.
 */
async function reconcileOOP(
  deps: StaticReconcilerDeps,
  cutoff: string
): Promise<{ oopMatchesUpdated: number; oopUnresolved: number }> {
  const { supabase, logger } = deps;

  const { data: oopRows, error: oopErr } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select(
      'id, tournament_id, category, day_number, round_label, court, court_position, ' +
        'scheduled_label, team1_player1_name, team1_player2_name, team2_player1_name, ' +
        'team2_player2_name, match_widget_id, status, captured_at'
    )
    .gte('captured_at', cutoff);

  if (oopErr) {
    throw new Error(`oop_snapshots read failed: ${oopErr.message}`);
  }

  const rows = ((oopRows ?? []) as unknown as OopSnapshotRow[]).filter(
    (r) => r.match_widget_id != null
  );
  if (rows.length === 0) {
    return { oopMatchesUpdated: 0, oopUnresolved: 0 };
  }

  // Keep only the latest snapshot per (tournament_id, match_widget_id).
  const latest = new Map<string, OopSnapshotRow>();
  for (const r of rows) {
    const key = `${r.tournament_id}::${r.match_widget_id}`;
    const prev = latest.get(key);
    if (!prev || r.captured_at > prev.captured_at) latest.set(key, r);
  }
  const latestRows = Array.from(latest.values());

  // Build dicts + widget ids per (tournament_id, category) pair.
  const tourCatPairs = new Set<string>();
  for (const r of latestRows) {
    tourCatPairs.add(`${r.tournament_id}::${r.category}`);
  }
  const dictionaries = new Map<
    string,
    ReturnType<typeof buildTournamentDictionary>
  >();
  const widgetIdByTournament = new Map<string, string | null>();
  for (const key of tourCatPairs) {
    const [tid, cat] = key.split('::') as [string, 'men' | 'women'];
    if (!dictionaries.has(key)) {
      dictionaries.set(key, await buildDictForTournamentCategory(supabase, tid, cat, cutoff));
    }
    if (!widgetIdByTournament.has(tid)) {
      widgetIdByTournament.set(tid, await getActiveWidgetId(supabase, tid));
    }
  }

  const fipIdToPlayerId = await buildFipIdToPlayerIdMap(
    supabase,
    dictionaries.values()
  );

  let oopMatchesUpdated = 0;
  let oopUnresolved = 0;

  for (const r of latestRows) {
    const tournamentWidgetId = widgetIdByTournament.get(r.tournament_id);
    if (!tournamentWidgetId) {
      // Widget-code-lookup hasn't resolved yet — skip for now; next tick retries.
      oopUnresolved += 1;
      continue;
    }

    const dict = dictionaries.get(`${r.tournament_id}::${r.category}`);
    if (!dict) {
      oopUnresolved += 1;
      continue;
    }

    const resolved = resolveFourNames(dict, fipIdToPlayerId, {
      t1p1: r.team1_player1_name,
      t1p2: r.team1_player2_name,
      t2p1: r.team2_player1_name,
      t2p2: r.team2_player2_name,
    });
    if (!resolved) {
      oopUnresolved += 1;
      continue;
    }

    const { matchId } = await findOrCreateMatch(supabase, {
      tournamentId: r.tournament_id,
      tournamentWidgetId,
      matchWidgetId: r.match_widget_id!,
      category: r.category,
      roundLabel: r.round_label ?? '',
      court: r.court,
      pair1PlayerIds: [resolved.p1p1, resolved.p1p2],
      pair2PlayerIds: [resolved.p2p1, resolved.p2p2],
    });

    const update: Record<string, unknown> = {
      court: r.court,
      last_updated_by: 'padelgod',
      updated_at: new Date().toISOString(),
    };
    if (r.round_label != null) update.round = r.round_label;
    // court_position is 0-based from the OOP widget; matches.court_order is
    // 1-based (matches padelapi convention). Historical snapshots may carry
    // NULL — leave court_order untouched in that case so we don't clobber a
    // value the padelapi sync may have written earlier.
    if (r.court_position != null) update.court_order = r.court_position + 1;
    // scheduled_at intentionally NOT written — see phase docblock.

    const { error: updErr } = await supabase
      .from('matches')
      .update(update)
      .eq('id', matchId);
    if (updErr) {
      throw new Error(
        `matches update failed (id=${matchId}, oop widget=${r.match_widget_id}): ${updErr.message}`
      );
    }
    oopMatchesUpdated += 1;
  }

  logger?.info(
    { oopMatchesUpdated, oopUnresolved },
    'static-reconciler OOP phase complete'
  );
  return { oopMatchesUpdated, oopUnresolved };
}

// ─── Results phase ───────────────────────────────────────────────────────────

interface ResultsSnapshotRow {
  id: string;
  tournament_id: string;
  category: 'men' | 'women';
  day_number: number;
  round_label: string | null;
  court: string | null;
  match_widget_id: string | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  set_scores: string;
  winner_team: 1 | 2;
  status: 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

/**
 * Phase 4: results → matches + sets.
 *
 * For each recent `results_snapshots` row, resolve its four widget short
 * names, locate-or-create the match via the real tournament widget id, UPDATE
 * status/winner_pair, then UPSERT the parsed per-set rows into `public.sets`
 * with `score_source='api'` (results are the authoritative final state).
 */
async function reconcileResults(
  deps: StaticReconcilerDeps,
  cutoff: string
): Promise<{
  resultsMatchesUpdated: number;
  setsWritten: number;
  resultsUnresolved: number;
}> {
  const { supabase, logger } = deps;

  const { data: resultsRows, error: resErr } = await supabase
    .schema('padelgod')
    .from('results_snapshots')
    .select(
      'id, tournament_id, category, day_number, round_label, court, match_widget_id, ' +
        'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, ' +
        'set_scores, winner_team, status, captured_at'
    )
    .gte('captured_at', cutoff);

  if (resErr) {
    throw new Error(`results_snapshots read failed: ${resErr.message}`);
  }

  const rows = ((resultsRows ?? []) as unknown as ResultsSnapshotRow[]).filter(
    (r) => r.match_widget_id != null
  );
  if (rows.length === 0) {
    return { resultsMatchesUpdated: 0, setsWritten: 0, resultsUnresolved: 0 };
  }

  // Keep only the latest snapshot per (tournament_id, match_widget_id).
  const latest = new Map<string, ResultsSnapshotRow>();
  for (const r of rows) {
    const key = `${r.tournament_id}::${r.match_widget_id}`;
    const prev = latest.get(key);
    if (!prev || r.captured_at > prev.captured_at) latest.set(key, r);
  }
  const latestRows = Array.from(latest.values());

  const tourCatPairs = new Set<string>();
  for (const r of latestRows) {
    tourCatPairs.add(`${r.tournament_id}::${r.category}`);
  }
  const dictionaries = new Map<
    string,
    ReturnType<typeof buildTournamentDictionary>
  >();
  const widgetIdByTournament = new Map<string, string | null>();
  for (const key of tourCatPairs) {
    const [tid, cat] = key.split('::') as [string, 'men' | 'women'];
    if (!dictionaries.has(key)) {
      dictionaries.set(key, await buildDictForTournamentCategory(supabase, tid, cat, cutoff));
    }
    if (!widgetIdByTournament.has(tid)) {
      widgetIdByTournament.set(tid, await getActiveWidgetId(supabase, tid));
    }
  }

  const fipIdToPlayerId = await buildFipIdToPlayerIdMap(
    supabase,
    dictionaries.values()
  );

  let resultsMatchesUpdated = 0;
  let setsWritten = 0;
  let resultsUnresolved = 0;

  for (const r of latestRows) {
    const tournamentWidgetId = widgetIdByTournament.get(r.tournament_id);
    if (!tournamentWidgetId) {
      resultsUnresolved += 1;
      continue;
    }

    const dict = dictionaries.get(`${r.tournament_id}::${r.category}`);
    if (!dict) {
      resultsUnresolved += 1;
      continue;
    }

    const resolved = resolveFourNames(dict, fipIdToPlayerId, {
      t1p1: r.team1_player1_name,
      t1p2: r.team1_player2_name,
      t2p1: r.team2_player1_name,
      t2p2: r.team2_player2_name,
    });
    if (!resolved) {
      resultsUnresolved += 1;
      continue;
    }

    const { matchId } = await findOrCreateMatch(supabase, {
      tournamentId: r.tournament_id,
      tournamentWidgetId,
      matchWidgetId: r.match_widget_id!,
      category: r.category,
      roundLabel: r.round_label ?? '',
      court: r.court ?? null,
      pair1PlayerIds: [resolved.p1p1, resolved.p1p2],
      pair2PlayerIds: [resolved.p2p1, resolved.p2p2],
    });

    const nowIso = new Date().toISOString();
    const matchUpdate: Record<string, unknown> = {
      status: r.status,
      winner_pair: r.winner_team,
      last_updated_by: 'padelgod',
      updated_at: nowIso,
    };
    if (r.round_label != null) matchUpdate.round = r.round_label;
    if (r.court != null) matchUpdate.court = r.court;

    const { error: mUpdErr } = await supabase
      .from('matches')
      .update(matchUpdate)
      .eq('id', matchId);
    if (mUpdErr) {
      throw new Error(
        `matches update failed (id=${matchId}, results widget=${r.match_widget_id}): ${mUpdErr.message}`
      );
    }
    resultsMatchesUpdated += 1;

    // Backfill finished_at when the live-poller didn't own this match.
    // The live-poller stamps finished_at precisely on the live→finished tick,
    // but only if padelgod was actively polling it. For matches scraped only
    // via the results widget (poller wasn't running, late-enrolled tournament,
    // etc.), fall back to `started_at + duration` if we have them, otherwise
    // `captured_at`. The .is(null) guard ensures the live-poller's precise
    // stamp always wins when present, so double-running is idempotent.
    const { data: mRow, error: mReadErr } = await supabase
      .from('matches')
      .select('started_at, duration, finished_at')
      .eq('id', matchId)
      .maybeSingle();
    if (mReadErr) {
      logger?.warn(
        { matchId, err: mReadErr.message },
        'static-reconciler: finished_at backfill read failed'
      );
    } else if (mRow && !mRow.finished_at) {
      const finishedAt = computeFinishedAtFallback(
        (mRow.started_at as string | null) ?? null,
        (mRow.duration as string | null) ?? null,
        r.captured_at
      );
      const { error: fUpdErr } = await supabase
        .from('matches')
        .update({ finished_at: finishedAt })
        .eq('id', matchId)
        .is('finished_at', null);
      if (fUpdErr) {
        logger?.warn(
          { matchId, err: fUpdErr.message },
          'static-reconciler: finished_at backfill write failed'
        );
      }
    }

    const parsedSets = parseSetScores(r.set_scores);
    for (const s of parsedSets) {
      const row = {
        match_id: matchId,
        set_number: s.set_number,
        set_score: s.set_score,
        pair1_games: s.pair1_games,
        pair2_games: s.pair2_games,
        is_current: false,
        score_source: 'api',
        updated_at: nowIso,
      };
      const { error: sUpErr } = await supabase
        .from('sets')
        .upsert(row, { onConflict: 'match_id,set_number' });
      if (sUpErr) {
        throw new Error(
          `sets upsert failed (match=${matchId}, set=${s.set_number}): ${sUpErr.message}`
        );
      }
      setsWritten += 1;
    }
  }

  logger?.info(
    { resultsMatchesUpdated, setsWritten, resultsUnresolved },
    'static-reconciler results phase complete'
  );

  return { resultsMatchesUpdated, setsWritten, resultsUnresolved };
}
