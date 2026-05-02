import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  parseOopScheduledAtBatch,
  type OopScheduleRow,
} from '../lib/oop-schedule-parser.js';

/**
 * fip-oop-writer — simplified-pipeline writer #2.
 *
 * Reads `padelgod.oop_snapshots` (populated by `oop-fetcher` every hour
 * at :50) and UPDATEs `public.matches` rows already keyed by the real
 * widget composite (created by `fip-draw-populator`). Two independent
 * passes per tournament:
 *
 * Pass A — court / round / court_order
 * ------------------------------------
 * - Looks up matches by `widget_id_composite` via a batched prefix query
 * - If not found → SKIP (never creates matches; that's the populator's job)
 * - UPDATEs court + court_order; UPDATEs round ONLY if currently null
 *   (keeps the populator's canonical "R32" format from being clobbered
 *   with OOP's "Round of 32" during the parallel migration period)
 *
 * Pass B — scheduled_at / schedule_label (gap-fill)
 * -------------------------------------------------
 * - For matches with `scheduled_at IS NULL`, parses the OOP snapshot's
 *   `scheduled_label` ("Starting at 5:00 PM" / "Not before 7:00 PM" /
 *   "Followed by") combined with `day_date` and the tournament's
 *   timezone into a UTC timestamp.
 * - Source priority `tournament.scheduled_at` is `['padelapi', 'fip']`
 *   so we only fill when current is NULL — never clobber padelapi.
 * - For FIP-only tournaments (no padelapi twin) this is the ONLY
 *   automatic path that populates scheduled_at; before this pass the
 *   only writer was the manual "Apply N Changes" button on the OOP
 *   Schedule Review tab in /ops, which is fine for the operator-led
 *   tournaments but left every fip_beyond / fip_promises tournament
 *   invisible to the public app's date filter.
 * - "Followed by" needs court-context, so the parser runs as a single
 *   per-tournament batch (chained by court_position).
 *
 * What this writer does NOT touch
 * -------------------------------
 * - `status`, `winner_pair`, `sets` — results-writer owns these
 * - `scheduled_at` when it's already set — gap-fill semantics
 * - `widget_id_composite` — populator sets this on INSERT, immutable
 * - Any row where `widget_id_composite IS NULL` — legacy reconciler rows
 *   are invisible to this writer
 *
 * Known data issue (out of scope — separate parser PR)
 * ----------------------------------------------------
 * Some oop_snapshots rows have `court` and `scheduled_label` SWAPPED due
 * to a bug in `crionet-oop.ts` (observed 2026-04-24 on Brussels). When
 * this writer runs against bad snapshot data, it will faithfully copy
 * the bad value into `public.matches.court`. Fix is in the parser, not
 * here. Adding court-string validation here would mask the upstream bug
 * and is deliberately not done.
 */

export interface FipOopWriterDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** When true (default), log proposed updates but don't write. Lets
   *  operators review output before committing. */
  dryRun: boolean;
  /** When set, only tournaments whose UUID is in the allowlist are
   *  processed. Used by the on-demand refresh endpoint. */
  onlyTournamentIds?: Set<string>;
}

export interface FipOopWriterResult {
  tournamentsProcessed: number;
  tournamentsSkippedNoWidget: number;
  oopRowsConsidered: number;
  updated: number;
  skippedNoMatch: number;
  skippedNoWidgetId: number;
  skippedNothingToChange: number;
  scheduledAtWritten: number;
  scheduledAtSkippedNoTimezone: number;
  scheduledAtSkippedUnparsable: number;
  dryRun: boolean;
}

interface TournamentRow {
  tournament_id: string;
  tournament_name: string;
  slug: string;
}

interface OopRow {
  tournament_id: string;
  match_widget_id: string | null;
  category: 'men' | 'women';
  round_label: string | null;
  court: string | null;
  court_position: number | null;
  scheduled_label: string | null;
  /** Calendar date from the Crionet day-pill (`oop_snapshots.day_date`).
   *  Required for Pass B (scheduled_at gap-fill) — without it the parsed
   *  local time has no calendar anchor. NULL on snapshots captured before
   *  the 2026-04-29 day_date column was introduced. */
  day_date: string | null;
  captured_at: string;
}

