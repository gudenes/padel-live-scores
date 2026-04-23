import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  linkDrawSnapshotsToPublicMatches,
  type DrawSnapshotCandidate,
  type PublicMatchCandidate,
} from '../lib/draw-linker.js';

/**
 * FIP draw linker (PR 2 of the draw-linker pipeline).
 *
 * Reads the latest `fip_event_page`-sourced `padelgod.draw_snapshots` rows
 * for each active tournament and writes `public.entity_external_ids` rows
 * that map `{tournamentWidgetId}:{matchWidgetId}` → `public.matches.id`.
 *
 * This closes the "unlinked match" gap that neither the live-poller nor
 * the OOP-based linker can close for:
 *
 *   - TBD placeholders — QFs/SFs that Crionet leaves as "Winner of X vs
 *     Winner of Y" in the OOP until the feeding matches finish. Brussels
 *     P2 2026 had 5 of these stuck for ~72h.
 *   - Qualifier matches that padelapi stored in public.matches but that
 *     Crionet never surfaced in OOP (e.g. Brussels WQ011).
 *
 * PR 2 scope is strictly limited to WIDGET LINKING. It does NOT:
 *   - Mutate `public.matches` (no FK backfills — future PR 3).
 *   - Create new `public.matches` rows.
 *   - Rewrite existing `entity_external_ids` rows that point elsewhere
 *     (uses `ignoreDuplicates: true` so an existing composite wins).
 *
 * Dry-run mode (`dryRun=true`) logs every proposed linkage but writes
 * nothing. Default is dry-run so the first production run is observable
 * before any canonical data moves.
 */

export interface FipDrawLinkerDeps {
  supabase: SupabaseClient;
  logger?: Logger;
}

export interface FipDrawLinkerOptions {
  /**
   * When true, no DB writes happen — the worker logs what it WOULD have
   * done. Default: true. Flip to false once the first run's dry-run log
   * has been reviewed in prod.
   */
  dryRun?: boolean;
}

export interface FipDrawLinkerResult {
  tournamentsProcessed: number;
  drawRowsConsidered: number;
  linkagesProposed: number;
  linkagesWritten: number;
  linkagesSkippedAlreadyLinked: number;
  dryRun: boolean;
}

/** Active-tournament row as returned by
 *  `padelgod_active_tournaments_for_static_workers`. */
interface ActiveTournamentRow {
  tournament_id: string;
  tournament_name: string;
  widget_id: string;
  starts_at: string | null;
  ends_at: string | null;
  expected_days: number;
}

/** Shape of the raw `padelgod.draw_snapshots` row we select. */
interface RawDrawSnapshotRow {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women';
  round_label: string;
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_fip_id: string | null;
  team2_fip_id: string | null;
  status: 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';
  captured_at: string;
}

/** Shape of the joined `public.matches` row we select. */
interface RawPublicMatchRow {
  id: string;
  round: string | null;
  category: 'men' | 'women' | null;
  pair1_player1: unknown;
  pair1_player2: unknown;
  pair2_player1: unknown;
  pair2_player2: unknown;
}

export async function runFipDrawLinker(
  deps: FipDrawLinkerDeps,
  opts: FipDrawLinkerOptions = {},
): Promise<FipDrawLinkerResult> {
  const dryRun = opts.dryRun ?? true;

  // 1. Active tournaments (with widget_id — we need it for the composite
  //    external_id format).
  const { data: tournamentsRaw, error: tournamentsErr } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers',
  );
  if (tournamentsErr) {
    throw new Error(
      `padelgod_active_tournaments_for_static_workers RPC failed: ${tournamentsErr.message}`,
    );
  }
  const tournaments = (tournamentsRaw ?? []) as ActiveTournamentRow[];
  if (tournaments.length === 0) {
    return {
      tournamentsProcessed: 0,
      drawRowsConsidered: 0,
      linkagesProposed: 0,
      linkagesWritten: 0,
      linkagesSkippedAlreadyLinked: 0,
      dryRun,
    };
  }

  let drawRowsConsidered = 0;
  let linkagesProposed = 0;
  let linkagesWritten = 0;
  let linkagesSkippedAlreadyLinked = 0;

  for (const t of tournaments) {
    const per = await linkOneTournament(deps, t, dryRun);
    drawRowsConsidered += per.drawRowsConsidered;
    linkagesProposed += per.linkagesProposed;
    linkagesWritten += per.linkagesWritten;
    linkagesSkippedAlreadyLinked += per.linkagesSkippedAlreadyLinked;
  }

  deps.logger?.info(
    {
      tournamentsProcessed: tournaments.length,
      drawRowsConsidered,
      linkagesProposed,
      linkagesWritten,
      linkagesSkippedAlreadyLinked,
      dryRun,
    },
    'fip-draw-linker run complete',
  );

  return {
    tournamentsProcessed: tournaments.length,
    drawRowsConsidered,
    linkagesProposed,
    linkagesWritten,
    linkagesSkippedAlreadyLinked,
    dryRun,
  };
}

