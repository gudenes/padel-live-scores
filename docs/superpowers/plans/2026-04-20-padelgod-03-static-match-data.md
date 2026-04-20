# Padelgod Plan 3: Static Match Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four "static" workers that pull pre-match information from FIP/Crionet for each tournament — entry lists, draws, order of play, and finished-match results. Plus the per-tournament player dictionary library that resolves the widget's abbreviated names ("J. Lebrón") to canonical FIP player IDs.

**Architecture:** Each worker scrapes one widget endpoint per tournament with an active widget code (from Plan 2's `padelgod.widget_id_cache`). To keep the static and canonical layers decoupled, fetchers write to **snapshot tables in the `padelgod` schema**, not directly to the canonical `public.tournament_draws`, `public.matches`, or `public.sets`/`games` tables. A separate "reconciler" pass (Plan 4 / 5) merges snapshots into the canonical layer with proper provenance + conflict rules. This means Plan 3 is **read-and-store-only** — zero risk of clobbering existing data while we battle-test the parsers.

**Tech Stack:** Same as Plan 2 — Node.js 20 + TypeScript + axios + cheerio + node-cron + vitest. New: 1 small library file (`tournament-dictionary.ts`) using the global `PlayerResolver` patterns from main app's `src/lib/player-resolver.ts` as inspiration but reimplemented in Padelgod's tighter scope.

**Companion specs:**
- `docs/superpowers/specs/2026-04-20-padelgod-design.md` — §3.4 (worker structure), §5 (player enrichment design)
- `docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md` — §2 (endpoint inventory), §3 (live row shapes used as oracles for results parser)
- `docs/superpowers/plans/2026-04-20-padelgod-02-discovery-layer.md` — what's already in place

**Prerequisites (from Plan 2):**
- Padelgod service deployed to Railway with scheduler running
- `padelgod.widget_id_cache` table populated for at least one FIP-sourced tournament
- `padelgod.scrape_jobs` + `padelgod.raw_payloads` working
- HTTP client + scrape-job wrapper + parser-versions in place

---

## File Structure

**New files in `padelgod/`:**
```
padelgod/
├── src/
│   ├── lib/
│   │   └── tournament-dictionary.ts       # Build dict from entry-list players, lookup short names with pair disambig
│   ├── parsers/
│   │   ├── crionet-entry-list.ts          # /screen/entrylist HTML → ParsedEntryListPlayer[]
│   │   ├── crionet-draw.ts                # /screen/draw HTML → ParsedDrawMatch[]
│   │   ├── crionet-oop.ts                 # /screen/oopbyday HTML → ParsedOopMatch[]
│   │   └── crionet-results.ts             # /screen/resultsbyday HTML → ParsedResultsMatch[]
│   ├── workers/
│   │   ├── entry-list-fetcher.ts          # one tournament per tick (cycles through active codes)
│   │   ├── draw-fetcher.ts                # one tournament per tick
│   │   ├── oop-fetcher.ts                 # iterates active tournaments + day cursors
│   │   └── results-fetcher.ts             # iterates active tournaments + day cursors
│   └── __tests__/  (parsers/, workers/, lib/ subfolders for each new file)
└── (existing files unchanged)

supabase/migrations/
├── 20260420000013_padelgod_static_snapshot_tables.sql   # Snapshot tables for entry lists, draws, OOP, results
└── 20260420000014_padelgod_active_tournaments_views.sql # Helper views/functions for "tournaments needing X"
```

**Modified files:**
- `padelgod/src/lib/parser-versions.ts` — add 4 new constants
- `padelgod/src/scheduler.ts` — register the 4 new workers

---

## Conventions

**Same conventions as Plan 2.** Parsers are pure (HTML in → typed object out). Workers compose `httpClient + supabase + parser + runScrapeJob`. Each worker takes one tournament per invocation OR iterates a small batch — never unbounded.

**Snapshot table convention:** every row in `padelgod.entry_list_snapshots` / `padelgod.draw_snapshots` / `padelgod.oop_snapshots` / `padelgod.results_snapshots` is **append-only with a `captured_at` timestamp**. The reconciler reads the latest snapshot per (tournament_id, day, etc.) and writes to canonical tables. This way:
- We can replay history (when did the OOP change?)
- Parser bugs don't corrupt canonical data
- Battle-testing happens at the snapshot layer first

**Day cursor convention:** widgets paginate by day (`oopbyday/{CODE}/{day}` where day is 1, 2, 3...). For each tournament, workers fetch days 1..N where N = number of tournament days (computed from `tournaments.starts_at` + `ends_at`). For tournaments without dates, default to days 1..7 and stop on first 200-with-no-data.

**Player dictionary scope:** built per-tournament, in-memory, lifetime = single worker invocation. Loaded from `padelgod.entry_list_snapshots` (the latest snapshot per tournament). This keeps each worker independent — no cross-worker state.

---

### Task 1: Migration — snapshot tables

**Files:**
- Create: `supabase/migrations/20260420000013_padelgod_static_snapshot_tables.sql`

- [ ] **Step 1: Create the migration file with EXACTLY this content:**

```sql
-- Padelgod Plan 3: append-only snapshot tables for static match data.
-- Reconciler workers (Plan 4+) read latest snapshots and merge into canonical tables.

-- 1. Entry list snapshots (one row per player per snapshot per tournament+category)
CREATE TABLE padelgod.entry_list_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  fip_id TEXT,                          -- nullable: amateurs may not have one
  name TEXT NOT NULL,
  country TEXT,                         -- ISO3 (ESP, ARG, ...)
  seed INT,                             -- nullable
  partner_fip_id TEXT,                  -- pair info (Padel is doubles)
  partner_name TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entry_list_snap_tournament ON padelgod.entry_list_snapshots(tournament_id, category, captured_at DESC);
CREATE INDEX idx_entry_list_snap_recent ON padelgod.entry_list_snapshots(captured_at DESC);

COMMENT ON TABLE padelgod.entry_list_snapshots IS
  'Per-tournament + per-category entry list rows. Append-only; reconciler reads latest snapshot per (tournament_id, category).';

-- 2. Draw snapshots (one row per match per snapshot)
CREATE TABLE padelgod.draw_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  draw_type TEXT NOT NULL CHECK (draw_type IN ('main_draw', 'qualifying')),
  round_label TEXT NOT NULL,            -- e.g. 'R32', 'QF', 'SF', 'F'
  draw_position INT,                    -- bracket slot, 1-indexed
  team1_player1_name TEXT,              -- short widget names (resolved to FIP IDs by reconciler)
  team1_player2_name TEXT,
  team2_player1_name TEXT,
  team2_player2_name TEXT,
  team1_seed INT,
  team2_seed INT,
  team1_country TEXT,
  team2_country TEXT,
  set_scores TEXT,                      -- e.g. "6-4 4-6 6-2" if completed; NULL if scheduled
  winner_team INT CHECK (winner_team IN (1, 2)),
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'finished', 'walkover', 'retired')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_draw_snap_tournament ON padelgod.draw_snapshots(tournament_id, category, draw_type, captured_at DESC);
CREATE INDEX idx_draw_snap_recent ON padelgod.draw_snapshots(captured_at DESC);

COMMENT ON TABLE padelgod.draw_snapshots IS
  'Per-match draw bracket entries. Append-only; reconciler dedupes by (tournament_id, category, draw_type, round_label, draw_position).';

-- 3. OOP (Order of Play) snapshots (one row per scheduled match per snapshot)
CREATE TABLE padelgod.oop_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  day_number INT NOT NULL,              -- widget day cursor: 1, 2, 3, ...
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  round_label TEXT,                     -- 'QF', 'F', etc.
  court TEXT NOT NULL,
  scheduled_label TEXT,                 -- 'Starting at 10:00 AM' / 'Followed by' (raw widget text)
  team1_player1_name TEXT,
  team1_player2_name TEXT,
  team2_player1_name TEXT,
  team2_player2_name TEXT,
  match_widget_id TEXT,                 -- e.g. 'MQ012' from data-id attribute
  status TEXT NOT NULL CHECK (status IN ('scheduled', 'live', 'finished', 'walkover', 'retired')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_oop_snap_tournament_day ON padelgod.oop_snapshots(tournament_id, day_number, captured_at DESC);
CREATE INDEX idx_oop_snap_recent ON padelgod.oop_snapshots(captured_at DESC);

COMMENT ON TABLE padelgod.oop_snapshots IS
  'Per-tournament + per-day order of play snapshots. Append-only; reconciler reads latest per (tournament_id, day_number).';

-- 4. Results snapshots (one row per finished match per snapshot)
CREATE TABLE padelgod.results_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID NOT NULL REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  day_number INT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  round_label TEXT,
  court TEXT,
  match_widget_id TEXT,
  team1_player1_name TEXT,
  team1_player2_name TEXT,
  team2_player1_name TEXT,
  team2_player2_name TEXT,
  set_scores TEXT NOT NULL,             -- '6-4 4-6 6-2'
  winner_team INT NOT NULL CHECK (winner_team IN (1, 2)),
  status TEXT NOT NULL CHECK (status IN ('finished', 'walkover', 'retired')),
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_results_snap_tournament_day ON padelgod.results_snapshots(tournament_id, day_number, captured_at DESC);
CREATE INDEX idx_results_snap_recent ON padelgod.results_snapshots(captured_at DESC);

COMMENT ON TABLE padelgod.results_snapshots IS
  'Per-tournament + per-day completed match results. Append-only; reconciler reads latest per (tournament_id, day_number).';

-- Verification
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='entry_list_snapshots'),
    'padelgod.entry_list_snapshots missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='draw_snapshots'),
    'padelgod.draw_snapshots missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='oop_snapshots'),
    'padelgod.oop_snapshots missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='results_snapshots'),
    'padelgod.results_snapshots missing';
END $$;
```

- [ ] **Step 2: Commit (do NOT apply to Supabase yet — user does that as part of Task 14)**

```bash
git add supabase/migrations/20260420000013_padelgod_static_snapshot_tables.sql
git commit -m "feat(db): add padelgod snapshot tables (entry list, draw, OOP, results)"
```

---

### Task 2: Migration — helper views for "tournaments needing X"

**Files:**
- Create: `supabase/migrations/20260420000014_padelgod_active_tournaments_views.sql`

A worker that "fetches OOP for tournaments currently in their date window" needs a query. Centralize it in a SQL function that all 4 workers can reuse.

- [ ] **Step 1: Create the migration with EXACTLY this content:**

```sql
-- Padelgod Plan 3: helper functions for selecting tournaments to scrape per worker.

-- Tournaments with an active widget code AND in their date window (or close to it).
-- Used by entry-list / draw / oop / results workers.
CREATE OR REPLACE FUNCTION public.padelgod_active_tournaments_for_static_workers()
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  widget_id TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  expected_days INT
) AS $$
  SELECT
    t.id AS tournament_id,
    t.name AS tournament_name,
    c.widget_id,
    t.starts_at,
    t.ends_at,
    GREATEST(
      1,
      CASE
        WHEN t.starts_at IS NOT NULL AND t.ends_at IS NOT NULL
          THEN EXTRACT(DAY FROM (t.ends_at - t.starts_at))::INT + 1
        ELSE 7
      END
    ) AS expected_days
  FROM public.tournaments t
  INNER JOIN padelgod.widget_id_cache c
    ON c.tournament_id = t.id AND c.is_active = true
  WHERE
    -- tournament is currently happening OR within ±7 days of its window
    (
      t.starts_at IS NULL  -- no dates: assume active, fetch defensively
      OR (t.starts_at <= NOW() + INTERVAL '7 days' AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days')
    )
  ORDER BY t.starts_at ASC NULLS LAST
  LIMIT 50;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'padelgod_active_tournaments_for_static_workers'
  ), 'function missing';
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260420000014_padelgod_active_tournaments_views.sql
git commit -m "feat(db): add padelgod_active_tournaments_for_static_workers() helper"
```

---

### Task 3: Add new parser version constants

**Files:**
- Modify: `padelgod/src/lib/parser-versions.ts`

- [ ] **Step 1: Append to `padelgod/src/lib/parser-versions.ts` (after the existing constants)**

```typescript
export const CRIONET_ENTRY_LIST_VERSION = 'crionet-entry-list-1.0.0';
export const CRIONET_DRAW_VERSION = 'crionet-draw-1.0.0';
export const CRIONET_OOP_VERSION = 'crionet-oop-1.0.0';
export const CRIONET_RESULTS_VERSION = 'crionet-results-1.0.0';
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd padelgod && npm run typecheck
git add padelgod/src/lib/parser-versions.ts
git commit -m "feat(padelgod): add Plan 3 parser version constants"
```

---

### Task 4: Crionet entry list parser

**Files:**
- Create: `padelgod/src/parsers/crionet-entry-list.ts`
- Create: `padelgod/src/__tests__/parsers/crionet-entry-list.test.ts`

The widget endpoint (`/screen/entrylist/{CODE}/{ms|ws}?t=tol`) returns HTML with a player list. Validated shape (from live data report §2):

```html
<div class="entry-list">
  <div class="entry-list-row" data-fip-id="P200038" data-partner-fip-id="P200042">
    <div class="player-name">LEBRON, Juan</div>
    <div class="player-country"><img src="/flags/ESP.jpg" alt="ESP"/></div>
    <div class="seed">(1)</div>
    <div class="partner-name">CHINGOTTO, Federico</div>
  </div>
  <!-- ... -->
</div>
```

(Selectors documented at top of parser file so they can be adjusted post-deploy.)

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/parsers/crionet-entry-list.test.ts
import { describe, it, expect } from 'vitest';
import { parseCrionetEntryList } from '../../parsers/crionet-entry-list.js';

describe('parseCrionetEntryList', () => {
  it('extracts pair entries with seed + country', () => {
    const html = `
      <div class="entry-list">
        <div class="entry-list-row" data-fip-id="P200038" data-partner-fip-id="P200042">
          <div class="player-name">LEBRON, Juan</div>
          <div class="player-country"><img src="/flags/ESP.jpg" alt="ESP"/></div>
          <div class="seed">(1)</div>
          <div class="partner-name">CHINGOTTO, Federico</div>
        </div>
        <div class="entry-list-row" data-fip-id="P200052">
          <div class="player-name">COELLO, Arturo</div>
          <div class="player-country"><img src="/flags/ESP.jpg" alt="ESP"/></div>
          <div class="seed">(2)</div>
          <div class="partner-name">TAPIA, Agustin</div>
        </div>
      </div>
    `;
    const result = parseCrionetEntryList(html, 'men');
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      fipId: 'P200038',
      name: 'Juan Lebron',
      country: 'ESP',
      seed: 1,
      partnerFipId: 'P200042',
      partnerName: 'Federico Chingotto',
      category: 'men',
    });
    expect(result[1]?.partnerFipId).toBeNull();  // not provided in second row
  });

  it('returns empty array when no rows', () => {
    expect(parseCrionetEntryList('<div></div>', 'women')).toEqual([]);
  });

  it('strips noise tokens from "LASTNAME, Firstname" format', () => {
    const html = `
      <div class="entry-list-row" data-fip-id="P1">
        <div class="player-name">DI NENNO, Martin</div>
        <div class="player-country"><img src="/flags/ARG.jpg" alt="ARG"/></div>
      </div>`;
    const result = parseCrionetEntryList(html, 'men');
    expect(result[0]?.name).toBe('Martin Di Nenno');
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/parsers/crionet-entry-list.ts`**

```typescript
import * as cheerio from 'cheerio';

// === Selectors — adjust post-deploy after live HTML inspection ===
const ROW_SELECTOR = '.entry-list-row';
const NAME_SELECTOR = '.player-name';
const COUNTRY_FLAG_SELECTOR = '.player-country img';
const SEED_SELECTOR = '.seed';
const PARTNER_NAME_SELECTOR = '.partner-name';
// =================================================================

export type Category = 'men' | 'women';

export interface ParsedEntryListPlayer {
  fipId: string | null;
  name: string;
  country: string | null;
  seed: number | null;
  partnerFipId: string | null;
  partnerName: string | null;
  category: Category;
}

// "LASTNAME, Firstname" → "Firstname Lastname"
function normalizeName(raw: string): string {
  const trimmed = raw.trim();
  const m = trimmed.match(/^(.+?),\s+(.+)$/);
  if (!m) return trimmed;
  const lastname = (m[1] ?? '')
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  const firstname = (m[2] ?? '').trim();
  return `${firstname} ${lastname}`.trim();
}

function parseSeed(raw: string): number | null {
  const m = raw.match(/\((\d+)\)/);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

function parseCountry(flagSrc: string, alt: string): string | null {
  if (alt && alt.trim().length === 3) return alt.trim().toUpperCase();
  const m = flagSrc.match(/([A-Z]{3})\.jpg/);
  return m && m[1] ? m[1] : null;
}

export function parseCrionetEntryList(html: string, category: Category): ParsedEntryListPlayer[] {
  const $ = cheerio.load(html);
  const rows: ParsedEntryListPlayer[] = [];

  $(ROW_SELECTOR).each((_, el) => {
    const row = $(el);
    const name = normalizeName(row.find(NAME_SELECTOR).first().text() ?? '');
    if (!name) return;

    const fipId = row.attr('data-fip-id')?.trim() || null;
    const partnerFipId = row.attr('data-partner-fip-id')?.trim() || null;
    const flag = row.find(COUNTRY_FLAG_SELECTOR).first();
    const country = parseCountry(flag.attr('src') ?? '', flag.attr('alt') ?? '');
    const seed = parseSeed(row.find(SEED_SELECTOR).first().text() ?? '');
    const partnerNameRaw = row.find(PARTNER_NAME_SELECTOR).first().text() ?? '';
    const partnerName = partnerNameRaw ? normalizeName(partnerNameRaw) : null;

    rows.push({ fipId, name, country, seed, partnerFipId, partnerName, category });
  });

  return rows;
}
```

- [ ] **Step 4: Confirm PASS (3/3)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/crionet-entry-list.ts padelgod/src/__tests__/parsers/crionet-entry-list.test.ts
git commit -m "feat(padelgod): add Crionet entry-list parser"
```

---

### Task 5: Entry list fetcher worker

**Files:**
- Create: `padelgod/src/workers/entry-list-fetcher.ts`
- Create: `padelgod/src/__tests__/workers/entry-list-fetcher.test.ts`

For each active tournament, fetches `/screen/entrylist/{CODE}/ms` and `/ws`, parses, inserts into `padelgod.entry_list_snapshots` (one row per player per category). One tournament + both categories per invocation.

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/workers/entry-list-fetcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runEntryListFetcher } from '../../workers/entry-list-fetcher.js';

function fakeSupabase(activeTournaments: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: () => ({
      from: (t: string) => ({
        insert: (rows: any) => {
          if (t === 'entry_list_snapshots') {
            const arr = Array.isArray(rows) ? rows : [rows];
            inserted.push(...arr);
            return { data: arr, error: null };
          }
          if (t === 'scrape_jobs') {
            return {
              select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
            };
          }
          return { data: null, error: { message: 'unexpected' } };
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    }),
    rpc: vi.fn(async (_name: string) => ({ data: activeTournaments, error: null })),
  };
}

const fakeRow = (fipId: string, name: string, partner?: string) => `
  <div class="entry-list-row" data-fip-id="${fipId}"${partner ? ` data-partner-fip-id="${partner}"` : ''}>
    <div class="player-name">${name}</div>
    <div class="player-country"><img src="/flags/ESP.jpg" alt="ESP"/></div>
  </div>
`;

describe('runEntryListFetcher', () => {
  it('fetches both categories for one tournament and inserts snapshots', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 'tour-1', tournament_name: 'X', widget_id: 'FIP-2026-1701', starts_at: null, ends_at: null, expected_days: 7 },
    ]);
    const httpClient = {
      get: vi.fn()
        .mockResolvedValueOnce({ data: `<div class="entry-list">${fakeRow('P1', 'COELLO, Arturo')}</div>` })  // men
        .mockResolvedValueOnce({ data: `<div class="entry-list">${fakeRow('P9', 'SANCHEZ, Bea')}</div>` }),  // women
    };

    const result = await runEntryListFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalPlayersInserted).toBe(2);
    expect(supabase.inserted).toHaveLength(2);
    expect(supabase.inserted[0].category).toBe('men');
    expect(supabase.inserted[1].category).toBe('women');
  });

  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase([]);
    const httpClient = { get: vi.fn() };

    const result = await runEntryListFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(0);
    expect(httpClient.get).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/workers/entry-list-fetcher.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetEntryList, type Category } from '../parsers/crionet-entry-list.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_ENTRY_LIST_VERSION } from '../lib/parser-versions.js';

export interface EntryListFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface EntryListFetcherResult {
  tournamentsProcessed: number;
  totalPlayersInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  tournament_name: string;
  widget_id: string;
  starts_at: string | null;
  ends_at: string | null;
  expected_days: number;
}

const URL_FOR = (code: string, gender: 'ms' | 'ws') =>
  `https://widget.matchscorerlive.com/screen/entrylist/${code}/${gender}?t=tol`;

async function fetchAndStore(
  deps: EntryListFetcherDeps,
  t: ActiveTournament,
  category: Category
): Promise<number> {
  const code = t.widget_id;
  const targetUrl = URL_FOR(code, category === 'men' ? 'ms' : 'ws');
  let inserted = 0;
  let scrapeJobIdForInserts = '';

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'discover',  // entry list reuses discover type for now; could add 'entry_list' enum later
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_ENTRY_LIST_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      const parsed = parseCrionetEntryList(body, category);
      if (parsed.length === 0) return { body, contentHash };

      // We don't have the scrapeJobId yet (it's created by runScrapeJob), so
      // we need a different shape. Workaround: insert AFTER the scrape job
      // completes. Move insert outside this callback.
      scrapeJobIdForInserts = ''; // placeholder; populated after callback returns
      // store parsed for outer scope
      (deps as any).__lastParsed = parsed;
      return { body, contentHash };
    }
  );

  // Now insert the parsed rows. The runScrapeJob callback can't know its own
  // scrape_job_id yet, so we accept that snapshots are inserted under a
  // SEPARATE row reference: we use the most recent scrape_job for this
  // tournament+url combo. For simplicity, look it up:
  const { data: jobRow } = await deps.supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('id')
    .eq('tournament_id', t.tournament_id)
    .eq('target_url', targetUrl)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const parsed = (deps as any).__lastParsed as ReturnType<typeof parseCrionetEntryList> | undefined;
  delete (deps as any).__lastParsed;
  if (!parsed || parsed.length === 0 || !jobRow?.id) return 0;

  scrapeJobIdForInserts = jobRow.id;

  const rows = parsed.map((p) => ({
    scrape_job_id: scrapeJobIdForInserts,
    tournament_id: t.tournament_id,
    category,
    fip_id: p.fipId,
    name: p.name,
    country: p.country,
    seed: p.seed,
    partner_fip_id: p.partnerFipId,
    partner_name: p.partnerName,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .insert(rows);

  if (error) throw new Error(`entry_list_snapshots insert failed: ${error.message}`);
  inserted = rows.length;
  return inserted;
}

export async function runEntryListFetcher(
  deps: EntryListFetcherDeps
): Promise<EntryListFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalPlayersInserted = 0;
  for (const t of list) {
    const menCount = await fetchAndStore(deps, t, 'men');
    const womenCount = await fetchAndStore(deps, t, 'women');
    totalPlayersInserted += menCount + womenCount;
  }

  return {
    tournamentsProcessed: list.length,
    totalPlayersInserted,
  };
}
```

- [ ] **Step 4: Confirm PASS (2/2)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/entry-list-fetcher.ts padelgod/src/__tests__/workers/entry-list-fetcher.test.ts
git commit -m "feat(padelgod): add entry-list-fetcher worker (snapshots per tournament+category)"
```

---

### Task 6: Crionet draw parser

**Files:**
- Create: `padelgod/src/parsers/crionet-draw.ts`
- Create: `padelgod/src/__tests__/parsers/crionet-draw.test.ts`

The widget endpoint `/screen/draw/{CODE}/{drawType}/{round}?t=tol` returns bracket HTML. Reuses scorebox-style markup from the live-data report. The parser extracts one row per match.

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/parsers/crionet-draw.test.ts
import { describe, it, expect } from 'vitest';
import { parseCrionetDraw } from '../../parsers/crionet-draw.js';

describe('parseCrionetDraw', () => {
  it('parses a completed match from draw HTML', () => {
    const html = `
      <table class="w-100">
        <tr class="scorebox-header-completed">
          <th class="text-left"><span class="court-name">CENTRE COURT</span></th>
          <th colspan="4" class="round-name text-right"><small>Round of 16</small></th>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span>L. Galan</span></div>
            <div><img class="flags" src="/images/flags/ARG.jpg"/><span>F. Chingotto</span></div>
          </td>
          <td class="set">6</td><td class="set">3</td><td class="set">7</td>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span class="winner">J. Lebron</span></div>
            <div><img class="flags" src="/images/flags/ARG.jpg"/><span class="winner">A. Tapia</span></div>
          </td>
          <td class="set">7</td><td class="set">6</td><td class="set">6</td>
        </tr>
      </table>
    `;
    const result = parseCrionetDraw(html, 'men', 'main_draw');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      category: 'men',
      drawType: 'main_draw',
      roundLabel: 'Round of 16',
      team1Player1Name: 'L. Galan',
      team1Player2Name: 'F. Chingotto',
      team2Player1Name: 'J. Lebron',
      team2Player2Name: 'A. Tapia',
      winnerTeam: 2,
      setScores: '6-7 3-6 7-6',
      status: 'finished',
    });
  });

  it('returns empty array for "Draw not available" HTML', () => {
    const html = '<div class="message">Draw not available</div>';
    expect(parseCrionetDraw(html, 'women', 'qualifying')).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/parsers/crionet-draw.ts`**

```typescript
import * as cheerio from 'cheerio';

// === Selectors ===
const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-completed, tr.scorebox-header-live, tr.scorebox-header-scheduled';
const COURT_NAME_SELECTOR = '.court-name';
const ROUND_NAME_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr.draw-item-container';
const TEAM_SELECTOR = 'td.team';
const PLAYER_LINE_SELECTOR = 'div';
const PLAYER_NAME_SELECTOR = 'span';
const SET_SELECTOR = 'td.set';
const WINNER_CLASS = 'winner';
// =================

export type Category = 'men' | 'women';
export type DrawType = 'main_draw' | 'qualifying';
export type DrawStatus = 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';

export interface ParsedDrawMatch {
  category: Category;
  drawType: DrawType;
  roundLabel: string;
  drawPosition: number | null;
  court: string | null;
  team1Player1Name: string | null;
  team1Player2Name: string | null;
  team2Player1Name: string | null;
  team2Player2Name: string | null;
  team1Country: string | null;
  team2Country: string | null;
  setScores: string | null;
  winnerTeam: 1 | 2 | null;
  status: DrawStatus;
}

function statusFromHeaderClass(cls: string): DrawStatus {
  if (cls.includes('completed')) return 'finished';
  if (cls.includes('live')) return 'live';
  return 'scheduled';
}

function parseTeam($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1Name: string | null;
  player2Name: string | null;
  country: string | null;
  hasWinner: boolean;
} {
  const lines = td.find(PLAYER_LINE_SELECTOR);
  let player1Name: string | null = null;
  let player2Name: string | null = null;
  let country: string | null = null;
  let hasWinner = false;
  lines.each((idx, line) => {
    const $line = $(line);
    const nameSpan = $line.find(PLAYER_NAME_SELECTOR).first();
    const text = nameSpan.text().trim();
    if (!text) return;
    if (nameSpan.hasClass(WINNER_CLASS)) hasWinner = true;
    if (idx === 0) player1Name = text;
    else if (idx === 1) player2Name = text;
    if (!country) {
      const flag = $line.find('img.flags').first().attr('src');
      const m = flag?.match(/([A-Z]{3})\.jpg/);
      if (m) country = m[1] ?? null;
    }
  });
  return { player1Name, player2Name, country, hasWinner };
}

export function parseCrionetDraw(
  html: string,
  category: Category,
  drawType: DrawType
): ParsedDrawMatch[] {
  const $ = cheerio.load(html);
  const out: ParsedDrawMatch[] = [];

  $(TABLE_SELECTOR).each((_, table) => {
    const $t = $(table);
    const header = $t.find(HEADER_SELECTOR).first();
    if (header.length === 0) return;
    const headerClass = header.attr('class') ?? '';
    const status = statusFromHeaderClass(headerClass);
    const court = header.find(COURT_NAME_SELECTOR).first().text().trim() || null;
    const round = header.find(ROUND_NAME_SELECTOR).first().text().trim() || 'Unknown';

    const teamRows = $t.find(TEAM_ROW_SELECTOR);
    if (teamRows.length < 2) return;
    const team1Row = teamRows.eq(0);
    const team2Row = teamRows.eq(1);

    const team1 = parseTeam($, team1Row.find(TEAM_SELECTOR).first());
    const team2 = parseTeam($, team2Row.find(TEAM_SELECTOR).first());

    const team1Sets = team1Row.find(SET_SELECTOR).map((_, el) => $(el).text().trim()).get();
    const team2Sets = team2Row.find(SET_SELECTOR).map((_, el) => $(el).text().trim()).get();
    const sets: string[] = [];
    for (let i = 0; i < Math.max(team1Sets.length, team2Sets.length); i++) {
      const a = team1Sets[i] ?? '-';
      const b = team2Sets[i] ?? '-';
      if (a === '-' && b === '-') continue;
      sets.push(`${a}-${b}`);
    }
    const setScores = sets.length > 0 ? sets.join(' ') : null;

    const winnerTeam: 1 | 2 | null = team1.hasWinner ? 1 : team2.hasWinner ? 2 : null;

    out.push({
      category,
      drawType,
      roundLabel: round,
      drawPosition: null,  // not derivable from this HTML alone; reconciler can compute later
      court,
      team1Player1Name: team1.player1Name,
      team1Player2Name: team1.player2Name,
      team2Player1Name: team2.player1Name,
      team2Player2Name: team2.player2Name,
      team1Country: team1.country,
      team2Country: team2.country,
      setScores,
      winnerTeam,
      status,
    });
  });

  return out;
}
```

- [ ] **Step 4: Confirm PASS (2/2)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/crionet-draw.ts padelgod/src/__tests__/parsers/crionet-draw.test.ts
git commit -m "feat(padelgod): add Crionet draw parser"
```

---

### Task 7: Draw fetcher worker

**Files:**
- Create: `padelgod/src/workers/draw-fetcher.ts`
- Create: `padelgod/src/__tests__/workers/draw-fetcher.test.ts`

For each active tournament, iterates `(category, drawType)` ∈ {(men, MD), (men, MQ), (women, WD), (women, WQ)} and the relevant rounds. Inserts to `padelgod.draw_snapshots`.

For V1, **fetch only the first round (or all rounds with no round filter)**. The widget URL is `/screen/draw/{CODE}/{drawType}/{round}?t=tol`. We'll iterate rounds 1..6 (R64, R32, R16, QF, SF, F) and stop on "Draw not available".

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/workers/draw-fetcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runDrawFetcher } from '../../workers/draw-fetcher.js';

function fakeSupabase(activeTournaments: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: () => ({
      from: (t: string) => ({
        insert: (rows: any) => {
          if (t === 'draw_snapshots') {
            const arr = Array.isArray(rows) ? rows : [rows];
            inserted.push(...arr);
            return { data: arr, error: null };
          }
          if (t === 'scrape_jobs') {
            return { select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }) };
          }
          return { data: null, error: { message: 'unexpected' } };
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => ({ data: { id: 'job-uuid' }, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: activeTournaments, error: null })),
  };
}

describe('runDrawFetcher', () => {
  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase([]);
    const httpClient = { get: vi.fn() };

    const result = await runDrawFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(0);
  });

  it('skips draw types when widget says "Draw not available"', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 't1', tournament_name: 'X', widget_id: 'FIP-2026-1701', starts_at: null, ends_at: null, expected_days: 7 },
    ]);
    const httpClient = {
      get: vi.fn(async () => ({ data: '<div class="message">Draw not available</div>' })),
    };

    const result = await runDrawFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalMatchesInserted).toBe(0);
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/workers/draw-fetcher.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetDraw, type Category, type DrawType } from '../parsers/crionet-draw.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_DRAW_VERSION } from '../lib/parser-versions.js';

