# Padelgod FIP Rankings Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move FIP rankings sync from Vercel cron (timing out at 120s on official splits) and padelgod's broken HTML scraper (returning 0 rows since FIP redesigned the page) into a single padelgod worker that calls the FIP WP JSON API and runs on a Monday-aware schedule.

**Architecture:** Padelgod's `player-rankings` worker is rewritten to call FIP's WP JSON API directly (`/wp-json/fip/v1/ranking/load-more/` and `/wp-json/fip/v1/player/search?search_type=race`). Players are resolved via `fip_id`-keyed upsert (matching `fip-entry-list-populator`'s pattern). Snapshots tagged `'padelgod-fip'`. Schedule: every 30 min Monday 06:00–12:00 UTC + daily 07:00 Tue–Sat. Vercel cron deleted in the same PR. Fail-loud guardrails throw `PARSED_ZERO_ROWS` + `Sentry.captureException` so silent breakage is impossible.

**Tech Stack:** TypeScript, vitest, Supabase JS client, axios (padelgod's `httpClient`), `@sentry/node`, node-cron.

**Spec:** [`docs/superpowers/specs/2026-05-18-padelgod-rankings-migration-design.md`](../specs/2026-05-18-padelgod-rankings-migration-design.md)

---

## File Structure

**Created:**

- `padelgod/src/lib/avatar-rehost.ts` — mirror of `src/lib/avatar-rehost.ts`, single responsibility (rehost a single avatar + ensure bucket).

**Modified:**

- `padelgod/src/workers/player-rankings.ts` — full rewrite. Responsibilities: orchestrate 4 phases (official ×2, race ×2), call FIP WP JSON API, resolve+upsert players by `fip_id`, write `player_ranking_snapshots`, clear race dropouts, rehost avatars, fail loud on zero rows.
- `padelgod/src/__tests__/workers/player-rankings.test.ts` — full rewrite against the new contract.
- `padelgod/src/__tests__/scheduler.test.ts` — accept `player-rankings` appearing twice.
- `padelgod/src/scheduler.ts` — two cron entries for `player-rankings` instead of one.
- `padelgod/src/lib/parser-versions.ts` — bump `FIP_RANKINGS_VERSION` to `'fip-rankings-wp-2.0.0'`.
- `src/app/api/admin/sync-fip-rankings/route.ts` — one constant: `source: 'vercel-fip-manual'` instead of `'vercel-fip'`.
- `vercel.json` — remove 4 `sync-fip-rankings` cron entries.

**Deleted:**

- `padelgod/src/parsers/fip-rankings.ts` — broken HTML cheerio parser.
- `padelgod/src/__tests__/parsers/fip-rankings.test.ts` — its subject is gone.
- `src/app/api/cron/sync-fip-rankings/route.ts` — Vercel cron wrapper.

---

## Task 1: Mirror `avatar-rehost.ts` into padelgod

**Files:**
- Create: `padelgod/src/lib/avatar-rehost.ts`

- [ ] **Step 1: Create the mirrored file**

Copy `src/lib/avatar-rehost.ts` to `padelgod/src/lib/avatar-rehost.ts` with a "must stay in sync" header comment. The mirror is byte-identical except for the header. Full contents to write:

```ts
// padelgod/src/lib/avatar-rehost.ts
//
// Mirror of src/lib/avatar-rehost.ts (Next.js project). Padelgod runs
// as a separate Railway service and doesn't share imports with the
// Next.js app — same trade-off used by `db-paginate.ts` and
// `fip-player-search.ts`. Keep this file BYTE-IDENTICAL with the
// Next.js side except for this header. If you edit one, mirror the
// other.

import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'avatars'
const SUPABASE_STORAGE_MARKER = '.supabase.co/storage/'

export type RehostStatus =
  | 'ok'
  | 'skipped-already-hosted'
  | 'skipped-no-source'
  | 'download-failed'
  | 'upload-failed'
  | 'db-update-failed'
  | 'error'

export interface RehostResult {
  playerId: string
  status: RehostStatus
  newUrl?: string
  detail?: string
}

function pickExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return 'jpg'
}

function isSupabaseHosted(url: string | null | undefined): boolean {
  return !!url && url.includes(SUPABASE_STORAGE_MARKER)
}

export async function rehostAvatarToSupabase(
  supabase: SupabaseClient,
  playerId: string,
  sourceUrl: string | null | undefined,
): Promise<RehostResult> {
  if (!sourceUrl) {
    return { playerId, status: 'skipped-no-source' }
  }
  if (isSupabaseHosted(sourceUrl)) {
    return { playerId, status: 'skipped-already-hosted', newUrl: sourceUrl }
  }

  const { data: current, error: readError } = await supabase
    .from('players')
    .select('avatar_url')
    .eq('id', playerId)
    .maybeSingle()
  if (readError) {
    return { playerId, status: 'error', detail: `read failed: ${readError.message}` }
  }
  if (isSupabaseHosted(current?.avatar_url)) {
    return { playerId, status: 'skipped-already-hosted', newUrl: current!.avatar_url! }
  }

  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      return { playerId, status: 'download-failed', detail: `${res.status} ${res.statusText}` }
    }
    const contentType = res.headers.get('Content-Type') ?? 'image/jpeg'
    const ext = pickExtension(contentType)
    const buffer = await res.arrayBuffer()
    const filePath = `${playerId}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, { contentType, upsert: true })
    if (uploadError) {
      return { playerId, status: 'upload-failed', detail: uploadError.message }
    }

    const newUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`

    const { error: updateError } = await supabase
      .from('players')
      .update({ avatar_url: newUrl })
      .eq('id', playerId)
    if (updateError) {
      return { playerId, status: 'db-update-failed', detail: updateError.message }
    }

    return { playerId, status: 'ok', newUrl }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { playerId, status: 'error', detail }
  }
}

export async function ensureAvatarsBucket(supabase: SupabaseClient): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png', 'image/gif'],
  })
  if (error && !error.message.includes('already exists')) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd padelgod && npx tsc --noEmit src/lib/avatar-rehost.ts`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/lib/avatar-rehost.ts
git commit -m "feat(padelgod): mirror avatar-rehost helper for rankings worker"
```

---

## Task 2: Bump parser version constant

**Files:**
- Modify: `padelgod/src/lib/parser-versions.ts:7`

- [ ] **Step 1: Replace the constant value**

Edit `padelgod/src/lib/parser-versions.ts`. Find:

```ts
export const FIP_RANKINGS_VERSION = 'fip-rankings-1.0.0';
```

Replace with:

```ts
// Bumped 2026-05-18 when the rankings worker switched from HTML-scrape
// against the redesigned-and-broken padelfip.com/ranking page to the
// WP JSON API at /wp-json/fip/v1/ranking/load-more/ + .../player/search.
export const FIP_RANKINGS_VERSION = 'fip-rankings-wp-2.0.0';
```

- [ ] **Step 2: Verify build still passes**

Run: `cd padelgod && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/lib/parser-versions.ts
git commit -m "chore(padelgod): bump FIP_RANKINGS_VERSION for WP API rewrite"
```

---

## Task 3: Reset worker test file scaffolding

**Files:**
- Modify: `padelgod/src/__tests__/workers/player-rankings.test.ts` (replace entire contents)

This task replaces the existing test file (which mocks HTML scraping) with a scaffolding that mocks `httpClient` (axios) + a fake Supabase client. Subsequent tasks fill in test cases.

- [ ] **Step 1: Replace the test file with scaffolding**

Full replacement contents:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPlayerRankings } from '../../workers/player-rankings.js';

// ── HTTP mock ────────────────────────────────────────────────────────────
//
// Padelgod workers receive an injected `httpClient` (axios instance). For
// the rankings worker we mock GET on two endpoints:
//   1. /wp-json/fip/v1/ranking/load-more/        — official rankings
//   2. /wp-json/fip/v1/player/search?search_type=race — race rankings
//
// Tests configure per-URL responses via setHttpResponses().

interface MockedResponse {
  status: number;
  data: unknown;
}

const httpResponses = new Map<string, MockedResponse>();

function setHttpResponse(urlSubstring: string, data: unknown, status = 200) {
  httpResponses.set(urlSubstring, { status, data });
}

function makeHttpClient() {
  return {
    get: vi.fn(async (url: string) => {
      for (const [substring, response] of httpResponses.entries()) {
        if (url.includes(substring)) {
          return response;
        }
      }
      throw new Error(`MOCK: no response configured for URL: ${url}`);
    }),
  } as any;
}

// ── FIP row builders ─────────────────────────────────────────────────────

interface FipOfficialRow {
  player_id: string;
  name: string;
  surname: string;
  rank: number;
  points: number;
  move: number;
  url: string;
  thumbnail: string;
  country_name: string;
  country_flag: string;
}

interface FipRaceRow {
  player_id: string;
  name: string;
  surname: string;
  race_rank: number;
  race_points: number;
  race_move: number;
  url: string;
  thumbnail: string;
  country_name: string;
  country_flag: string;
}

function officialRow(overrides: Partial<FipOfficialRow> & { player_id: string; rank: number }): FipOfficialRow {
  return {
    player_id: overrides.player_id,
    name: overrides.name ?? 'Player',
    surname: overrides.surname ?? overrides.player_id,
    rank: overrides.rank,
    points: overrides.points ?? 1000 - overrides.rank,
    move: overrides.move ?? 0,
    url: overrides.url ?? `https://www.padelfip.com/player/${overrides.player_id.toLowerCase()}/`,
    thumbnail: overrides.thumbnail ?? `https://www.padelfip.com/wp-content/uploads/${overrides.player_id}.png`,
    country_name: overrides.country_name ?? 'ESP',
    country_flag: overrides.country_flag ?? '',
  };
}

