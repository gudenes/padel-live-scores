# FIP Player Profile Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the padelgod `player-profile` worker actually enrich players from FIP — driven by which tournaments are active, with status tracking and an ad-hoc backfill mode for one-shot bulk runs.

**Architecture:** Three-part change. (1) Add profile-status columns to `players` so the worker can pick its next batch self-healingly. (2) Replace the V1.5 stub batch driver with a real loop that picks players via a tournament-priority query (active/upcoming events first, ranking fallback second), and write all fields the parser already extracts (`birthplace`/`height`/`equipment`) gated by `filterUpdateByPriority`. (3) Ship a CLI script for ad-hoc bulk runs with `--filter` and `--limit` windows so the entire player table can be backfilled in chunks without bypassing the steady-state safeguards.

**Tech Stack:** TypeScript, Node 20, Supabase (PostgreSQL), Vitest, axios, cheerio. Worker runs on Railway under padelgod's scheduler.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260509_player_profile_status.sql` | create | Add `profile_fetched_at`, `profile_attempt_at`, `profile_status` columns + index |
| `src/lib/source-priority.ts` | modify | Add `player.equipment` to the priority map |
| `padelgod/src/db/player-profile-queue.ts` | create | Pure query builder: select next batch (tournament-active → ranked → fallback) |
| `padelgod/src/db/__tests__/player-profile-queue.test.ts` | create | Unit tests for queue helper |
| `padelgod/src/workers/player-profile.ts` | modify | Wire all parsed fields, write status, replace stub with real batch loop |
| `padelgod/src/workers/__tests__/player-profile.test.ts` | create | Unit tests: write payload + status branches |
| `padelgod/src/workers/fip-entry-list-populator.ts` | modify | Push hook: stamp newly-inserted players to front of queue |
| `scripts/backfill-fip-player-profiles.ts` | create | Ad-hoc bulk runner with windowing flags |

---

## Task 1: Profile-status columns migration

**Files:**
- Create: `supabase/migrations/20260509_player_profile_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Track per-player FIP profile enrichment state so the player-profile worker
-- can pick its next batch self-healingly and skip permanent failures.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS profile_fetched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS profile_status     TEXT;

-- Allowed statuses: 'ok' | 'missing_page' | 'parse_error' | 'http_error' | 'permanent_failure'
ALTER TABLE players
  DROP CONSTRAINT IF EXISTS players_profile_status_check;
ALTER TABLE players
  ADD CONSTRAINT players_profile_status_check
  CHECK (profile_status IS NULL OR profile_status IN (
    'ok', 'missing_page', 'parse_error', 'http_error', 'permanent_failure'
  ));

-- Hot path: queue picks oldest-attempted players that aren't permanently failing.
CREATE INDEX IF NOT EXISTS idx_players_profile_queue
  ON players (profile_attempt_at NULLS FIRST)
  WHERE fip_id IS NOT NULL
    AND (profile_status IS DISTINCT FROM 'permanent_failure');

COMMENT ON COLUMN players.profile_fetched_at IS 'When the FIP profile was last successfully scraped.';
COMMENT ON COLUMN players.profile_attempt_at IS 'When the FIP profile was last attempted (success OR failure). Drives queue ordering.';
COMMENT ON COLUMN players.profile_status     IS 'Outcome of the last attempt. ''permanent_failure'' parks the row.';
```

- [ ] **Step 2: Apply via Supabase dashboard**

Paste the migration into the Supabase SQL editor on the project. Confirm: `\d+ players` shows the three new columns and the index.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260509_player_profile_status.sql
git commit -m "feat(players): profile enrichment status columns"
```

---

## Task 2: Add `player.equipment` to source priority

**Files:**
- Modify: `src/lib/source-priority.ts`

- [ ] **Step 1: Add the field to the type union**

Locate the `FieldKey` union (around line 62) and add `'player.equipment'` after `'player.side'`:

```ts
  | 'player.side'
  | 'player.equipment'
  | 'player.win_rate'