export interface DrawFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface DrawFetcherResult {
  tournamentsProcessed: number;
  totalMatchesInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  widget_id: string;
}

const DRAW_TYPE_CODES: Array<{ category: Category; drawType: DrawType; code: string }> = [
  { category: 'men',   drawType: 'main_draw',  code: 'MD' },
  { category: 'men',   drawType: 'qualifying', code: 'MQ' },
  { category: 'women', drawType: 'main_draw',  code: 'WD' },
  { category: 'women', drawType: 'qualifying', code: 'WQ' },
];

const URL_FOR = (widgetCode: string, drawTypeCode: string, round: number) =>
  `https://widget.matchscorerlive.com/screen/draw/${widgetCode}/${drawTypeCode}/${round}?t=tol`;

const ROUNDS_TO_TRY = [1, 2, 3, 4, 5, 6, 7, 8];  // pre-final stages; widget returns "Draw not available" past valid

async function getLatestScrapeJobId(
  supabase: SupabaseClient,
  tournamentId: string,
  targetUrl: string
): Promise<string | null> {
  const { data } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('target_url', targetUrl)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function fetchOneDrawTypeRound(
  deps: DrawFetcherDeps,
  t: ActiveTournament,
  category: Category,
  drawType: DrawType,
  drawTypeCode: string,
  round: number
): Promise<number> {
  const targetUrl = URL_FOR(t.widget_id, drawTypeCode, round);
  let parsed: ReturnType<typeof parseCrionetDraw> = [];

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'draw',
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_DRAW_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseCrionetDraw(body, category, drawType);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) return 0;

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) return 0;

  const rows = parsed.map((m) => ({
    scrape_job_id: scrapeJobId,
    tournament_id: t.tournament_id,
    category: m.category,
    draw_type: m.drawType,
    round_label: m.roundLabel,
    draw_position: m.drawPosition,
    team1_player1_name: m.team1Player1Name,
    team1_player2_name: m.team1Player2Name,
    team2_player1_name: m.team2Player1Name,
    team2_player2_name: m.team2Player2Name,
    team1_seed: null,
    team2_seed: null,
    team1_country: m.team1Country,
    team2_country: m.team2Country,
    set_scores: m.setScores,
    winner_team: m.winnerTeam,
    status: m.status,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .insert(rows);

  if (error) throw new Error(`draw_snapshots insert failed: ${error.message}`);
  return rows.length;
}

export async function runDrawFetcher(deps: DrawFetcherDeps): Promise<DrawFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalMatchesInserted = 0;
  for (const t of list) {
    for (const { category, drawType, code } of DRAW_TYPE_CODES) {
      let consecutiveEmpty = 0;
      for (const round of ROUNDS_TO_TRY) {
        const inserted = await fetchOneDrawTypeRound(deps, t, category, drawType, code, round);
        totalMatchesInserted += inserted;
        if (inserted === 0) {
          consecutiveEmpty++;
          if (consecutiveEmpty >= 2) break;  // assume past valid rounds for this drawType
        } else {
          consecutiveEmpty = 0;
        }
      }
    }
  }

  return {
    tournamentsProcessed: list.length,
    totalMatchesInserted,
  };
}
```

- [ ] **Step 4: Confirm PASS (2/2)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/draw-fetcher.ts padelgod/src/__tests__/workers/draw-fetcher.test.ts
git commit -m "feat(padelgod): add draw-fetcher worker (4 draw types × N rounds per tournament)"
```

---

### Task 8: Crionet OOP parser

**Files:**
- Create: `padelgod/src/parsers/crionet-oop.ts`
- Create: `padelgod/src/__tests__/parsers/crionet-oop.test.ts`

The widget endpoint `/screen/oopbyday/{CODE}/{day}?t=tol` returns one HTML table per court. Each table contains scheduled matches with player names, court, scheduled label, and a `data-id` attribute (the widget's match ID like `MQ012`).

Re-uses much of the draw parser pattern but extracts the day-cursored OOP rows. Validated shape (from live data §3):

```html
<tr class="scorebox-header-scheduled">
  <th class="text-left"><span class="court-name">Starting at 10:00 AM</span></th>
  <th colspan="4" class="round-name text-right"><small><b>Men </b><div>Q2</div></small></th>
</tr>
<tr class="draw-item-container">
  <td class="team">...players...</td>
  <td colspan="4">...status / button with data-id="MQ012"...</td>
</tr>
```

The court name appears in `.tournament-name` for live matches and `.court-name` for scheduled. The "scheduled label" (`Starting at 10:00 AM` / `Followed by`) is in the same `.court-name` slot for scheduled matches.

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/parsers/crionet-oop.test.ts
import { describe, it, expect } from 'vitest';
import { parseCrionetOop } from '../../parsers/crionet-oop.js';

describe('parseCrionetOop', () => {
  it('parses a scheduled match row', () => {
    const html = `
      <table class="w-100">
        <tr class="scorebox-header-scheduled">
          <th><span class="court-name">Starting at 10:00 AM</span></th>
          <th><div class="round-name"><small><b>Men </b><div>Q2</div></small></div></th>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span>M. Sintes</span></div>
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span>D. Santigosa</span></div>
          </td>
          <td colspan="4">
            <a class="open" data-id="MQ012" data-year="2026" data-tid="1701" data-org="FIP">STATS</a>
          </td>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/FRA.jpg"/><span>B. Tison</span></div>
            <div><img class="flags" src="/images/flags/FRA.jpg"/><span>M. Joris</span></div>
          </td>
          <td colspan="4"></td>
        </tr>
      </table>
    `;
    const result = parseCrionetOop(html, 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dayNumber: 1,
      category: 'men',
      roundLabel: 'Q2',
      court: 'Starting at 10:00 AM',
      scheduledLabel: 'Starting at 10:00 AM',
      team1Player1Name: 'M. Sintes',
      team1Player2Name: 'D. Santigosa',
      team2Player1Name: 'B. Tison',
      team2Player2Name: 'M. Joris',
      matchWidgetId: 'MQ012',
      status: 'scheduled',
    });
  });

  it('returns empty array for "No schedule available"', () => {
    expect(parseCrionetOop('<h4 class="message">No schedule available</h4>', 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/parsers/crionet-oop.ts`**

```typescript
import * as cheerio from 'cheerio';

const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-scheduled, tr.scorebox-header-live, tr.scorebox-header-completed';
const COURT_LABEL_SELECTOR = '.court-name, .tournament-name';
const ROUND_BLOCK_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr.draw-item-container';
const TEAM_SELECTOR = 'td.team';
const PLAYER_LINE_SELECTOR = 'div';
const PLAYER_NAME_SELECTOR = 'span';
const STATS_BUTTON_SELECTOR = 'a.open';

export type Category = 'men' | 'women';
export type OopStatus = 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired';

export interface ParsedOopMatch {
  dayNumber: number;
  category: Category;
  roundLabel: string | null;
  court: string;
  scheduledLabel: string | null;
  team1Player1Name: string | null;
  team1Player2Name: string | null;
  team2Player1Name: string | null;
  team2Player2Name: string | null;
  matchWidgetId: string | null;
  status: OopStatus;
}

function statusFromHeaderClass(cls: string): OopStatus {
  if (cls.includes('completed')) return 'finished';
  if (cls.includes('live')) return 'live';
  return 'scheduled';
}

function parseCategoryFromRoundBlock($block: cheerio.Cheerio<any>): Category | null {
  const text = $block.text().trim().toLowerCase();
  if (text.startsWith('men')) return 'men';
  if (text.startsWith('women')) return 'women';
  return null;
}

function parseRoundLabel($block: cheerio.Cheerio<any>): string | null {
  // Extract content INSIDE the inner <div> after <b>Men/Women</b>
  const inner = $block.find('div').first().text().trim();
  return inner || null;
}

function parsePlayers($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1: string | null;
  player2: string | null;
} {
  const lines = td.find(PLAYER_LINE_SELECTOR);
  let p1: string | null = null;
  let p2: string | null = null;
  lines.each((idx, line) => {
    const text = $(line).find(PLAYER_NAME_SELECTOR).first().text().trim();
    if (!text) return;
    if (idx === 0) p1 = text;
    else if (idx === 1) p2 = text;
  });
  return { player1: p1, player2: p2 };
}

export function parseCrionetOop(html: string, dayNumber: number): ParsedOopMatch[] {
  const $ = cheerio.load(html);
  const out: ParsedOopMatch[] = [];

  $(TABLE_SELECTOR).each((_, table) => {
    const $t = $(table);
    const header = $t.find(HEADER_SELECTOR).first();
    if (header.length === 0) return;

    const headerClass = header.attr('class') ?? '';
    const status = statusFromHeaderClass(headerClass);
    const courtLabel = header.find(COURT_LABEL_SELECTOR).first().text().trim();
    const roundBlock = header.find(ROUND_BLOCK_SELECTOR).first();
    const category = parseCategoryFromRoundBlock(roundBlock);
    if (!category) return;
    const roundLabel = parseRoundLabel(roundBlock);

    const teamRows = $t.find(TEAM_ROW_SELECTOR);
    if (teamRows.length < 2) return;
    const team1Row = teamRows.eq(0);
    const team2Row = teamRows.eq(1);
    const team1 = parsePlayers($, team1Row.find(TEAM_SELECTOR).first());
    const team2 = parsePlayers($, team2Row.find(TEAM_SELECTOR).first());

    // The stats button (with data-id) lives in either team row
    const button = $t.find(STATS_BUTTON_SELECTOR).first();
    const matchWidgetId = button.attr('data-id') ?? null;

    out.push({
      dayNumber,
      category,
      roundLabel,
      court: courtLabel || 'Unknown',
      scheduledLabel: status === 'scheduled' ? courtLabel || null : null,
      team1Player1Name: team1.player1,
      team1Player2Name: team1.player2,
      team2Player1Name: team2.player1,
      team2Player2Name: team2.player2,
      matchWidgetId,
      status,
    });
  });

  return out;
}
```

- [ ] **Step 4: Confirm PASS (2/2)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/crionet-oop.ts padelgod/src/__tests__/parsers/crionet-oop.test.ts
git commit -m "feat(padelgod): add Crionet OOP parser"
```

---

### Task 9: OOP fetcher worker

**Files:**
- Create: `padelgod/src/workers/oop-fetcher.ts`
- Create: `padelgod/src/__tests__/workers/oop-fetcher.test.ts`

For each active tournament, iterate days 1..expected_days, fetch `/screen/oopbyday/{CODE}/{day}?t=tol`, insert to `padelgod.oop_snapshots`.

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/workers/oop-fetcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runOopFetcher } from '../../workers/oop-fetcher.js';

function fakeSupabase(activeTournaments: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: () => ({
      from: (t: string) => ({
        insert: (rows: any) => {
          if (t === 'oop_snapshots') {
            const arr = Array.isArray(rows) ? rows : [rows];
            inserted.push(...arr);
            return { data: arr, error: null };
          }
          if (t === 'scrape_jobs') {
            return { select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }) };
          }
          return { data: null, error: { message: 'unexpected' } };
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
            }),
          }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: activeTournaments, error: null })),
  };
}

describe('runOopFetcher', () => {
  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase([]);
    const httpClient = { get: vi.fn() };

    const result = await runOopFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(0);
  });

  it('iterates expected_days and stops on consecutive empty days', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 't1', tournament_name: 'X', widget_id: 'FIP-2026-1701', starts_at: null, ends_at: null, expected_days: 4 },
    ]);
    const httpClient = {
      get: vi.fn(async () => ({ data: '<h4 class="message">No schedule available</h4>' })),
    };

    const result = await runOopFetcher({ supabase: supabase as any, httpClient: httpClient as any });

    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalMatchesInserted).toBe(0);
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/workers/oop-fetcher.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetOop } from '../parsers/crionet-oop.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_OOP_VERSION } from '../lib/parser-versions.js';

