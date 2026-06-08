import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
// Paginated reads against snapshot tables that can exceed PostgREST's
// 1k response cap. See padelgod/src/lib/db-paginate.ts for the helper
// (mirror of src/lib/db-paginate.ts) and CLAUDE.md → "PostgREST 1k cap"
// for the project policy.
import { paginatedSelect } from '../lib/db-paginate.js';
import { roundCanonical } from '../lib/round-canonical.js';
// Low-level name/fip_id/player-UUID primitives — shared with
// fip-draw-reconciler. The populator's higher-level tiered
// `resolveFourPlayers` (bracket overlay + partner anchor) stays in
// this file because it's coupled to the INSERT flow.
import {
  normalizeName as sharedNormalizeName,
  loadPlayersByFipId as sharedLoadPlayersByFipId,
  loadEntryListNameMap as sharedLoadEntryListNameMap,
} from '../lib/draw-resolver.js';
import { activeTournamentArgs } from '../lib/active-tournament-args.js';
import { claimNotificationEvent } from '../lib/notification-events.js';
import { notifyEvent, type NotifyDeps } from '../lib/notify.js';

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
  /**
   * Web-push notify config (baseUrl / cronSecret / logger). Forwarded from
   * the scheduler's `SchedulerDeps.notify` (populated in index.ts from
   * NOTIFY_BASE_URL + CRON_SECRET). When undefined, the `draw_released`
   * dispatch silently no-ops.
   */
  notify?: NotifyDeps;
  /**
   * Free event-notification senders master switch (Plan 2B). Defaults to
   * false so the `draw_released` sender ships dark — it fires only when
   * BOTH this is true AND `notify` is configured. Also gated to non-dry-run
   * runs so an operator's dry-run review never claims the sent-log key.
   */
  eventsEnabled?: boolean;
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
  /** Number of `tournament_draws` UPSERT calls (one per team per
   *  draw row that has a non-null `draw_position`). The legacy
   *  static-reconciler used to own this; the populator picked it up
   *  alongside the matches-side write so the canonical bracket table
   *  stays current after the reconcileDraws scope-down skipped
   *  populator-covered tournaments. */
  tournamentDrawsWritten: number;
  /** Draw rows where draw_position was null (OOP-fallback path or
   *  malformed snapshot) — tournament_draws keys on draw_position so
   *  these rows skip the bracket-table write but still hit
   *  public.matches normally. */
  tournamentDrawsSkippedNoPosition: number;
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
  // 3-letter IOC/FIP country codes per player. Sourced from
  // oop_snapshots when this is an OOP-fallback row; null on
  // fip_event_page rows (the FIP draw bracket exposes seeds + fip_id
  // but not country flags). Written into public.matches.pair*_country
  // for the amateur thin-match path so the UI can render flags
  // without an extra resolver step.
  team1_player1_country: string | null;
  team1_player2_country: string | null;
  team2_player1_country: string | null;
  team2_player2_country: string | null;
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

