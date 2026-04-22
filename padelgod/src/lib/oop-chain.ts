/**
 * oop-chain — pure inference of per-match `started_at` from a court's
 * Order-of-Play timeline.
 *
 * Why this exists
 * ---------------
 * Crionet exposes no absolute per-match start/end timestamps. What it DOES
 * expose for each court, in play order:
 *   • A schedule label on the first match ("Starting at 11:00 AM")
 *   • "Followed by" on subsequent matches (= starts when the previous ends)
 *   • Occasional "Not before X PM" floors
 *   • A duration (mm:ss) for finished matches
 *
 * Given these, we can chain-compute start times for matches we never
 * observed live:
 *   started[i] = max(started[i-1] + duration[i-1] + gap, notBefore[i])
 *
 * The `gap` accounts for warm-up / changeover / ceremony between matches
 * on the same court (typically 10–20 min). V1 uses a constant (15 min).
 * Future work: self-calibrate against live-poller observations over time.
 *
 * The chain breaks at the first match whose duration we don't know — any
 * later match gets `null`, because there's no way to infer when a live or
 * scheduled upstream match will end.
 *
 * Pure: no I/O, no Date.now. Callers resolve schedule labels to absolute
 * ISO strings (tournament-timezone handling lives outside this module).
 *
 *
 * Wiring status (as of 2026-04-22)
 * --------------------------------
 * This module is implemented and unit-tested. The prerequisites that used
 * to block reconciler integration — the OOP parser capturing the real
 * court name, and `padelgod.oop_snapshots.court_position` existing — are
 * both satisfied as of the court-capture branch (feat/padelgod-court-capture).
 *
 * The reconciler now writes `public.matches.court + court_order`. A
 * follow-up plan is needed to actually call `computeOopChain` against the
 * latest per-court snapshots and write `public.matches.started_at` (and
 * eventually a computed `finished_at` fallback). Blockers for that wiring:
 *   - Duration source: the results widget surfaces duration (HH:MM) for
 *     finished matches but the parser doesn't yet capture it, and
 *     `results_snapshots` has no `duration_minutes` column. The live-poller
 *     writes `public.matches.duration` for matches we see live; unseen
 *     matches still need a duration source before the chain can extend
 *     past them.
 *   - Inter-match gap: the chain uses a constant 15-minute default. Worth
 *     calibrating against live-observed gaps once we have enough data.
 */

export type OopChainStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'walkover'
  | 'retired';

export interface OopChainEntry {
  /** The widget's match id (e.g. "MD021"), used for output keying. */
  matchWidgetId: string;
  /** Status from the latest OOP / results snapshot for this match. */
  status: OopChainStatus;
  /** Minutes from results widget (finished) or live widget (live). */
  durationMinutes: number | null;
  /**
   * Absolute lower bound for this match's start, or null when the chain
   * alone dictates it.
   *
   * Caller responsibilities:
   *   - "Starting at 11:00 AM" on the court's FIRST match → resolve to ISO
   *     using tournament timezone and pass here.
   *   - "Not before 4:00 PM" on any match → resolve to ISO and pass here.
   *   - "Followed by" or no label → pass null.
   */
  notBeforeIso: string | null;
}

export interface OopChainResult {
  matchWidgetId: string;
  /** ISO start time, or null if the chain couldn't determine one. */
  startedAtIso: string | null;
}

export interface OopChainOptions {
  /**
   * Minutes added between matches to account for warm-up / changeover /
   * ceremony / net re-tensioning. Default 15.
   */
  gapMinutes?: number;
}

const DEFAULT_GAP_MINUTES = 15;

/**
 * Compute the inferred `started_at` for each entry in a single court's
 * ordered timeline. The input must be pre-sorted by play order (as the OOP
 * widget emits it) — this function does NOT reorder.
 *
 * Walkovers and byes break the chain because they have no meaningful
 * duration — we treat them as if their duration were 0 but keep the gap,
 * since the next match typically still waits for the umpire to arrive.
 * Retired matches DO carry a duration (what was played before the retire),
 * so they chain normally.
 */
export function computeOopChain(
  entries: OopChainEntry[],
  opts: OopChainOptions = {},
): OopChainResult[] {
  const gapMs = (opts.gapMinutes ?? DEFAULT_GAP_MINUTES) * 60_000;
  const out: OopChainResult[] = [];

  // `chainEndMs` is the earliest a next match can start based on everything
  // we've chained so far. `null` means the chain is broken — no upstream
  // duration to extrapolate from — and all following entries will be null
  // unless they carry their own `notBeforeIso` floor.
  let chainEndMs: number | null = null;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const floorMs =
      e.notBeforeIso != null ? parseIsoOrNull(e.notBeforeIso) : null;

    // Choose the start: the latest of the chain tip and the floor. If both
    // are null, we cannot infer a start.
    let startMs: number | null;
    if (chainEndMs != null && floorMs != null) {
      startMs = Math.max(chainEndMs, floorMs);
    } else if (chainEndMs != null) {
      startMs = chainEndMs;
    } else if (floorMs != null) {
      startMs = floorMs;
    } else {
      startMs = null;
    }

    out.push({
      matchWidgetId: e.matchWidgetId,
      startedAtIso: startMs != null ? new Date(startMs).toISOString() : null,
    });

    // Advance the chain if we can.
    if (startMs == null) {
      // No start inferred → we cannot extend the chain past this match,
      // even if this match does get a `notBeforeIso` later (it wasn't given).
      chainEndMs = null;
      continue;
    }

    if (isTerminal(e.status)) {
      // Walkover has no playtime — keep the gap so the next match doesn't
      // appear to start at the same instant, but don't add a duration.
      if (e.status === 'walkover') {
        chainEndMs = startMs + gapMs;
        continue;
      }
      if (e.durationMinutes != null) {
        chainEndMs = startMs + e.durationMinutes * 60_000 + gapMs;
      } else {
        // Terminal but unknown duration — chain breaks for later matches.
        chainEndMs = null;
      }
    } else {
      // Scheduled / live: we emit the START but can't chain past it because
      // we don't know when (or if) it'll finish.
      chainEndMs = null;
    }
  }

  return out;
}

function isTerminal(status: OopChainStatus): boolean {
  return status === 'finished' || status === 'walkover' || status === 'retired';
}

function parseIsoOrNull(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// ---------------------------------------------------------------------------
// Label resolution helper
// ---------------------------------------------------------------------------

/**
 * Parse a schedule label like "Starting at 11:00 AM" or "Not before 4:00 PM"
 * into `{ hours, minutes }` in 24-hour time. Returns null for labels that
 * don't carry an absolute time ("Followed by", empty, etc).
 *
 * Exposed as a helper for the reconciler; kept pure so callers can compose
 * it with their own timezone handling.
 */
export function parseScheduleLabelTime(
  label: string | null,
): { hours: number; minutes: number } | null {
  if (!label) return null;
  // Matches "11:00 AM", "4:00 PM", "11:00AM", etc. Case-insensitive.
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(label);
  if (!m) return null;
  let hours = parseInt(m[1]!, 10);
  const minutes = parseInt(m[2]!, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  const isPm = m[3]!.toUpperCase() === 'PM';
  if (isPm && hours < 12) hours += 12;
  if (!isPm && hours === 12) hours = 0;
  return { hours, minutes };
}