export interface OopFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface OopFetcherResult {
  tournamentsProcessed: number;
  totalMatchesInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  widget_id: string;
  expected_days: number;
}

const URL_FOR = (code: string, day: number) =>
  `https://widget.matchscorerlive.com/screen/oopbyday/${code}/${day}?t=tol`;

async function getLatestScrapeJobId(
  supabase: SupabaseClient,
  tournamentId: string,
  targetUrl: string
): Promise<string | null> {
  const { data } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('target_url', targetUrl)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function fetchOneDay(
  deps: OopFetcherDeps,
  t: ActiveTournament,
  day: number
): Promise<number> {
  const targetUrl = URL_FOR(t.widget_id, day);
  let parsed: ReturnType<typeof parseCrionetOop> = [];

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'oop',
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_OOP_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseCrionetOop(body, day);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) return 0;

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) return 0;

  const rows = parsed.map((m) => ({
    scrape_job_id: scrapeJobId,
    tournament_id: t.tournament_id,
    day_number: m.dayNumber,
    category: m.category,
    round_label: m.roundLabel,
    court: m.court,
    scheduled_label: m.scheduledLabel,
    team1_player1_name: m.team1Player1Name,
    team1_player2_name: m.team1Player2Name,
    team2_player1_name: m.team2Player1Name,
    team2_player2_name: m.team2Player2Name,
    match_widget_id: m.matchWidgetId,
    status: m.status,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .insert(rows);

  if (error) throw new Error(`oop_snapshots insert failed: ${error.message}`);
  return rows.length;
}

export async function runOopFetcher(deps: OopFetcherDeps): Promise<OopFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalMatchesInserted = 0;
  for (const t of list) {
    let consecutiveEmpty = 0;
    const maxDay = Math.max(t.expected_days ?? 7, 7);
    for (let day = 1; day <= maxDay; day++) {
      const inserted = await fetchOneDay(deps, t, day);
      totalMatchesInserted += inserted;
      if (inserted === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) break;
      } else {
        consecutiveEmpty = 0;
      }
    }
  }

  return {
    tournamentsProcessed: list.length,
    totalMatchesInserted,
  };
}
```

- [ ] **Step 4: Confirm PASS (2/2)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/oop-fetcher.ts padelgod/src/__tests__/workers/oop-fetcher.test.ts
git commit -m "feat(padelgod): add oop-fetcher worker (per-day snapshots per tournament)"
```

