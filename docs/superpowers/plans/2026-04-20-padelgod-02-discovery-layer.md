# Padelgod Plan 2: Discovery Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four "discovery" workers that populate the data Padelgod needs before any live scoring can happen — tournaments, widget codes, player rankings, and player profiles. Plus the supporting infrastructure (HTTP client, scrape-job wrapper, node-cron scheduler) all subsequent worker plans will reuse.

**Architecture:** Each worker is a pure async function `runWorker(deps): Promise<WorkerResult>`. The scheduler (node-cron) registers each worker with its cron expression and invokes it at the right cadence. Every scrape passes through a `scrapeJob()` wrapper that records start/finish/duration to `padelgod.scrape_jobs` and optionally captures the raw HTTP response body to `padelgod.raw_payloads`. Parsers are pure functions (HTML/JSON in → typed object out) with their own version constants so we can debug breakage when upstream changes.

**Tech Stack:** Node.js 20, TypeScript 5, axios + axios-retry (HTTP), cheerio (HTML parsing), node-cron (scheduler), playwright/chromium (widget-code Playwright fallback only), vitest (tests). Builds on Plan 1's env loader, logger, Supabase client, and `padelgod` schema.

**Companion specs:**
- `docs/superpowers/specs/2026-04-20-padelgod-design.md` — §3.4 worker structure, §3.6 concurrency, §5 player enrichment
- `docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md` — §1, §2, §6, §7 validated endpoint shapes
- `docs/superpowers/plans/2026-04-20-padelgod-01-foundation.md` — what's already in place

**Prerequisites (from Plan 1):**
- `padelgod/` skeleton with env loader, logger, Supabase client, /health endpoint
- `padelgod` Postgres schema with `scrape_jobs`, `widget_id_cache`, `raw_payloads`, `unresolved_players`, `unresolved_matches`
- Public `match_points` table + `public_id` columns + `set_updated_at()` trigger across all entities
- Service deployed to Railway

---

## File Structure

**New files in `padelgod/`:**
```
padelgod/
├── package.json                          # Add: axios, axios-retry, cheerio, node-cron, playwright
├── Dockerfile                            # Add chromium install for playwright fallback
├── src/
│   ├── lib/
│   │   ├── http-client.ts                # Axios wrapper: retry, throttle, polite User-Agent
│   │   ├── scrape-job.ts                 # Wraps a scrape: writes scrape_jobs row + raw_payloads + parser_version
│   │   ├── playwright-pool.ts            # Singleton browser instance (lazy init, graceful close)
│   │   └── parser-versions.ts            # Constants: FIP_WP_EVENTS_VERSION, CRIONET_SEARCH_VERSION, etc.
│   ├── parsers/
│   │   ├── fip-wp-events.ts              # Parse WP API events response → ParsedTournament[]
│   │   ├── crionet-search.ts             # Parse /ft search HTML → { code, name, isLive }[]
│   │   ├── fip-rankings.ts               # Parse FIP rankings page HTML → ParsedRanking[]
│   │   └── fip-player-profile.ts         # Parse /player/<slug>/ HTML + JSON-LD → ParsedPlayerProfile
│   ├── workers/
│   │   ├── tournament-discovery.ts       # WP API + parser → upsert tournaments
│   │   ├── widget-code-lookup.ts         # Search → fallback Playwright → upsert widget_id_cache
│   │   ├── player-rankings.ts            # Rankings page → upsert player rankings
│   │   └── player-profile.ts             # Profile page → upsert players (equipment, birthdate, height)
│   ├── scheduler.ts                      # node-cron wiring: registers all workers + their schedules
│   ├── index.ts                          # MODIFIED: start scheduler alongside Fastify app
│   └── __tests__/
│       ├── http-client.test.ts
│       ├── scrape-job.test.ts
│       ├── parsers/
│       │   ├── fip-wp-events.test.ts
│       │   ├── crionet-search.test.ts
│       │   ├── fip-rankings.test.ts
│       │   └── fip-player-profile.test.ts
│       └── workers/                      # Worker integration tests (mock HTTP, verify DB calls)
│           ├── tournament-discovery.test.ts
│           ├── widget-code-lookup.test.ts
│           ├── player-rankings.test.ts
│           └── player-profile.test.ts
```

**Modified files:**
- `padelgod/package.json` — add deps
- `padelgod/Dockerfile` — install chromium for Playwright
- `padelgod/src/index.ts` — start scheduler alongside Fastify

---

## Conventions

**Parser pattern:** Each parser exports a `parse...()` function (pure, no I/O) and a `PARSER_VERSION` constant. The constant is bumped when the parser logic changes — recorded in `padelgod.scrape_jobs.parser_version` so we can correlate scrape failures with parser deploys.

**Worker pattern:** Each worker exports `runWorker(deps): Promise<WorkerResult>` where `deps` is `{ supabase, logger, httpClient }`. Workers do NOT own their own scheduling — they only know how to do one pass. The scheduler decides cadence.

**Scrape job tracking:** Every HTTP call goes through `scrapeJob()`:
```typescript
const result = await scrapeJob(supabase, {
  jobType: 'discover',
  tournamentId: null,
  targetUrl: 'https://www.padelfip.com/wp-json/wp/v2/events?modified_after=...',
  parserVersion: FIP_WP_EVENTS_VERSION,
}, async () => {
  const response = await httpClient.get(url);
  return { body: response.data, contentHash: hash(response.data) };
});
```
The wrapper writes the `scrape_jobs` row before/after, captures `raw_payloads` if `captureBody=true`, and propagates errors with `status='failed'`.

**Polite scraping:** all HTTP requests use User-Agent `Padelgod-Scraper/0.2.0 (contact: ops@padelnachos.com)` and respect a 1-second minimum delay between requests to the same host (configurable per worker).

---

### Task 1: Add Plan 2 dependencies

**Files:**
- Modify: `padelgod/package.json`

- [ ] **Step 1: Edit `padelgod/package.json` to add the following deps:**

Under `"dependencies"`, add (in alphabetical order with existing):
```json
"axios": "^1.7.7",
"axios-retry": "^4.5.0",
"cheerio": "^1.0.0",
"node-cron": "^3.0.3",
"playwright": "^1.48.2"
```

Under `"devDependencies"`, add:
```json
"@types/node-cron": "^3.0.11"
```

- [ ] **Step 2: Run install + verify**

```bash
cd padelgod && npm install
npm run typecheck
npm test
```
Expected: install succeeds, typecheck clean, all 10 existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add padelgod/package.json padelgod/package-lock.json
git commit -m "chore(padelgod): add Plan 2 deps (axios, cheerio, node-cron, playwright)"
```

---

### Task 2: HTTP client with retry + throttle

**Files:**
- Create: `padelgod/src/lib/http-client.ts`
- Create: `padelgod/src/__tests__/http-client.test.ts`

- [ ] **Step 1: Write the failing test `padelgod/src/__tests__/http-client.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createHttpClient } from '../lib/http-client.js';