interface ExistingMatch {
  id: string;
  widget_id_composite: string;
  round: string | null;
  court: string | null;
  court_order: number | null;
  /** Used by Pass B to enforce gap-fill semantics — only write
   *  scheduled_at when current is NULL or a midnight-UTC placeholder
   *  (see isPlaceholderScheduledAt). */
  scheduled_at: string | null;
}

/**
 * True when scheduled_at is the padelapi midnight-UTC placeholder
 * pattern — a known calendar date but no time. Padelapi writes
 * `YYYY-MM-DDT00:00:00+00:00` whenever it has played_at as a date but
 * no schedule_label. The OOP writer's gap-fill must treat these as
 * effectively NULL so the real OOP-derived time can replace them;
 * otherwise the row stays stuck on the placeholder forever (the
 * trigger that put us on this fix in the first place).
 *
 * False-positive risk is negligible: real padel matches don't start
 * at exactly 00:00:00 UTC anywhere in the world (the closest sane
 * tz is +1, where 00:00 UTC = 01:00 local — still well outside any
 * tournament play hours).
 */
export function isPlaceholderScheduledAt(value: string | null): boolean {
  if (!value) return false;
  // Avoid a Date round-trip — string-match the time component.
  // Accepts both "T00:00:00" and "T00:00:00.000" sub-second forms.
  return /T00:00:00(?:\.0+)?(?:Z|[+-]00:00)?$/.test(value);
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFipOopWriter(
  deps: FipOopWriterDeps
): Promise<FipOopWriterResult> {
  const { supabase, logger, dryRun } = deps;

  const result: FipOopWriterResult = {
    tournamentsProcessed: 0,
    tournamentsSkippedNoWidget: 0,
    oopRowsConsidered: 0,
    updated: 0,
    skippedNoMatch: 0,
    skippedNoWidgetId: 0,
    skippedNothingToChange: 0,
    scheduledAtWritten: 0,
    scheduledAtSkippedNoTimezone: 0,
    scheduledAtSkippedUnparsable: 0,
    dryRun,
  };

  // 1. Active tournaments
  const { data: tours, error: toursErr } = await supabase.rpc(
    'padelgod_active_tournaments_with_slug'
  );
  if (toursErr) {
    throw new Error(
      `padelgod_active_tournaments_with_slug RPC failed: ${toursErr.message}`
    );
  }
  const allTournaments = (tours ?? []) as TournamentRow[];
  const tournaments = deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0
    ? allTournaments.filter((t) => deps.onlyTournamentIds!.has(t.tournament_id))
    : allTournaments;

  for (const t of tournaments) {
    const tournamentWidgetId = await getActiveWidgetIdCode(
      supabase,
      t.tournament_id
    );
    if (!tournamentWidgetId) {
      result.tournamentsSkippedNoWidget += 1;
      continue;
    }

    // 2. Latest OOP snapshot per (tournament, match_widget_id)
    const latestOop = await loadLatestOopRows(supabase, t.tournament_id);
    if (latestOop.length === 0) continue;

    result.tournamentsProcessed += 1;

    // 3. Pre-load composite-keyed matches for this tournament
    const compositePrefix = `${tournamentWidgetId}:`;
    const matchByComposite = await loadExistingMatchesByPrefix(
      supabase,
      compositePrefix
    );

    // 4. Pass A — court / round / court_order updates per OOP row.
    //    Also tracks which matches are eligible for Pass B's gap-fill
    //    write. We feed the FULL OOP batch (not just NULL-scheduled_at
    //    rows) to the parser so "Followed by" can chain off filled-in
    //    neighbours — e.g. cp=2 "Followed by" needs cp=0/cp=1 in the
    //    batch as anchors even if those two are already filled. Without
    //    this, gap-fill becomes order-dependent: a row that arrives
    //    AFTER its court-mates were filled gets stranded with no chain
    //    anchor and never resolves. Mendoza day-3 hit this with MD028 /
    //    MD029 / MD023 — populator created them late, all the absolute-
    //    time anchors had already filled in earlier runs, parser saw
    //    only orphan "Followed by" rows and dropped them.
    const allOopForParser: Array<{ matchId: string | null; row: OopRow }> = [];
    // Map<matchId, scheduledAtAtReadTime>. The value is what was on the
    // row when we loaded it — used as a CAS-style precondition on the
    // UPDATE so a concurrent writer's edit doesn't get clobbered.
    // NULL value means "scheduled_at was NULL when read" (use .is(null)
    // guard); a string is the placeholder value (use .eq(value) guard).
    const writeEligible = new Map<string, string | null>();
    for (const r of latestOop) {
      result.oopRowsConsidered += 1;

      if (!r.match_widget_id) {
        result.skippedNoWidgetId += 1;
        continue;
      }

      const composite = `${tournamentWidgetId}:${r.match_widget_id}`;
      const existing = matchByComposite.get(composite);

      if (!existing) {
        // Populator hasn't created this match yet (or never will, e.g.
        // widget-code-lookup + populator haven't caught up). Still feed
        // the OOP row to the parser so the chain stays intact for other
        // rows on the same court. matchId stays null; the write loop
        // skips entries without a match.
        result.skippedNoMatch += 1;
        if (r.day_date && r.scheduled_label) {
          allOopForParser.push({ matchId: null, row: r });
        }
        continue;
      }

      // Pass A patch
      const patch = buildOopPatch(r, existing);
      if (!patch) {
        result.skippedNothingToChange += 1;
      } else if (dryRun) {
        logger?.info(
          { composite, matchId: existing.id, patch },
          'fip-oop-writer [dry-run]: would UPDATE match'
        );
        result.updated += 1;
      } else {
        const { error: updErr } = await supabase
          .from('matches')
          .update(patch)
          .eq('id', existing.id);
        if (updErr) {
          throw new Error(
            `matches update failed (id=${existing.id}, composite=${composite}): ${updErr.message}`
          );
        }
        result.updated += 1;
      }

      // Pass B feed — every OOP row with the basics goes in so the
      // parser's per-court chain is complete. The write step below
      // gates on `writeEligible` (matches whose current scheduled_at
      // is NULL or a midnight-UTC padelapi placeholder) so we still
      // preserve gap-fill semantics: real-time-bearing rows act as
      // chain anchors but we never overwrite them.
      if (r.day_date && r.scheduled_label) {
        allOopForParser.push({ matchId: existing.id, row: r });
        if (
          existing.scheduled_at == null ||
          isPlaceholderScheduledAt(existing.scheduled_at)
        ) {
          writeEligible.set(existing.id, existing.scheduled_at);
        }
      }
    }

    // 5. Pass B — scheduled_at gap-fill from OOP day_date + label.
    if (writeEligible.size > 0) {
      const tournamentTimezone = await getTournamentTimezone(
        supabase,
        t.tournament_id,
      );
      if (!tournamentTimezone) {
        // No tz on the tournament row + country fallback didn't resolve.
        // Skip — without tz we can't compute UTC. Operator can set the
        // tournament's timezone column manually and the next run picks it up.
        result.scheduledAtSkippedNoTimezone += writeEligible.size;
        logger?.warn(
          {
            tournamentId: t.tournament_id,
            candidates: writeEligible.size,
          },
          'fip-oop-writer: skipping scheduled_at writes — no timezone resolvable',
        );
      } else {
        const oopBatch: OopScheduleRow[] = allOopForParser.map(
          ({ row }) => ({
            matchWidgetId: row.match_widget_id,
            court: row.court,
            courtPosition: row.court_position ?? 0,
            scheduledLabel: row.scheduled_label,
            dayDate: row.day_date,
          }),
        );
        const parsed = parseOopScheduledAtBatch(oopBatch, tournamentTimezone);
        const matchIdByWidget = new Map(
          allOopForParser
            .filter(({ matchId }) => matchId != null)
            .map(({ matchId, row }) => [row.match_widget_id!, matchId!]),
        );

        // Track unparsable WRITE candidates only — we don't care if the
        // parser dropped a row whose match doesn't exist yet.
        let parsedWriteEligible = 0;

        for (const p of parsed) {
          const matchId = matchIdByWidget.get(p.matchWidgetId);
          if (!matchId) continue;
          if (!writeEligible.has(matchId)) continue; // gap-fill: skip filled rows
          parsedWriteEligible += 1;
          if (dryRun) {
            logger?.info(
              {
                matchId,
                scheduledAt: p.scheduledAt,
                scheduleLabel: p.scheduleLabel,
                approximate: p.approximate,
              },
              'fip-oop-writer [dry-run]: would WRITE scheduled_at',
            );
          } else {
            // CAS-style guard against a concurrent writer (manual ops
            // Schedule Review tab, future padelapi recursion) setting
            // a real value between our read above and this write. We
            // only overwrite the EXACT value we observed at read time —
            // either NULL or the midnight-UTC placeholder. The .is(null)
            // and .eq(value) PostgREST filters cannot be combined into
            // one .or() chain reliably, so branch here.
            const originalValue = writeEligible.get(matchId)!;
            let query = supabase
              .from('matches')
              .update({
                scheduled_at: p.scheduledAt,
                schedule_label: p.scheduleLabel,
              })
              .eq('id', matchId);
            if (originalValue == null) {
              query = query.is('scheduled_at', null);
            } else {
              query = query.eq('scheduled_at', originalValue);
            }
            const { error: schedErr } = await query;
            if (schedErr) {
              logger?.warn(
                { matchId, err: schedErr.message },
                'fip-oop-writer: scheduled_at write failed',
              );
              continue;
            }
          }
          result.scheduledAtWritten += 1;
        }

        // Anything we wanted to write but the parser couldn't resolve
        // (e.g. "Followed by" with no chain anchor anywhere on its court).
        result.scheduledAtSkippedUnparsable +=
          writeEligible.size - parsedWriteEligible;
      }
    }
  }

  logger?.info(result, 'fip-oop-writer run complete');
  return result;
}

// ── Patch builder (exported for testing) ───────────────────────────────

/**
 * Compute the narrow UPDATE patch for one match given the latest OOP
 * snapshot. Returns null when nothing would change (caller skips the
 * write).
 *
 * Policy:
 *   - court: overwrite if differs (OOP is authoritative for court moves).
 *   - court_order: 0-based → 1-based; overwrite only when snapshot has
 *     a non-null court_position (preserve whatever was there on
 *     historical rows without positions).
 *   - round: overwrite when the OOP value disagrees with the existing
 *     row's value AFTER normalising both (so "R32" vs "Round of 32"
 *     reads as a no-op, but "R32" vs "Q3" triggers a write). The
 *     OOP is authoritative for what's actually being played: a single
 *     widget_id_composite can be reused across qualifying and main
 *     draw, so the populator's draw-bracket label can be stale during
 *     qualifying. Skipping the write produced "R32 on Apr 29" UI rows
 *     for matches that were really Q3 qualifiers (Mendoza Apr 2026).
 */
export function buildOopPatch(
  snapshot: OopRow,
  existing: ExistingMatch
): Record<string, string | number> | null {
  const patch: Record<string, string | number> = {};

  if (snapshot.court && snapshot.court !== existing.court) {
    patch.court = snapshot.court;
  }

  if (
    snapshot.court_position != null &&
    existing.court_order !== snapshot.court_position + 1
  ) {
    patch.court_order = snapshot.court_position + 1;
  }

  if (snapshot.round_label != null && snapshot.round_label.length > 0) {
    const oopNorm = normalizeRoundShort(snapshot.round_label);
    const existingNorm = normalizeRoundShort(existing.round);
    // Only write when OOP gives us a recognised label AND it differs
    // from what's currently on the row (after normalising both formats).
    // When existing.round is null, oopNorm always "differs" → write.
    if (oopNorm != null && oopNorm !== existingNorm) {
      patch.round = snapshot.round_label;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

// Map every round-label format we see in the wild (verbose "Round of 32",
// short "R32", abbreviations "QF", lowercase variants, qualifier "Q1")
// to a canonical short code. Returns null for unrecognised input so the
// caller can choose to skip rather than overwrite with garbage.
//
// Kept inline (rather than imported from src/lib/source-matcher) because
// padelgod runs as a separate Railway service and doesn't share imports
// with the Next.js app. The mapping is small and the labels are stable —
// duplication is the cheaper trade-off here.
function normalizeRoundShort(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === '') return null;
  const map: Record<string, string> = {
    r128: 'R128',
    'round of 128': 'R128',
    r64: 'R64',
    'round of 64': 'R64',
    r32: 'R32',
    'round of 32': 'R32',
    r16: 'R16',
    'round of 16': 'R16',
    qf: 'QF',
    quarter: 'QF',
    quarters: 'QF',
    quarterfinals: 'QF',
    'quarter-finals': 'QF',
    'quarter finals': 'QF',
    sf: 'SF',
    semifinals: 'SF',
    'semi-finals': 'SF',
    'semi finals': 'SF',
    f: 'F',
    final: 'F',
    finals: 'F',
    q1: 'Q1',
    q2: 'Q2',
    q3: 'Q3',
  };
  return map[cleaned] ?? null;
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

async function loadLatestOopRows(
  supabase: SupabaseClient,
  tournamentId: string
): Promise<OopRow[]> {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select(
      'tournament_id, match_widget_id, category, round_label, court, court_position, scheduled_label, day_date, captured_at'
    )
    .eq('tournament_id', tournamentId);
  if (error) {
    throw new Error(
      `oop_snapshots read failed (tournament=${tournamentId}): ${error.message}`
    );
  }
  const rows = (data ?? []) as unknown as OopRow[];

  const latest = new Map<string, OopRow>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const key = r.match_widget_id;
    const prev = latest.get(key);
    if (!prev || r.captured_at > prev.captured_at) latest.set(key, r);
  }
  return Array.from(latest.values());
}

async function loadExistingMatchesByPrefix(
  supabase: SupabaseClient,
  compositePrefix: string
): Promise<Map<string, ExistingMatch>> {
  const { data, error } = await supabase
    .from('matches')
    .select('id, widget_id_composite, round, court, court_order, scheduled_at')
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

// Country → IANA timezone fallback for tournaments where the timezone
// column is null. Mirrors the smaller subset of the map used by the
// Vercel sync's inferTimezone helper. Kept inline to avoid pulling a
// Next.js-side module into padelgod.
const COUNTRY_TIMEZONES: Readonly<Record<string, string>> = Object.freeze({
  ES: 'Europe/Madrid',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  DE: 'Europe/Berlin',
  PT: 'Europe/Lisbon',
  GB: 'Europe/London',
  US: 'America/New_York',
  MX: 'America/Mexico_City',
  AR: 'America/Argentina/Buenos_Aires',
  BR: 'America/Sao_Paulo',
  SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai',
  QA: 'Asia/Qatar',
  HK: 'Asia/Hong_Kong',
  SG: 'Asia/Singapore',
  JP: 'Asia/Tokyo',
  AU: 'Australia/Sydney',
  ZA: 'Africa/Johannesburg',
  MA: 'Africa/Casablanca',
  EG: 'Africa/Cairo',
  SE: 'Europe/Stockholm',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  AT: 'Europe/Vienna',
  CH: 'Europe/Zurich',
  PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague',
  RO: 'Europe/Bucharest',
  GR: 'Europe/Athens',
  TR: 'Europe/Istanbul',
  IL: 'Asia/Jerusalem',
  KZ: 'Asia/Almaty',
  UZ: 'Asia/Tashkent',
  KG: 'Asia/Bishkek',
  CL: 'America/Santiago',
  CO: 'America/Bogota',
  PY: 'America/Asuncion',
  PE: 'America/Lima',
  EC: 'America/Guayaquil',
  UY: 'America/Montevideo',
  CN: 'Asia/Shanghai',
  IN: 'Asia/Kolkata',
  TH: 'Asia/Bangkok',
  PH: 'Asia/Manila',
  MY: 'Asia/Kuala_Lumpur',
  ID: 'Asia/Jakarta',
  KW: 'Asia/Kuwait',
  TN: 'Africa/Tunis',
  CI: 'Africa/Abidjan',
  KE: 'Africa/Nairobi',
  CA: 'America/Toronto',
  HR: 'Europe/Zagreb',
  BO: 'America/La_Paz',
  CY: 'Asia/Nicosia',
});

async function getTournamentTimezone(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('timezone, country')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `tournaments timezone lookup failed (tournament=${tournamentId}): ${error.message}`,
    );
  }
  const explicit = (data?.timezone as string | null | undefined) ?? null;
  if (explicit) return explicit;
  const country = (data?.country as string | null | undefined) ?? null;
  if (!country) return null;
  return COUNTRY_TIMEZONES[country.toUpperCase()] ?? null;
}