---

### Task 10: Crionet results parser

**Files:**
- Create: `padelgod/src/parsers/crionet-results.ts`
- Create: `padelgod/src/__tests__/parsers/crionet-results.test.ts`

The widget endpoint `/screen/resultsbyday/{CODE}/{day}?t=tol` returns finished match results — same scorebox structure as the draw parser but always with `scorebox-header-completed` and final set scores filled in.

Most of the work mirrors the draw parser. To stay DRY without coupling them, we duplicate the parsing logic in this parser since the row shape differs slightly (no draw_position, has match-id button like OOP, includes set scores always).

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/parsers/crionet-results.test.ts
import { describe, it, expect } from 'vitest';
import { parseCrionetResults } from '../../parsers/crionet-results.js';

describe('parseCrionetResults', () => {
  it('parses a finished match row with set scores', () => {
    const html = `
      <table class="w-100">
        <tr class="scorebox-header-completed">
          <th><span class="court-name">Centre Court</span></th>
          <th><div class="round-name"><small><b>Men </b><div>Final</div></small></div></th>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span>L. Galan</span></div>
            <div><img class="flags" src="/images/flags/ARG.jpg"/><span>F. Chingotto</span></div>
          </td>
          <td class="set">7</td><td class="set">3</td><td class="set">7</td>
          <td colspan="1">
            <a class="open" data-id="MD001" data-year="2026" data-tid="1701" data-org="FIP">STATS</a>
          </td>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div><img class="flags" src="/images/flags/ESP.jpg"/><span class="winner">J. Lebron</span></div>
            <div><img class="flags" src="/images/flags/ARG.jpg"/><span class="winner">A. Tapia</span></div>
          </td>
          <td class="set">5</td><td class="set">6</td><td class="set">5</td>
        </tr>
      </table>
    `;
    const result = parseCrionetResults(html, 5);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      dayNumber: 5,
      category: 'men',
      roundLabel: 'Final',
      court: 'Centre Court',
      matchWidgetId: 'MD001',
      team1Player1Name: 'L. Galan',
      team2Player1Name: 'J. Lebron',
      setScores: '7-5 3-6 7-5',
      winnerTeam: 2,
      status: 'finished',
    });
  });

  it('returns empty array for "No results found"', () => {
    expect(parseCrionetResults('<h4 class="message">No results found</h4>', 1)).toEqual([]);
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/parsers/crionet-results.ts`**

```typescript
import * as cheerio from 'cheerio';

const TABLE_SELECTOR = 'table.w-100';
const HEADER_SELECTOR = 'tr.scorebox-header-completed';
const COURT_LABEL_SELECTOR = '.court-name, .tournament-name';
const ROUND_BLOCK_SELECTOR = '.round-name';
const TEAM_ROW_SELECTOR = 'tr.draw-item-container';
const TEAM_SELECTOR = 'td.team';
const PLAYER_LINE_SELECTOR = 'div';
const PLAYER_NAME_SELECTOR = 'span';
const SET_SELECTOR = 'td.set';
const STATS_BUTTON_SELECTOR = 'a.open';
const WINNER_CLASS = 'winner';

export type Category = 'men' | 'women';
export type ResultsStatus = 'finished' | 'walkover' | 'retired';

export interface ParsedResultsMatch {
  dayNumber: number;
  category: Category;
  roundLabel: string | null;
  court: string | null;
  matchWidgetId: string | null;
  team1Player1Name: string | null;
  team1Player2Name: string | null;
  team2Player1Name: string | null;
  team2Player2Name: string | null;
  setScores: string;
  winnerTeam: 1 | 2;
  status: ResultsStatus;
}

function parseCategoryFromRoundBlock($block: cheerio.Cheerio<any>): Category | null {
  const text = $block.text().trim().toLowerCase();
  if (text.startsWith('men')) return 'men';
  if (text.startsWith('women')) return 'women';
  return null;
}

function parseRoundLabel($block: cheerio.Cheerio<any>): string | null {
  const inner = $block.find('div').first().text().trim();
  return inner || null;
}

function parseTeam($: cheerio.CheerioAPI, td: cheerio.Cheerio<any>): {
  player1: string | null;
  player2: string | null;
  hasWinner: boolean;
} {
  const lines = td.find(PLAYER_LINE_SELECTOR);
  let p1: string | null = null;
  let p2: string | null = null;
  let hasWinner = false;
  lines.each((idx, line) => {
    const $line = $(line);
    const span = $line.find(PLAYER_NAME_SELECTOR).first();
    const text = span.text().trim();
    if (!text) return;
    if (span.hasClass(WINNER_CLASS)) hasWinner = true;
    if (idx === 0) p1 = text;
    else if (idx === 1) p2 = text;
  });
  return { player1: p1, player2: p2, hasWinner };
}

export function parseCrionetResults(html: string, dayNumber: number): ParsedResultsMatch[] {
  const $ = cheerio.load(html);
  const out: ParsedResultsMatch[] = [];

  $(TABLE_SELECTOR).each((_, table) => {
    const $t = $(table);
    const header = $t.find(HEADER_SELECTOR).first();
    if (header.length === 0) return;

    const court = header.find(COURT_LABEL_SELECTOR).first().text().trim() || null;
    const roundBlock = header.find(ROUND_BLOCK_SELECTOR).first();
    const category = parseCategoryFromRoundBlock(roundBlock);
    if (!category) return;
    const roundLabel = parseRoundLabel(roundBlock);

    const teamRows = $t.find(TEAM_ROW_SELECTOR);
    if (teamRows.length < 2) return;
    const team1Row = teamRows.eq(0);
    const team2Row = teamRows.eq(1);

    const team1 = parseTeam($, team1Row.find(TEAM_SELECTOR).first());
    const team2 = parseTeam($, team2Row.find(TEAM_SELECTOR).first());

    const team1Sets = team1Row.find(SET_SELECTOR).map((_, el) => $(el).text().trim()).get();
    const team2Sets = team2Row.find(SET_SELECTOR).map((_, el) => $(el).text().trim()).get();
    const sets: string[] = [];
    for (let i = 0; i < Math.max(team1Sets.length, team2Sets.length); i++) {
      const a = team1Sets[i] ?? '-';
      const b = team2Sets[i] ?? '-';
      if (a === '-' && b === '-') continue;
      sets.push(`${a}-${b}`);
    }
    if (sets.length === 0) return;
    const setScores = sets.join(' ');

    const winnerTeam: 1 | 2 = team1.hasWinner ? 1 : 2;
    const button = $t.find(STATS_BUTTON_SELECTOR).first();
    const matchWidgetId = button.attr('data-id') ?? null;

    out.push({
      dayNumber,
      category,
      roundLabel,
      court,
      matchWidgetId,
      team1Player1Name: team1.player1,
      team1Player2Name: team1.player2,
      team2Player1Name: team2.player1,
      team2Player2Name: team2.player2,
      setScores,
      winnerTeam,
      status: 'finished',
    });
  });

  return out;
}
```

- [ ] **Step 4: Confirm PASS (2/2)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/crionet-results.ts padelgod/src/__tests__/parsers/crionet-results.test.ts
git commit -m "feat(padelgod): add Crionet results parser"
```

---

### Task 11: Results fetcher worker

**Files:**
- Create: `padelgod/src/workers/results-fetcher.ts`
- Create: `padelgod/src/__tests__/workers/results-fetcher.test.ts`

Mirrors the OOP worker but inserts into `padelgod.results_snapshots`.

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/workers/results-fetcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runResultsFetcher } from '../../workers/results-fetcher.js';

function fakeSupabase(activeTournaments: any[]) {
  const inserted: any[] = [];
  return {
    inserted,
    schema: () => ({
      from: (t: string) => ({
        insert: (rows: any) => {
          if (t === 'results_snapshots') {
            const arr = Array.isArray(rows) ? rows : [rows];
            inserted.push(...arr);
            return { data: arr, error: null };
          }
          if (t === 'scrape_jobs') {
            return { select: () => ({ single: async () => ({ data: { id: 'job-uuid' }, error: null }) }) };
          }
          return { data: null, error: { message: 'unexpected' } };
        },
        update: () => ({ eq: () => ({ data: null, error: null }) }),
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: async () => ({ data: { id: 'job-uuid' }, error: null }) }),
            }),
          }),
        }),
      }),
    }),
    rpc: vi.fn(async () => ({ data: activeTournaments, error: null })),
  };
}

