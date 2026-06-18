import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { paginatedSelect } from '../lib/db-paginate.js';
import { countryToTimezone } from '../lib/country-timezone.js';
import {
  parseOopScheduledAtBatch,
  type OopScheduleRow,
} from '../lib/oop-schedule-parser.js';
import { activeTournamentArgs } from '../lib/active-tournament-args.js';
import { type NotifyDeps } from '../lib/notify.js';

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
  /**
   * Web-push notify config, forwarded from the scheduler's
   * `SchedulerDeps.notify`. No longer consumed by this worker — the
   * `match_scheduled` sender was removed (superseded by the morning
   * matchday digest). Retained for scheduler-wiring compatibility.
   */
  notify?: NotifyDeps;
  /**
   * Free event-notification senders master switch, forwarded from the
   * scheduler. No longer consumed here (see `notify` above). Retained for
   * scheduler-wiring compatibility.
   */
  eventsEnabled?: boolean;
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
   *  (see isPlaceholderScheduledAt), OR when the existing value is a
   *  "Followed by" estimate that may shift as the OOP chain evolves
   *  (see isScheduledAtWriteEligible). */
  scheduled_at: string | null;
  schedule_label: string | null;
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

/**
 * Pass B eligibility predicate — whether to re-estimate scheduled_at
 * on this OOP run.
 *
 * Eligible when:
 *   - scheduled_at is NULL (never been set);
 *   - it's the padelapi midnight-UTC placeholder (date-only, no time);
 *   - the row's current `schedule_label` is "Followed by". These values
 *     are pure chain-derived estimates: any change to absolute anchors
 *     upstream on the same court (a new "Not before X PM" landing, a
 *     court_order shuffle, a walkover finishing earlier than expected)
 *     shifts the correct estimate downstream, so we must always recompute
 *     rather than freeze the first guess.
 *
 * Firm rows ("Starting at X PM", "Not before X PM") are NOT eligible —
 * those carry an absolute time and are preserved across runs so we don't
 * clobber manual overrides or padelapi-sourced firm times. The CAS guard
 * on the UPDATE still protects against a concurrent writer landing a
 * firmer value between our read and write.
 */
export function isScheduledAtWriteEligible(
  scheduledAt: string | null,
  scheduleLabel: string | null,
): boolean {
  if (scheduledAt == null) return true;
  if (isPlaceholderScheduledAt(scheduledAt)) return true;
  if (scheduleLabel && /followed by/i.test(scheduleLabel)) return true;
  return false;
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
    'padelgod_active_tournaments_with_slug',
    activeTournamentArgs(deps.onlyTournamentIds),
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
          isScheduledAtWriteEligible(
            existing.scheduled_at,
            existing.schedule_label,
          )
        ) {
          writeEligible.set(existing.id, existing.scheduled_at);
        }
      }
    }

    // 5. Pass B — scheduled_at gap-fill from OOP day_date + label.
    if (writeEligible.size > 0) {
      const { tz: tournamentTimezone, country, name } =
        await getTournamentTimezone(supabase, t.tournament_id);
      if (!tournamentTimezone) {
        // No tz on the tournament row + country fallback didn't resolve.
        // Skip — without tz we can't compute UTC. Two common fixes:
        //   (a) country is unset upstream → fix the sync that should
        //       populate `tournaments.country`, OR set it manually in
        //       the ops UI and the next run picks up.
        //   (b) country is a new circuit destination not yet in
        //       `src/lib/country-timezone.ts` → add it there (the
        //       mirror + drift test keep padelgod aligned).
        // The warn includes name + country so operators can act on it
        // before play day. FIP PLATINUM ALBANIA 2026-05-25 was the
        // first incident that surfaced this gap silently — see
        // CLAUDE.md → "Timezone display" / the country-timezone lib.
        result.scheduledAtSkippedNoTimezone += writeEligible.size;
        logger?.warn(
          {
            tournamentId: t.tournament_id,
            tournamentName: name,
            country,
            candidates: writeEligible.size,
          },
          'fip-oop-writer: skipping scheduled_at writes — no timezone resolvable (add country to src/lib/country-timezone.ts, or populate tournaments.timezone/country)',
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
      // Keep round_canonical in sync with the raw `round` we just set.
      // normalizeRoundShort's output (R64/R32/R16/QF/SF/F/Q1/Q2/Q3) is
      // already the canonical short form.
      patch.round_canonical = oopNorm;
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
  // Pagination is required: per-tournament `oop_snapshots` rows accumulate
  // at ~75 widgets × 96 ticks/day, so any tournament past ~1.4 days of
  // running blows past PostgREST's `db_max_rows` cap (10k) and the
  // unranged read silently truncates to a non-deterministic 10k slice.
  // For tournaments with >10k rows the slice often does NOT contain
  // each widget's latest capture — the dedup-by-widget Map below comes
  // back stale or missing and the writer iterates over a fossilised set.
  // Asuncion P2 hit this on QF day 2026-05-08 (table at 20k+ rows; the
  // unordered slice covered a 35-second window from the previous
  // morning, missed every May 8 widget). See CLAUDE.md → "PostgREST 1k
  // cap" for the project policy. `paginatedSelect` walks pages until
  // PostgREST returns a partial page; ordering by captured_at desc just
  // makes the latest-per-widget dedup early-exit-friendly for future
  // optimisations — the dedup itself is order-independent.
  const rows = await paginatedSelect<OopRow>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('oop_snapshots')
        .select(
          'tournament_id, match_widget_id, category, round_label, court, court_position, scheduled_label, day_date, captured_at'
        )
        .eq('tournament_id', tournamentId)
        .order('captured_at', { ascending: false })
        .range(start, end),
    {
      what: `oop_snapshots (tournament=${tournamentId})`,
      pageSize: 10_000,
    },
  );

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
    .select('id, widget_id_composite, round, court, court_order, scheduled_at, schedule_label')
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

/**
 * Resolve the IANA timezone for a tournament. Prefers the explicit
 * `tournaments.timezone` column; falls back to a country-code lookup
 * via the shared {@link countryToTimezone} map (mirrored from the
 * Next.js side — see `padelgod/src/lib/country-timezone.ts`).
 *
 * Returns null when neither source resolves. When that happens the
 * caller logs a warn including the tournament name + country code so
 * we hear about new circuit destinations before play day rather than
 * after a user notices missing schedules. Adding a new country = one
 * line in `src/lib/country-timezone.ts` (the mirror keeps padelgod
 * in sync; the country-timezone drift test in CI catches divergence).
 */

async function getTournamentTimezone(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<{ tz: string | null; country: string | null; name: string | null }> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('name, timezone, country')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) {
    throw new Error(
      `tournaments timezone lookup failed (tournament=${tournamentId}): ${error.message}`,
    );
  }
  const explicit = (data?.timezone as string | null | undefined) ?? null;
  const country = (data?.country as string | null | undefined) ?? null;
  const name = (data?.name as string | null | undefined) ?? null;
  if (explicit) return { tz: explicit, country, name };
  return { tz: countryToTimezone(country), country, name };
}