interface ExistingMatch {
  id: string;
  // NULL when the row was created by the live-poller / OOP path
  // (findOrCreateMatch), which stores the widget identity in the
  // entity_external_ids sidecar and leaves this column unset. Such rows
  // are surfaced by loadSidecarMatchesByPrefix, not the column query.
  widget_id_composite: string | null;
  round: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  pair1_player1_name: string | null;
  pair1_player2_name: string | null;
  pair2_player1_name: string | null;
  pair2_player2_name: string | null;
  pair1_player1_country: string | null;
  pair1_player2_country: string | null;
  pair2_player1_country: string | null;
  pair2_player2_country: string | null;
  pair1_seed: number | null;
  pair2_seed: number | null;
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

// `normalizeName` lives in ../lib/draw-resolver.ts now (shared with the
// reconciler). Re-exported here so existing test imports stay valid.
export const normalizeName = sharedNormalizeName;
/**
 * Build the short-form Crionet uses in OOP snapshots: first initial + dot +
 * space + all tokens after the first. For compound surnames the full compound
 * is preserved (they don't shorten surnames).
 *
 * "Mateo Alvarez"         → "m. alvarez"
 * "Matias Negrete Oliva"  → "m. negrete oliva"
 * "Adrian Ronco Lopez"    → "a. ronco lopez"
 *
 * Input should already be normalized (lowercase, no accents) — or pass the
 * raw long-form; normalizeName is applied internally.
 *
 * Note: Crionet also generates a "last-token-only" short form for players
 * with middle given names (e.g. "A. Miranda" for "Adrian Maria Miranda"
 * where "Maria" is dropped). buildShortFormMap registers both variants.
 */
export function shortenName(longName: string): string {
  const norm = normalizeName(longName);
  const tokens = norm.split(' ').filter(Boolean);
  if (tokens.length < 2) return norm;
  const initial = tokens[0]!.charAt(0);
  const tail = tokens.slice(1).join(' ');
  return `${initial}. ${tail}`;
}

/**
 * Returns true when a short-form input ("J. Ruiz") is consistent with a
 * long-form name ("Javier Ruiz Gonzalez"). The rule is permissive on
 * purpose — callers decide what to do with multiple consistent
 * candidates:
 *   - bracket overlay requires EXACTLY ONE consistent bracket name
 *   - partner anchor trusts the sibling's entry-list partner declaration
 *
 * Consistency =
 *   (1) same first letter on the first token (handles "J. " short or
 *       "Javier" long), AND
 *   (2) at least one shared surname token between the input's surname
 *       tokens (everything after the first token) and the long-form's
 *       surname tokens.
 *
 * Returns false on null / empty / single-token inputs (a single token
 * can't be confidently mapped to a multi-token long-form by this rule).
 */
export function isShortFormConsistentWith(
  shortOrLong: string,
  longForm: string,
): boolean {
  if (!shortOrLong || !longForm) return false;
  const sTokens = normalizeName(shortOrLong).split(' ').filter(Boolean);
  const lTokens = normalizeName(longForm).split(' ').filter(Boolean);
  if (sTokens.length < 2 || lTokens.length < 2) return false;
  // Initial match: compare first letter of first token, ignoring the
  // trailing dot if present ("j." vs "javier" both start with "j").
  const sInitial = sTokens[0]!.charAt(0);
  const lInitial = lTokens[0]!.charAt(0);
  if (sInitial !== lInitial) return false;
  // Surname overlap: any token after the first in s appears anywhere
  // after the first in l.
  const lSurnames = new Set(lTokens.slice(1));
  return sTokens.slice(1).some((t) => lSurnames.has(t));
}

/**
 * Returns true when only the first-token initial agrees between two
 * names. Used by the late-swap detector — if initials match but
 * `isShortFormConsistentWith` is false, the OOP shorthand may indicate
 * a real pair swap rather than a resolver error.
 *
 * Single-token inputs are accepted — unlike `isShortFormConsistentWith`
 * which requires at least two tokens on both sides.
 */
export function doShortFormInitialsMatch(
  shortOrLong: string,
  longForm: string,
): boolean {
  if (!shortOrLong || !longForm) return false;
  const sTokens = normalizeName(shortOrLong).split(' ').filter(Boolean);
  const lTokens = normalizeName(longForm).split(' ').filter(Boolean);
  if (sTokens.length === 0 || lTokens.length === 0) return false;
  return sTokens[0]!.charAt(0) === lTokens[0]!.charAt(0);
}

/**
 * Build a short-form → fip_id lookup from the long-form nameToFipId map.
 *
 * Covers three Crionet short-form patterns observed in oop_snapshots:
 *   1. Full-tail: "M. Negrete Oliva" ← "Matias Negrete Oliva"
 *      (first initial + dot + all tokens after first)
 *   2. Last-token: "A. Miranda" ← "Adrian Maria Miranda"
 *      (first initial + dot + last token only — Crionet drops middle given names
 *       when the "surname" is a single token)
 *   3. Spanish paternal-surname (3-token only): "J. Ruiz" ← "Javier Ruiz Gonzalez"
 *      (first initial + dot + second token only — Spanish convention shortens
 *       "Nombre Apellido1 Apellido2" to "N. Apellido1", where Apellido1 is the
 *       paternal surname). Without this, "Javier Ruiz Gonzalez" generates only
 *       "j. ruiz gonzalez" and "j. gonzalez" — neither matches OOP's "J. Ruiz",
 *       which would then resolve solely to "Jorge Nieto Ruiz" via Pattern 2,
 *       mispairing the wrong player. Restricted to length === 3 to avoid
 *       overgenerating on 4+ token names where token-2 is a middle given name.
 *
 * Collision rule: if two different long-forms produce the same short key
 * (e.g. "Mateo Alvarez" + "Marco Alvarez" → "m. alvarez", or "Jorge Nieto Ruiz"
 * + "Javier Ruiz Gonzalez" → "j. ruiz"), the value is set to null — we won't
 * silently pick the wrong player. Callers treat null as "ambiguous / not
 * found" and the match keeps raw name strings until a stronger signal lands.
 */
export function buildShortFormMap(
  nameToFipId: Map<string, string>
): Map<string, string | null> {
  const map = new Map<string, string | null>();

  const put = (key: string, fipId: string) => {
    if (map.has(key)) {
      const existing = map.get(key);
      if (existing !== fipId) map.set(key, null); // ambiguous — two long-forms collide
      // same fip_id (de-duplicated entry from multiple snapshot batches) → keep
    } else {
      map.set(key, fipId);
    }
  };

  for (const [longNorm, fipId] of nameToFipId) {
    // Pattern 1: full-tail short form ("M. Negrete Oliva")
    put(shortenName(longNorm), fipId);

    const tokens = longNorm.split(' ').filter(Boolean);
    if (tokens.length >= 3) {
      // Pattern 2: last-token-only short form ("A. Miranda") — only useful for
      // names with 3+ tokens where the middle token(s) are given middle names
      // rather than part of a compound surname.
      const lastOnly = `${tokens[0]!.charAt(0)}. ${tokens[tokens.length - 1]}`;
      put(lastOnly, fipId);
    }
    if (tokens.length === 3) {
      // Pattern 3: Spanish paternal-surname short form ("J. Ruiz" from
      // "Javier Ruiz Gonzalez"). Only fires for exactly 3 tokens — for
      // 4+ tokens token-2 is usually a middle given name, not the surname.
      const paternal = `${tokens[0]!.charAt(0)}. ${tokens[1]}`;
      put(paternal, fipId);
    }
  }

  return map;
}


function isRealFipTeamId(id: string | null): boolean {
  // FIP team ids are "P######" for real pairs; byes have non-P numeric ids.
  return id != null && /^P\d+$/i.test(id);
}

/**
 * Detects Crionet OOP-style short-form names ("S. Rodriguez", "M. Popovich
 * Fernández"). Used by the UPDATE branch to decide whether the draw row's
 * long-form names should overwrite the existing row — the FIP draw
 * (fip_event_page source) is higher-confidence than OOP-derived names.
 */
function nameLooksShortForm(name: string | null | undefined): boolean {
  if (!name) return false;
  return /^[A-Za-z]\.\s+\S/.test(name.trim());
}

/** Main-draw bracket-position labels emitted by `roundLabelFromMatchCount`.
 *  Used to detect stale labels written before the qualifier-aware parser
 *  shipped — a row whose widget is qualifier-prefixed (MQ/WQ) but whose
 *  round is one of these is a backfill candidate. */
const MAIN_DRAW_ROUND_LABELS: ReadonlySet<string> = new Set([
  'R64', 'R32', 'R16', 'QF', 'SF', 'F',
]);

function isMainDrawRoundLabel(label: string | null | undefined): boolean {
  return !!label && MAIN_DRAW_ROUND_LABELS.has(label);
}

function isQualifierRoundLabel(label: string | null | undefined): boolean {
  return !!label && /^Q\d+$/.test(label);
}

/** Qualifier widgets are prefixed `MQ`/`WQ` (men's / women's qualifying)
 *  in the FIP scheme. Used to gate the round-label backfill rule so it
 *  only fires on qualifier rows — a main-draw row legitimately carries
 *  R32/R16/QF and must never be touched by this rule. */
function isQualifierWidget(matchWidgetId: string | null | undefined): boolean {
  if (!matchWidgetId) return false;
  return /^[MW]Q/i.test(matchWidgetId);
}

/** Round depth ordering — bigger number = earlier round. Used to find
 *  the FIRST main-draw round per category for a tournament. */
const MAIN_DRAW_ROUND_DEPTH: Record<string, number> = {
  R128: 128, R64: 64, R32: 32, R16: 16, QF: 8, SF: 4, F: 2,
};

/**
 * Pick the deepest (= first in chronological order) main-draw round
 * per category from a flat array of draw rows. For a 56-team men's
 * Premier draw with FIP-published bracket, `latestDraws` will contain
 * rows at R64/R32/R16/QF/SF/F — first round = R64. For a 32-team
 * women's draw — first round = R32.
 *
 * Used by the bye-skip gate: FIP marks "seed advancing unopposed" rows
 * as status='walkover' with one team empty, but uses the SAME shape
 * for later-round cells where a seed is waiting for a feeder match
 * winner. Only first-round rows of that shape are actual byes — later
 * rounds describe real upcoming matches.
 */
export function computeFirstRoundByCategory(
  rows: ReadonlyArray<{ category: string; round_label: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  const bestDepth = new Map<string, number>();
  for (const r of rows) {
    if (!r.round_label || !r.category) continue;
    const depth = MAIN_DRAW_ROUND_DEPTH[r.round_label];
    if (depth == null) continue;
    const prev = bestDepth.get(r.category);
    if (prev == null || depth > prev) {
      bestDepth.set(r.category, depth);
      out.set(r.category, r.round_label);
    }
  }
  return out;
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
    tournamentDrawsWritten: 0,
    tournamentDrawsSkippedNoPosition: 0,
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
    'padelgod_active_tournaments_with_slug',
    activeTournamentArgs(onlyTournamentIds),
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
    // Source selection:
    //   - Bracket present (most Silver+ cases): use the bracket AND merge
    //     OOP rows for any round the bracket doesn't cover. The FIP
    //     event-page bracket only goes back to R32, so qualifying rounds
    //     (Q1/Q2/Q3) are invisible to the app until the live-poller fires
    //     at match-start without this merge — matchscorerlive's OOP
    //     widget has them hours earlier.
    //   - Bracket empty + any FIP tier (fip_bronze through fip_platinum
    //     + fip_championship + amateur tiers): use OOP as the entire
    //     draw source. FIP increasingly publishes Pro Tour brackets as
    //     PDF-only or late AJAX. Without this fallback those tournaments
    //     stay invisible to the app for days. Seeds + fip_ids stay null
    //     on the OOP-sourced rows — the composite-key UPDATE NULL-only
    //     path backfills them once the bracket lands via `draw_snapshots`.
    //   - Bracket empty + Premier (p1/p2/major/finals) or legacy WPT:
    //     skip. Premier has its own data path (padelapi sync + Crionet
    //     live-poller per match); WPT is historical.
    const tournamentLevelForFallback =
      levelByTournamentId.get(t.tournament_id) ?? null;
    const isFipTierTournament =
      tournamentLevelForFallback != null &&
      tournamentLevelForFallback.startsWith('fip_');
    let latestDraws = await loadLatestFipDrawRows(supabase, t.tournament_id);
    if (latestDraws.length === 0) {
      if (isFipTierTournament) {
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
            'fip-draw-populator: FIP-tier fallback — using oop_snapshots as draw source',
          );
        }
      }
    } else {
      // Bracket present — merge OOP rounds the bracket doesn't cover.
      // Predicate is "round_label not in bracket" rather than a hardcoded
      // [Q1, Q2, Q3] list so future extra rounds (pre-qualifying, playoffs,
      // …) get picked up automatically.
      const drawRoundLabels = new Set(
        latestDraws.map((d) => d.round_label).filter((r): r is string => !!r),
      );
      const oopExtra = await loadLatestOopRowsAsDrawRows(
        supabase,
        t.tournament_id,
        { excludeRoundLabels: drawRoundLabels },
      );
      if (oopExtra.length > 0) {
        logger?.info(
          {
            tournamentId: t.tournament_id,
            level: tournamentLevelForFallback,
            oopExtraCount: oopExtra.length,
            extraRounds: Array.from(
              new Set(oopExtra.map((r) => r.round_label)),
            ),
          },
          'fip-draw-populator: merging OOP-only rounds into draw set',
        );
      }
      latestDraws = [...latestDraws, ...oopExtra];
    }
    if (latestDraws.length === 0) continue;