describe('runResultsFetcher', () => {
  it('returns 0 processed when no active tournaments', async () => {
    const supabase = fakeSupabase([]);
    const httpClient = { get: vi.fn() };
    const result = await runResultsFetcher({ supabase: supabase as any, httpClient: httpClient as any });
    expect(result.tournamentsProcessed).toBe(0);
  });

  it('iterates days and stops on consecutive empty', async () => {
    const supabase = fakeSupabase([
      { tournament_id: 't1', tournament_name: 'X', widget_id: 'FIP-2026-1701', starts_at: null, ends_at: null, expected_days: 4 },
    ]);
    const httpClient = {
      get: vi.fn(async () => ({ data: '<h4 class="message">No results found</h4>' })),
    };
    const result = await runResultsFetcher({ supabase: supabase as any, httpClient: httpClient as any });
    expect(result.tournamentsProcessed).toBe(1);
    expect(result.totalMatchesInserted).toBe(0);
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/workers/results-fetcher.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetResults } from '../parsers/crionet-results.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_RESULTS_VERSION } from '../lib/parser-versions.js';

export interface ResultsFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface ResultsFetcherResult {
  tournamentsProcessed: number;
  totalMatchesInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  widget_id: string;
  expected_days: number;
}

const URL_FOR = (code: string, day: number) =>
  `https://widget.matchscorerlive.com/screen/resultsbyday/${code}/${day}?t=tol`;

async function getLatestScrapeJobId(
  supabase: SupabaseClient,
  tournamentId: string,
  targetUrl: string
): Promise<string | null> {
  const { data } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('target_url', targetUrl)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function fetchOneDay(
  deps: ResultsFetcherDeps,
  t: ActiveTournament,
  day: number
): Promise<number> {
  const targetUrl = URL_FOR(t.widget_id, day);
  let parsed: ReturnType<typeof parseCrionetResults> = [];

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'oop',  // re-use OOP type for now; can split with new enum later
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_RESULTS_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseCrionetResults(body, day);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) return 0;

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) return 0;

  const rows = parsed.map((m) => ({
    scrape_job_id: scrapeJobId,
    tournament_id: t.tournament_id,
    day_number: m.dayNumber,
    category: m.category,
    round_label: m.roundLabel,
    court: m.court,
    match_widget_id: m.matchWidgetId,
    team1_player1_name: m.team1Player1Name,
    team1_player2_name: m.team1Player2Name,
    team2_player1_name: m.team2Player1Name,
    team2_player2_name: m.team2Player2Name,
    set_scores: m.setScores,
    winner_team: m.winnerTeam,
    status: m.status,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('results_snapshots')
    .insert(rows);

  if (error) throw new Error(`results_snapshots insert failed: ${error.message}`);
  return rows.length;
}

export async function runResultsFetcher(deps: ResultsFetcherDeps): Promise<ResultsFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalMatchesInserted = 0;
  for (const t of list) {
    let consecutiveEmpty = 0;
    const maxDay = Math.max(t.expected_days ?? 7, 7);
    for (let day = 1; day <= maxDay; day++) {
      const inserted = await fetchOneDay(deps, t, day);
      totalMatchesInserted += inserted;
      if (inserted === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 2) break;
      } else {
        consecutiveEmpty = 0;
      }
    }
  }

  return {
    tournamentsProcessed: list.length,
    totalMatchesInserted,
  };
}
```

- [ ] **Step 4: Confirm PASS (2/2)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/results-fetcher.ts padelgod/src/__tests__/workers/results-fetcher.test.ts
git commit -m "feat(padelgod): add results-fetcher worker (per-day snapshots per tournament)"
```

---

### Task 12: Tournament dictionary library (player resolution)

**Files:**
- Create: `padelgod/src/lib/tournament-dictionary.ts`
- Create: `padelgod/src/__tests__/lib/tournament-dictionary.test.ts`

Plan 4 needs to resolve abbreviated widget names ("J. Lebrón") to canonical FIP IDs. Plan 3 ships the library in pure-function form so it has unit-test coverage but is not yet wired into any worker. Plan 4's reconciler/live-poller will import it.

The library:
1. `buildTournamentDictionary(entryListPlayers): TournamentDictionary` — builds the in-memory dict from latest snapshot
2. `resolveShortName(dict, shortName, partnerHint?): ResolveResult` — returns `{ fipId, confidence, candidates }`

Confidence levels: `exact` (single match in dict), `pair_disambiguated` (multiple matches but partner narrows to one), `fuzzy` (token similarity), `unresolved`.

- [ ] **Step 1: Write failing test**

```typescript
// padelgod/src/__tests__/lib/tournament-dictionary.test.ts
import { describe, it, expect } from 'vitest';
import {
  buildTournamentDictionary,
  resolveShortName,
} from '../../lib/tournament-dictionary.js';

const PLAYERS = [
  { fipId: 'P001', name: 'Juan Lebron', country: 'ESP', partnerFipId: 'P002', partnerName: 'Federico Chingotto' },
  { fipId: 'P002', name: 'Federico Chingotto', country: 'ARG', partnerFipId: 'P001', partnerName: 'Juan Lebron' },
  { fipId: 'P003', name: 'Mario Lebron', country: 'ESP', partnerFipId: 'P004', partnerName: 'Other Partner' },
  { fipId: 'P004', name: 'Other Partner', country: 'ESP', partnerFipId: 'P003', partnerName: 'Mario Lebron' },
];

describe('buildTournamentDictionary + resolveShortName', () => {
  it('resolves a short name to single match (exact)', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    const result = resolveShortName(dict, 'F. Chingotto');
    expect(result.fipId).toBe('P002');
    expect(result.confidence).toBe('exact');
  });

  it('disambiguates by partner when ambiguous', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    const result = resolveShortName(dict, 'Lebron', 'F. Chingotto');
    expect(result.fipId).toBe('P001');
    expect(result.confidence).toBe('pair_disambiguated');
  });

  it('returns unresolved when ambiguous and no partner hint', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    const result = resolveShortName(dict, 'Lebron');
    expect(result.fipId).toBeNull();
    expect(result.confidence).toBe('unresolved');
    expect(result.candidates).toEqual(expect.arrayContaining(['P001', 'P003']));
  });

  it('returns unresolved when nothing matches', () => {
    const dict = buildTournamentDictionary(PLAYERS);
    const result = resolveShortName(dict, 'XYZNotAName');
    expect(result.fipId).toBeNull();
    expect(result.confidence).toBe('unresolved');
  });
});
```

- [ ] **Step 2: Confirm FAIL**

- [ ] **Step 3: Create `padelgod/src/lib/tournament-dictionary.ts`**

```typescript
// In-memory per-tournament player dictionary for resolving abbreviated widget
// names like "J. Lebrón" → canonical FIP IDs. Built fresh per worker invocation.

export interface DictionaryPlayer {
  fipId: string;
  name: string;
  country: string | null;
  partnerFipId?: string | null;
  partnerName?: string | null;
}

export interface TournamentDictionary {
  players: Map<string, DictionaryPlayer>;          // fipId → player
  byNormalizedSurname: Map<string, string[]>;       // normalized surname → fipIds
  byNormalizedFullName: Map<string, string[]>;      // normalized full name → fipIds
}

export type ResolveConfidence = 'exact' | 'pair_disambiguated' | 'fuzzy' | 'unresolved';

export interface ResolveResult {
  fipId: string | null;
  confidence: ResolveConfidence;
  candidates: string[];
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSurname(name: string): string {
  // "J. Lebron" → "lebron"  |  "Juan Lebron" → "lebron"  |  "Lebron" → "lebron"
  const norm = normalize(name);
  const parts = norm.split(' ');
  return parts[parts.length - 1] ?? norm;
}

export function buildTournamentDictionary(players: DictionaryPlayer[]): TournamentDictionary {
  const byFip = new Map<string, DictionaryPlayer>();
  const bySurname = new Map<string, string[]>();
  const byFullName = new Map<string, string[]>();

  for (const p of players) {
    byFip.set(p.fipId, p);

    const surname = extractSurname(p.name);
    if (surname) {
      const arr = bySurname.get(surname) ?? [];
      arr.push(p.fipId);
      bySurname.set(surname, arr);
    }

    const fullName = normalize(p.name);
    if (fullName) {
      const arr = byFullName.get(fullName) ?? [];
      arr.push(p.fipId);
      byFullName.set(fullName, arr);
    }
  }

  return { players: byFip, byNormalizedSurname: bySurname, byNormalizedFullName: byFullName };
}

export function resolveShortName(
  dict: TournamentDictionary,
  shortName: string,
  partnerHint?: string
): ResolveResult {
  if (!shortName) return { fipId: null, confidence: 'unresolved', candidates: [] };

  const normFull = normalize(shortName);
  const surname = extractSurname(shortName);

  // 1. Try full name match
  const fullMatches = dict.byNormalizedFullName.get(normFull) ?? [];
  if (fullMatches.length === 1) {
    return { fipId: fullMatches[0]!, confidence: 'exact', candidates: fullMatches };
  }

  // 2. Try surname match
  const surnameMatches = dict.byNormalizedSurname.get(surname) ?? [];
  if (surnameMatches.length === 0) {
    return { fipId: null, confidence: 'unresolved', candidates: [] };
  }
  if (surnameMatches.length === 1) {
    return { fipId: surnameMatches[0]!, confidence: 'exact', candidates: surnameMatches };
  }

  // 3. Multiple surname matches — try partner disambiguation
  if (partnerHint) {
    const partnerSurname = extractSurname(partnerHint);
    for (const fipId of surnameMatches) {
      const player = dict.players.get(fipId);
      if (!player?.partnerName) continue;
      const dictPartnerSurname = extractSurname(player.partnerName);
      if (dictPartnerSurname === partnerSurname) {
        return { fipId, confidence: 'pair_disambiguated', candidates: surnameMatches };
      }
    }
  }

  // 4. Multiple matches, no disambiguation — unresolved with candidates list
  return { fipId: null, confidence: 'unresolved', candidates: surnameMatches };
}
```

- [ ] **Step 4: Confirm PASS (4/4)**

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/tournament-dictionary.ts padelgod/src/__tests__/lib/tournament-dictionary.test.ts
git commit -m "feat(padelgod): add tournament-dictionary lib (player resolution + pair disambig)"
```

---

### Task 13: Wire new workers into scheduler + entry point

**Files:**
- Modify: `padelgod/src/scheduler.ts`
- Modify: `padelgod/src/lib/env.ts` — add 4 new enable flags
- Modify: `padelgod/.env.example`
- Modify: `padelgod/src/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add env flags to `padelgod/src/lib/env.ts`** (preserve existing fields, add these):

```typescript
ENABLE_ENTRY_LIST_FETCHER: z.coerce.boolean().default(true),
ENABLE_DRAW_FETCHER: z.coerce.boolean().default(true),
ENABLE_OOP_FETCHER: z.coerce.boolean().default(true),
ENABLE_RESULTS_FETCHER: z.coerce.boolean().default(true),
```

- [ ] **Step 2: Append to `padelgod/.env.example`:**

```
ENABLE_ENTRY_LIST_FETCHER=true
ENABLE_DRAW_FETCHER=true
ENABLE_OOP_FETCHER=true
ENABLE_RESULTS_FETCHER=true
```

- [ ] **Step 3: Update `padelgod/src/scheduler.ts`** — add the 4 new entries and flag fields:

Add imports near top:
```typescript
import { runEntryListFetcher } from './workers/entry-list-fetcher.js';
import { runDrawFetcher } from './workers/draw-fetcher.js';
import { runOopFetcher } from './workers/oop-fetcher.js';
import { runResultsFetcher } from './workers/results-fetcher.js';
```

Extend `SchedulerFlags`:
```typescript
export interface SchedulerFlags {
  enableTournamentDiscovery: boolean;
  enableWidgetCodeLookup: boolean;
  enablePlayerRankings: boolean;
  enablePlayerProfile: boolean;
  enableEntryListFetcher: boolean;
  enableDrawFetcher: boolean;
  enableOopFetcher: boolean;
  enableResultsFetcher: boolean;
}
```

Inside `buildSchedule`, add 4 new entries (after the existing player-profile entry):

```typescript
  if (flags.enableEntryListFetcher) {
    entries.push({
      name: 'entry-list-fetcher',
      cron: '45 * * * *',  // hourly at :45
      run: (deps) => runEntryListFetcher(deps),
    });
  }
  if (flags.enableDrawFetcher) {
    entries.push({
      name: 'draw-fetcher',
      cron: '20 */2 * * *',  // every 2 hours at :20
      run: (deps) => runDrawFetcher(deps),
    });
  }
  if (flags.enableOopFetcher) {
    entries.push({
      name: 'oop-fetcher',
      cron: '50 * * * *',  // hourly at :50
      run: (deps) => runOopFetcher(deps),
    });
  }
  if (flags.enableResultsFetcher) {
    entries.push({
      name: 'results-fetcher',
      cron: '55 * * * *',  // hourly at :55
      run: (deps) => runResultsFetcher(deps),
    });
  }
```

- [ ] **Step 4: Update `padelgod/src/__tests__/scheduler.test.ts`** to cover the new flags:

Replace the existing test with:
```typescript
import { describe, it, expect } from 'vitest';
import { buildSchedule } from '../scheduler.js';

const ALL_ENABLED = {
  enableTournamentDiscovery: true,
  enableWidgetCodeLookup: true,
  enablePlayerRankings: true,
  enablePlayerProfile: true,
  enableEntryListFetcher: true,
  enableDrawFetcher: true,
  enableOopFetcher: true,
  enableResultsFetcher: true,
};

describe('buildSchedule', () => {
  it('includes all 8 V1 workers when fully enabled', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const names = sched.map((s) => s.name);
    expect(names).toContain('tournament-discovery');
    expect(names).toContain('widget-code-lookup');
    expect(names).toContain('player-rankings');
    expect(names).toContain('player-profile');
    expect(names).toContain('entry-list-fetcher');
    expect(names).toContain('draw-fetcher');
    expect(names).toContain('oop-fetcher');
    expect(names).toContain('results-fetcher');
  });

  it('respects enable flags for static workers', () => {
    const sched = buildSchedule({
      ...ALL_ENABLED,
      enableEntryListFetcher: false,
      enableDrawFetcher: false,
      enableOopFetcher: false,
      enableResultsFetcher: false,
    });
    const names = sched.map((s) => s.name);
    expect(names).not.toContain('entry-list-fetcher');
    expect(names).not.toContain('draw-fetcher');
    expect(names).not.toContain('oop-fetcher');
    expect(names).not.toContain('results-fetcher');
  });
});
```

- [ ] **Step 5: Update `padelgod/src/index.ts`** — add the 4 new flags to the `buildSchedule({...})` call inside `if (env.ENABLE_SCHEDULER)`:

```typescript
    const schedule = buildSchedule({
      enableTournamentDiscovery: env.ENABLE_TOURNAMENT_DISCOVERY,
      enableWidgetCodeLookup: env.ENABLE_WIDGET_CODE_LOOKUP,
      enablePlayerRankings: env.ENABLE_PLAYER_RANKINGS,
      enablePlayerProfile: env.ENABLE_PLAYER_PROFILE,
      enableEntryListFetcher: env.ENABLE_ENTRY_LIST_FETCHER,
      enableDrawFetcher: env.ENABLE_DRAW_FETCHER,
      enableOopFetcher: env.ENABLE_OOP_FETCHER,
      enableResultsFetcher: env.ENABLE_RESULTS_FETCHER,
    });
```

- [ ] **Step 6: Run typecheck + all tests**

```bash
cd padelgod && npm run typecheck && npm test 2>&1 | tail -5
```
Expected: typecheck clean, all tests still pass.

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/scheduler.ts padelgod/src/lib/env.ts padelgod/.env.example \
        padelgod/src/__tests__/scheduler.test.ts padelgod/src/index.ts
git commit -m "feat(padelgod): wire 4 Plan 3 workers into scheduler with enable flags"
```

---

### Task 14: User applies new migrations + final local verification

**Files:** none modified.

- [ ] **Step 1: Run final local verification**

```bash
cd padelgod
npm run typecheck
npm test
npm run build
ls dist/workers/ dist/parsers/ dist/lib/
```
Expected: typecheck + tests + build all clean. `dist/workers/` should contain 8 workers (4 from Plan 2 + 4 from Plan 3). `dist/parsers/` should contain 8 parsers.

- [ ] **Step 2: USER ACTION — apply both new migrations to Supabase**

Apply in this order (the verification blocks will fail loudly if applied wrong):

1. `supabase/migrations/20260420000013_padelgod_static_snapshot_tables.sql`
2. `supabase/migrations/20260420000014_padelgod_active_tournaments_views.sql`

Either via:
- **CLI:** `supabase migration up`
- **Dashboard:** paste each file in SQL Editor, run

Then verify:
```sql
SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='padelgod' AND table_name='entry_list_snapshots') AS el,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='padelgod' AND table_name='draw_snapshots') AS d,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='padelgod' AND table_name='oop_snapshots') AS o,
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='padelgod' AND table_name='results_snapshots') AS r,
       EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='padelgod_active_tournaments_for_static_workers') AS fn;
