# Schedule Late-Flags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle 90-min "Followed by" chain push with two read-time hints — "may be late" while the predecessor is running over, "starting soon" once it finishes — without ever overwriting `scheduled_at`.

**Architecture:** A new `late_hint` column on `public.matches` is populated every 2 minutes by a new padelgod worker (`schedule-hints-writer`) that walks each court's chain in `court_order` and writes `'may_be_late'` / `'starting_soon'` / `NULL`. MatchCard reads the column and renders a small dotted-underline tap-target under the time. A separate `EST` chip is rendered in the chip row for non-Premier-tier tournaments to signal lower precision.

**Tech Stack:** Postgres (Supabase migration), Node.js padelgod worker (vitest + node-cron), Next.js 16 App Router (React 19, next-intl 5 locales, PostHog).

**Spec:** [docs/superpowers/specs/2026-05-06-schedule-late-flags-design.md](docs/superpowers/specs/2026-05-06-schedule-late-flags-design.md)

---

## File Structure

| File | Purpose |
|---|---|
| `supabase/migrations/<ts>_matches_late_hint.sql` | NEW — adds `late_hint` column + CHECK + partial index |
| `padelgod/src/lib/late-hint-rules.ts` | NEW — pure function `computeLateHintsForGroup()` |
| `padelgod/src/__tests__/lib/late-hint-rules.test.ts` | NEW — unit tests for the pure rules |
| `padelgod/src/workers/schedule-hints-writer.ts` | NEW — worker entry point: load → group → compute → diff → UPDATE |
| `padelgod/src/__tests__/workers/schedule-hints-writer.test.ts` | NEW — worker integration tests with mocked supabase |
| `padelgod/src/scheduler.ts` | MODIFY — register worker with feature flag + dry-run |
| `src/types/match.ts` | MODIFY — add `late_hint?: 'may_be_late' \| 'starting_soon' \| null` to `Match` |
| `src/lib/fetch-matches-day.ts` | MODIFY — add `late_hint` to the explicit `MATCH_SELECT` constant |
| `src/messages/{en,es,pt,it,fr}.json` | MODIFY — add `match.lateHint.*` keys |
| `src/components/MatchCard.tsx` | MODIFY — render hint under time, EST chip in chip row, tap-to-reveal sheet |

All other match-fetching call sites use `select('*')` or `MATCH_SELECT_LIVE`/`MATCH_SELECT_LEAN` which start with `*` — they pick up the column automatically.

---

## Task 1: Migration — add `late_hint` column

**Files:**
- Create: `supabase/migrations/20260506000001_matches_late_hint.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260506000001_matches_late_hint.sql
--
-- Adds late_hint column to public.matches. Populated by padelgod's
-- schedule-hints-writer every 2 min based on the court chain state.
-- See docs/superpowers/specs/2026-05-06-schedule-late-flags-design.md
-- for the rules.

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS late_hint TEXT NULL;

ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_late_hint_check;

ALTER TABLE public.matches
  ADD CONSTRAINT matches_late_hint_check
    CHECK (late_hint IS NULL OR late_hint IN ('may_be_late', 'starting_soon'));

CREATE INDEX IF NOT EXISTS idx_matches_late_hint
  ON public.matches (late_hint)
  WHERE late_hint IS NOT NULL;

COMMENT ON COLUMN public.matches.late_hint IS
  'Computed schedule hint for the matches list UI. ''may_be_late'' = the previous match on this court is running over expected duration or is itself delayed. ''starting_soon'' = the previous match has finished, this match is the immediate next still scheduled. NULL = no hint to render. Written by padelgod schedule-hints-writer worker every ~2 min. Cleared when the match leaves scheduled status.';
```

- [ ] **Step 2: Apply locally and verify**

Run:
```bash
psql "$DATABASE_URL" -f supabase/migrations/20260506000001_matches_late_hint.sql
psql "$DATABASE_URL" -c "\d public.matches" | grep late_hint
```

Expected output line:
```
 late_hint                | text                        |           |          |
```

And:
```bash
psql "$DATABASE_URL" -c "INSERT INTO public.matches (id, late_hint) VALUES (gen_random_uuid(), 'invalid_value');"
```
Expected: `ERROR:  new row for relation "matches" violates check constraint "matches_late_hint_check"`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260506000001_matches_late_hint.sql
git commit -m "feat(db): add late_hint column to matches"
```

---

## Task 2: Pure hint computation function (TDD)

**Files:**
- Create: `padelgod/src/lib/late-hint-rules.ts`
- Test: `padelgod/src/__tests__/lib/late-hint-rules.test.ts`

The function takes a single court+day group sorted by `court_order` ascending, plus `now` and `expectedDurationMinutes`, and returns the late-hint each match should carry. Pure — no DB, no Date.now().

- [ ] **Step 1: Create the test file with the type-only stub**

```ts
// padelgod/src/__tests__/lib/late-hint-rules.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeLateHintsForGroup,
  type LateHintMatchInput,
  type LateHintResult,
} from '../../lib/late-hint-rules.js';

const NOW = new Date('2026-04-26T17:30:00.000Z');
const GAP = 90;