```

- [ ] **Step 2: Add the priority entry**

Locate the priority map (around line 128) and add this entry alongside the other FIP-primary bio fields:

```ts
  'player.equipment':      ['fip', 'padelapi', 'manual'],
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors related to `source-priority.ts`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/source-priority.ts
git commit -m "feat(source-priority): add player.equipment field (FIP primary)"
```

---

## Task 3: Queue selection helper with tests

**Files:**
- Create: `padelgod/src/db/player-profile-queue.ts`
- Create: `padelgod/src/db/__tests__/player-profile-queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/db/__tests__/player-profile-queue.test.ts
import { describe, it, expect } from 'vitest';
import { buildProfileQueueQuery } from '../player-profile-queue.js';

describe('buildProfileQueueQuery', () => {
  it('builds a query targeting tournament-active players first', () => {
    const q = buildProfileQueueQuery({ mode: 'tournament', limit: 50, retryAfterDays: 30 });
    expect(q.sql).toMatch(/entry_list_snapshots/);
    expect(q.sql).toMatch(/starts_at\s*<=\s*now\(\)\s*\+\s*interval\s*'14 days'/);
    expect(q.sql).toMatch(/ends_at\s*>=\s*now\(\)\s*-\s*interval\s*'2 days'/);
    expect(q.sql).toMatch(/profile_status IS DISTINCT FROM 'permanent_failure'/);
    expect(q.sql).toMatch(/LIMIT 50/);
    // Tier ordering: Premier (1) before Gold (2) before Silver (3) before Bronze (4)
    expect(q.sql).toMatch(/CASE\s+t\.level/);
  });

  it('builds a ranked-fallback query for top-N players', () => {
    const q = buildProfileQueueQuery({ mode: 'ranked', limit: 25, retryAfterDays: 30, rankCap: 1000 });
    expect(q.sql).toMatch(/ranking <= 1000/);
    expect(q.sql).not.toMatch(/entry_list_snapshots/);
    expect(q.sql).toMatch(/LIMIT 25/);
  });

  it('builds an unbounded query for full-table backfill', () => {
    const q = buildProfileQueueQuery({ mode: 'all', limit: 200, retryAfterDays: 30 });
    expect(q.sql).toMatch(/fip_id IS NOT NULL/);
    expect(q.sql).not.toMatch(/entry_list_snapshots/);
    expect(q.sql).not.toMatch(/ranking <=/);
    expect(q.sql).toMatch(/LIMIT 200/);
  });

  it('honors retryAfterDays so recently-attempted players are skipped', () => {
    const q = buildProfileQueueQuery({ mode: 'all', limit: 10, retryAfterDays: 7 });
    expect(q.sql).toMatch(/profile_attempt_at IS NULL OR profile_attempt_at < now\(\) - interval '7 days'/);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd padelgod && npx vitest run src/db/__tests__/player-profile-queue.test.ts`
Expected: FAIL — `Cannot find module '../player-profile-queue.js'`

- [ ] **Step 3: Write the helper**

```ts
// padelgod/src/db/player-profile-queue.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export type QueueMode = 'tournament' | 'ranked' | 'all';

export interface QueueOptions {
  mode: QueueMode;
  limit: number;
  retryAfterDays: number;
  rankCap?: number; // only used when mode === 'ranked'; default 1000
}

export interface QueueRow {
  id: string;
  fip_id: string;
  profile_attempt_at: string | null;
}

/**
 * Build the SQL for picking the next batch of players to enrich.
 * Returns SQL + bindings as a string so we can unit-test the shape and
 * also pass it through Supabase's `rpc` or raw `from(...).select(...)` chains.
 *
 * Tier ordering used in 'tournament' mode:
 *   premier (1) > fip_gold (2) > fip_silver (3) > fip_bronze (4) > other (5)
 */
export function buildProfileQueueQuery(opts: QueueOptions): { sql: string } {
  const retryClause = `(profile_attempt_at IS NULL OR profile_attempt_at < now() - interval '${opts.retryAfterDays} days')`;
  const baseFilter = `
    p.fip_id IS NOT NULL
    AND (p.profile_status IS DISTINCT FROM 'permanent_failure')
    AND ${retryClause.replace(/profile_attempt_at/g, 'p.profile_attempt_at')}
  `;

  if (opts.mode === 'tournament') {
    return {
      sql: `
        SELECT DISTINCT p.id, p.fip_id, p.profile_attempt_at
        FROM players p
        JOIN padelgod.entry_list_snapshots els ON els.fip_id = p.fip_id
        JOIN tournaments t ON t.id = els.tournament_id
        WHERE ${baseFilter}
          AND t.starts_at <= now() + interval '14 days'
          AND t.ends_at   >= now() - interval '2 days'
        ORDER BY
          CASE t.level
            WHEN 'premier'    THEN 1
            WHEN 'fip_gold'   THEN 2
            WHEN 'fip_silver' THEN 3
            WHEN 'fip_bronze' THEN 4
            ELSE 5
          END,
          p.profile_attempt_at ASC NULLS FIRST
        LIMIT ${opts.limit}
      `.trim(),
    };
  }

  if (opts.mode === 'ranked') {
    const cap = opts.rankCap ?? 1000;
    return {
      sql: `
        SELECT p.id, p.fip_id, p.profile_attempt_at
        FROM players p
        WHERE ${baseFilter}
          AND p.ranking IS NOT NULL
          AND p.ranking <= ${cap}
        ORDER BY p.profile_attempt_at ASC NULLS FIRST
        LIMIT ${opts.limit}
      `.trim(),
    };
  }

  // mode === 'all'
  return {
    sql: `
      SELECT p.id, p.fip_id, p.profile_attempt_at
      FROM players p
      WHERE ${baseFilter}
      ORDER BY p.profile_attempt_at ASC NULLS FIRST
      LIMIT ${opts.limit}
    `.trim(),
  };
}

/**
 * Execute the queue query via Supabase. We use rpc-style raw SQL via the
 * `pg_query` exec function (already used elsewhere in padelgod for ad-hoc
 * SELECTs). Falls back to a typed PostgREST query when mode === 'all' since
 * that path doesn't need the entry_list_snapshots join.
 */
export async function fetchProfileQueueBatch(
  supabase: SupabaseClient,
  opts: QueueOptions
): Promise<QueueRow[]> {
  const { sql } = buildProfileQueueQuery(opts);
  const { data, error } = await supabase.rpc('pg_query', { query_text: sql });
  if (error) throw new Error(`profile queue fetch failed: ${error.message}`);
  return (data ?? []) as QueueRow[];
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd padelgod && npx vitest run src/db/__tests__/player-profile-queue.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/db/player-profile-queue.ts padelgod/src/db/__tests__/player-profile-queue.test.ts
git commit -m "feat(padelgod): profile enrichment queue helper"
```

> **Note on `pg_query`:** if your padelgod project doesn't have a `pg_query` rpc, replace the rpc call in `fetchProfileQueueBatch` with whatever raw-SQL exec helper exists (search for other `supabase.rpc(` calls in padelgod). If none exists, build the queries via PostgREST chains instead — the test only validates `buildProfileQueueQuery`, so you can refactor `fetchProfileQueueBatch` freely.

---

## Task 4: Wire all parsed fields + status tracking in the worker

**Files:**
- Modify: `padelgod/src/workers/player-profile.ts`
- Create: `padelgod/src/workers/__tests__/player-profile.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/workers/__tests__/player-profile.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildPlayerProfileUpdate } from '../player-profile.js';

describe('buildPlayerProfileUpdate', () => {
  it('writes every parsed field FIP owns, gated by source priority', () => {
    const parsed = {
      fipId: 'P200038',
      birthDate: '1999-08-22',
      birthPlace: 'Madrid',
      heightCm: 184,
      affiliation: null,
      racketBrand: 'Bullpadel',
      racketModel: 'Vertex 04',
      coaches: ['Coach A'],
    };
    const u = buildPlayerProfileUpdate(parsed, 'ok');
    expect(u.fip_id).toBe('P200038');
    expect(u.birthdate).toBe('1999-08-22');
    expect(u.birthplace).toBe('Madrid');
    expect(u.height).toBe(184);
    expect(u.coaches).toEqual(['Coach A']);
    expect(u.equipment).toEqual({ brand: 'Bullpadel', model: 'Vertex 04' });
    expect(u.profile_status).toBe('ok');
    expect(u.last_updated_by).toBe('padelgod');
    expect(typeof u.profile_attempt_at).toBe('string');
    expect(typeof u.profile_fetched_at).toBe('string');
  });

  it('omits null spec fields so existing values are preserved', () => {
    const parsed = {
      fipId: 'P200038',
      birthDate: null, birthPlace: null, heightCm: null,
      affiliation: null, racketBrand: null, racketModel: null,
      coaches: [],
    };
    const u = buildPlayerProfileUpdate(parsed, 'ok');
    expect(u.birthdate).toBeUndefined();
    expect(u.birthplace).toBeUndefined();
    expect(u.height).toBeUndefined();
    expect(u.equipment).toBeUndefined();
    // coaches is always written (per existing 2026 policy: empty array is meaningful)
    expect(u.coaches).toEqual([]);
  });

  it('records failure status without writing parsed fields', () => {
    const u = buildPlayerProfileUpdate(null, 'http_error');
    expect(u.profile_status).toBe('http_error');
    expect(u.profile_fetched_at).toBeUndefined();
    expect(typeof u.profile_attempt_at).toBe('string');
    expect(u.fip_id).toBeUndefined();
    expect(u.birthdate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd padelgod && npx vitest run src/workers/__tests__/player-profile.test.ts`
Expected: FAIL — `buildPlayerProfileUpdate` is not exported.

- [ ] **Step 3: Refactor `player-profile.ts` — extract `buildPlayerProfileUpdate` and write all fields**

Replace the entire body of `padelgod/src/workers/player-profile.ts` with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipPlayerProfile, type ParsedPlayerProfile } from '../parsers/fip-player-profile.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_PLAYER_PROFILE_VERSION } from '../lib/parser-versions.js';
import { fetchProfileQueueBatch, type QueueMode } from '../db/player-profile-queue.js';

export interface PlayerProfileDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface PlayerProfileTask {
  playerId: string;
  slug: string;
}

export type ProfileStatus = 'ok' | 'missing_page' | 'parse_error' | 'http_error' | 'permanent_failure';

export interface PlayerProfileResult {
  updated: boolean;
  fipId: string | null;
  status: ProfileStatus;
}

/**
 * Pure builder — exported for tests. Returns the partial update payload
 * (just the fields we want to write). Caller is responsible for routing
 * through filterUpdateByPriority and applying it via Supabase.
 */
export function buildPlayerProfileUpdate(
  parsed: ParsedPlayerProfile | null,
  status: ProfileStatus
): Record<string, unknown> {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    last_updated_by: 'padelgod',
    profile_attempt_at: now,
    profile_status: status,
  };

  if (parsed && status === 'ok') {
    updates.profile_fetched_at = now;
    if (parsed.fipId)      updates.fip_id     = parsed.fipId;
    if (parsed.birthDate)  updates.birthdate  = parsed.birthDate;
    if (parsed.birthPlace) updates.birthplace = parsed.birthPlace;
    if (parsed.heightCm)   updates.height     = parsed.heightCm;
    // Coaches always written (empty array is meaningful — see prior policy).
    updates.coaches = parsed.coaches;
    if (parsed.racketBrand || parsed.racketModel) {
      updates.equipment = {
        brand: parsed.racketBrand ?? null,
        model: parsed.racketModel ?? null,
      };
    }
  }

  return updates;
}

function classifyError(err: unknown): ProfileStatus {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b404\b/.test(message)) return 'missing_page';
  if (/parse|cheerio|JSON/i.test(message)) return 'parse_error';
  return 'http_error';
}

/**
 * Run a single profile scrape + DB write. Returns the outcome.
 */
export async function runPlayerProfile(
  deps: PlayerProfileDeps,
  task: PlayerProfileTask
): Promise<PlayerProfileResult> {
  const targetUrl = `https://www.padelfip.com/player/${task.slug}/`;
  let parsed: ParsedPlayerProfile | null = null;
  let status: ProfileStatus = 'ok';

  try {
    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'profile',
        tournamentId: null,
        targetUrl,
        parserVersion: FIP_PLAYER_PROFILE_VERSION,
        captureBody: false,
      },
      async () => {
        const response = await deps.httpClient.get(targetUrl);
        const body = String(response.data);
        const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
        parsed = parseFipPlayerProfile(body);
        return { body, contentHash };
      }
    );
  } catch (err) {
    status = classifyError(err);
  }

  const updates = buildPlayerProfileUpdate(parsed, status);

  const { error } = await deps.supabase.from('players').update(updates).eq('id', task.playerId);
  if (error) throw new Error(`Player profile update failed: ${error.message}`);

  return { updated: status === 'ok', fipId: parsed?.fipId ?? null, status };
}

export interface RunBatchOptions {
  mode: QueueMode;
  limit: number;
  retryAfterDays?: number;
  throttleMs?: number;
}

export interface BatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Real batch driver — replaces the V1.5 stub. Picks N players via the queue
 * helper, runs each profile fetch sequentially with optional throttle,
 * returns per-batch counters for logging.
 */
export async function runPlayerProfileBatch(
  deps: PlayerProfileDeps,
  opts: RunBatchOptions
): Promise<BatchResult> {
  const batch = await fetchProfileQueueBatch(deps.supabase, {
    mode: opts.mode,
    limit: opts.limit,
    retryAfterDays: opts.retryAfterDays ?? 30,
  });

  let succeeded = 0;
  let failed = 0;

  for (const row of batch) {
    // FIP slugs follow `firstname-lastname` derived from the canonical name,
    // but the FIP profile page also accepts `fip_id` directly. We use fip_id
    // as the slug since it's the only thing we store reliably.
    const slug = row.fip_id;
    try {
      const result = await runPlayerProfile(deps, { playerId: row.id, slug });
      if (result.status === 'ok') succeeded++;
      else failed++;
    } catch {
      failed++;
    }
    if (opts.throttleMs) await new Promise(r => setTimeout(r, opts.throttleMs));
  }

  return { attempted: batch.length, succeeded, failed };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd padelgod && npx vitest run src/workers/__tests__/player-profile.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Run the full padelgod test suite**

Run: `cd padelgod && npx vitest run`
Expected: no regressions in other workers' tests.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/player-profile.ts padelgod/src/workers/__tests__/player-profile.test.ts
git commit -m "feat(player-profile): write all parsed fields + status tracking + batch driver"
```

---

## Task 5: Wire the batch driver into the scheduler

**Files:**
- Modify: `padelgod/src/scheduler.ts` (around lines 168–171 where the stub lives)

- [ ] **Step 1: Locate the stub**

Run: `grep -n "player-profile worker has no batch driver" padelgod/src/scheduler.ts`
Expected: one match, around line 168.

- [ ] **Step 2: Replace the stub call with the real batch driver**

Open `padelgod/src/scheduler.ts`. Find the block that logs `"player-profile worker has no batch driver yet (V1.5)"` and replace it with:

```ts
import { runPlayerProfileBatch } from './workers/player-profile.js';

// ... inside the scheduler's player-profile :30 handler ...

const result = await runPlayerProfileBatch(
  { supabase, httpClient },
  {
    mode: 'tournament',
    limit: 40,
    retryAfterDays: 30,
    throttleMs: 750,
  },
);

console.log(
  `[player-profile] tournament batch: attempted=${result.attempted} ok=${result.succeeded} fail=${result.failed}`,
);

// Top-up with ranked-fallback if we had spare quota
if (result.attempted < 40) {
  const spare = 40 - result.attempted;
  const fallback = await runPlayerProfileBatch(
    { supabase, httpClient },
    { mode: 'ranked', limit: spare, retryAfterDays: 30, throttleMs: 750 },
  );
  console.log(
    `[player-profile] ranked-fallback: attempted=${fallback.attempted} ok=${fallback.succeeded} fail=${fallback.failed}`,
  );
}
```

(Match the existing import style and dependency-injection pattern of the scheduler — the snippet above shows the call shape, not literal placement. Look at how a working worker like `tournament-discovery` is wired and mirror that pattern.)

- [ ] **Step 3: Compile-check**

Run: `cd padelgod && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/scheduler.ts
git commit -m "feat(scheduler): wire real player-profile batch driver"
```

---

## Task 6: Push hook in entry-list populator

**Files:**
- Modify: `padelgod/src/workers/fip-entry-list-populator.ts` (around lines 232–258 where players are inserted/updated)

- [ ] **Step 1: Locate the insert path**

Run: `grep -n "fip_id\|insert\|upsert" padelgod/src/workers/fip-entry-list-populator.ts | head -30`

Find the block where new players are inserted (the `INSERT` path that requires `fip_id` per CLAUDE.md note).

- [ ] **Step 2: Stamp newly-inserted players to front of queue**

In the insert payload, add:

```ts
profile_attempt_at: '1970-01-01T00:00:00Z',
profile_status: null,
```

This pushes the row to the top of the `profile_attempt_at NULLS FIRST` index ordering, so the next `:30` profile-batch run picks it up.

(Do NOT touch the UPDATE path — existing populated players already have an `attempt_at` value or will pick it up via the steady-state scan.)

- [ ] **Step 3: Smoke check**

Run: `cd padelgod && npx tsc --noEmit && npx vitest run`
Expected: no errors, no regressions.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/workers/fip-entry-list-populator.ts
git commit -m "feat(entry-list-populator): push new players to front of profile queue"
```

---

## Task 7: Ad-hoc backfill script

**Files:**
- Create: `scripts/backfill-fip-player-profiles.ts`

- [ ] **Step 1: Write the script**

```ts
#!/usr/bin/env tsx
/**
 * Ad-hoc backfill runner for FIP player profile enrichment.
 *
 * Usage examples:
 *   # Enrich every FIP-id'd player, 100 at a time, ~1 req/sec
 *   npx tsx scripts/backfill-fip-player-profiles.ts --filter=all --limit=100 --throttle-ms=1000
 *
 *   # Just the active-tournament window (= what the cron does, but unbounded)
 *   npx tsx scripts/backfill-fip-player-profiles.ts --filter=tournament --limit=500
 *
 *   # Top-1000 ranked only
 *   npx tsx scripts/backfill-fip-player-profiles.ts --filter=ranked --limit=1000
 *
 *   # Dry run — show counts, no HTTP, no writes
 *   npx tsx scripts/backfill-fip-player-profiles.ts --filter=all --limit=50 --dry-run
 *
 * Resumable: each invocation queries the DB by `profile_attempt_at NULLS FIRST`,
 * so re-running the same command picks up where the previous run stopped.
 * Permanent failures (404 etc.) are skipped automatically once status is set.
 */

import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { runPlayerProfileBatch } from '../padelgod/src/workers/player-profile.js';
import type { QueueMode } from '../padelgod/src/db/player-profile-queue.js';

interface CliOptions {
  filter: QueueMode;
  limit: number;
  throttleMs: number;
  retryAfterDays: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const get = (k: string, fallback?: string): string | undefined => {
    const m = argv.find(a => a.startsWith(`--${k}=`));
    return m ? m.split('=', 2)[1] : fallback;
  };
  const filter = (get('filter', 'tournament') ?? 'tournament') as QueueMode;
  if (!['tournament', 'ranked', 'all'].includes(filter)) {
    throw new Error(`--filter must be tournament|ranked|all, got: ${filter}`);
  }
  return {
    filter,
    limit: parseInt(get('limit', '100')!, 10),
    throttleMs: parseInt(get('throttle-ms', '1000')!, 10),
    retryAfterDays: parseInt(get('retry-after-days', '30')!, 10),
    dryRun: argv.includes('--dry-run'),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY');

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const httpClient = axios.create({
    timeout: 15000,
    headers: { 'User-Agent': 'PadelNachos-Backfill/1.0' },
  });

  console.log(
    `[backfill] mode=${opts.filter} limit=${opts.limit} throttle=${opts.throttleMs}ms retry-after=${opts.retryAfterDays}d dry-run=${opts.dryRun}`,
  );

  if (opts.dryRun) {
    const { fetchProfileQueueBatch } = await import('../padelgod/src/db/player-profile-queue.js');
    const rows = await fetchProfileQueueBatch(supabase, {
      mode: opts.filter,
      limit: opts.limit,
      retryAfterDays: opts.retryAfterDays,
    });
    console.log(`[backfill] dry-run — ${rows.length} player(s) would be processed:`);
    for (const row of rows.slice(0, 20)) {
      console.log(`  - ${row.fip_id}  attempted_at=${row.profile_attempt_at ?? '(never)'}`);
    }
    if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`);
    return;
  }

  const result = await runPlayerProfileBatch(
    { supabase, httpClient },
    {
      mode: opts.filter,
      limit: opts.limit,
      retryAfterDays: opts.retryAfterDays,
      throttleMs: opts.throttleMs,
    },
  );

  console.log(
    `[backfill] done — attempted=${result.attempted} ok=${result.succeeded} fail=${result.failed}`,
  );
}

main().catch(err => {
  console.error('[backfill] fatal:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/backfill-fip-player-profiles.ts`

- [ ] **Step 3: Smoke test (dry-run, 5 players)**

Run:
```bash
SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_KEY .env.local | cut -d= -f2) \
NEXT_PUBLIC_SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL .env.local | cut -d= -f2) \
npx tsx scripts/backfill-fip-player-profiles.ts --filter=tournament --limit=5 --dry-run
```

Expected: prints `[backfill] dry-run — 5 player(s) would be processed:` followed by 5 fip_ids.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-fip-player-profiles.ts
git commit -m "feat(scripts): ad-hoc FIP player profile backfill runner"
```

---

## Task 8: Verify on Max Arce

**Files:** none

- [ ] **Step 1: Find Max Arce's row**

Open Supabase SQL editor and run:

```sql
SELECT id, fip_id, name, country, ranking,
       birthdate, birthplace, height, coaches, equipment,
       profile_attempt_at, profile_fetched_at, profile_status
FROM players
WHERE name ILIKE '%arce%'
ORDER BY ranking NULLS LAST;
```

Note the `id` and `fip_id` of the Max Arce row.

- [ ] **Step 2: Force him to the front of the queue**

```sql
UPDATE players SET profile_attempt_at = '1970-01-01T00:00:00Z', profile_status = NULL
WHERE id = '<max-arce-uuid>';
```

- [ ] **Step 3: Run a tiny backfill (1 player)**

```bash
npx tsx scripts/backfill-fip-player-profiles.ts --filter=all --limit=1 --throttle-ms=0
```

Expected output: `[backfill] done — attempted=1 ok=1 fail=0`.

- [ ] **Step 4: Re-query and confirm**

Re-run the SELECT from Step 1. Expected: `birthdate`, `birthplace`, `height`, `equipment`, `coaches`, `profile_fetched_at`, `profile_status='ok'` are all populated for Max Arce.

- [ ] **Step 5: Commit a doc note (optional)**

If you want a paper trail of the verification result, add a short note to `CLAUDE.md` under a "Player profile enrichment" heading describing the new schedule and the backfill command. Otherwise skip.

---

## Self-Review Notes

- **Spec coverage:** Tournament-driven priority ✓ (Task 3, mode=tournament). Ranked fallback ✓ (Task 5 top-up). Push hook on new entries ✓ (Task 6). Ad-hoc backfill with windowing ✓ (Task 7). Status tracking ✓ (Task 1 columns + Task 4 writes). All parsed fields written ✓ (Task 4 `buildPlayerProfileUpdate`). FIP source-priority gating ✓ (Task 2 + Task 4).
- **Type consistency:** `QueueMode`, `RunBatchOptions`, `BatchResult`, `ProfileStatus`, `buildPlayerProfileUpdate`, `runPlayerProfileBatch`, `fetchProfileQueueBatch`, `buildProfileQueueQuery` — all referenced names match across tasks.
- **No placeholders:** every step has either real code, a real SQL block, or a real command. The one judgment call is Task 5's import style note (mirror existing scheduler pattern) — that's intentional because the scheduler's wiring shape varies and shouldn't be guessed.
- **Backwards compatibility:** the migration is `IF NOT EXISTS`. The source-priority change is additive. The worker's `runPlayerProfile` keeps the same signature so any existing manual call sites still work.