```
All 5 should return `true`.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin <branch-name>
```

(Branch name set by controller during execution.)

- [ ] **Step 4: After PR merge — watch Railway deploy**

Look for the "Scheduler started (workers=8)" log line.

At the next `:20` of an even hour you should see `draw-fetcher` fire, then `entry-list-fetcher` at `:45`, `oop-fetcher` at `:50`, `results-fetcher` at `:55`.

After 1 hour, verify in Supabase:
```sql
SELECT job_type, COUNT(*) AS jobs, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS successes
FROM padelgod.scrape_jobs
WHERE started_at > NOW() - INTERVAL '90 minutes'
GROUP BY job_type;
```
Expected: rows for `discover` (entry-list reuses this), `draw`, `oop` (results reuses this) with most/all successes.

```sql
SELECT (SELECT COUNT(*) FROM padelgod.entry_list_snapshots WHERE captured_at > NOW() - INTERVAL '2 hours') AS el,
       (SELECT COUNT(*) FROM padelgod.draw_snapshots       WHERE captured_at > NOW() - INTERVAL '2 hours') AS d,
       (SELECT COUNT(*) FROM padelgod.oop_snapshots        WHERE captured_at > NOW() - INTERVAL '2 hours') AS o,
       (SELECT COUNT(*) FROM padelgod.results_snapshots    WHERE captured_at > NOW() - INTERVAL '2 hours') AS r;
```
Expected: counts > 0 if any active FIP-sourced tournament is in the date window AND has a widget_id_cache row.