function raceRow(overrides: Partial<FipRaceRow> & { player_id: string; race_rank: number }): FipRaceRow {
  return {
    player_id: overrides.player_id,
    name: overrides.name ?? 'Player',
    surname: overrides.surname ?? overrides.player_id,
    race_rank: overrides.race_rank,
    race_points: overrides.race_points ?? 500 - overrides.race_rank,
    race_move: overrides.race_move ?? 0,
    url: overrides.url ?? `https://www.padelfip.com/player/${overrides.player_id.toLowerCase()}/`,
    thumbnail: overrides.thumbnail ?? `https://www.padelfip.com/wp-content/uploads/${overrides.player_id}.png`,
    country_name: overrides.country_name ?? 'ARG',
    country_flag: overrides.country_flag ?? '',
  };
}

// ── Supabase mock ────────────────────────────────────────────────────────
//
// Captures all `players` reads/writes + `player_ranking_snapshots` writes +
// `padelgod.scrape_jobs` writes. Returns deterministic UUIDs for inserted
// players so snapshot rows can be cross-referenced.
//
// playersTable is the in-memory state. Tests can seed it via the
// `seedPlayer()` helper before invoking runPlayerRankings.

interface PlayerRow {
  id: string;
  fip_id: string | null;
  name: string;
  country: string | null;
  category: 'men' | 'women';
  ranking: number | null;
  points: number | null;
  ranking_move: number | null;
  race_ranking: number | null;
  race_points: number | null;
  race_move: number | null;
  avatar_url: string | null;
  profile_url: string | null;
  last_updated_by: string | null;
}

interface SnapshotRow {
  player_id: string;
  type: 'official' | 'race';
  gender: 'men' | 'women';
  year: number;
  week: number;
  ranking_date: string;
  ranking: number;
  points: number | null;
  ranking_move: number | null;
  source: string;
}

interface ScrapeJobRow {
  id: string;
  job_type: string;
  target_url: string;
  status: 'running' | 'success' | 'failed';
  parser_version: string;
  error_message: string | null;
}

interface FakeSupabaseState {
  players: PlayerRow[];
  snapshots: SnapshotRow[];
  scrapeJobs: ScrapeJobRow[];
  storageUploads: Array<{ bucket: string; path: string }>;
}

let state: FakeSupabaseState;

function freshState(): FakeSupabaseState {
  return { players: [], snapshots: [], scrapeJobs: [], storageUploads: [] };
}

function seedPlayer(p: Partial<PlayerRow> & { id: string; fip_id: string; category: 'men' | 'women' }) {
  state.players.push({
    id: p.id,
    fip_id: p.fip_id,
    name: p.name ?? 'Seeded Player',
    country: p.country ?? null,
    category: p.category,
    ranking: p.ranking ?? null,
    points: p.points ?? null,
    ranking_move: p.ranking_move ?? null,
    race_ranking: p.race_ranking ?? null,
    race_points: p.race_points ?? null,
    race_move: p.race_move ?? null,
    avatar_url: p.avatar_url ?? null,
    profile_url: p.profile_url ?? null,
    last_updated_by: p.last_updated_by ?? null,
  });
}

let nextUuidCounter = 0;
function nextUuid(): string {
  nextUuidCounter += 1;
  return `00000000-0000-0000-0000-${nextUuidCounter.toString().padStart(12, '0')}`;
}

function makeSupabase() {
  // Builder pattern mimicking @supabase/supabase-js's PostgrestQueryBuilder.
  // Each .from(...) call returns a chain object that captures operations
  // and resolves to { data, error } when awaited or .select() is called.
  function fromTable(table: string) {
    return {
      schema: (_s: string) => fromTable(table),
      select: vi.fn().mockImplementation(function (this: any, _cols?: string) {
        return this;
      }),
      insert: vi.fn().mockImplementation(function (this: any, row: any) {
        if (table === 'scrape_jobs') {
          const sj: ScrapeJobRow = {
            id: nextUuid(),
            job_type: row.job_type,
            target_url: row.target_url,
            status: 'running',
            parser_version: row.parser_version,
            error_message: null,
          };
          state.scrapeJobs.push(sj);
          return {
            select: () => ({ single: async () => ({ data: sj, error: null }) }),
          };
        }
        if (table === 'players') {
          const inserted: PlayerRow = {
            id: nextUuid(),
            fip_id: row.fip_id ?? null,
            name: row.name,
            country: row.country ?? null,
            category: row.category,
            ranking: row.ranking ?? null,
            points: row.points ?? null,
            ranking_move: row.ranking_move ?? null,
            race_ranking: row.race_ranking ?? null,
            race_points: row.race_points ?? null,
            race_move: row.race_move ?? null,
            avatar_url: null,
            profile_url: row.profile_url ?? null,
            last_updated_by: row.last_updated_by ?? null,
          };
          state.players.push(inserted);
          return {
            select: () => ({
              single: async () => ({ data: inserted, error: null }),
            }),
          };
        }
        throw new Error(`MOCK: insert on unknown table ${table}`);
      }),
      upsert: vi.fn().mockImplementation(async function (this: any, rows: any, _opts: any) {
        if (table === 'player_ranking_snapshots') {
          const arr = Array.isArray(rows) ? rows : [rows];
          for (const r of arr) {
            // Replace any existing matching row (mimic onConflict)
            const idx = state.snapshots.findIndex(
              s =>
                s.player_id === r.player_id &&
                s.type === r.type &&
                s.year === r.year &&
                s.week === r.week,
            );
            if (idx >= 0) state.snapshots[idx] = r;
            else state.snapshots.push(r);
          }
          return { error: null };
        }
        throw new Error(`MOCK: upsert on unknown table ${table}`);
      }),
      update: vi.fn().mockImplementation(function (this: any, patch: any) {
        return {
          eq: async (col: string, val: any) => {
            if (table === 'scrape_jobs') {
              const row = state.scrapeJobs.find(s => s.id === val);
              if (row) {
                row.status = patch.status;
                row.error_message = patch.error_message ?? null;
              }
              return { error: null };
            }
            if (table === 'players') {
              const row = state.players.find(p => p.id === val);
              if (row) Object.assign(row, patch);
              return { error: null };
            }
            return { error: null };
          },
          in: async (col: string, vals: any[]) => {
            if (table === 'players') {
              for (const v of vals) {
                const row = state.players.find(p => p.id === v);
                if (row) Object.assign(row, patch);
              }
              return { error: null };
            }
            return { error: null };
          },
        };
      }),
      in: vi.fn().mockImplementation(async function (this: any, col: string, vals: any[]) {
        if (table === 'players') {
          const data = state.players.filter(p => vals.includes((p as any)[col]));
          return { data, error: null };
        }
        return { data: [], error: null };
      }),
      eq: vi.fn().mockImplementation(function (this: any, col: string, val: any) {
        return {
          not: () => this,
          maybeSingle: async () => {
            if (table === 'players') {
              const row = state.players.find(p => (p as any)[col] === val);
              return { data: row ?? null, error: null };
            }
            return { data: null, error: null };
          },
        };
      }),
      not: vi.fn().mockImplementation(function (this: any, _col: string, _op: string, _val: any) {
        return this;
      }),
    };
  }

  return {
    from: vi.fn((table: string) => fromTable(table)),
    schema: vi.fn(() => ({ from: (table: string) => fromTable(table) })),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          state.storageUploads.push({ bucket: 'avatars', path });
          return { error: null };
        },
      }),
      createBucket: async () => ({ error: null }),
    },
  } as any;
}

// ── Test bootstrap ───────────────────────────────────────────────────────