describe('createHttpClient', () => {
  it('returns an axios instance with the configured User-Agent', () => {
    const client = createHttpClient({ userAgent: 'Padelgod-Test/1.0' });
    expect(client.defaults.headers['User-Agent']).toBe('Padelgod-Test/1.0');
  });

  it('honors a custom timeout', () => {
    const client = createHttpClient({ userAgent: 'X', timeoutMs: 15000 });
    expect(client.defaults.timeout).toBe(15000);
  });

  it('throws when userAgent is empty', () => {
    expect(() => createHttpClient({ userAgent: '' })).toThrow(/userAgent/);
  });
});
```

- [ ] **Step 2: Run test — confirm FAIL (module not found)**

```bash
cd padelgod && npx vitest run src/__tests__/http-client.test.ts
```
Expected: FAIL — `../lib/http-client.js` not found.

- [ ] **Step 3: Create `padelgod/src/lib/http-client.ts`**

```typescript
import axios, { type AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';

export interface HttpClientOptions {
  userAgent: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export function createHttpClient(opts: HttpClientOptions): AxiosInstance {
  if (!opts.userAgent) throw new Error('userAgent is required');
  const client = axios.create({
    timeout: opts.timeoutMs ?? 30_000,
    headers: {
      'User-Agent': opts.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/json,*/*',
    },
    // Treat 4xx/5xx as exceptions so retries trigger
    validateStatus: (status) => status >= 200 && status < 400,
  });
  axiosRetry(client, {
    retries: opts.maxRetries ?? 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: (err) =>
      axiosRetry.isNetworkOrIdempotentRequestError(err) ||
      (err.response?.status !== undefined && err.response.status >= 500),
  });
  return client;
}

export const PADELGOD_USER_AGENT =
  'Padelgod-Scraper/0.2.0 (contact: ops@padelnachos.com)';
```

- [ ] **Step 4: Run test — confirm PASS**

```bash
cd padelgod && npx vitest run src/__tests__/http-client.test.ts
```
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/http-client.ts padelgod/src/__tests__/http-client.test.ts
git commit -m "feat(padelgod): add HTTP client wrapper (axios + retry + User-Agent)"
```

---

### Task 3: Scrape job wrapper

**Files:**
- Create: `padelgod/src/lib/scrape-job.ts`
- Create: `padelgod/src/__tests__/scrape-job.test.ts`

- [ ] **Step 1: Write the failing test `padelgod/src/__tests__/scrape-job.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScrapeJob } from '../lib/scrape-job.js';
import type { ScrapeJobType } from '../lib/db-types.js';

function fakeSupabase() {
  const inserted: any[] = [];
  const updated: any[] = [];
  const payloads: any[] = [];
  return {
    inserted, updated, payloads,
    schema: (s: string) => ({
      from: (table: string) => ({
        insert: (row: any) => ({
          select: () => ({
            single: async () => {
              if (table === 'scrape_jobs') {
                inserted.push({ table, row });
                return { data: { id: 'job-uuid', ...row }, error: null };
              }
              if (table === 'raw_payloads') {
                payloads.push({ table, row });
                return { data: { id: 'payload-uuid', ...row }, error: null };
              }
              return { data: null, error: { message: 'unexpected' } };
            },
          }),
        }),
        update: (changes: any) => ({
          eq: (col: string, val: any) => {
            updated.push({ table, changes, where: { [col]: val } });
            return { data: null, error: null };
          },
        }),
      }),
    }),
  };
}

describe('runScrapeJob', () => {
  let supabase: ReturnType<typeof fakeSupabase>;

  beforeEach(() => {
    supabase = fakeSupabase();
  });

  it('records a successful job (with raw payload)', async () => {
    const result = await runScrapeJob(
      supabase as any,
      {
        jobType: 'discover' as ScrapeJobType,
        tournamentId: null,
        targetUrl: 'https://example.com/api',
        parserVersion: 'test-1.0.0',
        captureBody: true,
      },
      async () => ({ body: '<html>ok</html>', contentHash: 'sha256:abc' })
    );

    expect(result.status).toBe('success');
    expect(result.scrapeJobId).toBe('job-uuid');
    expect(supabase.inserted).toHaveLength(2); // scrape_jobs + raw_payloads
    expect(supabase.updated).toHaveLength(1);  // status update
    expect(supabase.updated[0].changes.status).toBe('success');
  });

  it('records a failed job and rethrows the error', async () => {
    await expect(
      runScrapeJob(
        supabase as any,
        {
          jobType: 'oop' as ScrapeJobType,
          tournamentId: 'tour-uuid',
          targetUrl: 'https://example.com/oop',
          parserVersion: 'test-1.0.0',
          captureBody: false,
        },
        async () => {
          throw new Error('upstream 500');
        }
      )
    ).rejects.toThrow(/upstream 500/);

    const update = supabase.updated[0];
    expect(update.changes.status).toBe('failed');
    expect(update.changes.error_message).toMatch(/upstream 500/);
  });

  it('skips raw_payloads insert when captureBody=false', async () => {
    await runScrapeJob(
      supabase as any,
      {
        jobType: 'rankings' as ScrapeJobType,
        tournamentId: null,
        targetUrl: 'https://x',
        parserVersion: 'v',
        captureBody: false,
      },
      async () => ({ body: 'ignored', contentHash: 'h' })
    );

    expect(supabase.payloads).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — confirm FAIL**

```bash
cd padelgod && npx vitest run src/__tests__/scrape-job.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Create `padelgod/src/lib/scrape-job.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScrapeJobType } from './db-types.js';

export interface ScrapeJobOptions {
  jobType: ScrapeJobType;
  tournamentId: string | null;
  targetUrl: string;
  parserVersion: string;
  captureBody: boolean;
}

export interface ScrapeJobFnResult {
  body: string;
  contentHash: string;
}

export interface ScrapeJobResult {
  status: 'success' | 'failed';
  scrapeJobId: string;
  durationMs: number;
}

export async function runScrapeJob(
  supabase: SupabaseClient,
  opts: ScrapeJobOptions,
  fn: () => Promise<ScrapeJobFnResult>
): Promise<ScrapeJobResult> {
  const startedAt = Date.now();

  // Insert running row
  const { data: jobRow, error: insertErr } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .insert({
      job_type: opts.jobType,
      tournament_id: opts.tournamentId,
      target_url: opts.targetUrl,
      status: 'running',
      parser_version: opts.parserVersion,
    })
    .select()
    .single();

  if (insertErr || !jobRow) {
    throw new Error(`Failed to insert scrape_jobs row: ${insertErr?.message}`);
  }

  const scrapeJobId = jobRow.id as string;

  try {
    const fnResult = await fn();

    if (opts.captureBody && fnResult.body) {
      const byteSize = Buffer.byteLength(fnResult.body, 'utf8');
      await supabase
        .schema('padelgod')
        .from('raw_payloads')
        .insert({
          scrape_job_id: scrapeJobId,
          content_hash: fnResult.contentHash,
          body: fnResult.body,
          byte_size: byteSize,
        })
        .select()
        .single();
    }

    const durationMs = Date.now() - startedAt;
    await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq('id', scrapeJobId);

    return { status: 'success', scrapeJobId, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_message: errorMessage.slice(0, 4000),
      })
      .eq('id', scrapeJobId);
    throw err;
  }
}
```

- [ ] **Step 4: Run test — confirm PASS**

```bash
cd padelgod && npx vitest run src/__tests__/scrape-job.test.ts
```
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/scrape-job.ts padelgod/src/__tests__/scrape-job.test.ts
git commit -m "feat(padelgod): add scrape-job wrapper (job tracking + raw payload capture)"
```

---

### Task 4: Parser version constants

**Files:**
- Create: `padelgod/src/lib/parser-versions.ts`

- [ ] **Step 1: Create `padelgod/src/lib/parser-versions.ts`**

```typescript
// Parser version constants. Bump when a parser's logic changes — recorded in
// padelgod.scrape_jobs.parser_version so we can correlate scrape failures with
// parser deploys.

export const FIP_WP_EVENTS_VERSION = 'fip-wp-events-1.0.0';
export const CRIONET_SEARCH_VERSION = 'crionet-search-1.0.0';
export const FIP_RANKINGS_VERSION = 'fip-rankings-1.0.0';
export const FIP_PLAYER_PROFILE_VERSION = 'fip-player-profile-1.0.0';
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd padelgod && npm run typecheck
git add padelgod/src/lib/parser-versions.ts
git commit -m "feat(padelgod): add parser-version constants"
```

---

### Task 5: WP events parser (pure function)

**Files:**
- Create: `padelgod/src/parsers/fip-wp-events.ts`
- Create: `padelgod/src/__tests__/parsers/fip-wp-events.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseFipWpEvents } from '../../parsers/fip-wp-events.js';

describe('parseFipWpEvents', () => {
  it('extracts core fields from a single event', () => {
    const apiResponse = [
      {
        id: 321621,
        slug: 'fip-promises-kyalami-2026',
        link: 'https://www.padelfip.com/events/fip-promises-kyalami-2026/',
        title: { rendered: 'FIP Promises Kyalami 2026' },
        date_gmt: '2026-04-16T13:28:25',
        modified_gmt: '2026-04-16T13:30:10',
        featured_media: 0,
        country: [331],
        'event-year': [705],
        gender: [37, 36],
        'category-event': [708],
        status: 'publish',
        type: 'events',
      },
    ];

    const result = parseFipWpEvents(apiResponse as any);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      wpId: 321621,
      slug: 'fip-promises-kyalami-2026',
      name: 'FIP Promises Kyalami 2026',
      link: 'https://www.padelfip.com/events/fip-promises-kyalami-2026/',
      modifiedGmt: '2026-04-16T13:30:10',
      countryTermIds: [331],
      genderTermIds: [37, 36],
      categoryTermIds: [708],
    });
  });

  it('skips entries without slug or title', () => {
    const apiResponse = [
      { id: 1, slug: '', title: { rendered: '' }, modified_gmt: 'x' },
      { id: 2, slug: 'ok', title: { rendered: 'Ok Event' }, modified_gmt: '2026-01-01T00:00:00' },
    ];
    const result = parseFipWpEvents(apiResponse as any);
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe('ok');
  });

  it('returns empty array for empty input', () => {
    expect(parseFipWpEvents([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/parsers/fip-wp-events.ts`**

```typescript
// Parses the response from `https://www.padelfip.com/wp-json/wp/v2/events`.
// Validated shape documented in:
//   docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md §6.1

export interface ParsedTournament {
  wpId: number;
  slug: string;
  name: string;
  link: string;
  modifiedGmt: string;
  publishedGmt: string | null;
  featuredMediaId: number;
  countryTermIds: number[];
  genderTermIds: number[];
  categoryTermIds: number[];
  yearTermIds: number[];
}

interface RawEvent {
  id: number;
  slug?: string;
  link?: string;
  title?: { rendered?: string };
  date_gmt?: string;
  modified_gmt?: string;
  featured_media?: number;
  country?: number[];
  gender?: number[];
  'category-event'?: number[];
  'event-year'?: number[];
}

export function parseFipWpEvents(events: RawEvent[]): ParsedTournament[] {
  if (!Array.isArray(events)) return [];
  const out: ParsedTournament[] = [];
  for (const e of events) {
    const slug = (e.slug ?? '').trim();
    const name = (e.title?.rendered ?? '').trim();
    if (!slug || !name) continue;
    out.push({
      wpId: e.id,
      slug,
      name,
      link: e.link ?? '',
      modifiedGmt: e.modified_gmt ?? '',
      publishedGmt: e.date_gmt ?? null,
      featuredMediaId: e.featured_media ?? 0,
      countryTermIds: Array.isArray(e.country) ? e.country : [],
      genderTermIds: Array.isArray(e.gender) ? e.gender : [],
      categoryTermIds: Array.isArray(e['category-event']) ? e['category-event'] : [],
      yearTermIds: Array.isArray(e['event-year']) ? e['event-year'] : [],
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test — confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/fip-wp-events.ts padelgod/src/__tests__/parsers/fip-wp-events.test.ts
git commit -m "feat(padelgod): add FIP WP events parser (pure function)"
```

---

### Task 6: Tournament discovery worker

**Files:**
- Create: `padelgod/src/workers/tournament-discovery.ts`
- Create: `padelgod/src/__tests__/workers/tournament-discovery.test.ts`

The worker:
1. Reads max(modified_gmt) from existing tournaments where source IN ('fip', 'manual') (incremental sync key)
2. Calls `https://www.padelfip.com/wp-json/wp/v2/events?per_page=100&modified_after=<max>&orderby=modified&order=asc` via scrape-job wrapper
3. Parses with `parseFipWpEvents`
4. Upserts each tournament: `INSERT ... ON CONFLICT (fip_id) DO UPDATE` (using `slug` as the canonical fip_id, since the rename in Plan 1 made `slug` the canonical column)
5. Skips fields it doesn't own per `src/lib/source-priority.ts` in the main app — but Padelgod doesn't have access to that file. For V1: write only the fields the WP API gives us (`name`, `slug`, `link`, `modified_gmt` mapped to `updated_at`), and only on INSERT (don't overwrite on conflict). On conflict, just update `updated_at` so we know we re-saw the row.

- [ ] **Step 1: Write the failing test** (mock httpClient + supabase, verify upsert payload)

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runTournamentDiscovery } from '../../workers/tournament-discovery.js';

function fakeSupabase(maxModified: string | null) {
  const upserted: any[] = [];
  return {
    upserted,
    schema: (_s: string) => ({
      from: (_t: string) => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    from: (table: string) => ({
      select: (cols: string) => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: maxModified ? { updated_at: maxModified } : null,
              error: null,
            }),
          }),
        }),
      }),
      upsert: (rows: any[], opts: any) => {
        upserted.push({ table, rows, opts });
        return { data: rows.map((r, i) => ({ id: `t-${i}`, ...r })), error: null };
      },
    }),
  };
}

const fakeHttp = (events: any[]) => ({
  get: vi.fn(async (_url: string) => ({
    data: events,
    headers: { 'content-type': 'application/json' },
  })),
});

describe('runTournamentDiscovery', () => {
  it('upserts events returned by the WP API', async () => {
    const supabase = fakeSupabase(null);
    const httpClient = fakeHttp([
      {
        id: 1,
        slug: 'fip-gold-x-2026',
        title: { rendered: 'FIP Gold X 2026' },
        link: 'https://www.padelfip.com/events/fip-gold-x-2026/',
        modified_gmt: '2026-04-19T10:00:00',
        date_gmt: '2026-04-01T08:00:00',
        country: [10],
        gender: [37],
        'category-event': [19],
        'event-year': [705],
      },
    ]);

    const result = await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.discovered).toBe(1);
    expect(supabase.upserted).toHaveLength(1);
    expect(supabase.upserted[0].rows[0]).toMatchObject({
      slug: 'fip-gold-x-2026',
      name: 'FIP Gold X 2026',
    });
  });

  it('returns 0 discovered when WP returns empty', async () => {
    const supabase = fakeSupabase('2026-04-19T00:00:00');
    const httpClient = fakeHttp([]);

    const result = await runTournamentDiscovery({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.discovered).toBe(0);
    expect(supabase.upserted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/workers/tournament-discovery.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipWpEvents } from '../parsers/fip-wp-events.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_WP_EVENTS_VERSION } from '../lib/parser-versions.js';

export interface TournamentDiscoveryDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface TournamentDiscoveryResult {
  discovered: number;
  scrapeJobId: string;
}

const WP_API_BASE = 'https://www.padelfip.com/wp-json/wp/v2/events';

export async function runTournamentDiscovery(
  deps: TournamentDiscoveryDeps
): Promise<TournamentDiscoveryResult> {
  // 1. Look up max updated_at across tournaments (incremental sync key)
  const { data: latest } = await deps.supabase
    .from('tournaments')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const params = new URLSearchParams({ per_page: '100', orderby: 'modified', order: 'asc' });
  if (latest?.updated_at) {
    params.set('modified_after', latest.updated_at);
  }
  const targetUrl = `${WP_API_BASE}?${params.toString()}`;

  // 2. Scrape (with job tracking)
  let parsed: ReturnType<typeof parseFipWpEvents> = [];
  const jobResult = await runScrapeJob(
    deps.supabase,
    {
      jobType: 'discover',
      tournamentId: null,
      targetUrl,
      parserVersion: FIP_WP_EVENTS_VERSION,
      captureBody: false,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = JSON.stringify(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseFipWpEvents(response.data);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) {
    return { discovered: 0, scrapeJobId: jobResult.scrapeJobId };
  }

  // 3. Upsert (conflict on slug, which is the canonical FIP id post-Plan-1 rename)
  const rows = parsed.map((p) => ({
    name: p.name,
    slug: p.slug,
    source: 'fip',
    last_updated_by: 'padelgod',
  }));

  const { error: upsertErr } = await deps.supabase
    .from('tournaments')
    .upsert(rows, { onConflict: 'slug', ignoreDuplicates: false });

  if (upsertErr) {
    throw new Error(`Tournament upsert failed: ${upsertErr.message}`);
  }

  return { discovered: parsed.length, scrapeJobId: jobResult.scrapeJobId };
}
```

- [ ] **Step 4: Run test — confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/tournament-discovery.ts padelgod/src/__tests__/workers/tournament-discovery.test.ts
git commit -m "feat(padelgod): add tournament-discovery worker (WP API incremental sync)"
```

---

### Task 7: Crionet `/ft` search parser

**Files:**
- Create: `padelgod/src/parsers/crionet-search.ts`
- Create: `padelgod/src/__tests__/parsers/crionet-search.test.ts`

Validated shape (from live-data report §1):
```html
<div class="card tournament-card">
  <div class="card-header tournament-card-header tournament-card-header-live">
    <div class="tournament-name">BRUSSELS P2</div>
    <div class="tournament-title">BRUSSELS P2</div>
    <span class="tournament-code">1701</span>
  </div>
  ...
</div>
```

The full code is `FIP-2026-1701` (year prefixed). The parser receives the HTML + the year searched and constructs the full code.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseCrionetSearchResults } from '../../parsers/crionet-search.js';

describe('parseCrionetSearchResults', () => {
  it('extracts a single live tournament card', () => {
    const html = `
      <div class="d-flex flex-wrap">
        <div class="m-1">
          <div class="card tournament-card">
            <div class="card-header tournament-card-header tournament-card-header-live">
              <div>
                <div class="tournament-name">BRUSSELS P2</div>
                <div class="tournament-title">BRUSSELS P2</div>
              </div>
              <div><span class="tournament-code">1701</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
    const result = parseCrionetSearchResults(html, 2026);
    expect(result).toEqual([
      { code: 'FIP-2026-1701', name: 'BRUSSELS P2', isLive: true },
    ]);
  });

  it('marks non-live tournaments correctly', () => {
    const html = `
      <div class="card tournament-card">
        <div class="card-header tournament-card-header">
          <div class="tournament-name">FIP GOLD X</div>
          <span class="tournament-code">1234</span>
        </div>
      </div>
    `;
    const result = parseCrionetSearchResults(html, 2025);
    expect(result[0]).toEqual({ code: 'FIP-2025-1234', name: 'FIP GOLD X', isLive: false });
  });

  it('returns empty array for "No tournaments found" HTML', () => {
    const html = '<div class="text-center text-light">No tournaments found</div>';
    expect(parseCrionetSearchResults(html, 2026)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test — confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/parsers/crionet-search.ts`**

```typescript
import * as cheerio from 'cheerio';

export interface ParsedSearchResult {
  code: string;
  name: string;
  isLive: boolean;
}

export function parseCrionetSearchResults(
  html: string,
  year: number
): ParsedSearchResult[] {
  const $ = cheerio.load(html);
  const results: ParsedSearchResult[] = [];

  $('.card.tournament-card').each((_, el) => {
    const card = $(el);
    const name = card.find('.tournament-name').first().text().trim();
    const codeNum = card.find('.tournament-code').first().text().trim();
    const isLive = card.find('.tournament-card-header-live').length > 0;
    if (!name || !codeNum) return;
    results.push({
      code: `FIP-${year}-${codeNum}`,
      name,
      isLive,
    });
  });

  return results;
}
```

- [ ] **Step 4: Run test — confirm PASS**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/crionet-search.ts padelgod/src/__tests__/parsers/crionet-search.test.ts
git commit -m "feat(padelgod): add Crionet /ft search response parser"
```

---

### Task 8: Playwright pool (singleton)

**Files:**
- Create: `padelgod/src/lib/playwright-pool.ts`

No unit test for this — it's a stateful singleton wrapping a real browser. Smoke-tested as part of Task 9's worker test.

- [ ] **Step 1: Create `padelgod/src/lib/playwright-pool.ts`**

```typescript
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { Logger } from 'pino';

let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(logger: Logger): Promise<Browser> {
  if (browserPromise) return browserPromise;
  logger.info('Launching playwright chromium (one-time)');
  browserPromise = chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return browserPromise;
}

export async function withPage<T>(
  logger: Logger,
  fn: (page: Page) => Promise<T>
): Promise<T> {
  const browser = await getBrowser(logger);
  const context: BrowserContext = await browser.newContext({
    userAgent: 'Padelgod-Scraper/0.2.0 (contact: ops@padelnachos.com)',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close();
    await context.close();
  }
}

export async function shutdownBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise;
  await b.close();
  browserPromise = null;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd padelgod && npm run typecheck
git add padelgod/src/lib/playwright-pool.ts
git commit -m "feat(padelgod): add Playwright singleton pool"
```

---

### Task 9: Widget code lookup worker

**Files:**
- Create: `padelgod/src/workers/widget-code-lookup.ts`
- Create: `padelgod/src/__tests__/workers/widget-code-lookup.test.ts`

The worker resolves widget codes for tournaments that don't have one cached:
1. Query: tournaments where no row exists in `padelgod.widget_id_cache` AND `slug IS NOT NULL` (FIP-sourced only)
2. For each, POST `/ft` on `widget.matchscorerlive.com` with `connector=tol&year=<year>&query=<tournament name simplified>`
3. Parse response with `parseCrionetSearchResults`
4. If exactly one result and the name fuzzy-matches → write to `widget_id_cache` with `extraction_method='search'`
5. If zero or multiple results → fall back to Playwright on the event page (extract `FIP-YYYY-NNNN` regex from rendered DOM) → write with `extraction_method='page_regex'`
6. If both fail → log + skip (don't insert; will retry on next run)

For V1: keep the worker scope to **search only**. Playwright fallback comes in a follow-up commit (so the test surface stays manageable). Workers that fail search just log + skip.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runWidgetCodeLookup } from '../../workers/widget-code-lookup.js';

function fakeSupabase(needingResolution: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: (_s: string) => ({
      from: (t: string) => ({
        insert: (row: any) => {
          if (t === 'widget_id_cache') {
            inserted.push(row);
            return { data: row, error: null };
          }
          if (t === 'scrape_jobs') {
            return {
              select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
            };
          }
          return { data: null, error: { message: 'unexpected' } };
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
        select: () => ({
          // for the tournaments-needing-resolution query
          // simplification: we mock the chain via .rpc-like return
        }),
      }),
    }),
    rpc: vi.fn(async (_name: string) => ({ data: needingResolution, error: null })),
  };
}

describe('runWidgetCodeLookup', () => {
  it('writes widget_id_cache row when search returns exactly one match', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 'tour-uuid-1', tournament_name: 'Brussels P2', year: 2026 },
    ]);
    const httpClient = {
      post: vi.fn(async () => ({
        data: `<div class="card tournament-card">
          <div class="card-header tournament-card-header tournament-card-header-live">
            <div class="tournament-name">BRUSSELS P2</div>
            <span class="tournament-code">1701</span>
          </div>
        </div>`,
      })),
    };

    const result = await runWidgetCodeLookup({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.resolved).toBe(1);
    expect(supabase.inserted[0]).toMatchObject({
      tournament_id: 'tour-uuid-1',
      widget_id: 'FIP-2026-1701',
      extraction_method: 'search',
    });
  });

  it('skips and logs when search returns zero matches', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 'tour-uuid-2', tournament_name: 'Unknown Event', year: 2026 },
    ]);
    const httpClient = {
      post: vi.fn(async () => ({
        data: '<div class="text-center text-light">No tournaments found</div>',
      })),
    };

    const result = await runWidgetCodeLookup({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.resolved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(supabase.inserted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/workers/widget-code-lookup.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetSearchResults } from '../parsers/crionet-search.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_SEARCH_VERSION } from '../lib/parser-versions.js';

export interface WidgetCodeLookupDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface WidgetCodeLookupResult {
  attempted: number;
  resolved: number;
  skipped: number;
}

const SEARCH_URL = 'https://widget.matchscorerlive.com/ft';

interface NeedingResolution {
  tournament_id: string;
  tournament_name: string;
  year: number;
}

function simplifyQuery(name: string): string {
  // Strip FIP prefix and year/category noise; keep the distinctive city/event word.
  // Example: "FIP Gold Iconico Sevilla 2026" → "iconico sevilla"
  return name
    .toLowerCase()
    .replace(/\bfip\b/g, '')
    .replace(/\b(gold|silver|bronze|beyond|promises|premier|p1|p2|major|b1|b2|b3)\b/g, '')
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTournamentsNeedingResolution(
  supabase: SupabaseClient
): Promise<NeedingResolution[]> {
  // Query: tournaments without a widget_id_cache row, with a known year (from starts_at or fallback)
  // Implemented via a raw SQL view or RPC for V1 simplicity.
  const { data, error } = await supabase.rpc('padelgod_tournaments_needing_widget_code');
  if (error) throw new Error(`Lookup query failed: ${error.message}`);
  return (data ?? []) as NeedingResolution[];
}

export async function runWidgetCodeLookup(
  deps: WidgetCodeLookupDeps
): Promise<WidgetCodeLookupResult> {
  const todo = await fetchTournamentsNeedingResolution(deps.supabase);
  let resolved = 0;
  let skipped = 0;

  for (const t of todo) {
    const query = simplifyQuery(t.tournament_name);
    if (!query) {
      skipped++;
      continue;
    }

    const targetUrl = `${SEARCH_URL}?connector=tol&year=${t.year}&query=${encodeURIComponent(query)}`;
    let candidates: ReturnType<typeof parseCrionetSearchResults> = [];

    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'widget_id',
        tournamentId: t.tournament_id,
        targetUrl,
        parserVersion: CRIONET_SEARCH_VERSION,
        captureBody: true,
      },
      async () => {
        const response = await deps.httpClient.post(
          SEARCH_URL,
          new URLSearchParams({ connector: 'tol', year: String(t.year), query }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }
        );
        const body = String(response.data);
        const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
        candidates = parseCrionetSearchResults(body, t.year);
        return { body, contentHash };
      }
    );

    if (candidates.length !== 1) {
      // Zero matches OR ambiguous — skip; Playwright fallback comes in a later task.
      skipped++;
      continue;
    }

    const { code } = candidates[0]!;
    const { error: insertErr } = await deps.supabase
      .schema('padelgod')
      .from('widget_id_cache')
      .insert({
        tournament_id: t.tournament_id,
        widget_id: code,
        extraction_method: 'search',
      });

    if (insertErr) {
      // Unique constraint conflict means another worker beat us to it — count as resolved
      if (insertErr.message.includes('duplicate key')) {
        resolved++;
        continue;
      }
      throw new Error(`Insert widget_id_cache failed: ${insertErr.message}`);
    }
    resolved++;
  }

  return { attempted: todo.length, resolved, skipped };
}
```

- [ ] **Step 4: Run test — confirm PASS**

- [ ] **Step 5: Add the supporting Postgres view/RPC**

Create `supabase/migrations/20260420000012_padelgod_tournaments_needing_widget_code.sql`:
```sql
-- Helper function: list FIP-sourced tournaments that don't have a widget code yet.
CREATE OR REPLACE FUNCTION public.padelgod_tournaments_needing_widget_code()
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  year INT
) AS $$
  SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    EXTRACT(YEAR FROM COALESCE(t.starts_at, NOW()))::INT AS year
  FROM public.tournaments t
  LEFT JOIN padelgod.widget_id_cache c ON c.tournament_id = t.id
  WHERE c.tournament_id IS NULL
    AND t.slug IS NOT NULL
    AND t.source = 'fip'
  ORDER BY t.starts_at DESC NULLS LAST
  LIMIT 200;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'padelgod_tournaments_needing_widget_code'
  ), 'function missing';
END $$;
```

- [ ] **Step 6: Commit (worker + migration in one commit)**

```bash
git add padelgod/src/workers/widget-code-lookup.ts \
        padelgod/src/__tests__/workers/widget-code-lookup.test.ts \
        supabase/migrations/20260420000012_padelgod_tournaments_needing_widget_code.sql
git commit -m "feat(padelgod): add widget-code-lookup worker (search-first)"
```

---

### Task 10: FIP rankings parser + worker

**Files:**
- Create: `padelgod/src/parsers/fip-rankings.ts`
- Create: `padelgod/src/__tests__/parsers/fip-rankings.test.ts`
- Create: `padelgod/src/workers/player-rankings.ts`
- Create: `padelgod/src/__tests__/workers/player-rankings.test.ts`

This is the largest task in Plan 2 — combining parser + worker because the rankings page response shape is well-defined and the worker just upserts ranking rows. We keep them in one commit because they're tightly coupled.

The FIP rankings page is at `https://www.padelfip.com/ranking/?gender=male` (and `?gender=female`). Each row has player name + country flag + rank + points. The exact selectors need to be discovered by inspecting the rendered HTML — for V1, the parser is conservative: read the table rows, extract rank/name/country/points, return as `ParsedRanking[]`.

**Spec notes for the parser (HTML shape verified pre-implementation):**
- Table selector: `table.ranking-table tbody tr` (or whatever the live shape proves to be)
- Per-row: `.rank` (int), `.player-name` (text), `.player-country img` (alt or src), `.points` (int)

For this task, structure the parser to be **selector-driven via constants at top of file** so the implementer can adjust them after one round of `curl ... | grep` exploration without touching the parser logic.

- [ ] **Step 1: Write the parser test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseFipRankings } from '../../parsers/fip-rankings.js';

describe('parseFipRankings', () => {
  it('extracts rows from a rankings table', () => {
    // Selectors are documented at the top of the parser file. This fixture matches them.
    const html = `
      <table class="ranking-table">
        <tbody>
          <tr>
            <td class="rank">1</td>
            <td class="player-country"><img src="/flags/ESP.jpg" alt="ESP" /></td>
            <td class="player-name">Arturo Coello</td>
            <td class="points">14820</td>
          </tr>
          <tr>
            <td class="rank">2</td>
            <td class="player-country"><img src="/flags/ARG.jpg" alt="ARG" /></td>
            <td class="player-name">Agustín Tapia</td>
            <td class="points">14750</td>
          </tr>
        </tbody>
      </table>
    `;
    const result = parseFipRankings(html, 'men');
    expect(result).toEqual([
      { rank: 1, name: 'Arturo Coello', country: 'ESP', points: 14820, gender: 'men' },
      { rank: 2, name: 'Agustín Tapia', country: 'ARG', points: 14750, gender: 'men' },
    ]);
  });

  it('returns empty array on empty/malformed input', () => {
    expect(parseFipRankings('', 'men')).toEqual([]);
    expect(parseFipRankings('<html></html>', 'women')).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm test FAIL, then create parser:**

```typescript
import * as cheerio from 'cheerio';

// === Parser selectors — adjust here after live HTML inspection ===
const RANKING_ROW_SELECTOR = 'table.ranking-table tbody tr';
const RANK_SELECTOR = '.rank';
const NAME_SELECTOR = '.player-name';
const COUNTRY_FLAG_SELECTOR = '.player-country img';
const POINTS_SELECTOR = '.points';
// =================================================================

export type Gender = 'men' | 'women';

export interface ParsedRanking {
  rank: number;
  name: string;
  country: string | null;
  points: number;
  gender: Gender;
}

export function parseFipRankings(html: string, gender: Gender): ParsedRanking[] {
  const $ = cheerio.load(html);
  const rows: ParsedRanking[] = [];
  $(RANKING_ROW_SELECTOR).each((_, el) => {
    const row = $(el);
    const rank = parseInt(row.find(RANK_SELECTOR).first().text().trim(), 10);
    const name = row.find(NAME_SELECTOR).first().text().trim();
    const flag = row.find(COUNTRY_FLAG_SELECTOR).first();
    const country =
      flag.attr('alt')?.trim() ||
      (flag.attr('src') ?? '').match(/([A-Z]{3})\.jpg/)?.[1] ||
      null;
    const points = parseInt(row.find(POINTS_SELECTOR).first().text().replace(/\D/g, ''), 10);
    if (Number.isNaN(rank) || !name) return;
    rows.push({
      rank,
      name,
      country,
      points: Number.isNaN(points) ? 0 : points,
      gender,
    });
  });
  return rows;
}
```

- [ ] **Step 3: Worker test (mock httpClient + supabase, verify upsert payloads for both genders)**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runPlayerRankings } from '../../workers/player-rankings.js';

const fakeRow = (rank: number) => `
  <tr>
    <td class="rank">${rank}</td>
    <td class="player-country"><img src="/flags/ESP.jpg" alt="ESP" /></td>
    <td class="player-name">Player ${rank}</td>
    <td class="points">${20000 - rank * 100}</td>
  </tr>
`;

const fakeRankingsHtml = (n: number) => `
  <table class="ranking-table"><tbody>
    ${Array.from({ length: n }, (_, i) => fakeRow(i + 1)).join('')}
  </tbody></table>
`;

function fakeSupabase() {
  const upserted: any[] = [];
  return {
    upserted,
    schema: () => ({
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    from: () => ({
      upsert: (rows: any[]) => {
        upserted.push(...rows);
        return { data: rows, error: null };
      },
    }),
  };
}

describe('runPlayerRankings', () => {
  it('fetches both genders and upserts all rows', async () => {
    const supabase = fakeSupabase();
    const httpClient = {
      get: vi
        .fn()
        .mockResolvedValueOnce({ data: fakeRankingsHtml(3) })  // men
        .mockResolvedValueOnce({ data: fakeRankingsHtml(2) }), // women
    };

    const result = await runPlayerRankings({
      supabase: supabase as any,
      httpClient: httpClient as any,
    });

    expect(result.menCount).toBe(3);
    expect(result.womenCount).toBe(2);
    expect(supabase.upserted).toHaveLength(5);
  });
});
```

- [ ] **Step 4: Confirm test FAIL, then create worker:**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipRankings, type Gender, type ParsedRanking } from '../parsers/fip-rankings.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_RANKINGS_VERSION } from '../lib/parser-versions.js';

export interface PlayerRankingsDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface PlayerRankingsResult {
  menCount: number;
  womenCount: number;
}

const URL_FOR = (gender: Gender) =>
  `https://www.padelfip.com/ranking/?gender=${gender === 'men' ? 'male' : 'female'}`;

async function fetchAndParse(
  deps: PlayerRankingsDeps,
  gender: Gender
): Promise<ParsedRanking[]> {
  const targetUrl = URL_FOR(gender);
  let parsed: ParsedRanking[] = [];
  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'rankings',
      tournamentId: null,
      targetUrl,
      parserVersion: FIP_RANKINGS_VERSION,
      captureBody: false,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseFipRankings(body, gender);
      return { body, contentHash };
    }
  );
  return parsed;
}

export async function runPlayerRankings(
  deps: PlayerRankingsDeps
): Promise<PlayerRankingsResult> {
  const [men, women] = await Promise.all([
    fetchAndParse(deps, 'men'),
    fetchAndParse(deps, 'women'),
  ]);

  const all = [...men, ...women];
  if (all.length === 0) return { menCount: 0, womenCount: 0 };

  // Upsert by name + country + gender (no FIP id available from rankings page alone).
  // Player profile worker will enrich fip_id later.
  const rows = all.map((r) => ({
    name: r.name,
    country: r.country,
    category: r.gender,
    ranking: r.rank,
    points: r.points,
    last_updated_by: 'padelgod',
  }));

  const { error } = await deps.supabase
    .from('players')
    .upsert(rows, { onConflict: 'normalized_name,category', ignoreDuplicates: false });

  if (error) throw new Error(`Player rankings upsert failed: ${error.message}`);

  return { menCount: men.length, womenCount: women.length };
}
```

- [ ] **Step 5: Confirm tests PASS, commit**

```bash
git add padelgod/src/parsers/fip-rankings.ts \
        padelgod/src/__tests__/parsers/fip-rankings.test.ts \
        padelgod/src/workers/player-rankings.ts \
        padelgod/src/__tests__/workers/player-rankings.test.ts
git commit -m "feat(padelgod): add FIP rankings parser + player-rankings worker"
```

---

### Task 11: FIP player profile parser + worker

**Files:**
- Create: `padelgod/src/parsers/fip-player-profile.ts`
- Create: `padelgod/src/__tests__/parsers/fip-player-profile.test.ts`
- Create: `padelgod/src/workers/player-profile.ts`
- Create: `padelgod/src/__tests__/workers/player-profile.test.ts`

The parser extracts:
- `fip_id` from regex on the page content (validated `P\d+` format, e.g., `P217132`)
- JSON-LD `Person` schema (birthPlace, height, affiliation)
- "RACKET and BALL" section for current equipment

The worker takes a player slug, fetches `/player/<slug>/`, parses, and updates the matching `players` row.

- [ ] **Step 1: Parser test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseFipPlayerProfile } from '../../parsers/fip-player-profile.js';

describe('parseFipPlayerProfile', () => {
  it('extracts fip_id, JSON-LD fields, and equipment', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{
          "@context": "https://schema.org",
          "@type": "Person",
          "name": "Gabriel Elia Curcio",
          "birthDate": "2008-03-12",
          "birthPlace": { "@type": "Place", "name": "Buenos Aires" },
          "height": "180 cm",
          "affiliation": { "@type": "Organization", "name": "AAP" }
        }</script>
      </head><body>
        <span data-fip-id="P217132">P217132</span>
        <section class="player-equipment">
          <h2>RACKET and BALL</h2>
          <div class="racket-brand">Bullpadel</div>
          <div class="racket-model">Vertex 04 Comfort</div>
        </section>
      </body></html>
    `;
    const result = parseFipPlayerProfile(html);
    expect(result.fipId).toBe('P217132');
    expect(result.birthDate).toBe('2008-03-12');
    expect(result.birthPlace).toBe('Buenos Aires');
    expect(result.heightCm).toBe(180);
    expect(result.affiliation).toBe('AAP');
    expect(result.racketBrand).toBe('Bullpadel');
    expect(result.racketModel).toBe('Vertex 04 Comfort');
  });

  it('returns nulls when fields are missing', () => {
    const result = parseFipPlayerProfile('<html><body></body></html>');
    expect(result.fipId).toBeNull();
    expect(result.birthDate).toBeNull();
    expect(result.heightCm).toBeNull();
    expect(result.racketBrand).toBeNull();
  });
});
```

- [ ] **Step 2: Confirm FAIL, create parser:**

```typescript
import * as cheerio from 'cheerio';

export interface ParsedPlayerProfile {
  fipId: string | null;
  birthDate: string | null;       // ISO YYYY-MM-DD
  birthPlace: string | null;
  heightCm: number | null;
  affiliation: string | null;
  racketBrand: string | null;
  racketModel: string | null;
}

const FIP_ID_REGEX = /\bP\d{4,7}\b/;

function extractJsonLd(html: string): Record<string, unknown> | null {
  const match = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseHeightCm(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/(\d+)\s*cm/i);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

export function parseFipPlayerProfile(html: string): ParsedPlayerProfile {
  const $ = cheerio.load(html);

  // fip_id: prefer data attribute, fall back to regex on page text
  let fipId =
    $('[data-fip-id]').first().attr('data-fip-id')?.trim() ?? null;
  if (!fipId) {
    const match = html.match(FIP_ID_REGEX);
    fipId = match ? match[0] : null;
  }

  // JSON-LD Person fields
  const ld = extractJsonLd(html);
  let birthDate: string | null = null;
  let birthPlace: string | null = null;
  let heightCm: number | null = null;
  let affiliation: string | null = null;
  if (ld && typeof ld === 'object') {
    const obj = ld as Record<string, any>;
    birthDate = typeof obj.birthDate === 'string' ? obj.birthDate.slice(0, 10) : null;
    birthPlace = obj.birthPlace?.name ?? null;
    heightCm = parseHeightCm(obj.height);
    affiliation = obj.affiliation?.name ?? null;
  }

  // Equipment
  const racketBrand = $('.racket-brand').first().text().trim() || null;
  const racketModel = $('.racket-model').first().text().trim() || null;

  return { fipId, birthDate, birthPlace, heightCm, affiliation, racketBrand, racketModel };
}
```

- [ ] **Step 3: Confirm parser test PASS**

- [ ] **Step 4: Worker test (smaller — verifies it fetches + updates one player)**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runPlayerProfile } from '../../workers/player-profile.js';

function fakeSupabase() {
  const updates: any[] = [];
  return {
    updates,
    schema: () => ({
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
        }),
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    from: () => ({
      update: (changes: any) => ({
        eq: (col: string, val: any) => {
          updates.push({ changes, where: { [col]: val } });
          return { data: null, error: null };
        },
      }),
    }),
  };
}

describe('runPlayerProfile', () => {
  it('updates the player row from a profile fetch', async () => {
    const supabase = fakeSupabase();
    const httpClient = {
      get: vi.fn(async () => ({
        data: `<span data-fip-id="P12345">P12345</span>
               <script type="application/ld+json">{
                 "@type": "Person",
                 "birthDate": "1995-04-21",
                 "height": "190 cm"
               }</script>
               <div class="racket-brand">Nox</div>
               <div class="racket-model">AT10</div>`,
      })),
    };

    const result = await runPlayerProfile(
      {
        supabase: supabase as any,
        httpClient: httpClient as any,
      },
      { playerId: 'plr-uuid-1', slug: 'juan-lebron' }
    );

    expect(result.updated).toBe(true);
    expect(result.fipId).toBe('P12345');
    expect(supabase.updates[0].changes).toMatchObject({
      fip_id: 'P12345',
      birthdate: '1995-04-21',
    });
  });
});
```

- [ ] **Step 5: Confirm FAIL, create worker:**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipPlayerProfile } from '../parsers/fip-player-profile.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_PLAYER_PROFILE_VERSION } from '../lib/parser-versions.js';

export interface PlayerProfileDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface PlayerProfileTask {
  playerId: string;
  slug: string;
}

export interface PlayerProfileResult {
  updated: boolean;
  fipId: string | null;
}

export async function runPlayerProfile(
  deps: PlayerProfileDeps,
  task: PlayerProfileTask
): Promise<PlayerProfileResult> {
  const targetUrl = `https://www.padelfip.com/player/${task.slug}/`;
  let parsed: ReturnType<typeof parseFipPlayerProfile> | null = null;

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

  if (!parsed) return { updated: false, fipId: null };

  // Update only fields the profile owns. Don't clobber name/country (rankings worker owns those).
  const updates: Record<string, unknown> = { last_updated_by: 'padelgod' };
  if (parsed.fipId) updates.fip_id = parsed.fipId;
  if (parsed.birthDate) updates.birthdate = parsed.birthDate;
  // birth_place, height, affiliation, equipment: stored in db only if columns exist.
  // For V1 the existing players table lacks birth_place/height/affiliation columns,
  // so we skip them and revisit in a follow-up migration.

  const { error } = await deps.supabase
    .from('players')
    .update(updates)
    .eq('id', task.playerId);

  if (error) throw new Error(`Player profile update failed: ${error.message}`);

  return { updated: true, fipId: parsed.fipId };
}
```

- [ ] **Step 6: Confirm tests PASS, commit**

```bash
git add padelgod/src/parsers/fip-player-profile.ts \
        padelgod/src/__tests__/parsers/fip-player-profile.test.ts \
        padelgod/src/workers/player-profile.ts \
        padelgod/src/__tests__/workers/player-profile.test.ts
git commit -m "feat(padelgod): add player profile parser + worker"
```

---

### Task 12: Scheduler skeleton (node-cron)

**Files:**
- Create: `padelgod/src/scheduler.ts`
- Create: `padelgod/src/__tests__/scheduler.test.ts`

The scheduler registers each worker with its cron expression and an enable flag (so we can disable individual workers via env var if a parser breaks in production). Exposes `startScheduler()` and `stopScheduler()`.

- [ ] **Step 1: Test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildSchedule } from '../scheduler.js';

describe('buildSchedule', () => {
  it('includes all 4 V1 workers with sensible cron expressions', () => {
    const sched = buildSchedule({
      enableTournamentDiscovery: true,
      enableWidgetCodeLookup: true,
      enablePlayerRankings: true,
      enablePlayerProfile: true,
    });
    const names = sched.map((s) => s.name);
    expect(names).toContain('tournament-discovery');
    expect(names).toContain('widget-code-lookup');
    expect(names).toContain('player-rankings');
    expect(names).toContain('player-profile');
  });

  it('respects enable flags', () => {
    const sched = buildSchedule({
      enableTournamentDiscovery: false,
      enableWidgetCodeLookup: true,
      enablePlayerRankings: false,
      enablePlayerProfile: true,
    });
    const names = sched.map((s) => s.name);
    expect(names).not.toContain('tournament-discovery');
    expect(names).toContain('widget-code-lookup');
    expect(names).not.toContain('player-rankings');
    expect(names).toContain('player-profile');
  });
});
```

- [ ] **Step 2: Confirm FAIL, create scheduler:**

```typescript
import cron, { type ScheduledTask } from 'node-cron';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import { runTournamentDiscovery } from './workers/tournament-discovery.js';
import { runWidgetCodeLookup } from './workers/widget-code-lookup.js';
import { runPlayerRankings } from './workers/player-rankings.js';

export interface ScheduleEntry {
  name: string;
  cron: string;
  run: (deps: SchedulerDeps) => Promise<unknown>;
}

export interface SchedulerFlags {
  enableTournamentDiscovery: boolean;
  enableWidgetCodeLookup: boolean;
  enablePlayerRankings: boolean;
  enablePlayerProfile: boolean;
}

export interface SchedulerDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
}

export function buildSchedule(flags: SchedulerFlags): ScheduleEntry[] {
  const entries: ScheduleEntry[] = [];
  if (flags.enableTournamentDiscovery) {
    entries.push({
      name: 'tournament-discovery',
      cron: '0 * * * *', // hourly at :00
      run: (deps) => runTournamentDiscovery(deps),
    });
  }
  if (flags.enableWidgetCodeLookup) {
    entries.push({
      name: 'widget-code-lookup',
      cron: '15 * * * *', // hourly at :15
      run: (deps) => runWidgetCodeLookup(deps),
    });
  }
  if (flags.enablePlayerRankings) {
    entries.push({
      name: 'player-rankings',
      cron: '0 5 * * *', // daily 05:00 UTC
      run: (deps) => runPlayerRankings(deps),
    });
  }
  if (flags.enablePlayerProfile) {
    entries.push({
      name: 'player-profile',
      cron: '30 * * * *', // hourly at :30 — caller decides which players to refresh
      run: async (deps) => {
        deps.logger.info('player-profile worker scheduled but no batch driver yet (V1.5)');
      },
    });
  }
  return entries;
}

export function startScheduler(
  schedule: ScheduleEntry[],
  deps: SchedulerDeps
): ScheduledTask[] {
  return schedule.map((entry) => {
    deps.logger.info({ worker: entry.name, cron: entry.cron }, 'Registering scheduled worker');
    return cron.schedule(entry.cron, async () => {
      const childLogger = deps.logger.child({ worker: entry.name });
      try {
        const startedAt = Date.now();
        const result = await entry.run({ ...deps, logger: childLogger });
        childLogger.info({ result, durationMs: Date.now() - startedAt }, 'Worker completed');
      } catch (err) {
        childLogger.error({ err }, 'Worker threw');
      }
    });
  });
}

export function stopScheduler(tasks: ScheduledTask[]): void {
  for (const t of tasks) t.stop();
}
```

- [ ] **Step 3: Confirm test PASS, commit**

```bash
git add padelgod/src/scheduler.ts padelgod/src/__tests__/scheduler.test.ts
git commit -m "feat(padelgod): add node-cron scheduler skeleton + worker registration"
```

---

### Task 13: Wire scheduler into entry point

**Files:**
- Modify: `padelgod/src/index.ts`
- Modify: `padelgod/src/lib/env.ts` — add scheduler enable flags

- [ ] **Step 1: Add env flags to `padelgod/src/lib/env.ts`**

Modify the EnvSchema to add (keep all existing fields, add these to the object):
```typescript
ENABLE_SCHEDULER: z.coerce.boolean().default(true),
ENABLE_TOURNAMENT_DISCOVERY: z.coerce.boolean().default(true),
ENABLE_WIDGET_CODE_LOOKUP: z.coerce.boolean().default(true),
ENABLE_PLAYER_RANKINGS: z.coerce.boolean().default(true),
ENABLE_PLAYER_PROFILE: z.coerce.boolean().default(true),
```

- [ ] **Step 2: Update `padelgod/.env.example` to document the new flags**

Append to the file:
```
# Worker enable flags (set to false to disable individual workers; default true)
ENABLE_SCHEDULER=true
ENABLE_TOURNAMENT_DISCOVERY=true
ENABLE_WIDGET_CODE_LOOKUP=true
ENABLE_PLAYER_RANKINGS=true
ENABLE_PLAYER_PROFILE=true
```

- [ ] **Step 3: Modify `padelgod/src/index.ts` to start the scheduler**

Add imports near top:
```typescript
import axios from 'axios';
import { createHttpClient, PADELGOD_USER_AGENT } from './lib/http-client.js';
import { buildSchedule, startScheduler, stopScheduler, type SchedulerDeps } from './scheduler.js';
import { shutdownBrowser } from './lib/playwright-pool.js';
```

After Fastify listens (after the existing `app.listen(...)` block, before the graceful shutdown handlers), add:
```typescript
// Scheduler — runs workers on cron schedules
let scheduledTasks: ReturnType<typeof startScheduler> = [];
if (env.ENABLE_SCHEDULER) {
  const httpClient = createHttpClient({ userAgent: PADELGOD_USER_AGENT });
  const schedule = buildSchedule({
    enableTournamentDiscovery: env.ENABLE_TOURNAMENT_DISCOVERY,
    enableWidgetCodeLookup: env.ENABLE_WIDGET_CODE_LOOKUP,
    enablePlayerRankings: env.ENABLE_PLAYER_RANKINGS,
    enablePlayerProfile: env.ENABLE_PLAYER_PROFILE,
  });
  const schedulerDeps: SchedulerDeps = { supabase, httpClient, logger };
  scheduledTasks = startScheduler(schedule, schedulerDeps);
  logger.info({ workers: schedule.length }, 'Scheduler started');
} else {
  logger.warn('Scheduler disabled via ENABLE_SCHEDULER=false');
}
```

Update the graceful shutdown to also stop the scheduler + browser:
```typescript
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down gracefully');
  stopScheduler(scheduledTasks);
  await shutdownBrowser();
  await app.close();
  process.exit(0);
};
```

Remove the now-unused `void supabase;` line.

- [ ] **Step 4: Run typecheck + tests**

```bash
cd padelgod && npm run typecheck && npm test
```
Expected: clean typecheck, all existing tests pass (env tests still 3, plus 7 new tests across this plan = 10 + 7 = 17 minimum).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/index.ts padelgod/src/lib/env.ts padelgod/.env.example
git commit -m "feat(padelgod): wire scheduler into entry point with enable flags"
```

---

### Task 14: Update Dockerfile for Playwright

**Files:**
- Modify: `padelgod/Dockerfile`

Playwright requires Chromium binary + system deps. The base `node:20-bookworm-slim` image lacks them; we install via `npx playwright install --with-deps chromium`.

- [ ] **Step 1: Update `padelgod/Dockerfile` runtime stage**

Change the runtime stage to:
```dockerfile
# ---- runtime ----
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Install chromium browser + system deps for Playwright fallback
RUN npx playwright install --with-deps chromium
COPY --from=builder /app/dist ./dist
EXPOSE 3002
CMD ["node", "dist/index.js"]
```

- [ ] **Step 2: Commit (note this will increase the image size by ~300MB)**

```bash
git add padelgod/Dockerfile
git commit -m "build(padelgod): install chromium for Playwright widget-code fallback"
```

---

### Task 15: Apply the new migration to Supabase

**Files:** none modified.

This task is a **user action** — Padelgod cannot apply migrations. The implementer just verifies the file is in place and ready.

- [ ] **Step 1: Confirm migration file is in place**

```bash
ls -la supabase/migrations/20260420000012_padelgod_tournaments_needing_widget_code.sql
```
Expected: file exists.

- [ ] **Step 2: User must apply via Supabase Dashboard or CLI:**

```bash
supabase migration up
```
OR paste the file contents into Supabase Dashboard → SQL Editor.

The verification block in the migration will fail loudly if the function isn't created.

- [ ] **Step 3: Verify in SQL Editor:**

```sql
SELECT EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'padelgod_tournaments_needing_widget_code'
) AS function_exists;
```
Expected: `true`.

This task is marked complete by the controller after the user confirms the migration applied.

---

### Task 16: Smoke test workers locally

**Files:** none modified.

End-to-end manual verification before deploy.

- [ ] **Step 1: Set up local env**

```bash
cd padelgod
cp .env.example .env
# Edit .env to fill in real SUPABASE_URL, SUPABASE_SERVICE_KEY, PADELGOD_ADMIN_TOKEN
# Set ENABLE_SCHEDULER=false for manual control
echo "ENABLE_SCHEDULER=false" >> .env
```

- [ ] **Step 2: Run a one-shot worker via REPL**

Create a temporary test script `padelgod/scripts/run-worker.ts` (don't commit — local debug only):
```typescript
import { loadEnv } from '../src/lib/env.js';
import { createLogger } from '../src/lib/logger.js';
import { createSupabaseClient } from '../src/lib/supabase.js';
import { createHttpClient, PADELGOD_USER_AGENT } from '../src/lib/http-client.js';
import { runTournamentDiscovery } from '../src/workers/tournament-discovery.js';

const env = loadEnv();
const logger = createLogger({ level: 'debug', service: 'padelgod-smoke' });
const supabase = createSupabaseClient({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY });
const httpClient = createHttpClient({ userAgent: PADELGOD_USER_AGENT });

const result = await runTournamentDiscovery({ supabase, httpClient });
logger.info({ result }, 'Smoke test complete');
```

Run:
```bash
cd padelgod && npx tsx scripts/run-worker.ts
```

Expected log output:
```
{"level":"info","msg":"Supabase client initialized"}
{"level":"info","result":{"discovered":<N>,"scrapeJobId":"..."},"msg":"Smoke test complete"}
```

Where `<N>` is the number of new/updated tournaments since the last run.

- [ ] **Step 3: Verify in Supabase**

```sql
SELECT name, slug, source, last_updated_by, updated_at
FROM tournaments
WHERE last_updated_by = 'padelgod'
ORDER BY updated_at DESC LIMIT 5;
```
Expected: rows with `last_updated_by = 'padelgod'` and recent `updated_at`.

```sql
SELECT job_type, status, duration_ms, error_message, parser_version
FROM padelgod.scrape_jobs
ORDER BY started_at DESC LIMIT 5;
```
Expected: most recent row is `job_type='discover'`, `status='success'`.

- [ ] **Step 4: Delete the temp script**

```bash
rm padelgod/scripts/run-worker.ts
```

This task is marked complete after the controller confirms the smoke test produced the expected outputs.

---

### Task 17: Final verification + push to feature branch

**Files:** none modified.

- [ ] **Step 1: Run full local verification**

```bash
cd padelgod
npm run typecheck
npm test
npm run build
ls dist/
```
Expected:
- typecheck: 0 errors
- tests: 17+ passing
- build: `dist/index.js`, `dist/scheduler.js`, `dist/workers/*.js`, `dist/parsers/*.js`, `dist/lib/*.js` all present

- [ ] **Step 2: Push the branch + open PR**

(Branch name + PR title to be set by the controller once we're at this step.)

```bash
git push -u origin <branch-name>
```

PR body should reference both Plan 1 (foundation) and this Plan 2 doc.

- [ ] **Step 3: Watch CI + Vercel**

Both should be green. The Vercel build is unaffected (we excluded `padelgod/` from the root tsconfig in Plan 1).

- [ ] **Step 4: Merge after smoke test on Railway**

After merge:
1. Railway auto-deploys
2. Watch the deploy logs for the "Scheduler started" message
3. Confirm `tournament-discovery` runs at the next `:00` of the hour
4. Verify `padelgod.scrape_jobs` shows recent successful runs

---

## Definition of done

This plan is complete when **all** are true:

1. ✅ All 4 workers have unit tests covering happy path + error case
2. ✅ All 4 parsers have unit tests with realistic fixtures
3. ✅ HTTP client + scrape-job wrapper have unit tests
4. ✅ Scheduler skeleton tests pass
5. ✅ `npm test` passes (17+ tests total)
6. ✅ `npm run build` succeeds + `dist/` populated
7. ✅ Migration `20260420000012_padelgod_tournaments_needing_widget_code.sql` applied to Supabase
8. ✅ Local smoke test of `tournament-discovery` produces a row in `tournaments` with `last_updated_by = 'padelgod'` and a `success` row in `padelgod.scrape_jobs`
9. ✅ Branch pushed, PR opened, CI green, Vercel green
10. ✅ Merged to main, Railway auto-deploys, scheduler logs confirm worker registration

---

## What this plan deliberately does NOT do

- ❌ Playwright fallback for widget-code lookup — search-only for V1, fallback in Plan 2.5
- ❌ Player profile **batch driver** — the worker is built but no scheduler driver decides WHICH players to refresh. That's V1.5 (need to scope: refresh players whose `updated_at` < 7 days, top 200 by ranking).
- ❌ Equipment table writes — the parser extracts racket brand/model but the worker doesn't write them to `padel_brands`/`padel_rackets`/`player_equipment` yet. Add in Plan 2.5 once the parser is proven against more profile pages.
- ❌ Birth-place / height / affiliation columns on `players` — the parser captures them but the schema doesn't have columns yet. Add migration in Plan 2.5.
- ❌ Match-related workers — that's Plan 3 (entry list, draws, OOP, results) and Plan 4 (live polling).
- ❌ Admin API endpoints to trigger workers manually — Plan 5.

If you find yourself wanting to add any of these "while you're in there" — don't. Each scope creep weakens the test surface for the discovery layer.