    result.tournamentsProcessed += 1;

    // 4. Build name → fip_id map from latest entry_list snapshot, plus a
    //    short-form map for Crionet OOP names ("M. Alvarez") and a middle-name
    //    strip fallback for draw names with extra given-middle tokens.
    //
    // Pair-aware index + bracket overlay (Task 8). nameToFipId remains
    // for the Pattern 1/2/3 short-form lookup; fipIdToPartner enables
    // Pass 2 partner-anchor sweep + mis-pair sanity check in
    // resolveFourPlayers.
    const pairIndex = await buildPairIndex(supabase, t.tournament_id);
    const { nameToFipId, fipIdToPartner } = pairIndex;
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    const bracketOverlay = await buildBracketOverlay(supabase, t.tournament_id);

    // 5. Build fip_id → players.id map (only for fip_ids we'll actually use).
    //    Include both exact-match and short-form candidates so loadPlayersByFipId
    //    fetches the right rows even when the draw name is short-form.
    const wantedFipIds = new Set<string>();
    for (const d of latestDraws) {
      for (const n of [
        d.team1_player1_name,
        d.team1_player2_name,
        d.team2_player1_name,
        d.team2_player2_name,
      ]) {
        if (!n) continue;
        const norm = normalizeName(n);
        const f =
          nameToFipId.get(norm) ??
          (shortFormToFipId.get(norm) ?? undefined);
        if (f) wantedFipIds.add(f);

        // Pass-3 candidates (mirror resolveFourPlayers' middle-strip and
        // prefix paths). Without this, players reachable only via pass 3
        // never get loaded into fipIdToPlayerId and the resolver returns
        // null at runtime even though the EL has the right fip_id.
        const tokens = norm.split(' ').filter(Boolean);
        if (tokens.length >= 3) {
          for (let skip = 1; skip < tokens.length - 1; skip++) {
            const candidate = [
              ...tokens.slice(0, skip),
              ...tokens.slice(skip + 1),
            ].join(' ');
            const cf = nameToFipId.get(candidate);
            if (cf) wantedFipIds.add(cf);
          }
          for (let len = tokens.length - 1; len >= 2; len--) {
            const pf = nameToFipId.get(tokens.slice(0, len).join(' '));
            if (pf) wantedFipIds.add(pf);
          }
        }
      }
    }
    // Partner fip_ids from buildPairIndex must also be loaded so the
    // Pass 2 partner-anchor sweep can resolve to a player UUID even
    // when the partner's name doesn't appear in the draw rows (e.g.
    // when one side of the match is TBD or a walkover slot).
    for (const { partnerFipId } of pairIndex.fipIdToPartner.values()) {
      if (partnerFipId) wantedFipIds.add(partnerFipId);
    }
    const fipIdToPlayerId = await loadPlayersByFipId(supabase, wantedFipIds);

    // 6. Pre-load existing matches by composite for this tournament.
    // Two sources, because the same widget identity can be stored in
    // two places:
    //   (a) matches.widget_id_composite — populator-owned rows
    //   (b) entity_external_ids (source='crionet_widget') — rows created
    //       by the live-poller / OOP path (findOrCreateMatch), whose
    //       widget_id_composite column is NULL.
    // Without (b) the populator is blind to live-poller-created rows and
    // inserts a duplicate (see the Italy Major MQ025 dup, 2026-05). We
    // merge (b) in for any composite the column query didn't already
    // surface, then backfill the column on UPDATE so future runs hit (a).
    const compositePrefix = `${tournamentWidgetId}:`;
    const existingByComposite = await loadExistingMatchesByPrefix(
      supabase,
      compositePrefix
    );
    const sidecarByComposite = await loadSidecarMatchesByPrefix(
      supabase,
      compositePrefix
    );
    for (const [composite, match] of sidecarByComposite) {
      if (!existingByComposite.has(composite)) {
        existingByComposite.set(composite, match);
      }
    }

    // 6b. Determine the FIRST round of the main draw per category from
    // this tournament's draw rows. We use it below to scope the
    // bye-through skip — FIP marks a "seed advancing unopposed" row as
    // status='walkover' with one team empty, but uses the SAME shape
    // for later-round cells where a seed is waiting for a feeder
    // winner (R32 cell with seed-side filled, opponent-side empty
    // pending the R64 winner). Only the FIRST round describes an
    // actual bye event; later-round rows of the same shape describe a
    // real upcoming match. Without this scope, we'd skip every
    // pre-tournament R32+ cell on a 56-draw event with byes.
    const firstRoundByCategory = computeFirstRoundByCategory(latestDraws);

    // draw_released sender (Plan 2B, ships dark behind eventsEnabled).
    // Collect the distinct categories for which we actually upserted
    // tournament_draws rows this run, then fire ONCE per (tournament,
    // category) AFTER the inner loop. The sent-log claim
    // (`draw_released:<tid>:<category>`) makes it once-per-(tournament,
    // category)-ever; this Set just dedupes the per-row writes down to a
    // single claim attempt per category per run. Only populated on real
    // (non-dry-run) writes so an operator's dry-run review never claims.
    const categoriesUpserted = new Set<'men' | 'women'>();