beforeEach(() => {
  state = freshState();
  httpResponses.clear();
  nextUuidCounter = 0;
  // Re-mock global fetch (avatar-rehost uses it). Default to skip-already-hosted
  // by short-circuiting on the storage marker.
  vi.stubGlobal('fetch', vi.fn(async () => {
    return new Response(new ArrayBuffer(8), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
  }));
});

// ── Helpers re-exported for use in test cases (subsequent tasks) ─────────

export { setHttpResponse, makeHttpClient, makeSupabase, officialRow, raceRow, seedPlayer, state };

// Placeholder describe — test cases land here task-by-task.
describe('runPlayerRankings (WP JSON API rewrite)', () => {
  it.todo('Task 4 — happy path: all 4 phases populated, mixed existing + new players');
  it.todo('Task 5 — official current week empty, falls back to W-1 with data');
  it.todo('Task 5 — official all 3 fallback weeks empty: throws PARSED_ZERO_ROWS + Sentry');
  it.todo('Task 6 — race response with series boundary trims at 50% halving');
  it.todo('Task 7 — race dropouts: previously-ranked players not in current run get race fields NULLed');
  it.todo('Task 8 — race endpoint empty: throws PARSED_ZERO_ROWS + Sentry');
  it.todo('Task 9 — NO_SNAPSHOTS_WRITTEN floor: throws if every phase parsed but every upsert failed');
});
```

- [ ] **Step 2: Run the test file**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts`
Expected: 7 `it.todo` tests reported as skipped, **no failures**. The `import { runPlayerRankings }` line will fail TS resolution because the old worker still exists but exports a different signature; we'll deliberately leave that resolution failure for Task 4 to fix when the worker is rewritten.

If the test runner errors on the import (TypeScript path resolution), expected output looks like a module-resolution failure. That's fine for this step — we're treating Task 3 as scaffolding only.

- [ ] **Step 3: Commit (allow failing build)**

```bash
git add padelgod/src/__tests__/workers/player-rankings.test.ts
git commit -m "test(padelgod): scaffold new player-rankings test file (WIP — worker rewrite pending)"
```

---

## Task 4: Happy path — implement worker shell with all 4 phases

**Files:**
- Modify: `padelgod/src/__tests__/workers/player-rankings.test.ts` (fill in first `it`)
- Modify: `padelgod/src/workers/player-rankings.ts` (full rewrite)

This task replaces the entire 134-line worker with the new implementation, satisfying the happy-path test.

- [ ] **Step 1: Replace the first `it.todo` with a real test**

In `padelgod/src/__tests__/workers/player-rankings.test.ts`, find the `describe(...)` block and replace its body with:

```ts
describe('runPlayerRankings (WP JSON API rewrite)', () => {
  it('happy path: all 4 phases populated, mixed existing + new players', async () => {
    // Seed: one existing men's player, one existing women's player.
    seedPlayer({ id: 'aaaa1111-0000-0000-0000-000000000001', fip_id: 'P000001', category: 'men', name: 'Old Name', ranking: 99, points: 100 });
    seedPlayer({ id: 'bbbb2222-0000-0000-0000-000000000002', fip_id: 'P000002', category: 'women', name: 'Old Name W', ranking: 99, points: 100 });

    // Official men: 1 existing (P000001) + 1 new (P000003)
    setHttpResponse('search_type=race&gender=male', [
      raceRow({ player_id: 'P000001', race_rank: 1, race_points: 500, race_move: 0 }),
    ]);
    setHttpResponse('search_type=race&gender=female', [
      raceRow({ player_id: 'P000002', race_rank: 1, race_points: 500, race_move: 0 }),
    ]);
    setHttpResponse('gender=male&limit', [
      officialRow({ player_id: 'P000001', rank: 1, points: 21000 }),
      officialRow({ player_id: 'P000003', rank: 2, points: 20000 }),
    ]);
    setHttpResponse('gender=female&limit', [
      officialRow({ player_id: 'P000002', rank: 1, points: 18000 }),
    ]);

    const httpClient = makeHttpClient();
    const supabase = makeSupabase();
    const result = await runPlayerRankings({ supabase, httpClient });

    // scrape_jobs: 4 rows, all success
    expect(state.scrapeJobs).toHaveLength(4);
    expect(state.scrapeJobs.every(s => s.status === 'success')).toBe(true);
    expect(state.scrapeJobs.map(s => s.target_url).sort()).toEqual([
      expect.stringContaining('ranking/load-more') && expect.stringContaining('gender=female'),
      expect.stringContaining('ranking/load-more') && expect.stringContaining('gender=male'),
      expect.stringContaining('search_type=race') && expect.stringContaining('gender=female'),
      expect.stringContaining('search_type=race') && expect.stringContaining('gender=male'),
    ].sort());

    // Existing player updated, not duplicated
    const p1 = state.players.find(p => p.fip_id === 'P000001')!;
    expect(state.players.filter(p => p.fip_id === 'P000001')).toHaveLength(1);
    expect(p1.ranking).toBe(1);
    expect(p1.points).toBe(21000);
    expect(p1.last_updated_by).toBe('padelgod');

    // New player inserted with fip_id
    const p3 = state.players.find(p => p.fip_id === 'P000003')!;
    expect(p3).toBeDefined();
    expect(p3.category).toBe('men');
    expect(p3.ranking).toBe(2);

    // Snapshots: 3 official + 2 race = 5 rows tagged 'padelgod-fip'
    expect(state.snapshots).toHaveLength(5);
    expect(state.snapshots.every(s => s.source === 'padelgod-fip')).toBe(true);
    expect(state.snapshots.filter(s => s.type === 'official')).toHaveLength(3);
    expect(state.snapshots.filter(s => s.type === 'race')).toHaveLength(2);

    // Result shape
    expect(result.official.men.fetched).toBe(2);
    expect(result.official.women.fetched).toBe(1);
    expect(result.race.men.fetched).toBe(1);
    expect(result.race.women.fetched).toBe(1);
    expect(result.snapshotsWritten).toBe(5);
  });

  it.todo('Task 5 — official current week empty, falls back to W-1 with data');
  it.todo('Task 5 — official all 3 fallback weeks empty: throws PARSED_ZERO_ROWS + Sentry');
  it.todo('Task 6 — race response with series boundary trims at 50% halving');
  it.todo('Task 7 — race dropouts: previously-ranked players not in current run get race fields NULLed');
  it.todo('Task 8 — race endpoint empty: throws PARSED_ZERO_ROWS + Sentry');
  it.todo('Task 9 — NO_SNAPSHOTS_WRITTEN floor: throws if every phase parsed but every upsert failed');
});
```

- [ ] **Step 2: Run the test (expected to fail — worker not yet rewritten)**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts`
Expected: 1 FAIL on the happy-path test. Either resolution error or assertion mismatch — the existing HTML-scraping worker is incompatible with the new test shape.

- [ ] **Step 3: Replace the worker file**

Replace the entire contents of `padelgod/src/workers/player-rankings.ts` with:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import * as Sentry from '@sentry/node';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_RANKINGS_VERSION } from '../lib/parser-versions.js';
import { rehostAvatarToSupabase, ensureAvatarsBucket } from '../lib/avatar-rehost.js';

// ── Types ────────────────────────────────────────────────────────────────

export interface PlayerRankingsDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

interface PhaseResult {
  fetched: number;
  updated: number;
  created: number;
}

export interface PlayerRankingsResult {
  official: {
    men: PhaseResult & { rankingDate: string | null };
    women: PhaseResult & { rankingDate: string | null };
  };
  race: {
    men: PhaseResult & { dropoutsCleared: number };
    women: PhaseResult & { dropoutsCleared: number };
  };
  avatars: { rehosted: number; skipped: number; failed: number };
  snapshotsWritten: number;
}

interface FipOfficialPlayer {
  player_id: string;
  name: string;
  surname: string;
  rank: number;
  points: number;
  move: number;
  url: string;
  thumbnail: string;
  country_name: string;
  country_flag: string;
}

interface FipRacePlayer {
  player_id: string;
  name: string;
  surname: string;
  race_rank: number;
  race_points: number;
  race_move: number;
  url: string;
  thumbnail: string;
  country_name: string;
  country_flag: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const FIP_BASE = 'https://www.padelfip.com/es/wp-json/fip/v1';
const TOP_DEFAULT = 1000;
const PAGE_SIZE = 500;
const OFFICIAL_WEEK_FALLBACK = 3;
const AVATAR_BATCH = 20;
const RACE_CLEAR_CHUNK = 200;
const PROFILE_ATTEMPT_SENTINEL = '1970-01-01T00:00:00Z';

const COUNTRY_3_TO_2: Record<string, string> = {
  ESP: 'ES', ARG: 'AR', BRA: 'BR', POR: 'PT', FRA: 'FR', ITA: 'IT',
  BEL: 'BE', NLD: 'NL', GER: 'DE', GBR: 'GB', DEN: 'DK', SWE: 'SE',
  URU: 'UY', PAR: 'PY', CHI: 'CL', MEX: 'MX', USA: 'US', AUS: 'AU',
  QAT: 'QA', CRC: 'CR', COL: 'CO', PER: 'PE', ECU: 'EC', BOL: 'BO',
  VEN: 'VE', DOM: 'DO', PAN: 'PA', CUB: 'CU', GTM: 'GT', HON: 'HN',
  NIC: 'NI', SLV: 'SV', JAM: 'JM', TTO: 'TT', NZL: 'NZ', JPN: 'JP',
  KOR: 'KR', CHN: 'CN', IND: 'IN', EGY: 'EG', MAR: 'MA', RSA: 'ZA',
  KEN: 'KE', NGR: 'NG', TUN: 'TN', ISR: 'IL', LBN: 'LB', KUW: 'KW',
  BHR: 'BH', UAE: 'AE', KSA: 'SA', FIN: 'FI', NOR: 'NO', POL: 'PL',
  CZE: 'CZ', AUT: 'AT', SUI: 'CH', GRE: 'GR', ROU: 'RO', HUN: 'HU',
  BUL: 'BG', CRO: 'HR', SRB: 'RS', SVK: 'SK', SLO: 'SI', EST: 'EE',
  LAT: 'LV', LTU: 'LT', IRL: 'IE', LUX: 'LU', MON: 'MC', AND: 'AD',
  CYP: 'CY', MLT: 'MT', ISL: 'IS', ALB: 'AL', MKD: 'MK', BIH: 'BA',
  MNE: 'ME',
};

function fipCountryToIso2(code3: string | null | undefined): string | null {
  if (!code3) return null;
  return COUNTRY_3_TO_2[code3.toUpperCase()] ?? code3.slice(0, 2).toUpperCase();
}

// ── Date helpers ─────────────────────────────────────────────────────────

function isoYearWeek(d: Date): { year: number; week: number; mondayIso: string } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - 3);
  return { year: date.getUTCFullYear(), week, mondayIso: monday.toISOString().slice(0, 10) };
}

function currentYearWeek(): { year: number; week: number } {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const diff = now.getTime() - start.getTime();
  const week = Math.ceil((diff / 86400000 + start.getDay() + 1) / 7);
  return { year, week };
}

function weekToDate(year: number, week: number): string {
  const jan1 = new Date(year, 0, 1);
  const jan1Day = jan1.getDay();
  const dayOffset = (week - 1) * 7 - jan1Day + 1;
  const monday = new Date(year, 0, 1 + dayOffset);
  return monday.toISOString().slice(0, 10) + 'T00:00:00Z';
}

// ── Fetch helpers ────────────────────────────────────────────────────────

async function fetchOfficial(
  httpClient: AxiosInstance,
  gender: 'male' | 'female',
  top: number,
): Promise<{ players: FipOfficialPlayer[]; rankingDate: string | null }> {
  const { year, week } = currentYearWeek();
  for (let w = week; w >= week - OFFICIAL_WEEK_FALLBACK && w >= 1; w--) {
    const all: FipOfficialPlayer[] = [];
    let offset = 0;
    while (all.length < top) {
      const remaining = top - all.length;
      const fetchLimit = Math.min(PAGE_SIZE, remaining);
      const url = `${FIP_BASE}/ranking/load-more/?gender=${gender}&limit=${fetchLimit}&offset=${offset}&category=master&circuit=premierpadel&year=${year}&week=${w}&lang=es`;
      const res = await httpClient.get(url);
      const data: FipOfficialPlayer[] = res.data ?? [];
      if (data.length === 0) break;
      all.push(...data);
      if (data.length < fetchLimit) break;
      offset += data.length;
    }
    if (all.length > 0) {
      return { players: all, rankingDate: weekToDate(year, w) };
    }
  }
  return { players: [], rankingDate: null };
}

/**
 * Trim FIP race response at the first series boundary. FIP concatenates
 * multiple race series; the boundary is where race_rank halves vs. the
 * running max (guarded by maxSoFar >= 30 to avoid early false positives).
 * See spec section "Race series-trim heuristic" for justification.
 */
function trimRaceAtSeriesBoundary(rows: FipRacePlayer[]): FipRacePlayer[] {
  let maxRank = 0;
  for (let i = 0; i < rows.length; i++) {
    if (maxRank >= 30 && rows[i].race_rank * 2 < maxRank) {
      return rows.slice(0, i);
    }
    if (rows[i].race_rank > maxRank) maxRank = rows[i].race_rank;
  }
  return rows;
}

async function fetchRace(
  httpClient: AxiosInstance,
  gender: 'male' | 'female',
  top: number,
): Promise<FipRacePlayer[]> {
  const all: FipRacePlayer[] = [];
  let offset = 0;
  while (all.length < top) {
    const remaining = top - all.length;
    const fetchLimit = Math.min(PAGE_SIZE, remaining);
    const url = `${FIP_BASE}/player/search?search_type=race&q=&gender=${gender}&limit=${fetchLimit}&offset=${offset}&category=master&circuit=premierpadel&lang=es`;
    const res = await httpClient.get(url);
    const data: FipRacePlayer[] = res.data ?? [];
    if (data.length === 0) break;
    all.push(...data);
    if (data.length < fetchLimit) break;
    offset += data.length;
  }
  return trimRaceAtSeriesBoundary(all);
}

// ── DB helpers ───────────────────────────────────────────────────────────

interface ResolvedPlayer {
  fipId: string;
  playerId: string;
  thumbnail: string;
  outcome: 'updated' | 'created';
}

async function upsertOfficialPlayers(
  supabase: SupabaseClient,
  rows: FipOfficialPlayer[],
  category: 'men' | 'women',
): Promise<ResolvedPlayer[]> {
  const byFipId = new Map<string, FipOfficialPlayer>();
  for (const r of rows) byFipId.set(r.player_id.replace(/^fip-/, ''), r);

  const { data: existing } = await supabase
    .from('players')
    .select('id, fip_id, name, country, category, ranking, points, ranking_move, profile_url')
    .in('fip_id', Array.from(byFipId.keys()));

  const existingByFipId = new Map<string, any>();
  for (const row of existing ?? []) existingByFipId.set(row.fip_id, row);

  const now = new Date().toISOString();
  const resolved: ResolvedPlayer[] = [];

  for (const [fipId, fipRow] of byFipId.entries()) {
    const fullName = `${fipRow.name} ${fipRow.surname}`.trim();
    const country = fipCountryToIso2(fipRow.country_name);
    const match = existingByFipId.get(fipId);

    if (match) {
      const patch: Record<string, unknown> = {
        ranking: fipRow.rank,
        points: fipRow.points,
        ranking_move: fipRow.move,
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (fullName && fullName !== match.name) patch.name = fullName;
      if (country && country !== match.country) patch.country = country;
      if (fipRow.url && fipRow.url !== match.profile_url) patch.profile_url = fipRow.url;

      await supabase.from('players').update(patch).eq('id', match.id);
      resolved.push({ fipId, playerId: match.id, thumbnail: fipRow.thumbnail, outcome: 'updated' });
    } else {
      const insert = {
        fip_id: fipId,
        external_id: fipId,
        name: fullName,
        category,
        country,
        ranking: fipRow.rank,
        points: fipRow.points,
        ranking_move: fipRow.move,
        profile_url: fipRow.url || null,
        last_updated_by: 'padelgod',
        updated_at: now,
        profile_attempt_at: PROFILE_ATTEMPT_SENTINEL,
      };
      const { data: inserted } = await supabase.from('players').insert(insert).select().single();
      resolved.push({ fipId, playerId: inserted.id, thumbnail: fipRow.thumbnail, outcome: 'created' });
    }
  }

  return resolved;
}

async function upsertRacePlayers(
  supabase: SupabaseClient,
  rows: FipRacePlayer[],
  category: 'men' | 'women',
): Promise<ResolvedPlayer[]> {
  const byFipId = new Map<string, FipRacePlayer>();
  for (const r of rows) byFipId.set(r.player_id.replace(/^fip-/, ''), r);

  const { data: existing } = await supabase
    .from('players')
    .select('id, fip_id, name, country, category, race_ranking, race_points, race_move')
    .in('fip_id', Array.from(byFipId.keys()));

  const existingByFipId = new Map<string, any>();
  for (const row of existing ?? []) existingByFipId.set(row.fip_id, row);

  const now = new Date().toISOString();
  const resolved: ResolvedPlayer[] = [];

  for (const [fipId, fipRow] of byFipId.entries()) {
    const fullName = `${fipRow.name} ${fipRow.surname}`.trim();
    const country = fipCountryToIso2(fipRow.country_name);
    const match = existingByFipId.get(fipId);

    if (match) {
      const patch: Record<string, unknown> = {
        race_ranking: fipRow.race_rank,
        race_points: fipRow.race_points,
        race_move: fipRow.race_move,
        last_updated_by: 'padelgod',
        updated_at: now,
      };
      if (fullName && fullName !== match.name) patch.name = fullName;
      if (country && country !== match.country) patch.country = country;

      await supabase.from('players').update(patch).eq('id', match.id);
      resolved.push({ fipId, playerId: match.id, thumbnail: fipRow.thumbnail, outcome: 'updated' });
    } else {
      const insert = {
        fip_id: fipId,
        external_id: fipId,
        name: fullName,
        category,
        country,
        race_ranking: fipRow.race_rank,
        race_points: fipRow.race_points,
        race_move: fipRow.race_move,
        last_updated_by: 'padelgod',
        updated_at: now,
        profile_attempt_at: PROFILE_ATTEMPT_SENTINEL,
      };
      const { data: inserted } = await supabase.from('players').insert(insert).select().single();
      resolved.push({ fipId, playerId: inserted.id, thumbnail: fipRow.thumbnail, outcome: 'created' });
    }
  }

  return resolved;
}

async function writeOfficialSnapshots(
  supabase: SupabaseClient,
  resolved: ResolvedPlayer[],
  rowsByFipId: Map<string, FipOfficialPlayer>,
  category: 'men' | 'women',
  rankingDate: string,
): Promise<number> {
  const yw = isoYearWeek(new Date(rankingDate));
  const snapshotRows = resolved.map(r => {
    const row = rowsByFipId.get(r.fipId)!;
    return {
      player_id: r.playerId,
      type: 'official' as const,
      gender: category,
      year: yw.year,
      week: yw.week,
      ranking_date: yw.mondayIso,
      ranking: row.rank,
      points: row.points,
      ranking_move: row.move,
      source: 'padelgod-fip' as const,
    };
  });

  if (snapshotRows.length === 0) return 0;
  await supabase.from('player_ranking_snapshots').upsert(snapshotRows, {
    onConflict: 'player_id,type,year,week',
    ignoreDuplicates: false,
  });
  return snapshotRows.length;
}

async function writeRaceSnapshots(
  supabase: SupabaseClient,
  resolved: ResolvedPlayer[],
  rowsByFipId: Map<string, FipRacePlayer>,
  category: 'men' | 'women',
): Promise<number> {
  const yw = isoYearWeek(new Date());
  const snapshotRows = resolved.map(r => {
    const row = rowsByFipId.get(r.fipId)!;
    return {
      player_id: r.playerId,
      type: 'race' as const,
      gender: category,
      year: yw.year,
      week: yw.week,
      ranking_date: yw.mondayIso,
      ranking: row.race_rank,
      points: row.race_points,
      ranking_move: row.race_move,
      source: 'padelgod-fip' as const,
    };
  });

  if (snapshotRows.length === 0) return 0;
  await supabase.from('player_ranking_snapshots').upsert(snapshotRows, {
    onConflict: 'player_id,type,year,week',
    ignoreDuplicates: false,
  });
  return snapshotRows.length;
}

async function clearRaceDropouts(
  supabase: SupabaseClient,
  category: 'men' | 'women',
  writtenPlayerIds: Set<string>,
): Promise<number> {
  const { data: previouslyRanked } = await supabase
    .from('players')
    .select('id')
    .eq('category', category)
    .not('race_ranking', 'is', null);

  const dropouts = (previouslyRanked ?? [])
    .map((r: any) => r.id as string)
    .filter(id => !writtenPlayerIds.has(id));

  for (let i = 0; i < dropouts.length; i += RACE_CLEAR_CHUNK) {
    const chunk = dropouts.slice(i, i + RACE_CLEAR_CHUNK);
    await supabase
      .from('players')
      .update({ race_ranking: null, race_points: null, race_move: null })
      .in('id', chunk);
  }

  return dropouts.length;
}

// ── Phase runners ────────────────────────────────────────────────────────

async function runOfficialPhase(
  deps: PlayerRankingsDeps,
  gender: 'male' | 'female',
  category: 'men' | 'women',
  avatarMap: Map<string, string>,
): Promise<PhaseResult & { rankingDate: string | null; snapshotsWritten: number }> {
  let fetched = 0;
  let updated = 0;
  let created = 0;
  let rankingDate: string | null = null;
  let snapshotsWritten = 0;
  const phaseName = `official-${gender}`;

  try {
    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'rankings',
        tournamentId: null,
        targetUrl: `${FIP_BASE}/ranking/load-more/?gender=${gender}`,
        parserVersion: FIP_RANKINGS_VERSION,
        captureBody: false,
      },
      async () => {
        const { players, rankingDate: rd } = await fetchOfficial(deps.httpClient, gender, TOP_DEFAULT);
        fetched = players.length;
        rankingDate = rd;

        if (players.length === 0) {
          throw new Error(
            `PARSED_ZERO_ROWS: ${phaseName} returned 0 rows across all ${OFFICIAL_WEEK_FALLBACK} fallback weeks`,
          );
        }

        const rowsByFipId = new Map<string, FipOfficialPlayer>();
        for (const r of players) rowsByFipId.set(r.player_id.replace(/^fip-/, ''), r);

        const resolved = await upsertOfficialPlayers(deps.supabase, players, category);
        updated = resolved.filter(r => r.outcome === 'updated').length;
        created = resolved.filter(r => r.outcome === 'created').length;

        for (const r of resolved) {
          if (r.thumbnail) avatarMap.set(r.playerId, r.thumbnail);
        }

        snapshotsWritten = await writeOfficialSnapshots(
          deps.supabase, resolved, rowsByFipId, category, rd!,
        );
        return { body: '', contentHash: 'sha256:rankings' };
      },
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { worker: 'player-rankings', phase: phaseName } });
    throw err;
  }

  return { fetched, updated, created, rankingDate, snapshotsWritten };
}

async function runRacePhase(
  deps: PlayerRankingsDeps,
  gender: 'male' | 'female',
  category: 'men' | 'women',
  avatarMap: Map<string, string>,
): Promise<PhaseResult & { dropoutsCleared: number; snapshotsWritten: number }> {
  let fetched = 0;
  let updated = 0;
  let created = 0;
  let dropoutsCleared = 0;
  let snapshotsWritten = 0;
  const phaseName = `race-${gender}`;

  try {
    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'rankings',
        tournamentId: null,
        targetUrl: `${FIP_BASE}/player/search?search_type=race&gender=${gender}`,
        parserVersion: FIP_RANKINGS_VERSION,
        captureBody: false,
      },
      async () => {
        const players = await fetchRace(deps.httpClient, gender, TOP_DEFAULT);
        fetched = players.length;

        if (players.length === 0) {
          throw new Error(`PARSED_ZERO_ROWS: ${phaseName} returned 0 rows`);
        }

        const rowsByFipId = new Map<string, FipRacePlayer>();
        for (const r of players) rowsByFipId.set(r.player_id.replace(/^fip-/, ''), r);

        const resolved = await upsertRacePlayers(deps.supabase, players, category);
        updated = resolved.filter(r => r.outcome === 'updated').length;
        created = resolved.filter(r => r.outcome === 'created').length;

        for (const r of resolved) {
          if (r.thumbnail) avatarMap.set(r.playerId, r.thumbnail);
        }

        snapshotsWritten = await writeRaceSnapshots(
          deps.supabase, resolved, rowsByFipId, category,
        );

        const writtenIds = new Set(resolved.map(r => r.playerId));
        dropoutsCleared = await clearRaceDropouts(deps.supabase, category, writtenIds);

        return { body: '', contentHash: 'sha256:rankings' };
      },
    );
  } catch (err) {
    Sentry.captureException(err, { tags: { worker: 'player-rankings', phase: phaseName } });
    throw err;
  }

  return { fetched, updated, created, dropoutsCleared, snapshotsWritten };
}

// ── Main orchestrator ────────────────────────────────────────────────────

export async function runPlayerRankings(
  deps: PlayerRankingsDeps,
): Promise<PlayerRankingsResult> {
  await ensureAvatarsBucket(deps.supabase);

  const avatarMap = new Map<string, string>();

  const officialMen = await runOfficialPhase(deps, 'male', 'men', avatarMap);
  const officialWomen = await runOfficialPhase(deps, 'female', 'women', avatarMap);
  const raceMen = await runRacePhase(deps, 'male', 'men', avatarMap);
  const raceWomen = await runRacePhase(deps, 'female', 'women', avatarMap);

  const snapshotsWritten =
    officialMen.snapshotsWritten +
    officialWomen.snapshotsWritten +
    raceMen.snapshotsWritten +
    raceWomen.snapshotsWritten;

  if (snapshotsWritten === 0) {
    const err = new Error('NO_SNAPSHOTS_WRITTEN: all phases parsed rows but zero snapshots landed');
    Sentry.captureException(err, { tags: { worker: 'player-rankings', phase: 'orchestrator' } });
    throw err;
  }

  // Avatar rehost — post-loop, deduped Map, 20-wide batches
  const avatarEntries = Array.from(avatarMap.entries());
  let rehosted = 0;
  let skipped = 0;
  let failed = 0;
  for (let i = 0; i < avatarEntries.length; i += AVATAR_BATCH) {
    const chunk = avatarEntries.slice(i, i + AVATAR_BATCH);
    const outcomes = await Promise.all(
      chunk.map(([pid, thumb]) => rehostAvatarToSupabase(deps.supabase, pid, thumb)),
    );
    for (const o of outcomes) {
      if (o.status === 'ok') rehosted++;
      else if (o.status.startsWith('skipped')) skipped++;
      else failed++;
    }
  }

  return {
    official: {
      men: { fetched: officialMen.fetched, updated: officialMen.updated, created: officialMen.created, rankingDate: officialMen.rankingDate },
      women: { fetched: officialWomen.fetched, updated: officialWomen.updated, created: officialWomen.created, rankingDate: officialWomen.rankingDate },
    },
    race: {
      men: { fetched: raceMen.fetched, updated: raceMen.updated, created: raceMen.created, dropoutsCleared: raceMen.dropoutsCleared },
      women: { fetched: raceWomen.fetched, updated: raceWomen.updated, created: raceWomen.created, dropoutsCleared: raceWomen.dropoutsCleared },
    },
    avatars: { rehosted, skipped, failed },
    snapshotsWritten,
  };
}
```

- [ ] **Step 4: Run the happy-path test**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts -t "happy path"`
Expected: 1 PASS.

- [ ] **Step 5: Type-check the whole padelgod project**

Run: `cd padelgod && npx tsc --noEmit`
Expected: errors only on the still-present `padelgod/src/parsers/fip-rankings.ts` (referenced nowhere now — Task 10 deletes it). No errors in `workers/player-rankings.ts` or the test file.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/player-rankings.ts padelgod/src/__tests__/workers/player-rankings.test.ts
git commit -m "feat(padelgod): rewrite player-rankings to use FIP WP JSON API + fip_id resolver"
```

---

## Task 5: Official 3-week fallback + zero-row guard

**Files:**
- Modify: `padelgod/src/__tests__/workers/player-rankings.test.ts` (replace two `it.todo`s)

The worker already implements the fallback loop and the `PARSED_ZERO_ROWS` throw. This task adds tests that prove both behave correctly.

- [ ] **Step 1: Replace two `it.todo`s with real tests**

In `padelgod/src/__tests__/workers/player-rankings.test.ts`, replace:

```ts
  it.todo('Task 5 — official current week empty, falls back to W-1 with data');
  it.todo('Task 5 — official all 3 fallback weeks empty: throws PARSED_ZERO_ROWS + Sentry');
```

with:

```ts
  it('official current week empty, falls back to a prior week with data', async () => {
    // Configure the men's official endpoint to return [] for the CURRENT week
    // and data for the previous week. The URL substring matching only sees
    // gender — we differentiate by week via a custom handler.
    const httpClient = {
      get: vi.fn(async (url: string) => {
        const weekMatch = url.match(/week=(\d+)/);
        const week = weekMatch ? parseInt(weekMatch[1], 10) : 0;
        const currentWeek = (() => {
          const now = new Date();
          const start = new Date(now.getFullYear(), 0, 1);
          return Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
        })();
        if (url.includes('gender=male') && url.includes('ranking/load-more')) {
          if (week === currentWeek) return { status: 200, data: [] };
          return { status: 200, data: [officialRow({ player_id: 'P000001', rank: 1 })] };
        }
        if (url.includes('gender=female') && url.includes('ranking/load-more')) {
          return { status: 200, data: [officialRow({ player_id: 'P000002', rank: 1 })] };
        }
        if (url.includes('search_type=race') && url.includes('gender=male')) {
          return { status: 200, data: [raceRow({ player_id: 'P000001', race_rank: 1 })] };
        }
        if (url.includes('search_type=race') && url.includes('gender=female')) {
          return { status: 200, data: [raceRow({ player_id: 'P000002', race_rank: 1 })] };
        }
        return { status: 200, data: [] };
      }),
    } as any;

    const supabase = makeSupabase();
    const result = await runPlayerRankings({ supabase, httpClient });

    // Men fetched from fallback week, women from current week
    expect(result.official.men.fetched).toBe(1);
    expect(result.official.women.fetched).toBe(1);
    // No PARSED_ZERO_ROWS thrown (the fallback succeeded)
    expect(state.scrapeJobs.filter(s => s.status === 'failed')).toHaveLength(0);
  });

  it('official all 3 fallback weeks empty: throws PARSED_ZERO_ROWS + Sentry capture', async () => {
    const sentrySpy = vi.spyOn(await import('@sentry/node'), 'captureException').mockImplementation(() => 'event-id');

    const httpClient = {
      get: vi.fn(async (url: string) => {
        // Men's official: empty for all 4 attempted weeks
        if (url.includes('gender=male') && url.includes('ranking/load-more')) {
          return { status: 200, data: [] };
        }
        return { status: 200, data: [] };
      }),
    } as any;

    const supabase = makeSupabase();
    await expect(runPlayerRankings({ supabase, httpClient })).rejects.toThrow(/PARSED_ZERO_ROWS/);

    // First failing scrape_jobs row is official-male
    const failed = state.scrapeJobs.filter(s => s.status === 'failed');
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].target_url).toContain('gender=male');
    expect(failed[0].error_message).toContain('PARSED_ZERO_ROWS');

    // Sentry was called with the right tags
    expect(sentrySpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ worker: 'player-rankings', phase: 'official-male' }) }),
    );

    sentrySpy.mockRestore();
  });
```

- [ ] **Step 2: Run the new tests**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts`
Expected: 3 PASS, 4 todo.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/__tests__/workers/player-rankings.test.ts
git commit -m "test(padelgod): official fallback + PARSED_ZERO_ROWS guard"
```

---

## Task 6: Race series-trim boundary

**Files:**
- Modify: `padelgod/src/__tests__/workers/player-rankings.test.ts`

The worker's `trimRaceAtSeriesBoundary` already implements the heuristic (port from Vercel). Test it via the worker's race phase output.

- [ ] **Step 1: Replace the matching `it.todo`**

Find:

```ts
  it.todo('Task 6 — race response with series boundary trims at 50% halving');
```

Replace with:

```ts
  it('race response with series boundary trims at 50% halving', async () => {
    // Build a race response that simulates the dual-series concatenation:
    //   Series 1: race_rank 1..100 (Premier-circuit main race)
    //   Series 2: race_rank starts at 17 (sub-tier, reset numbering)
    // Boundary should be detected at the first row where race_rank < max/2.
    const series1: ReturnType<typeof raceRow>[] = [];
    for (let r = 1; r <= 100; r++) series1.push(raceRow({ player_id: `P${(1000 + r).toString().padStart(6, '0')}`, race_rank: r }));
    const series2: ReturnType<typeof raceRow>[] = [];
    for (let r = 17; r <= 30; r++) series2.push(raceRow({ player_id: `P${(2000 + r).toString().padStart(6, '0')}`, race_rank: r }));

    setHttpResponse('search_type=race&gender=male', [...series1, ...series2]);
    setHttpResponse('search_type=race&gender=female', [raceRow({ player_id: 'P000002', race_rank: 1 })]);
    setHttpResponse('gender=male&limit', [officialRow({ player_id: 'P001001', rank: 1 })]);
    setHttpResponse('gender=female&limit', [officialRow({ player_id: 'P000002', rank: 1 })]);

    const supabase = makeSupabase();
    const result = await runPlayerRankings({ supabase, httpClient: makeHttpClient() });

    // Series 1 has 100 rows, series 2 starts at rank=17 which is < 100/2.
    // Trim should cut at the boundary, keeping exactly 100 rows from men's race.
    expect(result.race.men.fetched).toBe(100);
    // Snapshots: 100 race-men + 1 race-women + 1 official-men + 1 official-women = 103
    expect(state.snapshots.filter(s => s.type === 'race' && s.gender === 'men')).toHaveLength(100);
  });
```

- [ ] **Step 2: Run the test**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts -t "series boundary"`
Expected: 1 PASS.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/__tests__/workers/player-rankings.test.ts
git commit -m "test(padelgod): race series-trim at 50% halving boundary"
```

---

## Task 7: Race dropouts NULL handling

**Files:**
- Modify: `padelgod/src/__tests__/workers/player-rankings.test.ts`

- [ ] **Step 1: Replace the matching `it.todo`**

Find:

```ts
  it.todo('Task 7 — race dropouts: previously-ranked players not in current run get race fields NULLed');
```

Replace with:

```ts
  it('race dropouts: previously-ranked players not in current run get race fields NULLed', async () => {
    // Seed two men's players with existing race_ranking. Only one shows up
    // in this run's race response; the other should be NULLed.
    seedPlayer({
      id: 'dddd1111-0000-0000-0000-000000000001', fip_id: 'P000010', category: 'men',
      race_ranking: 5, race_points: 100, race_move: 1,
    });
    seedPlayer({
      id: 'dddd1111-0000-0000-0000-000000000002', fip_id: 'P000020', category: 'men',
      race_ranking: 6, race_points: 90, race_move: 0,
    });

    // Only P000010 is in this run's race. P000020 should be NULLed.
    setHttpResponse('search_type=race&gender=male', [
      raceRow({ player_id: 'P000010', race_rank: 5, race_points: 100, race_move: 1 }),
    ]);
    setHttpResponse('search_type=race&gender=female', [raceRow({ player_id: 'P000099', race_rank: 1 })]);
    setHttpResponse('gender=male&limit', [officialRow({ player_id: 'P000010', rank: 50 })]);
    setHttpResponse('gender=female&limit', [officialRow({ player_id: 'P000099', rank: 1 })]);

    const supabase = makeSupabase();
    const result = await runPlayerRankings({ supabase, httpClient: makeHttpClient() });

    // P000010 retained
    const kept = state.players.find(p => p.fip_id === 'P000010')!;
    expect(kept.race_ranking).toBe(5);

    // P000020 NULLed
    const dropped = state.players.find(p => p.fip_id === 'P000020')!;
    expect(dropped.race_ranking).toBeNull();
    expect(dropped.race_points).toBeNull();
    expect(dropped.race_move).toBeNull();

    expect(result.race.men.dropoutsCleared).toBe(1);
  });
```

- [ ] **Step 2: Run the test**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts -t "race dropouts"`
Expected: 1 PASS.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/__tests__/workers/player-rankings.test.ts
git commit -m "test(padelgod): race dropouts NULL race_ranking/points/move"
```

---

## Task 8: Race endpoint zero-row guard

**Files:**
- Modify: `padelgod/src/__tests__/workers/player-rankings.test.ts`

- [ ] **Step 1: Replace the matching `it.todo`**

Find:

```ts
  it.todo('Task 8 — race endpoint empty: throws PARSED_ZERO_ROWS + Sentry');
```

Replace with:

```ts
  it('race endpoint empty: throws PARSED_ZERO_ROWS + Sentry capture tagged race-male', async () => {
    const sentrySpy = vi.spyOn(await import('@sentry/node'), 'captureException').mockImplementation(() => 'event-id');

    // Official OK, race-men returns [], race-women OK
    setHttpResponse('gender=male&limit', [officialRow({ player_id: 'P000001', rank: 1 })]);
    setHttpResponse('gender=female&limit', [officialRow({ player_id: 'P000002', rank: 1 })]);
    setHttpResponse('search_type=race&gender=male', []);
    setHttpResponse('search_type=race&gender=female', [raceRow({ player_id: 'P000002', race_rank: 1 })]);

    const supabase = makeSupabase();
    await expect(runPlayerRankings({ supabase, httpClient: makeHttpClient() })).rejects.toThrow(/PARSED_ZERO_ROWS/);

    // race-male scrape_job marked failed
    const failed = state.scrapeJobs.find(s => s.target_url.includes('search_type=race') && s.target_url.includes('gender=male'));
    expect(failed?.status).toBe('failed');
    expect(failed?.error_message).toContain('race-male');

    expect(sentrySpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ worker: 'player-rankings', phase: 'race-male' }) }),
    );

    sentrySpy.mockRestore();
  });
```

- [ ] **Step 2: Run the test**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts -t "race endpoint empty"`
Expected: 1 PASS.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/__tests__/workers/player-rankings.test.ts
git commit -m "test(padelgod): race zero-row guard with Sentry tag race-male"
```

---

## Task 9: NO_SNAPSHOTS_WRITTEN floor

**Files:**
- Modify: `padelgod/src/__tests__/workers/player-rankings.test.ts`

The worker already throws `NO_SNAPSHOTS_WRITTEN` if every phase succeeded but no snapshots landed. This test simulates that pathological case by making `player_ranking_snapshots.upsert` silently swallow rows.

- [ ] **Step 1: Replace the matching `it.todo`**

Find:

```ts
  it.todo('Task 9 — NO_SNAPSHOTS_WRITTEN floor: throws if every phase parsed but every upsert failed');
```

Replace with:

```ts
  it('NO_SNAPSHOTS_WRITTEN floor: orchestrator throws if every phase parsed but zero snapshots persist', async () => {
    const sentrySpy = vi.spyOn(await import('@sentry/node'), 'captureException').mockImplementation(() => 'event-id');

    // All four phases return data so PARSED_ZERO_ROWS does NOT fire
    setHttpResponse('gender=male&limit', [officialRow({ player_id: 'P000001', rank: 1 })]);
    setHttpResponse('gender=female&limit', [officialRow({ player_id: 'P000002', rank: 1 })]);
    setHttpResponse('search_type=race&gender=male', [raceRow({ player_id: 'P000001', race_rank: 1 })]);
    setHttpResponse('search_type=race&gender=female', [raceRow({ player_id: 'P000002', race_rank: 1 })]);

    // Override supabase so player_ranking_snapshots.upsert swallows everything.
    const supabase = makeSupabase();
    const realFrom = supabase.from;
    supabase.from = vi.fn((table: string) => {
      const builder = realFrom(table);
      if (table === 'player_ranking_snapshots') {
        builder.upsert = vi.fn(async () => ({ error: null })); // silently drop
      }
      return builder;
    });

    await expect(runPlayerRankings({ supabase, httpClient: makeHttpClient() })).rejects.toThrow(/NO_SNAPSHOTS_WRITTEN/);

    expect(sentrySpy).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ worker: 'player-rankings', phase: 'orchestrator' }) }),
    );

    sentrySpy.mockRestore();
  });
```

Note: the test mocks out the in-memory snapshot writes to simulate the production case where every upsert hits a constraint violation. In production this would never happen with valid data — the floor is a safety net for unexpected DB drift (e.g. RLS misconfiguration).

- [ ] **Step 2: Run the test**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts -t "NO_SNAPSHOTS"`
Expected: 1 PASS.

- [ ] **Step 3: Confirm all 7 tests pass and 0 todos remain**

Run: `cd padelgod && npx vitest run src/__tests__/workers/player-rankings.test.ts`
Expected: `7 passed, 0 todo`.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/__tests__/workers/player-rankings.test.ts
git commit -m "test(padelgod): NO_SNAPSHOTS_WRITTEN floor in orchestrator"
```

---

## Task 10: Delete broken HTML parser + its test

**Files:**
- Delete: `padelgod/src/parsers/fip-rankings.ts`
- Delete: `padelgod/src/__tests__/parsers/fip-rankings.test.ts`

- [ ] **Step 1: Delete both files**

Run:

```bash
rm padelgod/src/parsers/fip-rankings.ts
rm padelgod/src/__tests__/parsers/fip-rankings.test.ts
```

- [ ] **Step 2: Verify no remaining references**

Run: `cd padelgod && grep -rn "parseFipRankings\|fip-rankings.js" src/ --include="*.ts" 2>/dev/null`
Expected: no output (zero matches).

- [ ] **Step 3: Type-check + test the whole padelgod project**

Run: `cd padelgod && npx tsc --noEmit && npx vitest run`
Expected: zero TS errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/parsers/fip-rankings.ts padelgod/src/__tests__/parsers/fip-rankings.test.ts
git commit -m "chore(padelgod): delete broken HTML rankings parser + test"
```

---

## Task 11: Scheduler dual-registration

**Files:**
- Modify: `padelgod/src/__tests__/scheduler.test.ts`
- Modify: `padelgod/src/scheduler.ts:327-333`

- [ ] **Step 1: Add a failing scheduler test**

Read `padelgod/src/__tests__/scheduler.test.ts` to find an existing test pattern (likely uses `buildSchedule(ALL_ENABLED)` or similar). Add this new test inside the existing `describe` block:

```ts
  it('registers player-rankings TWICE when enabled (Mon poll + weekday daily)', () => {
    const schedule = buildSchedule(ALL_ENABLED as any);
    const entries = schedule.filter(s => s.name === 'player-rankings');
    expect(entries).toHaveLength(2);
    const crons = entries.map(e => e.cron).sort();
    expect(crons).toEqual(['0 7 * * 2-6', '0,30 6-12 * * 1']);
  });

  it('omits player-rankings entirely when flag is off', () => {
    const flags = { ...ALL_ENABLED, enablePlayerRankings: false };
    const schedule = buildSchedule(flags as any);
    expect(schedule.filter(s => s.name === 'player-rankings')).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the test (expected to fail — old single-entry scheduler)**

Run: `cd padelgod && npx vitest run src/__tests__/scheduler.test.ts`
Expected: the `registers player-rankings TWICE` test FAILs because the scheduler currently registers it once.

- [ ] **Step 3: Update the scheduler**

In `padelgod/src/scheduler.ts`, find the existing `enablePlayerRankings` block (around lines 327–333):

```ts
  if (flags.enablePlayerRankings) {
    entries.push({
      name: 'player-rankings',
      cron: '0 7 * * *', // daily 07:00 UTC
      run: getWorkerRunner('player-rankings')!,
    });
  }
```

Replace with:

```ts
  if (flags.enablePlayerRankings) {
    // Monday: every 30 min from 06:00 to 12:00 UTC. FIP publishes new
    // rankings on Mondays; idempotent UPSERT makes early-morning runs
    // free no-ops until they catch the publish.
    entries.push({
      name: 'player-rankings',
      cron: '0,30 6-12 * * 1',
      run: getWorkerRunner('player-rankings')!,
    });
    // Tue–Sat: daily 07:00 UTC. Keeps player profile/avatar data fresh
    // and recovers from any single failed Monday run.
    entries.push({
      name: 'player-rankings',
      cron: '0 7 * * 2-6',
      run: getWorkerRunner('player-rankings')!,
    });
  }
```

- [ ] **Step 4: Run all scheduler tests**

Run: `cd padelgod && npx vitest run src/__tests__/scheduler.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/scheduler.ts padelgod/src/__tests__/scheduler.test.ts
git commit -m "feat(padelgod): schedule player-rankings every 30min Mon + daily Tue-Sat"
```

---

## Task 12: Admin route source-tag change

**Files:**
- Modify: `src/app/api/admin/sync-fip-rankings/route.ts`

The admin route writes snapshots with `source: 'vercel-fip'`. After cutover, automated `'vercel-fip'` rows stop being written; this route becomes a manual escape hatch. Re-tag its writes so historical vs. manual rows are distinguishable.

- [ ] **Step 1: Find all `vercel-fip` occurrences**

Run: `grep -n "vercel-fip" src/app/api/admin/sync-fip-rankings/route.ts`
Expected output: 3 lines — one in the `SnapshotRow` type definition (around line 33), two in `writeSnapshot` callers (around lines 315 and 369).

- [ ] **Step 2: Update the type definition (line ~33)**

In `padelgod/src/app/api/admin/sync-fip-rankings/route.ts`, find:

```ts
  source: 'vercel-fip'
```

(inside the `SnapshotRow` type — it's the literal-type value, no trailing comma) and replace with:

```ts
  source: 'vercel-fip-manual'
```

- [ ] **Step 3: Update both `writeSnapshot` call sites**

The file has two `await writeSnapshot({ ... })` calls — one inside the officials loop, one inside the race loop. In both, find:

```ts
            source: 'vercel-fip',
```

and replace with:

```ts
            source: 'vercel-fip-manual',
```

Use `Edit` with `replace_all: true` on the exact line above to update both at once.

- [ ] **Step 4: Verify all three are updated**

Run: `grep -n "vercel-fip" src/app/api/admin/sync-fip-rankings/route.ts`
Expected output: 3 lines, all now showing `vercel-fip-manual`.

- [ ] **Step 5: Type-check the Next.js project**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/sync-fip-rankings/route.ts
git commit -m "refactor(rankings): admin route writes 'vercel-fip-manual' source tag"
```

---

## Task 13: Delete Vercel cron route

**Files:**
- Delete: `src/app/api/cron/sync-fip-rankings/route.ts`

- [ ] **Step 1: Delete the cron wrapper file**

Run: `rm src/app/api/cron/sync-fip-rankings/route.ts`

- [ ] **Step 2: Verify nothing references it**

Run: `grep -rn "cron/sync-fip-rankings" src/ --include="*.ts" --include="*.tsx" 2>/dev/null`
Expected: no output. (`vercel.json` references will be removed in Task 14.)

- [ ] **Step 3: Type-check the Next.js project**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/sync-fip-rankings/route.ts
git commit -m "chore(rankings): delete Vercel cron route (replaced by padelgod)"
```

---

## Task 14: Remove Vercel cron entries from `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Find the 4 cron entries**

Run: `grep -n "sync-fip-rankings" vercel.json`
Expected: 4 lines each containing a `path` with `sync-fip-rankings?type=...&gender=...`.

- [ ] **Step 2: Remove all 4 entries + their schedule lines**

Open `vercel.json`. Find each of these objects in the `crons` array and remove them (along with their surrounding commas to keep valid JSON):

```json
    {
      "path": "/api/cron/sync-fip-rankings?type=official&gender=male",
      "schedule": "0 7 * * *"
    },
    {
      "path": "/api/cron/sync-fip-rankings?type=official&gender=female",
      "schedule": "5 7 * * *"
    },
    {
      "path": "/api/cron/sync-fip-rankings?type=race&gender=male",
      "schedule": "10 7 * * *"
    },
    {
      "path": "/api/cron/sync-fip-rankings?type=race&gender=female",
      "schedule": "15 7 * * *"
    },
```

- [ ] **Step 3: Validate JSON syntax**

Run: `python3 -c "import json; json.load(open('vercel.json')); print('OK')"`
Expected: `OK`.

- [ ] **Step 4: Confirm no remaining references**

Run: `grep -n "sync-fip-rankings" vercel.json`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add vercel.json
git commit -m "chore(vercel): remove sync-fip-rankings cron entries (replaced by padelgod)"
```

---

## Task 15: Final verification

**Files:** none modified — verification only.

- [ ] **Step 1: Full padelgod test suite**

Run: `cd padelgod && npm test`
Expected: all tests pass. No `it.todo` remaining in `player-rankings.test.ts`.

- [ ] **Step 2: Full padelgod type check**

Run: `cd padelgod && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Full Next.js type check**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Next.js lint**

Run: `npm run lint`
Expected: zero errors. (Warnings are acceptable if pre-existing — confirm none are introduced by the admin-route edit.)

- [ ] **Step 5: Final commit-graph check**

Run: `git log --oneline origin/main..HEAD`
Expected: ~14 commits, one per Task 1–14.

- [ ] **Step 6: Push the branch**

```bash
git push -u origin feat/padelgod-rankings-migration
```

- [ ] **Step 7: Open the PR**

```bash
gh pr create --title "Migrate FIP rankings sync to padelgod (replace Vercel cron)" --body "$(cat <<'EOF'
## Summary

- Rewrites `padelgod/src/workers/player-rankings.ts` to call FIP's WP JSON API directly (the same endpoint Vercel uses today). Replaces the HTML cheerio parser that has been producing **zero rows** since FIP redesigned the rankings page on/around the day the worker shipped (2026-05-11).
- Deletes the Vercel cron at `/api/cron/sync-fip-rankings` (4 schedule entries) — the morning's `official/{male,female}` splits have been silently 504'ing on Vercel's 120s `maxDuration`. Padelgod has no time ceiling.
- Schedule: every 30 min Monday 06:00–12:00 UTC + daily 07:00 Tue–Sat. Idempotent UPSERTs make Monday re-runs free no-ops until they catch the FIP publish.
- Adds fail-loud guardrails: zero-row parse → `PARSED_ZERO_ROWS` throw → red `scrape_jobs` row + `Sentry.captureException` tagged by phase. The "scrape_job success but zero rows written" silent failure mode is now impossible.
- Resolves players by `fip_id` (matching `fip-entry-list-populator`'s pattern). Eliminates the `normalized_name,category` collision warning the old worker logged.

## Spec

[`docs/superpowers/specs/2026-05-18-padelgod-rankings-migration-design.md`](docs/superpowers/specs/2026-05-18-padelgod-rankings-migration-design.md)

## Test plan

- [ ] Padelgod test suite passes (`cd padelgod && npm test`)
- [ ] Next.js type-check + lint pass (`npx tsc --noEmit && npm run lint`)
- [ ] After Railway deploy: confirm `padelgod.scrape_jobs` shows 4 fresh `rankings` rows tagged `success` on the next scheduled tick
- [ ] After Railway deploy: confirm `player_ranking_snapshots` gains rows with `source='padelgod-fip'` for this week
- [ ] Spot-check: a player previously in race who dropped this week has `race_ranking IS NULL`
- [ ] Spot-check: a player new this week (no prior FIP id in DB) has `fip_id` set + `last_updated_by='padelgod'`
- [ ] Confirm Vercel deploy preview's cron list no longer includes `sync-fip-rankings` entries

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Share with the user.

---

## Self-Review Notes

**Spec coverage check:**

- Worker rewrite (Section 2 of spec) → Task 4 (orchestrator) + Tasks 5–9 (test coverage of each behaviour)
- Schedule (Section 3) → Task 11
- Fail-loud guardrails (Section 4) → Tasks 5 + 8 (zero-row), Task 9 (snapshot floor), Sentry capture in Task 4
- Cutover (Section 5) → Tasks 10, 12, 13, 14
- Testing (Section 6) → Tasks 4–9 (worker unit tests), Task 11 (scheduler test)
- Files added (avatar-rehost mirror) → Task 1
- Parser version bump → Task 2

**Type consistency check:** `PlayerRankingsResult` shape used consistently in Task 4 worker code and Task 4 test assertions. `runPlayerRankings`, `runOfficialPhase`, `runRacePhase` names stable across tasks. Sentry tag value `phase: 'official-male'` matches between Task 4 worker and Task 5 test (uses raw `male`/`female`, not `men`/`women`).

**Placeholder scan:** no TBD, no TODO, no "similar to Task N". Every code change has a full code block. Every test assertion is fully specified.