---

## Definition of done

This plan is complete when **all** are true:

1. ✅ All 4 parsers have unit tests with realistic fixtures
2. ✅ All 4 workers have unit tests covering happy path + skip path
3. ✅ Tournament dictionary lib has unit tests (4 confidence levels)
4. ✅ Scheduler test updated for 8 workers
5. ✅ Both migrations applied to Supabase, verifications passed
6. ✅ Branch pushed, PR opened, CI green, Vercel green
7. ✅ Merged to main, Railway deploys, scheduler logs confirm 8 workers registered
8. ✅ Within ~1 hour after merge, snapshot tables show inserted rows for at least one active tournament

---

## What this plan deliberately does NOT do

- ❌ Reconciler that merges snapshots into canonical `tournament_draws` / `matches` / `sets` / `games` — that's Plan 4
- ❌ Live polling (continuous 6-8s) — Plan 4
- ❌ `/screen/getmatchstats` POST endpoint — Plan 4
- ❌ Match-creation logic when results reference matches not in `matches` table — Plan 4 reconciler
- ❌ Player creation from entry list (only inserts to entry_list_snapshots; players workflow uses player-rankings + player-profile from Plan 2) — Plan 4 reconciler
- ❌ Admin API to trigger workers manually or inspect snapshots — Plan 5
- ❌ The `tournament-dictionary` lib is built but NOT yet used in any worker — Plan 4 reconciler imports it

If you find yourself wanting to add any of these "while you're in there" — don't. Each scope creep weakens the test surface for the static layer.
