import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  buildTournamentDictionary,
  resolveShortName,
  type DictionaryPlayer,
  type ResolveResult,
} from '../lib/tournament-dictionary.js';
import { findOrCreateMatch } from '../lib/match-identifier.js';

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

  deps.logger?.info(
    { ...entryListResult, ...drawResult },
    'static-reconciler run complete'
  );

  return { ...entryListResult, ...drawResult };
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