    // 7. Iterate + write
    for (const d of latestDraws) {
      result.drawRowsConsidered += 1;

      if (!d.match_widget_id) {
        result.skippedNoWidget += 1;
        continue;
      }

      // Skip pure bye-through rows only — bracket transitions where a
      // seeded team advances unopposed (one side has zero names AND
      // status='walkover'). Those describe how the bracket fills in,
      // not matches that get played.
      //
      // Everything else from the FIP draw is a real bracket cell with
      // a stable match_widget_id. We INSERT it even when:
      //   - team2 is TBD (R64 row waiting for Q2 winner — top seed +
      //     "winner of Q2 #X") → status='scheduled', team2 names null
      //   - both sides TBD (R16/QF/SF/F cells waiting on prior rounds)
      //     → status='scheduled', all 4 names null
      //   - actual walkover (both sides named, one withdrew) →
      //     status='walkover' with both team1 and team2 names set
      // Downstream writers (live-poller, fip-results-writer, the
      // populator's own UPDATE branch) fill in player FKs as the
      // bracket plays out — `widget_id_composite` is the stable key.
      // OOP rows have no bye concept (byes never make it onto OOP),
      // so the bye check only applies to fip_event_page rows.
      if (d.source === 'fip_event_page') {
        const team1HasNames = !!(d.team1_player1_name || d.team1_player2_name);
        const team2HasNames = !!(d.team2_player1_name || d.team2_player2_name);
        const isFirstMdRound =
          d.round_label === firstRoundByCategory.get(d.category);
        if (
          isFirstMdRound &&
          d.status === 'walkover' &&
          (!team1HasNames || !team2HasNames)
        ) {
          result.skippedBye += 1;
          continue;
        }
      }

      // Resolve 4 players. Each slot resolves independently — partial
      // success is allowed everywhere now. Skip rules:
      //   * If 0 of 4 resolve AND not amateur/OOP-sourced → skip (no
      //     useful signal; defer to next run when entry list catches up).
      //   * Otherwise → INSERT/UPDATE with whatever resolved, keeping
      //     unresolved slots as raw names (thin) on a per-slot basis.
      // Two cases allow a fully-thin match (zero FKs):
      //   1. Amateur tiers (Beyond / Promises / Other) — these don't
      //      have a strict entry-list discipline, late wildcards are
      //      common, and the player pool is small enough that profile
      //      links aren't expected.
      //   2. OOP-sourced rows — for Silver+ qualifiers, the entry list
      //      usually has a fip_id, but a single unresolved name (typo,
      //      late add, unusual diacritic) shouldn't keep the whole
      //      match invisible. The widget_id_composite is stable, so
      //      when the live-poller fires `findOrCreateMatch` for the
      //      same match, it'll land on this row and update the player
      //      FKs in place.
      //   3. FIP draw rows where ALL FOUR names are absent (R16/QF/SF/F
      //      cells waiting on a feeder round). Every bracket cell has a
      //      stable match_widget_id, so we INSERT the row as scaffolding
      //      and let the UPDATE branch fill in FKs once the feeder
      //      resolves. NOT extended to fip-draw rows with names present
      //      but unresolved — that's the "entry list is stale, retry
      //      next run" case and we preserve the strict-resolve contract
      //      to avoid raw-name rows that don't link to player profiles.
      const namesProvided = [
        d.team1_player1_name,
        d.team1_player2_name,
        d.team2_player1_name,
        d.team2_player2_name,
      ].filter((n) => n != null && n !== '').length;
      const tournamentLevel = levelByTournamentId.get(t.tournament_id) ?? null;
      const isAmateurTier =
        tournamentLevel != null && AMATEUR_TIER_LEVELS.has(tournamentLevel);
      const isOopSourced = d.source === 'oop_snapshot';
      const isFipDrawScaffolding =
        d.source === 'fip_event_page' && namesProvided === 0;
      const allowThinMatch = isAmateurTier || isOopSourced || isFipDrawScaffolding;
      const resolved = resolveFourPlayers(
        d,
        nameToFipId,
        shortFormToFipId,
        fipIdToPlayerId,
        logger,
        {
          fipIdToPartner,
          bracketOverlay: d.match_widget_id ? bracketOverlay.get(d.match_widget_id) : undefined,
        },
      );
      const numResolved = resolvedCount(resolved);
      if (numResolved === 0 && !allowThinMatch) {
        result.skippedPlayerUnresolved += 1;
        logger?.debug(
          {
            tournamentId: t.tournament_id,
            matchWidgetId: d.match_widget_id,
          },
          'fip-draw-populator: all 4 players unresolved — deferring to next run'
        );
        continue;
      }

      const composite = `${tournamentWidgetId}:${d.match_widget_id}`;
      const existing = existingByComposite.get(composite);

      if (!existing) {
        // INSERT new match. Per-slot: write FK if resolved, raw name if
        // not. Resolved + unresolved slots can coexist on the same row —
        // the UI renders the FK ones with profile links and the raw-name
        // ones as plain text. NOTE: deliberately not setting status/
        // court/scheduled_at/winner_pair/sets — those belong to other
        // writers.
        const insertRow: Record<string, unknown> = {
          widget_id_composite: composite,
          tournament_id: t.tournament_id,
          category: d.category,
          round: d.round_label,
          round_canonical: roundCanonical(d.round_label),
        };

        const slot = (
          fk: string | null,
          name: string | null,
          country: string | null,
          fkCol: string,
          nameCol: string,
          countryCol: string,
        ) => {
          if (fk) {
            insertRow[fkCol] = fk;
          } else {
            if (name) insertRow[nameCol] = name;
            // Country codes — non-null only on OOP-fallback rows. The
            // FIP draw_snapshots path leaves these null because the
            // bracket markup has no flag images.
            if (country) insertRow[countryCol] = country;
          }
        };
        slot(resolved.p1p1, d.team1_player1_name, d.team1_player1_country, 'pair1_player1_id', 'pair1_player1_name', 'pair1_player1_country');
        slot(resolved.p1p2, d.team1_player2_name, d.team1_player2_country, 'pair1_player2_id', 'pair1_player2_name', 'pair1_player2_country');
        slot(resolved.p2p1, d.team2_player1_name, d.team2_player1_country, 'pair2_player1_id', 'pair2_player1_name', 'pair2_player1_country');
        slot(resolved.p2p2, d.team2_player2_name, d.team2_player2_country, 'pair2_player2_id', 'pair2_player2_name', 'pair2_player2_country');

        // Seeds — written for both resolved-FK and thin-name paths.
        // FIP draw exposes them on the structured fip_event_page rows;
        // OOP-fallback rows always have nulls. Only the top 8/16 pairs
        // are seeded — null is the normal case, not a missing value.
        if (d.team1_seed != null) insertRow.pair1_seed = d.team1_seed;
        if (d.team2_seed != null) insertRow.pair2_seed = d.team2_seed;

        if (dryRun) {
          logger?.info(
            {
              composite,
              tournamentId: t.tournament_id,
              round: d.round_label,
              numResolved,
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
        await upsertTournamentDraws(
          supabase,
          d,
          resolved,
          dryRun,
          result,
          logger,
        );
        if (!dryRun) categoriesUpserted.add(d.category);
        continue;
      }

      // UPDATE NULL-only, per slot. Each player slot follows one of two
      // flavours independently:
      //   - resolved this run: backfill the FK if existing is null.
      //   - unresolved this run: backfill name + country if those are
      //     null (thin row gap-fill).
      // A 3-of-4 resolution this run can therefore upgrade 3 slots from
      // thin → linked while leaving the 4th slot's name in place.
      const patch: Record<string, string | number> = {};

      // Backfill widget_id_composite when the matched row is sidecar-only
      // (live-poller / OOP created it with the column NULL). Writing the
      // column makes future column-prefix lookups and downstream
      // composite-keyed writers (oop-writer, results-writer,
      // winner-propagator) target this row directly — and prevents the
      // populator from ever re-inserting a duplicate for this widget.
      if (existing.widget_id_composite == null) {
        patch.widget_id_composite = composite;
      }

      // Short-form refresh: when the existing row carries OOP-style
      // short-form names ("S. Rodriguez") and THIS draw row is from the
      // higher-confidence FIP event-page bracket with long-form names,
      // overwrite the short-form names with the long-form. The FIP draw
      // is the authoritative source for player identity once it lands;
      // the OOP-derived names were only ever a placeholder until then.
      // Names-only refresh — FK / seed / country logic below still
      // applies their own NULL-only rules.
      const drawIsAuthoritative = d.source === 'fip_event_page';
      const drawNamesAreLongForm =
        !nameLooksShortForm(d.team1_player1_name) &&
        !nameLooksShortForm(d.team1_player2_name) &&
        !nameLooksShortForm(d.team2_player1_name) &&
        !nameLooksShortForm(d.team2_player2_name);
      // Round-label backfill: when the widget is a qualifier (MQ/WQ
      // prefix) AND the existing row carries a stale main-draw label
      // (R32/R16/QF/SF/F written by the pre-qualifier-aware parser) AND
      // this draw row brings a Q-label, overwrite. Main-draw widgets
      // and rows whose round is already a Q-label are never touched —
      // this rule is narrowly scoped to repair the historical mislabel.
      if (
        isQualifierWidget(d.match_widget_id) &&
        isMainDrawRoundLabel(existing.round) &&
        isQualifierRoundLabel(d.round_label)
      ) {
        patch.round = d.round_label;
      }

      const refreshShortForm = drawIsAuthoritative && drawNamesAreLongForm;
      if (refreshShortForm) {
        if (
          nameLooksShortForm(existing.pair1_player1_name) &&
          d.team1_player1_name
        )
          patch.pair1_player1_name = d.team1_player1_name;
        if (
          nameLooksShortForm(existing.pair1_player2_name) &&
          d.team1_player2_name
        )
          patch.pair1_player2_name = d.team1_player2_name;
        if (
          nameLooksShortForm(existing.pair2_player1_name) &&
          d.team2_player1_name
        )
          patch.pair2_player1_name = d.team2_player1_name;
        if (
          nameLooksShortForm(existing.pair2_player2_name) &&
          d.team2_player2_name
        )
          patch.pair2_player2_name = d.team2_player2_name;
      }

      // Per-slot NULL-only gap-fill. If THIS run resolved the player,
      // fill the FK; otherwise fall back to filling name + country.
      // Country may land on a later run than the name (e.g. earlier
      // OOP fetch had no flag src; later fetch did) — keep each field
      // independently NULL-only so it upgrades the moment its source
      // value appears.
      const fillSlot = (
        fk: string | null,
        existingFk: string | null,
        fkCol: string,
        name: string | null,
        existingName: string | null,
        nameCol: string,
        country: string | null,
        existingCountry: string | null,
        countryCol: string,
      ): void => {
        if (fk !== null) {
          if (existingFk === null) patch[fkCol] = fk;
          return;
        }
        if (name != null && existingName === null) patch[nameCol] = name;
        if (country != null && existingCountry === null) patch[countryCol] = country;
      };
      fillSlot(
        resolved.p1p1, existing.pair1_player1_id, 'pair1_player1_id',
        d.team1_player1_name, existing.pair1_player1_name, 'pair1_player1_name',
        d.team1_player1_country, existing.pair1_player1_country, 'pair1_player1_country',
      );
      fillSlot(
        resolved.p1p2, existing.pair1_player2_id, 'pair1_player2_id',
        d.team1_player2_name, existing.pair1_player2_name, 'pair1_player2_name',
        d.team1_player2_country, existing.pair1_player2_country, 'pair1_player2_country',
      );
      fillSlot(
        resolved.p2p1, existing.pair2_player1_id, 'pair2_player1_id',
        d.team2_player1_name, existing.pair2_player1_name, 'pair2_player1_name',
        d.team2_player1_country, existing.pair2_player1_country, 'pair2_player1_country',
      );
      fillSlot(
        resolved.p2p2, existing.pair2_player2_id, 'pair2_player2_id',
        d.team2_player2_name, existing.pair2_player2_name, 'pair2_player2_name',
        d.team2_player2_country, existing.pair2_player2_country, 'pair2_player2_country',
      );

      // Seeds — gap-fill regardless of resolved/thin path. Pairs go from
      // null → seeded as the FIP draw page publishes seed numbers; once
      // a row has its seed we never overwrite (a re-seeding mid-tournament
      // would be unprecedented). Both branches above wrote either FKs
      // OR thin names, but neither touched seeds.
      if (existing.pair1_seed === null && d.team1_seed != null)
        patch.pair1_seed = d.team1_seed;
      if (existing.pair2_seed === null && d.team2_seed != null)
        patch.pair2_seed = d.team2_seed;

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
      await upsertTournamentDraws(
        supabase,
        d,
        resolved,
        dryRun,
        result,
        logger,
      );
      if (!dryRun) categoriesUpserted.add(d.category);
    }

    // draw_released fire — once per (tournament, category) per run, gated
    // by the sent-log claim so it's once-per-(tournament,category)-ever.
    // Placed AFTER the inner loop so the draws for this tournament are
    // already upserted before we claim + notify (claim-then-fail-to-write
    // can't happen). Ships dark: fires only when eventsEnabled AND notify
    // are both set (dry-run runs never populate `categoriesUpserted`).
    if (deps.eventsEnabled && deps.notify) {
      for (const category of categoriesUpserted) {
        const key = `draw_released:${t.tournament_id}:${category}`;
        const claimed = await claimNotificationEvent(
          supabase,
          key,
          'draw_released',
        );
        if (claimed) {
          notifyEvent(
            {
              category: 'draw_released',
              entityType: 'tournament',
              entityId: t.tournament_id,
              title: 'Draw is out',
              body: 'The bracket for an event you follow has been published.',
              url: `/tournaments/${t.tournament_id}`,
              dedupeKey: key,
            },
            deps.notify,
          );
        }
      }
    }
  }

  logger?.info(result, 'fip-draw-populator run complete');
  return result;
}

// ── tournament_draws helper ────────────────────────────────────────────

/**
 * UPSERT two `public.tournament_draws` rows (one per team) for one
 * draw_snapshots row. Mirrors the legacy static-reconciler.reconcileDraws
 * shape — same column set, same `onConflict` key — so the two writers
 * produce identical bracket-table state. Skips draw_position=null rows
 * (OOP-fallback path or malformed snapshot).
 *
 * Why the populator owns this now: today's reconcileDraws scope-down
 * makes the legacy phase skip every tournament where the populator has
 * created widget-composite matches. Without this helper, FIP-tier
 * tournaments would stop accumulating bracket-table updates entirely
 * (the gap that dropped tournament_draws.seed coverage from 54% in
 * draw_snapshots to 37% in tournament_draws).
 */
async function upsertTournamentDraws(
  supabase: SupabaseClient,
  d: DrawRow,
  resolved: ResolvedFour,
  dryRun: boolean,
  result: FipDrawPopulatorResult,
  logger: Logger | undefined,
): Promise<void> {
  if (d.draw_position == null) {
    result.tournamentDrawsSkippedNoPosition += 1;
    return;
  }
  const teamRows = [
    {
      tournament_id: d.tournament_id,
      category: d.category,
      draw_position: 2 * d.draw_position - 1,
      seed: d.team1_seed,
      marker: null,
      player1_name: d.team1_player1_name,
      // FIP draw bracket markup has no flag images — country is null on
      // fip_event_page rows and only populated on OOP-fallback. Use
      // whatever DrawRow has; null is acceptable.
      player1_country: d.team1_player1_country,
      player1_id: resolved?.p1p1 ?? null,
      player2_name: d.team1_player2_name,
      player2_country: d.team1_player2_country,
      player2_id: resolved?.p1p2 ?? null,
      team_points: null,
    },
    {
      tournament_id: d.tournament_id,
      category: d.category,
      draw_position: 2 * d.draw_position,
      seed: d.team2_seed,
      marker: null,
      player1_name: d.team2_player1_name,
      player1_country: d.team2_player1_country,
      player1_id: resolved?.p2p1 ?? null,
      player2_name: d.team2_player2_name,
      player2_country: d.team2_player2_country,
      player2_id: resolved?.p2p2 ?? null,
      team_points: null,
    },
  ];
  for (const teamRow of teamRows) {
    // tournament_draws has NOT NULL on player1_name. Pending-qualifier
    // and scaffolding cells (R16/QF/SF/F pre-tournament; "winner of Q2
    // #X" R64 slots) have null names on one or both team rows. Skip
    // those — tournament_draws is for resolved-pair markers (Q/WC/LL)
    // and the public bracket UI doesn't need TBD-side rows. The
    // companion match in public.matches still gets the cell.
    if (teamRow.player1_name == null) {
      continue;
    }
    if (dryRun) {
      logger?.debug(
        { teamRow },
        'fip-draw-populator [dry-run]: would UPSERT tournament_draws',
      );
      result.tournamentDrawsWritten += 1;
      continue;
    }
    const { error } = await supabase
      .from('tournament_draws')
      .upsert(teamRow, {
        onConflict: 'tournament_id,category,draw_position',
      });
    if (error) {
      throw new Error(
        `tournament_draws upsert failed (tournament=${d.tournament_id}, ` +
          `position=${teamRow.draw_position}): ${error.message}`,
      );
    }
    result.tournamentDrawsWritten += 1;
  }
}

// ── Helpers (exported for testing) ─────────────────────────────────────

export type Tier =
  | 'exact_long'
  | 'bracket_overlay'
  | 'short_unique'
  | 'partner_anchor'
  | 'unresolved';

export interface ResolvedFour {
  p1p1: string | null;
  p1p2: string | null;
  p2p1: string | null;
  p2p2: string | null;
  // Populated only when caller passes the options arg in resolveFourPlayers.
  // Legacy callers (no options) get undefined — back-compat with the
  // pre-Task-4 test suite.
  tiers?: {
    p1p1: Tier;
    p1p2: Tier;
    p2p1: Tier;
    p2p2: Tier;
  };
}

export interface ResolveOptions {
  /**
   * Per-fip_id partner index from buildPairIndex. Read by Pass 2 only
   * (Tasks 5–7); the Pass 1 resolver in this task does not consume it.
   * Accepting it now keeps `resolveFourPlayers` callable with a single
   * shape across Tasks 4–7.
   */
  fipIdToPartner?: Map<string, { partnerFipId: string | null; partnerNormName: string }>;
  /** Per-match bracket long-form names from buildBracketOverlay. */
  bracketOverlay?: BracketOverlayEntry;
}

export function resolvedCount(r: ResolvedFour): number {
  return (
    (r.p1p1 ? 1 : 0) +
    (r.p1p2 ? 1 : 0) +
    (r.p2p1 ? 1 : 0) +
    (r.p2p2 ? 1 : 0)
  );
}

/**
 * Resolve up to 4 player UUIDs from a draw row's parsed names.
 *
 * Returns a `ResolvedFour` where each slot is independently a player UUID
 * (resolved) or `null` (unresolved). Callers decide how to act on partial
 * resolution — in steady state we want partial FK fills (3-of-4 still
 * means 3 real profile links on the match card), with the unresolved
 * slot left NULL until the entry list catches up.
 *
 * When `options` is provided the returned value also carries a `tiers` map
 * tagging each slot's resolution method. Legacy callers that omit `options`
 * get the old return shape (no `tiers` field) — back-compat preserved.
 *
 * Pass 1 lookup order per slot:
 *   exact_long → bracket_overlay → short_unique → middle-strip
 * Bracket overlay fires only when EXACTLY ONE of the 4 overlay names is
 * consistent with the slot's short-form AND resolves via nameToFipId.
 */
export function resolveFourPlayers(
  d: DrawRow,
  nameToFipId: Map<string, string>,
  shortFormToFipId: Map<string, string | null>,
  fipIdToPlayerId: Map<string, string>,
  logger?: Logger,
  options?: ResolveOptions,
): ResolvedFour {
  const useTiers = options != null;
  const bracketOverlay = options?.bracketOverlay;
  const bracketPool = bracketOverlay
    ? [
        bracketOverlay.team1_player1_name,
        bracketOverlay.team1_player2_name,
        bracketOverlay.team2_player1_name,
        bracketOverlay.team2_player2_name,
      ].filter((n): n is string => !!n)
    : [];

  // Per-slot lookup. Returns { fipId, tier } where tier is the resolution
  // method tag and fipId is null when nothing resolved.
  const lookup = (name: string | null): { fipId: string | null; tier: Tier } => {
    if (!name) return { fipId: null, tier: 'unresolved' };
    const norm = normalizeName(name);

    // Tier 1: Exact-match (long-form from entry list) — fastest path.
    const exactFipId = nameToFipId.get(norm);
    if (exactFipId) return { fipId: fipIdToPlayerId.get(exactFipId) ?? null, tier: 'exact_long' };

    // Tier 2: Bracket overlay — exactly one consistent long-form name in the pool.
    // OOP snapshots write "J. Ruiz" while the bracket draw has "Javier Ruiz Gonzalez".
    // When EXACTLY ONE bracket name is consistent with the short-form AND resolves
    // via nameToFipId, we can safely upgrade to the long-form identity.
    if (bracketPool.length > 0) {
      const matches = bracketPool.filter((b) => isShortFormConsistentWith(name, b));
      if (matches.length === 1) {
        const longForm = matches[0]!;
        const fipId = nameToFipId.get(normalizeName(longForm));
        if (fipId) {
          return { fipId: fipIdToPlayerId.get(fipId) ?? null, tier: 'bracket_overlay' };
        }
      }
    }

    // Tier 3: Short-form match. OOP snapshots write "M. Alvarez" while the entry
    //    list has "Mateo Alvarez". buildShortFormMap() pre-computed the
    //    short-form keys for every entry-list player (two variants: full-tail
    //    "M. Negrete Oliva" and last-token "A. Miranda"). We look the input
    //    up directly against those keys.
    if (shortFormToFipId.has(norm)) {
      const sfFipId = shortFormToFipId.get(norm) ?? null;
      if (sfFipId == null) {
        logger?.warn(
          { name },
          'fip-draw-populator: short-form name is ambiguous — leaving unresolved',
        );
        return { fipId: null, tier: 'unresolved' };
      }
      return { fipId: fipIdToPlayerId.get(sfFipId) ?? null, tier: 'short_unique' };
    }

    // Tier 3b: middle-strip / prefix fallback.
    // Deliberately tagged as `short_unique` (no dedicated `middle_strip`
    // tier in Tier union) — Pass 2's mis-pair sanity check treats both
    // paths as equally low-confidence relative to exact_long and
    // bracket_overlay. If a future audit shows middle-strip needs a
    // distinct tier (e.g. to gate Pass 2 re-resolution more aggressively),
    // add `'middle_strip'` to the Tier union and a separate tier rank.
    // Middle-name strip / prefix match for draw names with extra
    //    given-middle tokens or trailing surnames. Collect ALL distinct
    //    fip_ids reachable across both shapes — if more than one comes
    //    back we can't safely pick one, so return null (mirrors the
    //    short-form ambiguity rule).
    const tokens = norm.split(' ').filter(Boolean);
    if (tokens.length >= 3) {
      const candidates = new Set<string>();

      // Remove one middle token at a time (inner tokens)
      for (let skip = 1; skip < tokens.length - 1; skip++) {
        const candidate = [
          ...tokens.slice(0, skip),
          ...tokens.slice(skip + 1),
        ].join(' ');
        const cFipId = nameToFipId.get(candidate);
        if (cFipId) candidates.add(cFipId);
      }

      // Prefix match: EL name is a strict prefix of draw name
      //     e.g. "Vinny Nahuel Di Francesco" is a prefix of
      //          "Vinny Nahuel Di Francesco Calderon"
      for (let len = tokens.length - 1; len >= 2; len--) {
        const prefix = tokens.slice(0, len).join(' ');
        const pFipId = nameToFipId.get(prefix);
        if (pFipId) candidates.add(pFipId);
      }

      if (candidates.size > 1) {
        logger?.warn(
          { name, candidates: Array.from(candidates) },
          'fip-draw-populator: middle-strip/prefix match is ambiguous — leaving unresolved',
        );
        return { fipId: null, tier: 'unresolved' };
      }
      if (candidates.size === 1) {
        const only = candidates.values().next().value as string;
        return { fipId: fipIdToPlayerId.get(only) ?? null, tier: 'short_unique' };
      }
    }

    return { fipId: null, tier: 'unresolved' };
  };

  const r1 = lookup(d.team1_player1_name);
  const r2 = lookup(d.team1_player2_name);
  const r3 = lookup(d.team2_player1_name);
  const r4 = lookup(d.team2_player2_name);

  const out: ResolvedFour = {
    p1p1: r1.fipId,
    p1p2: r2.fipId,
    p2p1: r3.fipId,
    p2p2: r4.fipId,
  };
  if (useTiers) {
    out.tiers = {
      p1p1: r1.tier,
      p1p2: r2.tier,
      p2p1: r3.tier,
      p2p2: r4.tier,
    };
  }

  // Pass 2 — pair-aware sweeps. Only runs when caller passes
  // fipIdToPartner via options. Two sweeps run in order:
  //   1. mis-pair sanity: when both slots resolve but aren't entry-list
  //      partners, drop the lower-tier slot (or both when tiers equal).
  //   2. partner-anchor: when exactly one slot is resolved AND the
  //      unresolved slot's raw shorthand is consistent with the resolved
  //      slot's entry-list partner, assign the partner's fip_id at tier
  //      'partner_anchor'. Uses lazy out[slot] reads so refill of a
  //      mis-pair-dropped slot is automatic when the kept slot's
  //      entry-list partner matches the dropped slot's shorthand.
  const fipIdToPartner = options?.fipIdToPartner;
  if (useTiers && fipIdToPartner) {
    const slotsByPair = [
      { anchor: 'p1p1', other: 'p1p2' },
      { anchor: 'p1p2', other: 'p1p1' },
      { anchor: 'p2p1', other: 'p2p2' },
      { anchor: 'p2p2', other: 'p2p1' },
    ] as const;

    const rawNameFor = (slot: 'p1p1' | 'p1p2' | 'p2p1' | 'p2p2'): string | null => {
      switch (slot) {
        case 'p1p1': return d.team1_player1_name;
        case 'p1p2': return d.team1_player2_name;
        case 'p2p1': return d.team2_player1_name;
        case 'p2p2': return d.team2_player2_name;
      }
    };

    // Map resolved player UUID back to fip_id so we can look up the
    // entry-list partner. fipIdToPlayerId is fip_id → uuid; we want
    // the inverse.
    const playerIdToFipId = new Map<string, string>();
    for (const [fipId, playerId] of fipIdToPlayerId) playerIdToFipId.set(playerId, fipId);

    const tierRank: Record<Tier, number> = {
      exact_long: 4,
      bracket_overlay: 3,
      short_unique: 2,
      partner_anchor: 1,
      unresolved: 0,
    };

    // Mis-pair sanity check. For each pair, if both slots resolved and
    // they're NOT entry-list partners, drop the lower-tier slot (or
    // both when tiers are equal). The partner-anchor loop below uses
    // lazy out[slot] reads, so a dropped slot can be refilled there.
    const pairsForMispair: Array<{
      aTier: Tier | undefined; aPlayerId: string | null;
      bTier: Tier | undefined; bPlayerId: string | null;
      dropA: () => void;
      dropB: () => void;
    }> = [
      {
        aTier: out.tiers?.p1p1, aPlayerId: out.p1p1,
        bTier: out.tiers?.p1p2, bPlayerId: out.p1p2,
        dropA: () => { out.p1p1 = null; if (out.tiers) out.tiers.p1p1 = 'unresolved'; },
        dropB: () => { out.p1p2 = null; if (out.tiers) out.tiers.p1p2 = 'unresolved'; },
      },
      {
        aTier: out.tiers?.p2p1, aPlayerId: out.p2p1,
        bTier: out.tiers?.p2p2, bPlayerId: out.p2p2,
        dropA: () => { out.p2p1 = null; if (out.tiers) out.tiers.p2p1 = 'unresolved'; },
        dropB: () => { out.p2p2 = null; if (out.tiers) out.tiers.p2p2 = 'unresolved'; },
      },
    ];

    for (const pair of pairsForMispair) {
      if (pair.aPlayerId == null || pair.bPlayerId == null) continue;
      const aFip = playerIdToFipId.get(pair.aPlayerId);
      const bFip = playerIdToFipId.get(pair.bPlayerId);
      if (!aFip || !bFip) continue;
      const aPartner = fipIdToPartner.get(aFip);
      // Mis-pair when A's entry-list partner is set AND it's NOT B.
      // Entry-list rows are symmetric (each player's row names the
      // other as partner), so checking only A's side is sufficient —
      // if A's partner isn't B, B's partner isn't A either.
      if (aPartner && aPartner.partnerFipId && aPartner.partnerFipId !== bFip) {
        const aRank = tierRank[pair.aTier ?? 'unresolved'];
        const bRank = tierRank[pair.bTier ?? 'unresolved'];
        if (aRank > bRank) {
          pair.dropB();
          logger?.warn(
            { keptTier: pair.aTier, droppedTier: pair.bTier, keptFipId: aFip, droppedFipId: bFip },
            'mispair_detected',
          );
        } else if (bRank > aRank) {
          pair.dropA();
          logger?.warn(
            { keptTier: pair.bTier, droppedTier: pair.aTier, keptFipId: bFip, droppedFipId: aFip },
            'mispair_detected',
          );
        } else {
          pair.dropA();
          pair.dropB();
          // Tie: emit one warn per dropped slot so the payload shape
          // matches the A-wins / B-wins branches (consumers can filter
          // on droppedFipId without missing tie events).
          logger?.warn(
            { keptTier: null, keptFipId: null, droppedTier: pair.aTier, droppedFipId: aFip },
            'mispair_detected',
          );
          logger?.warn(
            { keptTier: null, keptFipId: null, droppedTier: pair.bTier, droppedFipId: bFip },
            'mispair_detected',
          );
        }
      }
    }

    for (const { anchor, other } of slotsByPair) {
      const anchorPlayerId = out[anchor];
      const otherPlayerId = out[other];
      if (anchorPlayerId == null) continue;     // anchor not resolved
      if (otherPlayerId != null) continue;       // other already resolved
      const otherRawName = rawNameFor(other);
      if (!otherRawName) continue;            // no shorthand to validate against

      const anchorFip = playerIdToFipId.get(anchorPlayerId);
      if (!anchorFip) continue;
      const partner = fipIdToPartner.get(anchorFip);
      if (!partner || !partner.partnerNormName) continue;

      if (isShortFormConsistentWith(otherRawName, partner.partnerNormName)) {
        const partnerFip = partner.partnerFipId;
        if (partnerFip) {
          const partnerPlayerId = fipIdToPlayerId.get(partnerFip);
          if (partnerPlayerId) {
            out[other] = partnerPlayerId;
            if (out.tiers) out.tiers[other] = 'partner_anchor';
            logger?.info(
              {
                slot: other,
                anchorFipId: anchorFip,
                anchorTier: out.tiers?.[anchor],
                partnerFipId: partnerFip,
                rawShortForm: otherRawName,
                partnerNormName: partner.partnerNormName,
              },
              'partner_anchor_resolved',
            );
          }
        }
      } else if (doShortFormInitialsMatch(otherRawName, partner.partnerNormName)) {
        // Initials match but surname doesn't — likely a real late swap.
        // Decline the anchor and emit telemetry for ops review.
        logger?.warn(
          {
            slot: other,
            rawShortForm: otherRawName,
            expectedPartnerNormName: partner.partnerNormName,
            expectedPartnerFipId: partner.partnerFipId,
          },
          'suspected_late_swap',
        );
      }
    }
  }

  return out;
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
  // Paginate — large bracket dumps (Premier P1, Major) easily exceed
  // 1000 snapshot rows after a few days of scrapes. Without pagination
  // we'd silently miss late-tournament rounds (R16/QF/SF/F) that were
  // captured AFTER the qualifier rounds.
  const rawRows = await paginatedSelect<
    Omit<
      DrawRow,
      | 'source'
      | 'team1_player1_country'
      | 'team1_player2_country'
      | 'team2_player1_country'
      | 'team2_player2_country'
    >
  >(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('draw_snapshots')
        .select(
          'tournament_id, match_widget_id, category, round_label, draw_position, ' +
            'team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, ' +
            'team1_fip_id, team2_fip_id, team1_seed, team2_seed, status, captured_at',
        )
        .eq('tournament_id', tournamentId)
        .eq('source', 'fip_event_page')
        .range(start, end),
    { what: `draw_snapshots (tournament=${tournamentId})` },
  );

  // FIP draw_snapshots don't carry country data — the bracket exposes
  // seeds + fip_id but not flag images. Stamp explicit nulls so the
  // shared DrawRow contract holds; the populator's INSERT path just
  // emits no country columns when these are null.
  const rows = rawRows.map((r) => ({
    ...r,
    team1_player1_country: null,
    team1_player2_country: null,
    team2_player1_country: null,
    team2_player2_country: null,
    source: 'fip_event_page' as const,
  }));

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
 * Read OOP snapshots and transform them into the same DrawRow shape the
 * populator's main loop expects. Two callers, two modes:
 *
 * 1. **Full replacement** (no `excludeRoundLabels` arg): used by the
 *    amateur-tier fallback when `draw_snapshots` is empty. Some FIP
 *    tournaments (B3 Singapore, etc.) only expose the bracket as a PDF,
 *    never wiring an AJAX draw widget. OOP carries everything we need
 *    (round + court + 4 names + match_widget_id) to build a thin match.
 *
 * 2. **Qualifying-only merge** (with `excludeRoundLabels` set to the
 *    rounds already covered by `draw_snapshots`): used by Silver+
 *    tournaments to surface qualifying matches (Q1/Q2/Q3) that the
 *    bracket doesn't include. The bracket stays the source of truth for
 *    main-draw rounds; OOP fills the gap.
 *
 * Produces rows with `source: 'oop_snapshot'`. Downstream:
 * - the bye check (which keys off `team*_fip_id`) is skipped — OOP
 *   doesn't include byes / placeholder rows
 * - thin-match gate (`isAmateurTier || isOopSourced`) lets these
 *   insert with FK-null + raw name strings when entry-list resolution
 *   doesn't find a fip_id
 * - FIP results-writer / live-poller fill status / winner / sets later
 *   via the composite key
 */
async function loadLatestOopRowsAsDrawRows(
  supabase: SupabaseClient,
  tournamentId: string,
  opts: { excludeRoundLabels?: ReadonlySet<string> } = {},
): Promise<DrawRow[]> {
  interface OopRow {
    tournament_id: string;
    match_widget_id: string | null;
    category: 'men' | 'women' | null;
    round_label: string | null;
    team1_player1_name: string | null;
    team1_player2_name: string | null;
    team2_player1_name: string | null;
    team2_player2_name: string | null;
    team1_player1_country: string | null;
    team1_player2_country: string | null;
    team2_player1_country: string | null;
    team2_player2_country: string | null;
    captured_at: string;
  }

  // Paginate. OOP snapshots accumulate quickly during a tournament —
  // a 7-day FIP Silver event with 8 days of OOP captured at hourly
  // resolution easily clears 1000 rows. Without pagination the latest
  // round (today's matches) might fall past the cap and the populator
  // would miss every "live" match.
  const rows = await paginatedSelect<OopRow>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('oop_snapshots')
        .select(
          'tournament_id, match_widget_id, category, round_label, ' +
            'team1_player1_name, team1_player2_name, ' +
            'team2_player1_name, team2_player2_name, ' +
            'team1_player1_country, team1_player2_country, ' +
            'team2_player1_country, team2_player2_country, ' +
            'captured_at',
        )
        .eq('tournament_id', tournamentId)
        .range(start, end),
    { what: `oop_snapshots (tournament=${tournamentId})` },
  );

  // Dedupe: latest captured_at per (tournament_id, match_widget_id).
  // OOP gets re-fetched daily during a tournament — each fetch appends
  // a new row per match, so we always pick the freshest snapshot.
  const latest = new Map<string, OopRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    if (!r.category) continue; // can't write a match without category
    if (!r.round_label) continue; // round is required to write a match
    // Qualifying-only merge mode: drop any round the bracket already
    // covers so we don't double-insert main-draw matches that exist in
    // both sources. Done after the per-match key but before dedupe is
    // resolved — saves a tiny bit of work and matches the "filter then
    // dedupe" mental model. (`findOrCreateMatch` is also a backstop.)
    if (opts.excludeRoundLabels?.has(r.round_label)) continue;
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
    team1_player1_country: r.team1_player1_country,
    team1_player2_country: r.team1_player2_country,
    team2_player1_country: r.team2_player1_country,
    team2_player2_country: r.team2_player2_country,
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

/**
 * @deprecated Use `buildPairIndex` instead. Kept exported for any external
 * callers that may still import this directly. Body lives in
 * ../lib/draw-resolver.ts now (shared with the reconciler).
 */
export const loadEntryListNameMap = sharedLoadEntryListNameMap;

/**
 * Pair-aware entry-list index.
 *
 *   nameToFipId: same flat map loadEntryListNameMap returns — used by
 *                Pattern 1/2/3 short-form resolution unchanged.
 *
 *   fipIdToPartner: for every entry-list row that has either
 *                   partner_fip_id OR partner_name, the partner's
 *                   normalized long-form name (and fip_id when known).
 *                   Powers the Pass 2 partner-anchor sweep.
 *
 * Both maps reflect the latest captured_at per (category, fip_id).
 */
export interface PairIndex {
  nameToFipId: Map<string, string>;
  fipIdToPartner: Map<string, {
    partnerFipId: string | null;
    partnerNormName: string;
  }>;
}

export async function buildPairIndex(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<PairIndex> {
  interface Row {
    name: string | null;
    fip_id: string | null;
    category: 'men' | 'women';
    partner_fip_id: string | null;
    partner_name: string | null;
    captured_at: string;
  }
  const rows = await paginatedSelect<Row>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('entry_list_snapshots')
        .select('name, fip_id, category, partner_fip_id, partner_name, captured_at')
        .eq('tournament_id', tournamentId)
        .range(start, end),
    { what: `entry_list_snapshots (tournament=${tournamentId})` },
  );

  // Latest captured_at per category (same rule as loadEntryListNameMap).
  const maxByCat = new Map<string, string>();
  for (const r of rows) {
    const prev = maxByCat.get(r.category);
    if (!prev || r.captured_at > prev) maxByCat.set(r.category, r.captured_at);
  }

  const nameToFipId = new Map<string, string>();
  const fipIdToPartner = new Map<string, { partnerFipId: string | null; partnerNormName: string }>();
  for (const r of rows) {
    if (r.captured_at !== maxByCat.get(r.category)) continue;
    if (r.name && r.fip_id) nameToFipId.set(normalizeName(r.name), r.fip_id);
    if (r.fip_id && (r.partner_fip_id || r.partner_name)) {
      const partnerNormName = r.partner_name ? normalizeName(r.partner_name) : '';
      fipIdToPartner.set(r.fip_id, {
        partnerFipId: r.partner_fip_id,
        partnerNormName,
      });
    }
  }

  return { nameToFipId, fipIdToPartner };
}

/**
 * Per-match bracket long-form name overlay. Keyed by match_widget_id,
 * one entry per match the bracket has touched (including bye-skipped
 * walkover rows where one side is null but the other has real names).
 * The Pass 1 bracket_overlay tier scans the 4 names here looking for
 * exactly one consistent with the OOP shorthand.
 *
 * Reads only source='fip_event_page' rows — Crionet OOP rows are NOT
 * authoritative for player identity (they're short-form anyway, which
 * is the problem we're solving).
 */
export interface BracketOverlayEntry {
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_fip_id: string | null;
  team2_fip_id: string | null;
}

export type BracketOverlay = Map<string, BracketOverlayEntry>;

export async function buildBracketOverlay(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<BracketOverlay> {
  interface Row {
    match_widget_id: string | null;
    team1_player1_name: string | null;
    team1_player2_name: string | null;
    team2_player1_name: string | null;
    team2_player2_name: string | null;
    team1_fip_id: string | null;
    team2_fip_id: string | null;
    captured_at: string;
  }
  const rows = await paginatedSelect<Row>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('draw_snapshots')
        .select(
          'match_widget_id, team1_player1_name, team1_player2_name, ' +
          'team2_player1_name, team2_player2_name, ' +
          'team1_fip_id, team2_fip_id, captured_at',
        )
        .eq('tournament_id', tournamentId)
        .eq('source', 'fip_event_page')
        .range(start, end),
    { what: `draw_snapshots overlay (tournament=${tournamentId})` },
  );

  // Latest captured_at per match_widget_id.
  const latestByMid = new Map<string, Row>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const prev = latestByMid.get(r.match_widget_id);
    if (!prev || r.captured_at > prev.captured_at) latestByMid.set(r.match_widget_id, r);
  }

  const overlay: BracketOverlay = new Map();
  for (const [mid, r] of latestByMid) {
    overlay.set(mid, {
      team1_player1_name: r.team1_player1_name,
      team1_player2_name: r.team1_player2_name,
      team2_player1_name: r.team2_player1_name,
      team2_player2_name: r.team2_player2_name,
      team1_fip_id: r.team1_fip_id,
      team2_fip_id: r.team2_fip_id,
    });
  }
  return overlay;
}

// Body lives in ../lib/draw-resolver.ts now (shared with the reconciler).
const loadPlayersByFipId = sharedLoadPlayersByFipId;

const EXISTING_MATCH_COLUMNS =
  'id, widget_id_composite, round, ' +
  'pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
  'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name, ' +
  'pair1_player1_country, pair1_player2_country, pair2_player1_country, pair2_player2_country, ' +
  'pair1_seed, pair2_seed';

async function loadExistingMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string
): Promise<Map<string, ExistingMatch>> {
  const { data, error } = await supabase
    .from('matches')
    .select(EXISTING_MATCH_COLUMNS)
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

/**
 * Load existing matches whose `crionet_widget` sidecar mapping falls
 * under `compositePrefix`. These are rows the live-poller / OOP path
 * (findOrCreateMatch) created with `widget_id_composite` NULL — the
 * column-based loadExistingMatchesByPrefix can't see them, so without
 * this the populator inserts a duplicate for the same widget. Keyed by
 * the sidecar `external_id` (the real composite) so the caller merges
 * them into the same dedup map. Empty map when nothing matches.
 */
async function loadSidecarMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string
): Promise<Map<string, ExistingMatch>> {
  const { data: mappings, error: mapErr } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'match')
    .eq('source', 'crionet_widget')
    .like('external_id', `${compositePrefix}%`);
  if (mapErr) {
    throw new Error(
      `entity_external_ids read failed (prefix=${compositePrefix}): ${mapErr.message}`
    );
  }
  const rows = (mappings ?? []) as { entity_id: string; external_id: string }[];
  const map = new Map<string, ExistingMatch>();
  if (rows.length === 0) return map;

  const compositeByMatchId = new Map<string, string>();
  for (const r of rows) {
    if (r.entity_id && r.external_id) compositeByMatchId.set(r.entity_id, r.external_id);
  }

  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select(EXISTING_MATCH_COLUMNS)
    .in('id', Array.from(compositeByMatchId.keys()));
  if (matchErr) {
    throw new Error(
      `matches read by sidecar id failed (prefix=${compositePrefix}): ${matchErr.message}`
    );
  }
  for (const row of ((matchRows ?? []) as unknown) as ExistingMatch[]) {
    // Key by the sidecar composite — the column is NULL on these rows.
    const composite = compositeByMatchId.get(row.id);
    if (composite) map.set(composite, row);
  }
  return map;
}
