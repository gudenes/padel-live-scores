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
  /**
   * Optional per-level denylist — when non-empty, tournaments at any
   * of these `level` values are skipped. Composes with
   * `onlyTournamentIds`: allowlist applied first, then exclude-level
   * filter on the survivors. When empty/undefined, no level filtering
   * happens (default).
   *
   * Primary use case (2026-04-25 onwards): keep the simplified
   * pipeline OFF Premier-tier tournaments during the soak phase.
   * Premier matches go through the live-poller path which already
   * works; running the populator on them would create composite-keyed
   * duplicates of Premier rows that already have live state.
   *
   * Belt-and-suspenders even when active: Premier tournaments don't
   * have FIP draw snapshots in `padelgod.draw_snapshots` to begin
   * with (Premier draws come from Crionet, not FIP), so they wouldn't
   * be processed even without this filter. This is the explicit safety
   * net for any cross-listed event we haven't accounted for.
   */
  excludeLevels?: Set<string>;
}

export interface FipDrawPopulatorResult {
  tournamentsProcessed: number;
  tournamentsSkippedNoWidget: number;
  /** Tournaments skipped because they weren't in the allowlist. When
   *  `onlyTournamentIds` is unset/empty this is always 0. */
  tournamentsSkippedNotInAllowlist: number;
  /** Tournaments skipped because their `level` was in `excludeLevels`.
   *  Always 0 when the filter is unset/empty. */
  tournamentsSkippedExcludedLevel: number;
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
  /**
   * Where this row came from. `fip_event_page` is the primary path —
   * structured AJAX draw bracket, includes seeds + FIP team IDs.
   * `oop_snapshot` is the amateur-tier fallback used when a tournament
   * has zero draw snapshots (no AJAX widget exposed): we transform the
   * OOP table into the same shape, with seeds + FIP IDs nulled out.
   * The bye check (which keys off FIP team IDs) is skipped for
   * `oop_snapshot` rows — OOP doesn't list byes anyway.
   */
  source: 'fip_event_page' | 'oop_snapshot';
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
  pair1_player1_name: string | null;
  pair1_player2_name: string | null;
  pair2_player1_name: string | null;
  pair2_player2_name: string | null;
}