function mk(
  id: string,
  status: LateHintMatchInput['status'],
  scheduledAt: string | null,
  startedAt: string | null = null,
  finishedAt: string | null = null,
  courtOrder: number = 0,
): LateHintMatchInput {
  return {
    id,
    status,
    scheduledAt,
    startedAt,
    finishedAt,
    courtOrder,
  };
}

describe('computeLateHintsForGroup', () => {
  it('returns empty array for empty input', () => {
    const out = computeLateHintsForGroup([], NOW, GAP);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Create the empty rules module so the test compiles**

```ts
// padelgod/src/lib/late-hint-rules.ts

export type LateHint = 'may_be_late' | 'starting_soon' | null;

export type MatchStatus =
  | 'scheduled'
  | 'live'
  | 'on_court'
  | 'finished'
  | 'retired'
  | 'walkover'
  | string;

export interface LateHintMatchInput {
  id: string;
  status: MatchStatus;
  scheduledAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  courtOrder: number;
}

export interface LateHintResult {
  id: string;
  lateHint: LateHint;
}

export function computeLateHintsForGroup(
  _matchesInOrder: LateHintMatchInput[],
  _now: Date,
  _expectedDurationMinutes: number,
): LateHintResult[] {
  return [];
}
```

- [ ] **Step 3: Run the failing test (well, passing — empty case is the trivial case)**

Run: `cd padelgod && npx vitest run src/__tests__/lib/late-hint-rules.test.ts`
Expected: 1 test passes (empty case is the trivial baseline).

- [ ] **Step 4: Add test — non-scheduled matches always get null**

Append to the test file:

```ts
  it('forces null on matches not in scheduled status', () => {
    const out = computeLateHintsForGroup(
      [
        mk('a', 'live', '2026-04-26T15:30:00Z', '2026-04-26T15:30:00Z'),
        mk('b', 'finished', '2026-04-26T17:00:00Z', null, '2026-04-26T16:50:00Z'),
        mk('c', 'on_court', '2026-04-26T17:00:00Z'),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'a', lateHint: null },
      { id: 'b', lateHint: null },
      { id: 'c', lateHint: null },
    ]);
  });
```

- [ ] **Step 5: Implement the non-scheduled rule**

Replace the function body:

```ts
export function computeLateHintsForGroup(
  matchesInOrder: LateHintMatchInput[],
  now: Date,
  expectedDurationMinutes: number,
): LateHintResult[] {
  void expectedDurationMinutes;
  void now;
  return matchesInOrder.map(m => ({
    id: m.id,
    lateHint: m.status === 'scheduled' ? null : null,
  }));
}
```

Run: `cd padelgod && npx vitest run src/__tests__/lib/late-hint-rules.test.ts`
Expected: both tests pass.

- [ ] **Step 6: Add test — first scheduled match with future time has no hint**

```ts
  it('first scheduled match in court with future time has no hint', () => {
    const future = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [mk('only', 'scheduled', future)],
      NOW,
      GAP,
    );
    expect(out).toEqual([{ id: 'only', lateHint: null }]);
  });
```

Run the tests — passes (the current implementation returns null for everything).

- [ ] **Step 7: Add test — scheduled match past its time gets may_be_late**

```ts
  it('scheduled match past its scheduled_at gets may_be_late (self-delay)', () => {
    const pastIso = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [mk('late', 'scheduled', pastIso)],
      NOW,
      GAP,
    );
    expect(out).toEqual([{ id: 'late', lateHint: 'may_be_late' }]);
  });
```

Run: should fail — current impl returns null.

- [ ] **Step 8: Implement self-delay**

```ts
export function computeLateHintsForGroup(
  matchesInOrder: LateHintMatchInput[],
  now: Date,
  expectedDurationMinutes: number,
): LateHintResult[] {
  void expectedDurationMinutes;
  const nowMs = now.getTime();

  return matchesInOrder.map(m => {
    if (m.status !== 'scheduled') return { id: m.id, lateHint: null };

    const schedMs = m.scheduledAt ? Date.parse(m.scheduledAt) : NaN;
    const selfDelayed = !Number.isNaN(schedMs) && schedMs < nowMs;

    return { id: m.id, lateHint: selfDelayed ? 'may_be_late' : null };
  });
}
```

Run tests — all 4 pass.

- [ ] **Step 9: Add test — predecessor live, running over → next gets may_be_late**

```ts
  it('predecessor live and running over gets may_be_late on next match', () => {
    // A started 95 min ago, expected 90 → over by 5 min
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'live', startedIso, startedIso, null, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },        // not scheduled
      { id: 'B', lateHint: 'may_be_late' },
    ]);
  });

  it('predecessor live but within expected duration gets no hint on next', () => {
    const startedIso = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'live', startedIso, startedIso, null, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },
      { id: 'B', lateHint: null },
    ]);
  });
```

Run — fails: B gets null in the first test instead of may_be_late.

- [ ] **Step 10: Implement chain state walk**

Replace the entire function:

```ts
type ChainState = 'clear' | 'running_over' | 'delayed' | 'just_finished';

const RECENT_FINISH_WINDOW_MS = 60 * 60_000; // 60 min

function chainStateFromPredecessor(
  prev: LateHintMatchInput | null,
  prevHint: LateHint,
  nowMs: number,
  expectedDurationMs: number,
): ChainState {
  if (!prev) return 'clear';

  if (prev.status === 'live') {
    const startMs = prev.startedAt ? Date.parse(prev.startedAt) : NaN;
    if (!Number.isNaN(startMs) && nowMs - startMs > expectedDurationMs) {
      return 'running_over';
    }
    return 'clear';
  }

  if (prev.status === 'scheduled') {
    const schedMs = prev.scheduledAt ? Date.parse(prev.scheduledAt) : NaN;
    if (!Number.isNaN(schedMs) && schedMs < nowMs) return 'delayed';
    if (prevHint === 'may_be_late') return 'delayed'; // cascade through future-time predecessor
    return 'clear';
  }

  if (prev.status === 'finished' || prev.status === 'retired' || prev.status === 'walkover') {
    const finMs = prev.finishedAt ? Date.parse(prev.finishedAt) : NaN;
    if (!Number.isNaN(finMs) && nowMs - finMs <= RECENT_FINISH_WINDOW_MS) {
      return 'just_finished';
    }
    return 'clear';
  }

  return 'clear';
}

export function computeLateHintsForGroup(
  matchesInOrder: LateHintMatchInput[],
  now: Date,
  expectedDurationMinutes: number,
): LateHintResult[] {
  const nowMs = now.getTime();
  const expectedDurationMs = expectedDurationMinutes * 60_000;

  const out: LateHintResult[] = [];
  let prev: LateHintMatchInput | null = null;
  let prevHint: LateHint = null;

  for (const m of matchesInOrder) {
    if (m.status !== 'scheduled') {
      out.push({ id: m.id, lateHint: null });
      prev = m;
      prevHint = null;
      continue;
    }

    const schedMs = m.scheduledAt ? Date.parse(m.scheduledAt) : NaN;
    const selfDelayed = !Number.isNaN(schedMs) && schedMs < nowMs;

    const chain = chainStateFromPredecessor(prev, prevHint, nowMs, expectedDurationMs);

    let hint: LateHint;
    if (selfDelayed) {
      hint = 'may_be_late';
    } else if (chain === 'running_over' || chain === 'delayed') {
      hint = 'may_be_late';
    } else if (chain === 'just_finished') {
      hint = 'starting_soon';
    } else {
      hint = null;
    }

    out.push({ id: m.id, lateHint: hint });
    prev = m;
    prevHint = hint;
  }

  return out;
}
```

Run tests — all 6 pass.

- [ ] **Step 11: Add test — predecessor just finished, next is starting_soon**

```ts
  it('predecessor finished within last 60 min flips next to starting_soon', () => {
    const finishedIso = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'finished', '2026-04-26T15:00:00Z', null, finishedIso, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },
      { id: 'B', lateHint: 'starting_soon' },
    ]);
  });

  it('predecessor finished long ago does not trigger starting_soon', () => {
    const longAgoIso = new Date(NOW.getTime() - 90 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'finished', '2026-04-26T14:00:00Z', null, longAgoIso, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },
      { id: 'B', lateHint: null },
    ]);
  });

  it('walkover predecessor also triggers starting_soon', () => {
    const finishedIso = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'walkover', '2026-04-26T15:00:00Z', null, finishedIso, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out[1]).toEqual({ id: 'B', lateHint: 'starting_soon' });
  });
```

Run — all 9 should pass without further code changes (the rules already cover terminal statuses + recent-finish window).

- [ ] **Step 12: Add test — cascade through 3 matches**

```ts
  it('cascade: A running over → B may_be_late → C may_be_late (future time)', () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureBIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const futureCIso = new Date(NOW.getTime() + 150 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'live', startedIso, startedIso, null, 0),
        mk('B', 'scheduled', futureBIso, null, null, 1),
        mk('C', 'scheduled', futureCIso, null, null, 2),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },
      { id: 'B', lateHint: 'may_be_late' },
      { id: 'C', lateHint: 'may_be_late' },
    ]);
  });

  it('live predecessor with null started_at treated as clear', () => {
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'live', null, null, null, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out[1]).toEqual({ id: 'B', lateHint: null });
  });
```

Run: `cd padelgod && npx vitest run src/__tests__/lib/late-hint-rules.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 13: Commit**

```bash
git add padelgod/src/lib/late-hint-rules.ts padelgod/src/__tests__/lib/late-hint-rules.test.ts
git commit -m "feat(padelgod): pure late-hint computation rules"
```

---

## Task 3: schedule-hints-writer worker

**Files:**
- Create: `padelgod/src/workers/schedule-hints-writer.ts`
- Test: `padelgod/src/__tests__/workers/schedule-hints-writer.test.ts`

The worker loads scheduled and live matches for tournaments active in a 48h window, groups them by (tournament_id, court, day_date), and for each group calls `computeLateHintsForGroup`. Diffs computed vs DB hints and updates only changed rows.

- [ ] **Step 1: Create worker skeleton**

```ts
// padelgod/src/workers/schedule-hints-writer.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  computeLateHintsForGroup,
  type LateHintMatchInput,
  type LateHintResult,
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

  // Load matches with status scheduled OR live, in the active window.
  // Live matches are needed as predecessors even though they get null hints.
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
```

- [ ] **Step 2: Create the worker test file with a fake supabase**

```ts
// padelgod/src/__tests__/workers/schedule-hints-writer.test.ts
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { runScheduleHintsWriter } from '../../workers/schedule-hints-writer.js';

const SILENT_LOGGER = pino({ level: 'silent' });

const NOW = new Date('2026-04-26T17:30:00.000Z');
const GAP = 90;

interface FakeRow {
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

function makeFakeSupabase(rows: FakeRow[]) {
  const updates: Array<{ id: string; late_hint: string | null }> = [];
  const supabase = {
    from(_table: string) {
      return {
        select: () => ({
          in: () => ({
            gte: () => ({
              lte: () => Promise.resolve({ data: rows, error: null }),
            }),
          }),
        }),
        update(payload: { late_hint: string | null }) {
          return {
            eq: (_col: string, id: string) => {
              updates.push({ id, late_hint: payload.late_hint });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as Parameters<typeof runScheduleHintsWriter>[0]['supabase'];
  return { supabase, updates };
}

describe('runScheduleHintsWriter', () => {
  it('writes may_be_late when predecessor is live and running over', async () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const rows: FakeRow[] = [
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null, late_hint: null,
      },
      {
        id: 'B', tournament_id: 't1', court: 'C1', court_order: 1,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: null,
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    const result = await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: false,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(result.rowsUpdated).toBe(1);
    expect(updates).toEqual([{ id: 'B', late_hint: 'may_be_late' }]);
  });

  it('skips rows whose hint is already correct', async () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const rows: FakeRow[] = [
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null, late_hint: null,
      },
      {
        id: 'B', tournament_id: 't1', court: 'C1', court_order: 1,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: 'may_be_late',
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    const result = await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: false,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(result.rowsUpdated).toBe(0);
    expect(updates).toEqual([]);
  });

  it('does not write in dry-run mode', async () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const rows: FakeRow[] = [
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null, late_hint: null,
      },
      {
        id: 'B', tournament_id: 't1', court: 'C1', court_order: 1,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: null,
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    const result = await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: true,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(result.rowsToUpdate).toBe(1);
    expect(result.rowsUpdated).toBe(0);
    expect(updates).toEqual([]);
  });

  it('clears late_hint when match leaves scheduled status', async () => {
    const startedIso = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const rows: FakeRow[] = [
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null,
        late_hint: 'starting_soon', // stale
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: false,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(updates).toEqual([{ id: 'A', late_hint: null }]);
  });

  it('groups by (tournament, court, day) — different courts independent', async () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const rows: FakeRow[] = [
      // Court 1: A running over → B should get may_be_late
      {
        id: 'A', tournament_id: 't1', court: 'C1', court_order: 0,
        status: 'live', scheduled_at: startedIso,
        started_at: startedIso, finished_at: null, late_hint: null,
      },
      {
        id: 'B', tournament_id: 't1', court: 'C1', court_order: 1,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: null,
      },
      // Court 2: independent — D has no predecessor in its court, time in future
      {
        id: 'D', tournament_id: 't1', court: 'C2', court_order: 0,
        status: 'scheduled', scheduled_at: futureIso,
        started_at: null, finished_at: null, late_hint: null,
      },
    ];
    const { supabase, updates } = makeFakeSupabase(rows);

    await runScheduleHintsWriter({
      supabase,
      logger: SILENT_LOGGER,
      dryRun: false,
      expectedDurationMinutes: GAP,
      now: () => NOW,
    });

    expect(updates).toEqual([{ id: 'B', late_hint: 'may_be_late' }]);
  });
});
```

- [ ] **Step 3: Run the worker tests**

Run: `cd padelgod && npx vitest run src/__tests__/workers/schedule-hints-writer.test.ts`
Expected: 5 tests pass.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/workers/schedule-hints-writer.ts padelgod/src/__tests__/workers/schedule-hints-writer.test.ts
git commit -m "feat(padelgod): schedule-hints-writer worker"
```

---

## Task 4: Wire worker into the padelgod scheduler

**Files:**
- Modify: `padelgod/src/scheduler.ts`

Follow the existing pattern (e.g. `enableFipOopWriter` + `fipOopWriterDryRun`).

- [ ] **Step 1: Read the existing flag pattern**

Run: `grep -n "enableFipOopWriter\|fipOopWriterDryRun\|fip-oop-writer" padelgod/src/scheduler.ts`

Expected output: confirms there's an entry registering the worker with a cron string + flag-gated import. Use this as the template for schedule-hints-writer.

- [ ] **Step 2: Add the import + flag fields**

In `padelgod/src/scheduler.ts`, add the import next to the others:

```ts
import { runScheduleHintsWriter } from './workers/schedule-hints-writer.js';
```

In `SchedulerFlags`, add:

```ts
  enableScheduleHintsWriter: boolean;
  /** Same dry-run semantics as the populator flag. Independent. */
  scheduleHintsWriterDryRun: boolean;
  /** Default 90. Override via env to tune the "running over" threshold. */
  scheduleHintsExpectedDurationMin: number;
```

- [ ] **Step 3: Wire the schedule entry**

Find the array of `ScheduleEntry` registrations. Add an entry like the existing `fip-oop-writer` block, with cron `*/2 * * * *` (every 2 min):

```ts
  {
    name: 'schedule-hints-writer',
    cron: '*/2 * * * *',
    run: async (deps) => {
      if (!deps.flags.enableScheduleHintsWriter) return { skipped: true };
      return runScheduleHintsWriter({
        supabase: deps.supabase,
        logger: deps.logger.child({ worker: 'schedule-hints-writer' }),
        dryRun: deps.flags.scheduleHintsWriterDryRun,
        expectedDurationMinutes: deps.flags.scheduleHintsExpectedDurationMin,
      });
    },
  },
```

(Match the exact shape used by sibling entries — `deps.flags`, `deps.supabase`, `deps.logger.child(...)` are all already standard. If the existing pattern names them differently, follow that.)

- [ ] **Step 4: Wire the env vars in the bootstrap**

Find where `SchedulerFlags` is constructed from `process.env` (typically in `padelgod/src/index.ts` or wherever `flags:` is built). Add:

```ts
  enableScheduleHintsWriter: process.env.ENABLE_SCHEDULE_HINTS_WRITER !== 'false',
  scheduleHintsWriterDryRun: process.env.SCHEDULE_HINTS_WRITER_DRY_RUN !== 'false', // default true
  scheduleHintsExpectedDurationMin: Number.parseInt(
    process.env.SCHEDULE_HINTS_EXPECTED_DURATION_MIN ?? '90',
    10,
  ),
```

Default `dryRun=true` for first deploy — flip via env once dry-run output is reviewed.

- [ ] **Step 5: Verify the scheduler still type-checks**

Run: `cd padelgod && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/scheduler.ts padelgod/src/index.ts
git commit -m "feat(padelgod): register schedule-hints-writer in scheduler (dry-run default)"
```

---

## Task 5: Add `late_hint` to the Match TypeScript type

**Files:**
- Modify: `src/types/match.ts`

- [ ] **Step 1: Add the field to the Match interface**

In `src/types/match.ts`, find the `Match` interface and add this field next to `winner_pair`:

```ts
  /** Computed schedule hint written by padelgod's schedule-hints-writer.
   *  'may_be_late' = the previous match on this court is running over or
   *  itself delayed. 'starting_soon' = previous match has finished and this
   *  is the immediate next still scheduled. NULL = no hint. Only meaningful
   *  while status === 'scheduled' — UI shows existing chips for other states. */
  late_hint?: 'may_be_late' | 'starting_soon' | null
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/match.ts
git commit -m "feat(types): add late_hint to Match"
```

---

## Task 6: Update explicit `select(...)` lists to include late_hint

**Files:**
- Modify: `src/lib/fetch-matches-day.ts`

Most callers use `select('*')` or constants that start with `*` — those pick up the column automatically. The one explicit field-list query is in `fetch-matches-day.ts`.

- [ ] **Step 1: Audit the explicit selects**

Run: `grep -rn "from('matches')" src/ | grep -v "select('\*')" | grep -v "select('id')" | grep -v "select(MATCH_SELECT_LIVE)" | grep -v "select(MATCH_SELECT_LEAN)"`

Expected: only `src/lib/fetch-matches-day.ts` shows up among non-trivial selects. (Ops dashboard count queries select `id` — they don't render matches and don't need `late_hint`.)

- [ ] **Step 2: Add `late_hint` to MATCH_SELECT in fetch-matches-day.ts**

Find the `MATCH_SELECT` constant (around line 114) and add `late_hint` to the field list:

```ts
const MATCH_SELECT = `
  id, status, category, scheduled_at, finished_at, round, court, court_order,
  schedule_label, winner_pair, late_hint, pair1_seed, pair2_seed,
  pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
  pair1_player1_country, pair1_player2_country, pair2_player1_country, pair2_player2_country,
  tournament:tournaments(id, name, level, country, starts_at, ends_at, status),
  ${PLAYER_JOIN_FIELDS},
  sets(id, set_number, set_score, pair1_games, pair2_games, is_current,
       games(id, game_number, game_score, points, is_current, server_player_id))
`
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/fetch-matches-day.ts
git commit -m "feat(matches): include late_hint in fetch-matches-day select"
```

---

## Task 7: Add translation strings

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the lateHint namespace to en.json**

Open `src/messages/en.json` and find the top-level `match` object. Add this namespace inside it:

```json
    "lateHint": {
      "mayBeLate": "may be late",
      "mayBeLateAria": "Match may be late — tap for details",
      "startingSoon": "starting soon",
      "startingSoonAria": "Match starting soon — tap for details",
      "mayBeLateSheet": "The previous match on {court} is running long. We'll update as soon as it ends.",
      "startingSoonSheet": "The previous match has finished. This one should be called to court shortly.",
      "estChip": "EST",
      "estChipAria": "Estimated time — no live tracking on this tournament"
    },
```

- [ ] **Step 2: Add the lateHint namespace to es.json**

In `src/messages/es.json`, in `match`:

```json
    "lateHint": {
      "mayBeLate": "podría retrasarse",
      "mayBeLateAria": "Este partido podría retrasarse — toca para más información",
      "startingSoon": "empieza pronto",
      "startingSoonAria": "El partido empieza pronto — toca para más información",
      "mayBeLateSheet": "El partido anterior en {court} se está alargando. Actualizaremos en cuanto termine.",
      "startingSoonSheet": "El partido anterior ha terminado. Este debería entrar en pista en breve.",
      "estChip": "EST",
      "estChipAria": "Hora estimada — sin seguimiento en directo de este torneo"
    },
```

- [ ] **Step 3: Add the lateHint namespace to pt.json**

In `src/messages/pt.json`, in `match`:

```json
    "lateHint": {
      "mayBeLate": "pode atrasar",
      "mayBeLateAria": "O jogo pode atrasar — toca para mais detalhes",
      "startingSoon": "começa em breve",
      "startingSoonAria": "O jogo começa em breve — toca para mais detalhes",
      "mayBeLateSheet": "O jogo anterior em {court} está a demorar mais que o previsto. Atualizamos assim que terminar.",
      "startingSoonSheet": "O jogo anterior terminou. Este deve entrar em pista em breve.",
      "estChip": "EST",
      "estChipAria": "Hora estimada — sem acompanhamento ao vivo deste torneio"
    },
```

- [ ] **Step 4: Add the lateHint namespace to it.json**

In `src/messages/it.json`, in `match`:

```json
    "lateHint": {
      "mayBeLate": "potrebbe ritardare",
      "mayBeLateAria": "La partita potrebbe ritardare — tocca per i dettagli",
      "startingSoon": "inizia a breve",
      "startingSoonAria": "La partita inizia a breve — tocca per i dettagli",
      "mayBeLateSheet": "La partita precedente su {court} sta durando più del previsto. Aggiorneremo non appena finisce.",
      "startingSoonSheet": "La partita precedente è finita. Questa dovrebbe entrare in campo a breve.",
      "estChip": "EST",
      "estChipAria": "Orario stimato — nessun tracciamento dal vivo per questo torneo"
    },
```

- [ ] **Step 5: Add the lateHint namespace to fr.json**

In `src/messages/fr.json`, in `match`:

```json
    "lateHint": {
      "mayBeLate": "peut être en retard",
      "mayBeLateAria": "Le match peut être en retard — touchez pour plus d'infos",
      "startingSoon": "commence bientôt",
      "startingSoonAria": "Le match commence bientôt — touchez pour plus d'infos",
      "mayBeLateSheet": "Le match précédent sur {court} dure plus que prévu. Nous mettrons à jour dès qu'il se termine.",
      "startingSoonSheet": "Le match précédent est terminé. Celui-ci devrait être appelé sur le court sous peu.",
      "estChip": "EST",
      "estChipAria": "Horaire estimé — pas de suivi en direct pour ce tournoi"
    },
```

- [ ] **Step 6: Verify the JSON files all parse**

Run: `for f in src/messages/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK: $f"; done`
Expected: 5 lines of `OK: ...`.

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(i18n): translation strings for schedule late hints (5 locales)"
```

---

## Task 8: MatchCard — render hint under the time + tap-to-reveal sheet

**Files:**
- Modify: `src/components/MatchCard.tsx`

The hint sits in the existing `mc-time-stack` flex column under the time. Rendering only fires when `match.status === 'scheduled'`, `match.late_hint != null`, and we have a real `timeStr` (not TBD / not estimatedLabel). Tapping the hint opens a small popover anchored just below it.

- [ ] **Step 1: Re-read the existing time-stack and LockedPill code**

Open `src/components/MatchCard.tsx`. Re-read `formatScheduledTime` (~line 132), the `mc-time-stack` JSX block (~line 578), and the `LockedPill` component (~line 823) — the popover pattern we'll mirror.

- [ ] **Step 2: Add a `LateHintPill` component below `LockedPill`**

In `src/components/MatchCard.tsx`, append after the `LockedPill` function:

```tsx
// ── LateHintPill — small dotted-underline tap target under the time ────────
//
// Renders only on scheduled matches with a real timeStr and a non-null
// late_hint. Tapping pops a tiny info sheet (mirrors LockedPill's pattern):
// 3.5s auto-dismiss, click anywhere on the sheet to dismiss earlier.
//
// Two variants:
//   may_be_late  → orange (#F5A623), "may be late"      → "...running long..."
//   starting_soon → green (#7ED321), "starting soon"    → "...should be called shortly..."

interface LateHintPillProps {
  hint: 'may_be_late' | 'starting_soon'
  courtName: string
  tMatch: ReturnType<typeof useTranslations>
}

function LateHintPill({ hint, courtName, tMatch }: LateHintPillProps) {
  const [open, setOpen] = useState(false)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen((prev) => !prev)
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    if (!open) {
      dismissTimerRef.current = setTimeout(() => setOpen(false), 3500)
    }
  }

  useEffect(() => () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current) }, [])

  const isLate = hint === 'may_be_late'
  const accent = isLate ? ORANGE : GREEN
  const labelKey = isLate ? 'lateHint.mayBeLate' : 'lateHint.startingSoon'
  const ariaKey  = isLate ? 'lateHint.mayBeLateAria' : 'lateHint.startingSoonAria'
  const sheetKey = isLate ? 'lateHint.mayBeLateSheet' : 'lateHint.startingSoonSheet'

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-label={tMatch(ariaKey)}
        aria-expanded={open}
        style={{
          marginTop: 2,
          padding: 0,
          border: 0,
          background: 'transparent',
          color: accent,
          opacity: isLate ? 0.85 : 0.95,
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 0.2,
          textTransform: 'lowercase',
          cursor: 'pointer',
          borderBottom: `1px dotted ${accent}66`,
          lineHeight: 1.2,
          alignSelf: 'flex-end',
        }}
      >
        {tMatch(labelKey)}
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
          style={{
            position: 'absolute',
            right: 12,
            bottom: 6,                  // anchored above the card's bottom padding
            zIndex: 4,
            maxWidth: 240,
            padding: '8px 10px',
            background: BG_ELEV,
            border: `0.5px solid rgba(255,255,255,0.12)`,
            clipPath: CHUNKY.badge,
            color: '#E5E7EB',
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.35,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            cursor: 'pointer',
            animation: 'mc-locked-pop 200ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
          }}
        >
          {tMatch(sheetKey, { court: courtName })}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: Wire the pill into the time-stack**

In the existing scheduled-match time-stack JSX (around line 578), add the pill render at the end of the stack — *after* the time / estimatedLabel / TBD line. Find this block:

```tsx
              {timeStr ? (
                <span style={{ fontSize: 13, fontWeight: 800, color: GREEN, lineHeight: 1.2 }}>
                  {timeStr}{isApproximateTime ? '*' : ''}
                </span>
              ) : estimatedLabel ? (
                <span style={{ fontSize: 9, fontWeight: 600, color: ORANGE, lineHeight: 1.2, textTransform: 'uppercase' }}>
                  {estimatedLabel}
                </span>
              ) : (
                <span style={{ fontSize: 10, fontWeight: 600, color: MUTED, lineHeight: 1.2, opacity: 0.5 }}>
                  TBD
                </span>
              )}
```

Add right after the closing parenthesis (still inside the `<div>` of `mc-time-stack`):

```tsx
              {timeStr && (match.late_hint === 'may_be_late' || match.late_hint === 'starting_soon') && (
                <LateHintPill
                  hint={match.late_hint}
                  courtName={match.court ?? ''}
                  tMatch={tTournament}
                />
              )}
```

Note: `tTournament` is already declared at the top of the component (`useTranslations('tournament')`). Late-hint keys live under the `match` namespace, so we need a separate translator. Add this near the existing `tTournament` declaration:

```tsx
  const tMatch = useTranslations('match')
```

…and pass `tMatch` to `<LateHintPill>` instead of `tTournament`. (Matches the namespace where Task 7 placed the strings.)

- [ ] **Step 4: Manual smoke-test in the dev preview**

Use the project's preview tools (`preview_start` then a snapshot) — or open the matches list locally — and verify:
1. A scheduled match without `late_hint` renders unchanged.
2. With `late_hint='may_be_late'`, an orange dotted "may be late" appears under the time. Tapping it pops the orange-headed sheet for 3.5s. Card-body taps still navigate to match detail.
3. With `late_hint='starting_soon'`, the same pattern in green.

Force the values in the DB temporarily for one or two test matches:
```sql
UPDATE public.matches SET late_hint='may_be_late' WHERE id='<some-scheduled-match-id>';
UPDATE public.matches SET late_hint='starting_soon' WHERE id='<another-scheduled-match-id>';
```

Roll the values back when done.

- [ ] **Step 5: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(matchcard): late-hint pill with tap-to-reveal sheet"
```

---

## Task 9: MatchCard — EST chip in chip row for non-Premier tournaments

**Files:**
- Modify: `src/components/MatchCard.tsx`

The chip is a static visual indicator. Rendering condition: tournament level is non-Premier (use the existing `isPremierLevel` helper, negated).

- [ ] **Step 1: Add the chip to the chips row**

In `src/components/MatchCard.tsx`, find the metadata chip row (~line 362):

```tsx
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 6,
            marginBottom: 6,
            position: 'relative',
            zIndex: 2,
          }}
        >
          {round && <Chip>{round}</Chip>}
          {courtRaw && <Chip>{courtRaw.toUpperCase()}</Chip>}
          {status && (
            <Chip bg={status.bg} color={status.color} bold>
              {status.label}
            </Chip>
          )}
        </div>
```

Add an EST chip after the status chip (so it appears at the right side of the row). Insert this right before the closing `</div>`:

```tsx
          {!isPredictionEnabled && (
            <span
              title={tMatch('lateHint.estChipAria')}
              aria-label={tMatch('lateHint.estChipAria')}
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                color: GREEN,
                background: 'rgba(126,211,33,0.10)',
                border: '1px solid rgba(126,211,33,0.25)',
                padding: '2px 6px',
                clipPath: CHUNKY.badge,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
              }}
            >
              {tMatch('lateHint.estChip')}
            </span>
          )}
```

`isPredictionEnabled` is already computed at the top of the component (`isPremierLevel(tournamentLevel)`) — its inversion is exactly the "non-Premier tier" gate we want.

- [ ] **Step 2: Manual smoke-test**

Open the matches list. Confirm:
1. Premier-level matches (P1/P2/P10/Major) → no EST chip.
2. FIP Bronze/Silver/Gold matches → small green EST chip in the chip row alongside ROUND and COURT.
3. The EST chip composes with the existing chips without breaking layout.

- [ ] **Step 3: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(matchcard): EST chip on non-Premier matches"
```

---

## Task 10: Feature flag for the UI rollout

**Files:**
- Modify: `src/components/MatchCard.tsx`

Gate both the late-hint pill *and* the EST chip behind one env var so they can be disabled in production without a redeploy.

- [ ] **Step 1: Add the env-flag gate at the top of MatchCard**

Near the top of `src/components/MatchCard.tsx` (e.g. above the `MatchCard` component definition), add:

```tsx
const LATE_HINTS_ENABLED = process.env.NEXT_PUBLIC_LATE_HINTS_ENABLED !== 'false'
```

(Default ON. Set `NEXT_PUBLIC_LATE_HINTS_ENABLED=false` in Vercel env to disable.)

- [ ] **Step 2: Wrap the late-hint pill render**

Find the JSX block added in Task 8 step 3:

```tsx
              {timeStr && (match.late_hint === 'may_be_late' || match.late_hint === 'starting_soon') && (
                <LateHintPill ... />
              )}
```

Change the condition to:

```tsx
              {LATE_HINTS_ENABLED && timeStr && (match.late_hint === 'may_be_late' || match.late_hint === 'starting_soon') && (
                <LateHintPill ... />
              )}
```

- [ ] **Step 3: Wrap the EST chip render**

Change the EST chip condition from:

```tsx
          {!isPredictionEnabled && (
            <span ...>EST</span>
          )}
```

to:

```tsx
          {LATE_HINTS_ENABLED && !isPredictionEnabled && (
            <span ...>EST</span>
          )}
```

- [ ] **Step 4: Verify the build still type-checks**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(matchcard): gate late hints + EST chip behind NEXT_PUBLIC_LATE_HINTS_ENABLED"
```

---

## Task 11: Telemetry — shown + tapped events

**Files:**
- Modify: `src/components/MatchCard.tsx`

Two PostHog events from the `LateHintPill` component:
- `schedule_late_hint_shown` — fires once per mount when the hint is visible.
- `schedule_late_hint_tapped` — fires when the user taps the pill to open the sheet.

- [ ] **Step 1: Add the PostHog import**

At the top of `src/components/MatchCard.tsx`, add:

```tsx
import posthog from 'posthog-js'
```

(Mirrors the pattern used in [src/components/PWAInstallNudge.tsx:32](src/components/PWAInstallNudge.tsx:32).)

- [ ] **Step 2: Add the matchId prop to LateHintPill and emit the events**

Update `LateHintPillProps` and the component body added in Task 8:

```tsx
interface LateHintPillProps {
  hint: 'may_be_late' | 'starting_soon'
  courtName: string
  matchId: string
  tMatch: ReturnType<typeof useTranslations>
}

function LateHintPill({ hint, courtName, matchId, tMatch }: LateHintPillProps) {
  const [open, setOpen] = useState(false)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fire 'shown' once per mount
  useEffect(() => {
    posthog.capture('schedule_late_hint_shown', { matchId, hint })
  }, [matchId, hint])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen((prev) => !prev)
    if (!open) {
      posthog.capture('schedule_late_hint_tapped', { matchId, hint })
    }
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    if (!open) {
      dismissTimerRef.current = setTimeout(() => setOpen(false), 3500)
    }
  }

  // ... rest of component unchanged
```

- [ ] **Step 3: Pass matchId from the call site**

In the JSX block where `<LateHintPill>` is rendered:

```tsx
              {LATE_HINTS_ENABLED && timeStr && (match.late_hint === 'may_be_late' || match.late_hint === 'starting_soon') && (
                <LateHintPill
                  hint={match.late_hint}
                  courtName={match.court ?? ''}
                  matchId={match.id}
                  tMatch={tMatch}
                />
              )}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

In the dev preview, open a matches page with a hint visible, tap the hint, and verify in the PostHog Live Events feed that `schedule_late_hint_shown` fires on render and `schedule_late_hint_tapped` fires on tap.

- [ ] **Step 5: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(matchcard): telemetry for schedule late hints (shown + tapped)"
```

---

## Rollout reminder (post-merge, manual ops)

After all tasks merge:

1. **Migration** — apply `20260506000001_matches_late_hint.sql` in Supabase (auto-deploys on push if your migration pipeline is wired; otherwise apply via dashboard).
2. **Padelgod deploy** — Railway picks up the new worker. Default env: `SCHEDULE_HINTS_WRITER_DRY_RUN=true`. Watch logs for `schedule-hints-writer: would update` lines for 24h.
3. **Flip writes on** — set `SCHEDULE_HINTS_WRITER_DRY_RUN=false` in Railway. Re-deploy padelgod. The column starts populating within 2 min.
4. **UI rollout** — Vercel default is `NEXT_PUBLIC_LATE_HINTS_ENABLED` unset → ON. If you want a kill-switch, set it explicitly to `true` first, then flip to `false` if anything goes wrong.
5. **Iterate** — once you've collected 1–2 weeks of data, revisit `expectedDurationMinutes` (currently a flat 90) and consider per-tier calibration. Open question in the spec.
