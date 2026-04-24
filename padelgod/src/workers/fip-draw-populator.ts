import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

/**
 * fip-draw-populator — simplified-pipeline writer #1.
 *
 * Reads `padelgod.draw_snapshots` rows (the FIP event-page draw data
 * captured by `fip-draw-fetcher`) and creates / updates
 * `public.matches` rows keyed by the REAL widget composite:
 *
 *   widget_id_composite = "{tournament_widget_id}:{match_widget_id}"
 *                         e.g. "FIP-2026-1706:MD017"
 *
 * Why this worker exists
 * ----------------------
 * See `docs/superpowers/specs/2026-04-24-simplified-pipeline-
 * architecture.md`. Short version: replaces the `reconcileDraws` phase
 * of the legacy static-reconciler. Unlike the reconciler, this writer:
 *
 *   - Does ONE thing (create matches keyed by real composite)
 *   - Is independent of OOP / results / entry-list workers
 *   - Has no name-resolution fallback chain
 *   - Writes to the new `matches.widget_id_composite` column — does
 *     NOT touch rows created by the legacy reconciler (those have
 *     widget_id_composite NULL and a "draw:*" composite in
 *     entity_external_ids instead). Old and new rows coexist during
 *     migration; duplicates are cleaned up at Step 6.
 *
 * Parallel-safety during migration
 * --------------------------------
 *   1. Env flag `ENABLE_FIP_DRAW_POPULATOR` defaults to `false`.
 *   2. Even when enabled, `FIP_DRAW_POPULATOR_DRY_RUN` defaults to
 *      `true` — the worker logs what it WOULD insert/update, writes
 *      nothing.
 *   3. Cron slot `:42` — no overlap with reconciler `:05,:35`,
 *      fip-draw-fetcher `:35`, oop-fetcher `:50`, results-fetcher
 *      `:55`.
 *   4. Reads from: `padelgod.draw_snapshots`, `padelgod.entry_list_snapshots`,
 *      `padelgod.widget_id_cache`, `public.players`. All read-only.
 *   5. Writes to: `public.matches` ONLY rows where
 *      `widget_id_composite IS NOT NULL`. Legacy reconciler's rows
 *      (composite-NULL) are never touched.
 *
 * Player resolution
 * -----------------
 * FIP draws and FIP entry lists both use LONG-form names ("Nuno
 * Baptista"). We don't need the fuzzy short-form-vs-long-form logic
 * the legacy reconciler uses — a simple normalized exact-match is
 * enough:
 *
 *   draw.team1_player1_name  →  normalize  →  entry_list[name].fip_id
 *                           →  public.players WHERE fip_id = X  →  players.id
 *
 * If any of the 4 names can't be resolved, we skip the match and
 * retry on the next run. No unresolved queue, no fallbacks.
 *
 * Idempotence
 * -----------
 * Lookup by `widget_id_composite` before any write:
 *   - Not found → INSERT with composite, FKs, round, category, seeds,
 *     draw_position
 *   - Found with any NULL pair FK → UPDATE NULL-only (never clobbers)
 *   - Found with all 4 FKs set → no-op
 *
 * Running the worker twice in a row against stable data produces zero
 * writes the second time.
 */

export interface FipDrawPopulatorDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /**
   * When true (default), log proposed inserts/updates but don't
   * actually write to public.matches. Lets operators review output
   * before committing the migration.
   */
  dryRun: boolean;
  /**
   * Optional per-tournament allowlist — when non-empty, the populator
   * processes ONLY tournaments whose UUID is in this set. When empty
   * or undefined, processes all eligible tournaments (default).
   *
   * Added to let operators migrate tournaments one-at-a-time, leaving
   * the legacy pipeline's rows untouched for tournaments NOT in the
   * list. Brussels 2026 specifically: already has 109 legacy matches
   * with live-poller state; flipping populator writes globally would
   * create user-visible duplicate rows in tournament views. With the
   * allowlist we keep Brussels on legacy while migrating clean-slate
   * tournaments (Isla, Mendoza, Marrakech, Ijuí) to the new pipeline.
   *
   * Because the 3 downstream writers (oop-writer, results-writer,
   * winner-propagator) all look up matches by widget_id_composite
   * prefix, skipping Brussels HERE automatically keeps them off
   * Brussels too — no writes means no composite-keyed rows for
   * them to target. Only the populator needs the filter.
   */
  onlyTournamentIds?: Set<string>;
}