// ─── per-tournament logic (exported for testing) ─────────────────────────────

export interface PerTournamentCounts {
  drawRowsConsidered: number;
  linkagesProposed: number;
  linkagesWritten: number;
  linkagesSkippedAlreadyLinked: number;
}

async function linkOneTournament(
  deps: FipDrawLinkerDeps,
  t: ActiveTournamentRow,
  dryRun: boolean,
): Promise<PerTournamentCounts> {
  const childLog = deps.logger?.child({
    tournamentId: t.tournament_id,
    tournamentWidgetId: t.widget_id,
  });

  // 2. Load latest draw_snapshots per (tournament, widget_id) where
  //    source='fip_event_page'. Supabase-JS doesn't expose DISTINCT ON,
  //    so we fetch ordered by captured_at DESC and dedupe client-side
  //    by match_widget_id, keeping the first occurrence per widget.
  const { data: drawRowsRaw, error: drawErr } = await deps.supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .select(
      'tournament_id, match_widget_id, category, round_label, ' +
        'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, ' +
        'team1_fip_id, team2_fip_id, status, captured_at',
    )
    .eq('tournament_id', t.tournament_id)
    .eq('source', 'fip_event_page')
    .not('match_widget_id', 'is', null)
    .order('captured_at', { ascending: false });
  if (drawErr) {
    childLog?.warn({ err: drawErr.message }, 'draw_snapshots read failed — skipping tournament');
    return emptyCounts();
  }
  // Supabase-JS's strict typing infers an error-shape tuple for
  // schema().from() selects; cast through unknown is the documented
  // escape hatch when the select string is a dynamic projection.
  const allDrawRows = (drawRowsRaw ?? []) as unknown as RawDrawSnapshotRow[];
  if (allDrawRows.length === 0) return emptyCounts();

  const latestByWidgetId = new Map<string, RawDrawSnapshotRow>();
  for (const r of allDrawRows) {
    if (r.match_widget_id && !latestByWidgetId.has(r.match_widget_id)) {
      latestByWidgetId.set(r.match_widget_id, r);
    }
  }
  const latestDrawRows = Array.from(latestByWidgetId.values());

  // 3. Existing entity_external_ids for this tournament's widget. Skip
  //    any draw row whose composite is already linked — "first link wins"
  //    (live-poller + oop-fetcher have priority because they write
  //    earlier in the lifecycle).
  const prefix = `${t.widget_id}:`;
  const { data: existingRaw, error: existingErr } = await deps.supabase
    .from('entity_external_ids')
    .select('external_id, entity_id')
    .eq('entity_type', 'match')
    .eq('source', 'crionet_widget')
    .like('external_id', `${prefix}%`);
  if (existingErr) {
    childLog?.warn(
      { err: existingErr.message },
      'entity_external_ids read failed — skipping tournament',
    );
    return emptyCounts();
  }
  const alreadyLinkedComposites = new Set(
    ((existingRaw ?? []) as Array<{ external_id: string }>).map((r) => r.external_id),
  );

  // Filter draw rows to only those that aren't already linked.
  const unlinkedDrawRows = latestDrawRows.filter(
    (r) => !alreadyLinkedComposites.has(`${t.widget_id}:${r.match_widget_id}`),
  );
  const skippedAlreadyLinked = latestDrawRows.length - unlinkedDrawRows.length;
  if (unlinkedDrawRows.length === 0) {
    return {
      drawRowsConsidered: latestDrawRows.length,
      linkagesProposed: 0,
      linkagesWritten: 0,
      linkagesSkippedAlreadyLinked: skippedAlreadyLinked,
    };
  }

  // 4. Load public.matches for this tournament with player-name joins.
  const { data: publicRaw, error: publicErr } = await deps.supabase
    .from('matches')
    .select(
      'id, round, category, ' +
        'pair1_player1:players!matches_pair1_player1_id_fkey(name), ' +
        'pair1_player2:players!matches_pair1_player2_id_fkey(name), ' +
        'pair2_player1:players!matches_pair2_player1_id_fkey(name), ' +
        'pair2_player2:players!matches_pair2_player2_id_fkey(name)',
    )
    .eq('tournament_id', t.tournament_id);
  if (publicErr) {
    childLog?.warn(
      { err: publicErr.message },
      'public.matches read failed — skipping tournament',
    );
    return emptyCounts();
  }

  // Also exclude public.matches that already have a crionet_widget link — the
  // existing link is canonical and we shouldn't propose a second composite
  // pointing at the same match UUID.
  const alreadyLinkedMatchIds = new Set(
    ((existingRaw ?? []) as Array<{ entity_id: string }>).map((r) => r.entity_id),
  );

  const publicCandidates: PublicMatchCandidate[] = (publicRaw ?? [])
    .map((raw) => toPublicCandidate(raw as unknown as RawPublicMatchRow))
    .filter((c) => !alreadyLinkedMatchIds.has(c.id));

  // 5. Build linker input from the unlinked draw rows.
  const drawCandidates: DrawSnapshotCandidate[] = unlinkedDrawRows.map((r) => ({
    matchWidgetId: r.match_widget_id!,
    category: r.category,
    roundLabel: r.round_label,
    team1Player1Name: r.team1_player1_name,
    team1Player2Name: r.team1_player2_name,
    team2Player1Name: r.team2_player1_name,
    team2Player2Name: r.team2_player2_name,
    team1FipId: r.team1_fip_id,
    team2FipId: r.team2_fip_id,
    status: r.status,
  }));

  const linkages = linkDrawSnapshotsToPublicMatches(
    drawCandidates,
    publicCandidates,
    t.widget_id,
  );

  if (linkages.length === 0) {
    return {
      drawRowsConsidered: latestDrawRows.length,
      linkagesProposed: 0,
      linkagesWritten: 0,
      linkagesSkippedAlreadyLinked: skippedAlreadyLinked,
    };
  }

  // 6. Log every proposed linkage (even in dry-run) so the operator can
  //    spot-check a handful before flipping off dry-run mode.
  for (const l of linkages) {
    childLog?.info(
      {
        matchWidgetId: l.matchWidgetId,
        compositeExternalId: l.compositeExternalId,
        matchId: l.matchId,
        dryRun,
      },
      dryRun ? 'fip-draw-linker: proposed linkage (dry-run)' : 'fip-draw-linker: linking',
    );
  }

  if (dryRun) {
    return {
      drawRowsConsidered: latestDrawRows.length,
      linkagesProposed: linkages.length,
      linkagesWritten: 0,
      linkagesSkippedAlreadyLinked: skippedAlreadyLinked,
    };
  }

  // 7. Write linkages. `ignoreDuplicates: true` means an existing row for
  //    the same (source, entity_type, external_id) composite is left alone
  //    — so if another worker linked the same composite in the gap between
  //    our read and write, we don't stomp it.
  const nowIso = new Date().toISOString();
  const rows = linkages.map((l) => ({
    entity_type: 'match',
    entity_id: l.matchId,
    source: 'crionet_widget',
    external_id: l.compositeExternalId,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
  }));

  const { error: insertErr } = await deps.supabase
    .from('entity_external_ids')
    .upsert(rows, {
      onConflict: 'source,entity_type,external_id',
      ignoreDuplicates: true,
    });
  if (insertErr) {
    childLog?.warn(
      { err: insertErr.message, linkageCount: rows.length },
      'entity_external_ids upsert failed',
    );
    return {
      drawRowsConsidered: latestDrawRows.length,
      linkagesProposed: linkages.length,
      linkagesWritten: 0,
      linkagesSkippedAlreadyLinked: skippedAlreadyLinked,
    };
  }

  return {
    drawRowsConsidered: latestDrawRows.length,
    linkagesProposed: linkages.length,
    linkagesWritten: linkages.length,
    linkagesSkippedAlreadyLinked: skippedAlreadyLinked,
  };
}

function emptyCounts(): PerTournamentCounts {
  return {
    drawRowsConsidered: 0,
    linkagesProposed: 0,
    linkagesWritten: 0,
    linkagesSkippedAlreadyLinked: 0,
  };
}

/**
 * Normalize Supabase's embedded-resource shape (either an object or a
 * single-element array) to a single name string. Same helper as
 * oop-fetcher.autolinkOopMatches.
 */
function firstName(p: unknown): string | null {
  if (!p) return null;
  if (Array.isArray(p)) {
    return (p[0] as { name?: string | null } | undefined)?.name ?? null;
  }
  return (p as { name?: string | null }).name ?? null;
}

function toPublicCandidate(row: RawPublicMatchRow): PublicMatchCandidate {
  return {
    id: row.id,
    round: row.round,
    category: row.category,
    pair1Player1Name: firstName(row.pair1_player1),
    pair1Player2Name: firstName(row.pair1_player2),
    pair2Player1Name: firstName(row.pair2_player1),
    pair2Player2Name: firstName(row.pair2_player2),
  };
}
