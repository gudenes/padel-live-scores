// padelgod/src/workers/schedule-hints-writer.ts
//
// Periodic writer that computes per-match `late_hint` for the matches list
// UI ("may be late" / "starting soon" / null). Loads scheduled + live +
// recently-finished matches in a 48h window, groups them by
// (tournament_id, court, day_date), sorts each group by court_order, and
// delegates to computeLateHintsForGroup() from late-hint-rules.ts.
//
// Diffs computed values against the current `late_hint` column and
// UPDATEs only rows that need changing. Supports dry-run mode (logs
// proposed updates, no writes) for the rollout window.
//
// Designed to run every ~2 min from the padelgod scheduler. The 2-min
// cadence is the worst-case staleness for a hint to appear or clear after
// the underlying status changes.
//
// Spec: docs/superpowers/specs/2026-05-06-schedule-late-flags-design.md

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  computeLateHintsForGroup,
  type LateHintMatchInput,
  type LateHint,
} from '../lib/late-hint-rules.js';

export interface ScheduleHintsWriterDeps {
  supabase: SupabaseClient;
  logger: Logger;
  /** When true, log proposed UPDATEs but make no DB writes. */
  dryRun: boolean;
  /** Default 90. Override via env var SCHEDULE_HINTS_EXPECTED_DURATION_MIN. */
  expectedDurationMinutes: number;
  /** Override now() for tests. */
  now?: () => Date;
}

export interface ScheduleHintsWriterResult {
  groupsProcessed: number;
  rowsToUpdate: number;
  rowsUpdated: number;
}

interface MatchRow {
  id: string;
  tournament_id: string;
  court: string | null;
  court_order: number | null;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  late_hint: string | null;
}

const DAY_DATE_LOOKBACK_HOURS = 24;
const DAY_DATE_LOOKAHEAD_HOURS = 48;

export async function runScheduleHintsWriter(
  deps: ScheduleHintsWriterDeps,
): Promise<ScheduleHintsWriterResult> {
  const { supabase, logger, dryRun, expectedDurationMinutes } = deps;
  const now = (deps.now ?? (() => new Date()))();

  const fromIso = new Date(now.getTime() - DAY_DATE_LOOKBACK_HOURS * 3600_000).toISOString();
  const toIso = new Date(now.getTime() + DAY_DATE_LOOKAHEAD_HOURS * 3600_000).toISOString();

  // Load matches with status scheduled, live, on_court, or recently terminal.
  // Live + terminal matches are needed as predecessors even though they
  // themselves get null hints.
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, tournament_id, court, court_order, status, scheduled_at, started_at, finished_at, late_hint',
    )
    .in('status', ['scheduled', 'live', 'on_court', 'finished', 'retired', 'walkover'])
    .gte('scheduled_at', fromIso)
    .lte('scheduled_at', toIso);

  if (error) {
    logger.error({ err: error }, 'schedule-hints-writer: load failed');
    return { groupsProcessed: 0, rowsToUpdate: 0, rowsUpdated: 0 };
  }

  const rows = (data as MatchRow[]) ?? [];
  const groups = groupByCourtDay(rows);

  let rowsToUpdate = 0;
  let rowsUpdated = 0;

  for (const groupRows of groups.values()) {
    groupRows.sort((a, b) => (a.court_order ?? 0) - (b.court_order ?? 0));
    const inputs: LateHintMatchInput[] = groupRows.map(toComputeInput);
    const results = computeLateHintsForGroup(inputs, now, expectedDurationMinutes);

    for (let i = 0; i < results.length; i++) {
      const row = groupRows[i]!;
      const computed = results[i]!.lateHint;
      const current = row.late_hint as LateHint;
      if (computed === current) continue;

      rowsToUpdate++;
      if (dryRun) {
        logger.info(
          { matchId: row.id, from: current, to: computed },
          'schedule-hints-writer: would update',
        );
        continue;
      }

      const { error: updateErr } = await supabase
        .from('matches')
        .update({ late_hint: computed })
        .eq('id', row.id);

      if (updateErr) {
        logger.warn({ err: updateErr, matchId: row.id }, 'schedule-hints-writer: update failed');
        continue;
      }
      rowsUpdated++;
    }
  }

  logger.info(
    { groupsProcessed: groups.size, rowsToUpdate, rowsUpdated, dryRun },
    'schedule-hints-writer: done',
  );

  return { groupsProcessed: groups.size, rowsToUpdate, rowsUpdated };
}

function groupByCourtDay(rows: MatchRow[]): Map<string, MatchRow[]> {
  const out = new Map<string, MatchRow[]>();
  for (const r of rows) {
    if (!r.scheduled_at) continue;
    const dayDate = r.scheduled_at.slice(0, 10); // ISO YYYY-MM-DD
    const key = `${r.tournament_id}::${r.court ?? '__null__'}::${dayDate}`;
    let bucket = out.get(key);
    if (!bucket) {
      bucket = [];
      out.set(key, bucket);
    }
    bucket.push(r);
  }
  return out;
}

function toComputeInput(r: MatchRow): LateHintMatchInput {
  return {
    id: r.id,
    status: r.status,
    scheduledAt: r.scheduled_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    courtOrder: r.court_order ?? 0,
  };
}