export interface FipDrawPopulatorResult {
  tournamentsProcessed: number;
  tournamentsSkippedNoWidget: number;
  /** Tournaments skipped because they weren't in the allowlist. When
   *  `onlyTournamentIds` is unset/empty this is always 0. */
  tournamentsSkippedNotInAllowlist: number;
  drawRowsConsidered: number;
  inserted: number;
  updated: number;
  skippedNoWidget: number;
  skippedBye: number;
  skippedPlayerUnresolved: number;
  skippedAlreadyComplete: number;
  dryRun: boolean;
}

interface TournamentRow {
  tournament_id: string;
  tournament_name: string;
  slug: string;
}

interface DrawRow {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women';
  round_label: string;
  draw_position: number | null;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_fip_id: string | null;
  team2_fip_id: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
  status: 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

interface EntryListRow {
  name: string | null;
  fip_id: string | null;
  category: 'men' | 'women';
  captured_at: string;
}

interface ExistingMatch {
  id: string;
  widget_id_composite: string;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

// ── Name normalization ─────────────────────────────────────────────────

/**
 * Minimal name normalizer: lowercase, strip accents via NFKD, collapse
 * whitespace. Deliberately small — we're matching long-form → long-form
 * from the same FIP source, not doing fuzzy cross-source resolution.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isRealFipTeamId(id: string | null): boolean {
  // FIP team ids are "P######" for real pairs; byes have non-P numeric ids.
  return id != null && /^P\d+$/i.test(id);
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFipDrawPopulator(
  deps: FipDrawPopulatorDeps
): Promise<FipDrawPopulatorResult> {
  const { supabase, logger, dryRun, onlyTournamentIds } = deps;
  const allowlistActive = onlyTournamentIds && onlyTournamentIds.size > 0;

  const result: FipDrawPopulatorResult = {
    tournamentsProcessed: 0,
    tournamentsSkippedNoWidget: 0,
    tournamentsSkippedNotInAllowlist: 0,
    drawRowsConsidered: 0,
    inserted: 0,
    updated: 0,
    skippedNoWidget: 0,
    skippedBye: 0,
    skippedPlayerUnresolved: 0,
    skippedAlreadyComplete: 0,
    dryRun,
  };

  if (allowlistActive) {
    logger?.info(
      { allowlistSize: onlyTournamentIds.size },
      'fip-draw-populator: tournament allowlist active — processing only listed tournaments'
    );
  }

  // 1. Active tournaments with FIP slug
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
    // Allowlist filter. Evaluated FIRST so we don't waste widget-id
    // lookups on tournaments we won't process. Kept as a counter so
    // the result object can prove to operators that the allowlist
    // actually narrowed the set (matches expected count).
    if (allowlistActive && !onlyTournamentIds.has(t.tournament_id)) {
      result.tournamentsSkippedNotInAllowlist += 1;
      continue;
    }

    // 2. Per-tournament: Crionet widget code
    const tournamentWidgetId = await getActiveWidgetIdCode(
      supabase,
      t.tournament_id
    );
    if (!tournamentWidgetId) {
      result.tournamentsSkippedNoWidget += 1;
      continue;
    }

    // 3. Load latest draw snapshot per (tournament, match_widget_id)
    const latestDraws = await loadLatestFipDrawRows(supabase, t.tournament_id);
    if (latestDraws.length === 0) continue;

    result.tournamentsProcessed += 1;

    // 4. Build name → fip_id map from latest entry_list snapshot
    const nameToFipId = await loadEntryListNameMap(supabase, t.tournament_id);

    // 5. Build fip_id → players.id map (only for fip_ids we'll actually use)
    const wantedFipIds = new Set<string>();
    for (const d of latestDraws) {
      for (const n of [
        d.team1_player1_name,
        d.team1_player2_name,
        d.team2_player1_name,
        d.team2_player2_name,
      ]) {
        if (!n) continue;
        const f = nameToFipId.get(normalizeName(n));
        if (f) wantedFipIds.add(f);
      }
    }
    const fipIdToPlayerId = await loadPlayersByFipId(supabase, wantedFipIds);

    // 6. Pre-load existing matches by composite for this tournament
    const compositePrefix = `${tournamentWidgetId}:`;
    const existingByComposite = await loadExistingMatchesByPrefix(
      supabase,
      compositePrefix
    );

    // 7. Iterate + write
    for (const d of latestDraws) {
      result.drawRowsConsidered += 1;

      if (!d.match_widget_id) {
        result.skippedNoWidget += 1;
        continue;
      }

      // Skip byes and placeholder rows
      if (
        !isRealFipTeamId(d.team1_fip_id) ||
        !isRealFipTeamId(d.team2_fip_id) ||
        d.status === 'walkover'
      ) {
        result.skippedBye += 1;
        continue;
      }

      // Resolve 4 players
      const resolved = resolveFourPlayers(d, nameToFipId, fipIdToPlayerId);
      if (!resolved) {
        result.skippedPlayerUnresolved += 1;
        logger?.debug(
          {
            tournamentId: t.tournament_id,
            matchWidgetId: d.match_widget_id,
          },
          'fip-draw-populator: player unresolved — deferring to next run'
        );
        continue;
      }

      const composite = `${tournamentWidgetId}:${d.match_widget_id}`;
      const existing = existingByComposite.get(composite);

      if (!existing) {
        // INSERT new match
        const insertRow = {
          widget_id_composite: composite,
          tournament_id: t.tournament_id,
          category: d.category,
          round: d.round_label,
          pair1_player1_id: resolved.p1p1,
          pair1_player2_id: resolved.p1p2,
          pair2_player1_id: resolved.p2p1,
          pair2_player2_id: resolved.p2p2,
          // NOTE: deliberately not setting status/court/scheduled_at/
          // winner_pair/sets — those belong to other writers.
        };

        if (dryRun) {
          logger?.info(
            { composite, tournamentId: t.tournament_id, round: d.round_label },
            'fip-draw-populator [dry-run]: would INSERT match'
          );
        } else {
          const { error: insErr } = await supabase
            .from('matches')
            .insert(insertRow);
          if (insErr) {
            // Unique-index collision = another worker raced us. Treat
            // as success + continue to UPDATE path on next run.
            const isDuplicate =
              (insErr as { code?: string }).code === '23505';
            if (!isDuplicate) {
              throw new Error(
                `matches insert failed (composite=${composite}): ${insErr.message}`
              );
            }
            logger?.debug(
              { composite },
              'fip-draw-populator: unique collision on INSERT — treating as pre-existing'
            );
          }
        }
        result.inserted += 1;
        continue;
      }

      // UPDATE NULL-only for any missing pair FKs
      const patch: Record<string, string> = {};
      if (
        existing.pair1_player1_id === null &&
        resolved.p1p1 !== null
      )
        patch.pair1_player1_id = resolved.p1p1;
      if (
        existing.pair1_player2_id === null &&
        resolved.p1p2 !== null
      )
        patch.pair1_player2_id = resolved.p1p2;
      if (
        existing.pair2_player1_id === null &&
        resolved.p2p1 !== null
      )
        patch.pair2_player1_id = resolved.p2p1;
      if (
        existing.pair2_player2_id === null &&
        resolved.p2p2 !== null
      )
        patch.pair2_player2_id = resolved.p2p2;

      if (Object.keys(patch).length === 0) {
        result.skippedAlreadyComplete += 1;
        continue;
      }

      if (dryRun) {
        logger?.info(
          { composite, patch, matchId: existing.id },
          'fip-draw-populator [dry-run]: would UPDATE match (NULL-only fills)'
        );
      } else {
        const { error: updErr } = await supabase
          .from('matches')
          .update(patch)
          .eq('id', existing.id);
        if (updErr) {
          throw new Error(
            `matches update failed (id=${existing.id}): ${updErr.message}`
          );
        }
      }
      result.updated += 1;
    }
  }

  logger?.info(result, 'fip-draw-populator run complete');
  return result;
}

// ── Helpers (exported for testing) ─────────────────────────────────────

export function resolveFourPlayers(
  d: DrawRow,
  nameToFipId: Map<string, string>,
  fipIdToPlayerId: Map<string, string>
): {
  p1p1: string;
  p1p2: string;
  p2p1: string;
  p2p2: string;
} | null {
  const lookup = (name: string | null): string | null => {
    if (!name) return null;
    const fipId = nameToFipId.get(normalizeName(name));
    if (!fipId) return null;
    return fipIdToPlayerId.get(fipId) ?? null;
  };

  const p1p1 = lookup(d.team1_player1_name);
  const p1p2 = lookup(d.team1_player2_name);
  const p2p1 = lookup(d.team2_player1_name);
  const p2p2 = lookup(d.team2_player2_name);

  if (!p1p1 || !p1p2 || !p2p1 || !p2p2) return null;
  return { p1p1, p1p2, p2p1, p2p2 };
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

async function loadLatestFipDrawRows(
  supabase: SupabaseClient,
  tournamentId: string
): Promise<DrawRow[]> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .select(
      'tournament_id, match_widget_id, category, round_label, draw_position, ' +
        'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, ' +
        'team1_fip_id, team2_fip_id, team1_seed, team2_seed, status, captured_at'
    )
    .eq('tournament_id', tournamentId)
    .eq('source', 'fip_event_page');
  if (error) {
    throw new Error(
      `draw_snapshots read failed (tournament=${tournamentId}): ${error.message}`
    );
  }
  const rows = (data ?? []) as unknown as DrawRow[];

  // Dedupe: latest captured_at per (tournament_id, match_widget_id)
  const latest = new Map<string, DrawRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const key = `${r.tournament_id}::${r.match_widget_id}`;
    const prev = latest.get(key);
    if (!prev || r.captured_at > prev.captured_at) latest.set(key, r);
  }
  return Array.from(latest.values());
}

async function loadEntryListNameMap(
  supabase: SupabaseClient,
  tournamentId: string
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .select('name, fip_id, category, captured_at')
    .eq('tournament_id', tournamentId);
  if (error) {
    throw new Error(
      `entry_list_snapshots read failed (tournament=${tournamentId}): ${error.message}`
    );
  }
  const rows = (data ?? []) as EntryListRow[];

  // Latest captured_at per category — entry list may be updated over
  // time and we always want the freshest roster.
  const maxByCat = new Map<string, string>();
  for (const r of rows) {
    const prev = maxByCat.get(r.category);
    if (!prev || r.captured_at > prev) maxByCat.set(r.category, r.captured_at);
  }

  const nameToFipId = new Map<string, string>();
  for (const r of rows) {
    if (!r.name || !r.fip_id) continue;
    if (r.captured_at !== maxByCat.get(r.category)) continue;
    nameToFipId.set(normalizeName(r.name), r.fip_id);
  }
  return nameToFipId;
}

async function loadPlayersByFipId(
  supabase: SupabaseClient,
  fipIds: Set<string>
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (fipIds.size === 0) return map;
  const { data, error } = await supabase
    .from('players')
    .select('id, fip_id')
    .in('fip_id', Array.from(fipIds));
  if (error) {
    throw new Error(`players read failed: ${error.message}`);
  }
  for (const row of (data ?? []) as { id: string; fip_id: string }[]) {
    if (row.id && row.fip_id) map.set(row.fip_id, row.id);
  }
  return map;
}

async function loadExistingMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string
): Promise<Map<string, ExistingMatch>> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, widget_id_composite, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id'
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