// Amateur-tier levels — tournaments at these tiers are club-organized,
// the entry-list / FIP-search resolver routinely fails (the players
// aren't in the FIP database), and dropping the matches on the floor
// makes the tournament look empty in the public app. For these tiers we
// fall back to "thin matches": same composite key + round + category,
// player FK columns stay NULL, and the raw names from the draw snapshot
// are stored in pair*_player*_name. The UI renders the name strings
// when the FK is null. Higher tiers (Bronze/Silver/Gold/Premier) keep
// the strict-resolve behaviour so player profile links stay accurate.
const AMATEUR_TIER_LEVELS: ReadonlySet<string> = new Set([
  'fip_beyond',
  'fip_promises',
  'fip_other',
]);

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
  const { supabase, logger, dryRun, onlyTournamentIds, excludeLevels } = deps;
  const allowlistActive = onlyTournamentIds && onlyTournamentIds.size > 0;
  const excludeLevelsActive = excludeLevels && excludeLevels.size > 0;

  const result: FipDrawPopulatorResult = {
    tournamentsProcessed: 0,
    tournamentsSkippedNoWidget: 0,
    tournamentsSkippedNotInAllowlist: 0,
    tournamentsSkippedExcludedLevel: 0,
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
  if (excludeLevelsActive) {
    logger?.info(
      { excludeLevels: Array.from(excludeLevels) },
      'fip-draw-populator: level exclusion active — tournaments at these levels will be skipped'
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

  // 1b. Build a level lookup. Used by two filters:
  //   - the level-exclude denylist (caller-provided, optional)
  //   - the amateur-tier gate inside the per-row loop (always on)
  // The RPC doesn't return `level` (it's tightly scoped to the populator's
  // base requirements), so we do a single follow-up query against
  // public.tournaments. Cheap: one round-trip indexed on PK.
  let levelByTournamentId = new Map<string, string | null>();
  if (tournaments.length > 0) {
    const ids = tournaments.map((t) => t.tournament_id);
    const { data: levelRows, error: levelErr } = await supabase
      .from('tournaments')
      .select('id, level')
      .in('id', ids);
    if (levelErr) {
      throw new Error(
        `level lookup for fip-draw-populator failed: ${levelErr.message}`
      );
    }
    levelByTournamentId = new Map(
      (levelRows ?? []).map((r: { id: string; level: string | null }) => [
        r.id,
        (r.level ?? null) === null ? null : (r.level as string).toLowerCase(),
      ])
    );
  }

  for (const t of tournaments) {
    // Allowlist filter. Evaluated FIRST so we don't waste widget-id
    // lookups on tournaments we won't process. Kept as a counter so
    // the result object can prove to operators that the allowlist
    // actually narrowed the set (matches expected count).
    if (allowlistActive && !onlyTournamentIds.has(t.tournament_id)) {
      result.tournamentsSkippedNotInAllowlist += 1;
      continue;
    }

    // Exclude-level filter. Composes with the allowlist (allowlist
    // first, then this). Tournaments without a level (null) are NEVER
    // matched by the exclude filter — operators can categorise them
    // separately if needed.
    if (excludeLevelsActive) {
      const level = levelByTournamentId.get(t.tournament_id);
      if (level && excludeLevels.has(level)) {
        result.tournamentsSkippedExcludedLevel += 1;
        continue;
      }
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

    // 3. Load latest draw snapshot per (tournament, match_widget_id).
    // For amateur tiers, fall back to OOP snapshots when draw is empty —
    // some tournaments (B3 Singapore, etc.) only expose the bracket as a
    // PDF, never wiring an AJAX draw widget. OOP carries everything we
    // need (round + court + 4 names + match_widget_id) to build a thin
    // match. fip-results-writer fills in status/winner/sets later via
    // the composite key.
    const tournamentLevelForFallback =
      levelByTournamentId.get(t.tournament_id) ?? null;
    const isAmateurTournament =
      tournamentLevelForFallback != null &&
      AMATEUR_TIER_LEVELS.has(tournamentLevelForFallback);
    let latestDraws = await loadLatestFipDrawRows(supabase, t.tournament_id);
    if (latestDraws.length === 0 && isAmateurTournament) {
      latestDraws = await loadLatestOopRowsAsDrawRows(
        supabase,
        t.tournament_id,
      );
      if (latestDraws.length > 0) {
        logger?.info(
          {
            tournamentId: t.tournament_id,
            level: tournamentLevelForFallback,
            oopRows: latestDraws.length,
          },
          'fip-draw-populator: amateur-tier fallback — using oop_snapshots as draw source',
        );
      }
    }
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

      // Skip byes and placeholder rows. The FIP-team-id check only
      // applies to draw_snapshots — OOP rows don't carry FIP IDs but
      // also don't include byes (byes never make it onto the OOP page).
      if (d.source === 'fip_event_page') {
        if (
          !isRealFipTeamId(d.team1_fip_id) ||
          !isRealFipTeamId(d.team2_fip_id) ||
          d.status === 'walkover'
        ) {
          result.skippedBye += 1;
          continue;
        }
      }

      // Resolve 4 players. Amateur tiers (Beyond / Promises / Other) are
      // allowed to fall back to "thin matches" — same composite + round
      // + category, FK columns NULL, raw names preserved on
      // pair*_player*_name. The UI handles the FK-null case by rendering
      // the name strings without a profile link.
      const tournamentLevel = levelByTournamentId.get(t.tournament_id) ?? null;
      const isAmateurTier =
        tournamentLevel != null && AMATEUR_TIER_LEVELS.has(tournamentLevel);
      const resolved = resolveFourPlayers(d, nameToFipId, fipIdToPlayerId);
      if (!resolved && !isAmateurTier) {
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
        // INSERT new match. When `resolved` is set we write the FKs;
        // when null (amateur-tier thin match) we write the raw names.
        // NOTE: deliberately not setting status/court/scheduled_at/
        // winner_pair/sets — those belong to other writers.
        const insertRow: Record<string, unknown> = {
          widget_id_composite: composite,
          tournament_id: t.tournament_id,
          category: d.category,
          round: d.round_label,
        };
        if (resolved) {
          insertRow.pair1_player1_id = resolved.p1p1;
          insertRow.pair1_player2_id = resolved.p1p2;
          insertRow.pair2_player1_id = resolved.p2p1;
          insertRow.pair2_player2_id = resolved.p2p2;
        } else {
          insertRow.pair1_player1_name = d.team1_player1_name;
          insertRow.pair1_player2_name = d.team1_player2_name;
          insertRow.pair2_player1_name = d.team2_player1_name;
          insertRow.pair2_player2_name = d.team2_player2_name;
        }

        if (dryRun) {
          logger?.info(
            {
              composite,
              tournamentId: t.tournament_id,
              round: d.round_label,
              thin: !resolved,
            },
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

      // UPDATE NULL-only. Two flavours:
      //   - resolved: backfill missing FKs (existing behaviour). When a
      //     thin match later gets its players resolved (entry list lands,
      //     player gets added to FIP DB), this path upgrades it.
      //   - thin (amateur, !resolved): backfill missing names so the UI
      //     can keep showing the team strings.
      const patch: Record<string, string> = {};
      if (resolved) {
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
      } else {
        // Thin update: only fill names that are still null.
        if (
          existing.pair1_player1_name === null &&
          d.team1_player1_name != null
        )
          patch.pair1_player1_name = d.team1_player1_name;
        if (
          existing.pair1_player2_name === null &&
          d.team1_player2_name != null
        )
          patch.pair1_player2_name = d.team1_player2_name;
        if (
          existing.pair2_player1_name === null &&
          d.team2_player1_name != null
        )
          patch.pair2_player1_name = d.team2_player1_name;
        if (
          existing.pair2_player2_name === null &&
          d.team2_player2_name != null
        )
          patch.pair2_player2_name = d.team2_player2_name;
      }

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
  const rows = ((data ?? []) as unknown as Omit<DrawRow, 'source'>[]).map(
    (r) => ({ ...r, source: 'fip_event_page' as const }),
  );

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

/**
 * Amateur-tier fallback: read OOP snapshots and transform them into the
 * same DrawRow shape the populator's main loop expects. Used when
 * draw_snapshots is empty for a tournament because the FIP page didn't
 * expose a structured AJAX draw widget — the OOP page on
 * matchscorerlive.com still has the round + court + 4 player names per
 * match, which is everything we need to build a thin match.
 *
 * Concretely: B3 Singapore 2026 (FIP Beyond) had 240 OOP snapshots but
 * zero draw snapshots. Without this fallback, padelgod's populator
 * couldn't surface any matches even though the data was already
 * captured one table over.
 *
 * Produces rows with `source: 'oop_snapshot'`. Downstream:
 * - the bye check (which keys off `team*_fip_id`) is skipped — OOP
 *   doesn't include byes / placeholder rows
 * - amateur-tier gate then writes thin matches as usual
 * - FIP results-writer fills status / winner / sets later via composite
 */
async function loadLatestOopRowsAsDrawRows(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<DrawRow[]> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select(
      'tournament_id, match_widget_id, category, round_label, ' +
        'team1_player1_name, team1_player2_name, ' +
        'team2_player1_name, team2_player2_name, captured_at',
    )
    .eq('tournament_id', tournamentId);
  if (error) {
    throw new Error(
      `oop_snapshots read failed (tournament=${tournamentId}): ${error.message}`,
    );
  }

  interface OopRow {
    tournament_id: string;
    match_widget_id: string | null;
    category: 'men' | 'women' | null;
    round_label: string | null;
    team1_player1_name: string | null;
    team1_player2_name: string | null;
    team2_player1_name: string | null;
    team2_player2_name: string | null;
    captured_at: string;
  }

  const rows = ((data ?? []) as unknown) as OopRow[];

  // Dedupe: latest captured_at per (tournament_id, match_widget_id).
  // OOP gets re-fetched daily during a tournament — each fetch appends
  // a new row per match, so we always pick the freshest snapshot.
  const latest = new Map<string, OopRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    if (!r.category) continue; // can't write a match without category
    if (!r.round_label) continue; // round is required to write a match
    const key = `${r.tournament_id}::${r.match_widget_id}`;
    const prev = latest.get(key);
    if (!prev || r.captured_at > prev.captured_at) latest.set(key, r);
  }

  // Transform OOP shape → DrawRow shape. FIP-specific fields stay null.
  return Array.from(latest.values()).map((r) => ({
    tournament_id: r.tournament_id,
    match_widget_id: r.match_widget_id,
    category: r.category as 'men' | 'women',
    round_label: r.round_label as string,
    draw_position: null,
    team1_player1_name: r.team1_player1_name,
    team1_player2_name: r.team1_player2_name,
    team2_player1_name: r.team2_player1_name,
    team2_player2_name: r.team2_player2_name,
    team1_fip_id: null,
    team2_fip_id: null,
    team1_seed: null,
    team2_seed: null,
    // OOP rows by definition aren't byes — they exist because the
    // match was scheduled to be played. Default to 'scheduled' here;
    // fip-results-writer will UPDATE the real status later.
    status: 'scheduled' as const,
    captured_at: r.captured_at,
    source: 'oop_snapshot' as const,
  }));
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
      'id, widget_id_composite, ' +
        'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
        'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name',
    )
    .like('widget_id_composite', `${compositePrefix}%`);
  if (error) {
    throw new Error(
      `matches read failed (prefix=${compositePrefix}): ${error.message}`
    );
  }
  const map = new Map<string, ExistingMatch>();
  for (const row of ((data ?? []) as unknown) as ExistingMatch[]) {
    if (row.widget_id_composite) map.set(row.widget_id_composite, row);
  }
  return map;
}
