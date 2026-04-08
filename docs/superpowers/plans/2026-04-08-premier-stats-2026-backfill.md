# Premier Padel Stats 2026 Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pre-launch backfill of Premier Padel match stats for all 2026 Premier Tour + FIP Platinum/Gold matches, with a fully-wired Stats tab on match detail, in time for the April 13 launch.

**Architecture:** Two new Vercel cron endpoints (`premier-discovery` for entity linking, `premier-stats` for stats sync) populate a new `match_stats` table (composite PK `(match_id, set_number)`) via the existing `entity_external_ids` sidecar. A new `<MatchStatsView>` component on the existing Stats tab fetches from `/api/match-stats` and renders nested per-set pill tabs with three grouped stat sections (Service / Return / Total). Day-1 execution via manual curls; Vercel scheduling activates on day 2.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL + RLS + service role), TypeScript, Vitest, React 19.

**Spec:** `docs/superpowers/specs/2026-04-08-premier-stats-2026-backfill-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260409_match_stats.sql` | Create | `match_stats` table + RLS policies |
| `supabase/migrations/20260409_match_stats_unresolved.sql` | Create | `match_stats_unresolved` queue table + RLS |
| `src/lib/premier-api.ts` | Create | Thin REST client for premierpadel.com beforeauth API |
| `src/lib/premier-stats-parser.ts` | Create | Pure `PremierMatchDetail → MatchStatsRow[]` parser |
| `src/lib/source-matcher.ts` | Create | Token-subset matcher (extracted from merge script) |
| `src/lib/__fixtures__/premier-match-6190.json` | Create | Miami P1 SF full 3-set fixture |
| `src/lib/__fixtures__/premier-match-2set.json` | Create | 2-set straight-sets fixture |
| `src/lib/__fixtures__/premier-match-retired.json` | Create | Synthesized retired-match fixture |
| `src/lib/__tests__/premier-stats-parser.test.ts` | Create | Parser unit tests |
| `src/lib/__tests__/source-matcher.test.ts` | Create | Matcher unit tests |
| `src/app/api/cron/premier-discovery/route.ts` | Create | Weekly tournament + match linking cron |
| `src/app/api/cron/premier-stats/route.ts` | Create | Hourly stats sync cron |
| `src/app/api/match-stats/route.ts` | Create | GET endpoint for Stats tab |
| `src/components/MatchStatsView.tsx` | Create | Stats tab container component |
| `src/components/MatchStatsBar.tsx` | Create | Reusable side-by-side stat bar |
| `src/components/MatchStatsSetTabs.tsx` | Create | Per-set pill tab row |
| `src/app/match/[id]/page.tsx` | Modify | Replace `FinishedStatsSection` call with `<MatchStatsView>` |
| `scripts/merge-tournament-duplicates.ts` | Modify | Import helpers from new `source-matcher.ts` |
| `src/lib/source-priority.ts` | Modify | Add `'match.stats': ['premierpadel']` |
| `vercel.json` | Modify | Add cron entries (day 6 only) |
| `CLAUDE.md` | Modify | Document `premierpadel` as tertiary source |

**Branch:** All work lands on `claude/happy-lumiere` (current worktree branch). No main-branch modifications until final launch deploy.

**Manual steps required from the user:**
1. **Day 1:** Apply the two migrations via the Supabase dashboard SQL editor (this plan does NOT apply migrations automatically).
2. **Day 2:** Review `match_stats_unresolved` queue in Supabase and run manual link INSERTs for unresolved rows.
3. **Day 6:** Merge this branch to main for production deploy + confirm `SUPABASE_SERVICE_KEY` env var on Vercel matches local.

---

## Day 1 (Wed Apr 8): Migrations + API client + parser

**Exit criteria:** Parser unit tests green. Miami P1 SF (match `tournaments_match_id=6190`) has 4 rows in `match_stats` locally (verified in Supabase dashboard).

### Task 1: Migration — `match_stats` table

**Files:**
- Create: `supabase/migrations/20260409_match_stats.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260409_match_stats.sql`:

```sql
-- 20260409_match_stats.sql
-- Sidecar: per-match and per-set aggregate statistics, sourced from premierpadel.com.
-- Composite PK: (match_id, set_number) where set_number = 0 is the full-match
-- aggregate and 1..5 are individual sets.

CREATE TABLE IF NOT EXISTS public.match_stats (
  match_id    UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number  SMALLINT NOT NULL,
  PRIMARY KEY (match_id, set_number),

  -- Service stats (per team)
  team1_first_serve_won       INT,
  team1_first_serve_played    INT,
  team1_second_serve_won      INT,
  team1_second_serve_played   INT,
  team1_service_games         INT,
  team2_first_serve_won       INT,
  team2_first_serve_played    INT,
  team2_second_serve_won      INT,
  team2_second_serve_played   INT,
  team2_service_games         INT,

  -- Return stats (per team)
  team1_first_return_won      INT,
  team1_first_return_played   INT,
  team1_second_return_won     INT,
  team1_second_return_played  INT,
  team1_return_games          INT,
  team2_first_return_won      INT,
  team2_first_return_played   INT,
  team2_second_return_won     INT,
  team2_second_return_played  INT,
  team2_return_games          INT,

  -- Total points (ONLY populated on set_number = 0)
  team1_total_points_won      INT,
  team1_total_points_played   INT,
  team1_serve_points_won      INT,
  team1_serve_points_played   INT,
  team1_return_points_won     INT,
  team1_return_points_played  INT,
  team1_longest_streak        INT,
  team2_total_points_won      INT,
  team2_total_points_played   INT,
  team2_serve_points_won      INT,
  team2_serve_points_played   INT,
  team2_return_points_won     INT,
  team2_return_points_played  INT,
  team2_longest_streak        INT,

  -- Provenance
  source            TEXT NOT NULL DEFAULT 'premierpadel',
  source_match_id   TEXT NOT NULL,
  raw_payload       JSONB,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_stats_computed_at
  ON public.match_stats (computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_match_stats_source_match_id
  ON public.match_stats (source, source_match_id);

ALTER TABLE public.match_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read match_stats"
  ON public.match_stats FOR SELECT
  USING (true);

CREATE POLICY "Service role full access to match_stats"
  ON public.match_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

- [ ] **Step 2: Apply the migration via Supabase dashboard**

Open the Supabase SQL editor, paste the contents of `20260409_match_stats.sql`, click Run. Verify success with:

```sql
SELECT tablename FROM pg_tables WHERE tablename = 'match_stats';
-- Expected: 1 row returned
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260409_match_stats.sql
git commit -m "feat(db): add match_stats table for Premier Padel stats"
```

---

### Task 2: Migration — `match_stats_unresolved` queue

**Files:**
- Create: `supabase/migrations/20260409_match_stats_unresolved.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260409_match_stats_unresolved.sql`:

```sql
-- 20260409_match_stats_unresolved.sql
-- Queue for tournaments/matches that the auto-resolver couldn't link.
-- Resolved manually via Supabase SQL editor (see spec for exact queries).

CREATE TABLE IF NOT EXISTS public.match_stats_unresolved (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                 TEXT NOT NULL,
  source_kind            TEXT NOT NULL CHECK (source_kind IN ('tournament', 'match')),
  source_id              TEXT NOT NULL,
  source_payload         JSONB,
  candidate_count        INT NOT NULL DEFAULT 0,
  reason                 TEXT,
  resolved_at            TIMESTAMPTZ,
  resolved_match_id      UUID REFERENCES public.matches(id) ON DELETE SET NULL,
  resolved_tournament_id UUID REFERENCES public.tournaments(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_match_stats_unresolved_pending
  ON public.match_stats_unresolved (source, source_kind)
  WHERE resolved_at IS NULL;

ALTER TABLE public.match_stats_unresolved ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to match_stats_unresolved"
  ON public.match_stats_unresolved FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

- [ ] **Step 2: Apply the migration via Supabase dashboard**

Paste the SQL into the Supabase dashboard editor and run it. Verify:

```sql
SELECT tablename FROM pg_tables WHERE tablename = 'match_stats_unresolved';
-- Expected: 1 row
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260409_match_stats_unresolved.sql
git commit -m "feat(db): add match_stats_unresolved queue for manual linking"
```

---

### Task 3: Premier API client — types

**Files:**
- Create: `src/lib/premier-api.ts`

- [ ] **Step 1: Write the module header and type definitions**

Create `src/lib/premier-api.ts`:

```ts
// src/lib/premier-api.ts
//
// Thin REST client for premierpadel.com's public "beforeauth" API.
// All endpoints accept multipart/form-data and return { status: 1, data: ... }.
// No auth header required.
//
// Endpoints wrapped by this module:
// - gettournamentsdropdown         → list of 75 Premier tournaments with dates
// - gettournamnetupcomingmatches   → match list for a tournament (note: vendor typo)
// - gettournamentsmatchdetail      → full stats payload for a single match
//
// Usage:
//   const tournaments = await fetchPremierTournamentDropdown()
//   const matches = await fetchPremierUpcomingMatches(285)
//   const detail = await fetchPremierMatchDetail(6190)

const API_BASE = 'https://premierpadel.com/premierpadel/api/'

// ── Tournament types ──────────────────────────────────────────

export interface PremierTournamentSummary {
  tournaments_id: number
  full_name: string
  accommodation_start_date: string  // 'YYYY-MM-DD' or empty
  accommodation_end_date: string
  is_live: 'Yes' | 'No'
  is_recent_tournament: 'Yes' | 'No'
}

// ── Match-list types ──────────────────────────────────────────

export interface PremierUpcomingMatch {
  tournaments_match_id: number
  tournaments_id: number
  tournament_name?: string
  draw_type?: string
  round?: string
  round_name?: string
  team1_player_name?: string
  team1_partner_name?: string
  team2_player_name?: string
  team2_partner_player_name?: string
  is_bye?: 'Yes' | 'No'
  status?: string
  // Other fields exist but we only consume these
}

// ── Match-detail types (stats payload) ────────────────────────

export interface PremierStatRowTeam {
  title: string | number
  won: string | number
  played: string | number
  percentage: string | number
  is_winner: 'Yes' | 'No'
}

export interface PremierStatRow {
  title: string
  team_1: PremierStatRowTeam
  team_2: PremierStatRowTeam
}

export interface PremierMatchStateSection {
  title: string  // 'Match' | 'set 1' | 'set 2' | 'set 3' | ...
  service: PremierStatRow[]
  return: PremierStatRow[]
  total_points?: PremierStatRow[]
}

export interface PremierMatchScore {
  tournaments_match_id: number
  tournaments_id: number
  tournament_name: string
  court_name: string
  date: string
  start_time: string
  matchId: string
  draw_type: string
  team1_player_name: string
  team1_partner_name: string
  team2_player_name: string
  team2_partner_player_name: string
  is_bye: 'Yes' | 'No'
  round: string
  round_name: string
  winner_id: string
  status: string
  team1_score: Record<string, number | string | null>
  team2_score: Record<string, number | string | null>
}

export interface PremierMatchDetail {
  match_score: PremierMatchScore
  match_state: PremierMatchStateSection[]
}
```

- [ ] **Step 2: Commit the types**

```bash
git add src/lib/premier-api.ts
git commit -m "feat(premier): define types for Premier Padel API responses"
```

---

### Task 4: Premier API client — fetch helper

**Files:**
- Modify: `src/lib/premier-api.ts`

- [ ] **Step 1: Append the fetch helper with retry + timeout**

Append to `src/lib/premier-api.ts`:

```ts
// ── Fetch helper ──────────────────────────────────────────────

interface FetchOpts {
  retries?: number
  timeoutMs?: number
}

async function premierFetch<T>(
  endpoint: string,
  fields: Record<string, string | number>,
  opts: FetchOpts = {}
): Promise<T> {
  const { retries = 3, timeoutMs = 10000 } = opts
  const body = new FormData()
  for (const [k, v] of Object.entries(fields)) body.append(k, String(v))

  let lastErr: unknown
  for (let attempt = 0; attempt < retries; attempt++) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        body,
        signal: ctl.signal,
        cache: 'no-store',
      })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`Premier API ${endpoint} returned ${res.status}`)
      const json = (await res.json()) as { status: number; data: T }
      if (json.status !== 1) throw new Error(`Premier API ${endpoint} returned status=${json.status}`)
      return json.data
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      if (attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 250 * Math.pow(4, attempt)))
      }
    }
  }
  throw lastErr
}

// ── Throttle helper ──────────────────────────────────────────
// Wraps a promise-returning function with a trailing sleep. Use inside a
// for loop to space out requests (Premier's rate limits are undocumented).

export async function withThrottle<T>(fn: () => Promise<T>, ms = 200): Promise<T> {
  const result = await fn()
  await new Promise(r => setTimeout(r, ms))
  return result
}
```

- [ ] **Step 2: Append the three public endpoint wrappers**

Still in `src/lib/premier-api.ts`:

```ts
// ── Endpoint wrappers ────────────────────────────────────────

/**
 * Fetch the tournament dropdown list. Drops the "All" meta entry
 * (tournaments_id = 28) which is a filter placeholder, not a real tournament.
 */
export async function fetchPremierTournamentDropdown(lang = 'en'): Promise<PremierTournamentSummary[]> {
  const data = await premierFetch<PremierTournamentSummary[]>(
    'beforeauth/gettournamentsdropdown',
    { lang },
  )
  return Array.isArray(data) ? data.filter(t => t.tournaments_id !== 28) : []
}

/**
 * Fetch the match list for a single Premier tournament.
 * Note: endpoint name has a typo ("gettournamnet...") — that's vendor-side,
 * we mirror it exactly.
 */
export async function fetchPremierUpcomingMatches(
  tournamentsId: number,
): Promise<PremierUpcomingMatch[]> {
  const data = await premierFetch<{ tournaments_match: PremierUpcomingMatch[] }>(
    'beforeauth/gettournamnetupcomingmatches',
    { tournaments_id: tournamentsId },
  )
  return Array.isArray(data?.tournaments_match) ? data.tournaments_match : []
}

/**
 * Fetch the full stats payload for a single match.
 * Returns null when the match ID is not recognized (Premier returns
 * {status:1, data:[]} for unknown IDs rather than an error).
 */
export async function fetchPremierMatchDetail(
  matchId: number,
  lang = 'en',
): Promise<PremierMatchDetail | null> {
  try {
    const data = await premierFetch<PremierMatchDetail | unknown[]>(
      'beforeauth/gettournamentsmatchdetail',
      { tournaments_match_id: matchId, lang },
    )
    if (Array.isArray(data)) return null
    return data
  } catch (err) {
    console.error(`[premier-api] match detail ${matchId} failed:`, err)
    return null
  }
}
```

- [ ] **Step 3: Verify the file compiles**

Run:

```bash
npx tsc --noEmit src/lib/premier-api.ts 2>&1 | head -30
```

Expected: no errors from `premier-api.ts` (unrelated errors from other files are OK — we're only compiling this one).

- [ ] **Step 4: Commit**

```bash
git add src/lib/premier-api.ts
git commit -m "feat(premier): add REST client with retry + throttle for Premier Padel API"
```

---

### Task 5: Capture Premier match-detail fixtures

**Files:**
- Create: `src/lib/__fixtures__/premier-match-6190.json`
- Create: `src/lib/__fixtures__/premier-match-2set.json`
- Create: `src/lib/__fixtures__/premier-match-retired.json`

- [ ] **Step 1: Download the Miami P1 SF (3-set) fixture**

Run:

```bash
curl -s -X POST 'https://premierpadel.com/premierpadel/api/beforeauth/gettournamentsmatchdetail' \
  -F 'tournaments_match_id=6190' -F 'lang=en' \
  | python3 -m json.tool > src/lib/__fixtures__/premier-match-6190.json
wc -c src/lib/__fixtures__/premier-match-6190.json
```

Expected: ~8-10 KB file.

- [ ] **Step 2: Spot-check the fixture**

```bash
python3 -c "
import json
d = json.load(open('src/lib/__fixtures__/premier-match-6190.json'))
ms = d['data']['match_score']
print('match:', ms['tournament_name'], ms['round_name'])
print('players:', ms['team1_player_name'], '/', ms['team1_partner_name'],
      'vs', ms['team2_player_name'], '/', ms['team2_partner_player_name'])
print('sets in match_state:', len(d['data']['match_state']))
"
```

Expected:
```
match: MIAMI P1 Men SF
players: Stupaczuk / Yanguas vs Galan / Chingotto
sets in match_state: 4
```

- [ ] **Step 3: Download a 2-set match fixture**

Find a 2-set match by sampling match IDs. Try `tournaments_match_id=6100`:

```bash
curl -s -X POST 'https://premierpadel.com/premierpadel/api/beforeauth/gettournamentsmatchdetail' \
  -F 'tournaments_match_id=6100' -F 'lang=en' \
  | python3 -m json.tool > src/lib/__fixtures__/premier-match-2set.json

python3 -c "
import json
d = json.load(open('src/lib/__fixtures__/premier-match-2set.json'))
sets = [s for s in d['data']['match_state'] if s['title'].startswith('set')]
print('sets:', len(sets))
print('round:', d['data']['match_score']['round_name'])
"
```

Expected:
```
sets: 2
round: Women Q1
```

If the ID happens to be a 3-set match, try 6101, 6102, 6103 etc. until you find a 2-set one.

- [ ] **Step 4: Synthesize a retired-match fixture**

Create `src/lib/__fixtures__/premier-match-retired.json` by copying the 6190 fixture and zeroing out set 3 stats:

```bash
python3 << 'PY'
import json
with open('src/lib/__fixtures__/premier-match-6190.json') as f:
    d = json.load(f)

# Find the "set 3" section and zero all its stat values (simulate retired mid-set)
for section in d['data']['match_state']:
    if section['title'] == 'set 3':
        for category in ['service', 'return']:
            for row in section.get(category, []):
                for team in ['team_1', 'team_2']:
                    for key in ['title', 'won', 'played', 'percentage']:
                        if key in row[team] and row[team][key] != '':
                            row[team][key] = 0 if isinstance(row[team][key], (int, float)) else '0'

with open('src/lib/__fixtures__/premier-match-retired.json', 'w') as f:
    json.dump(d, f, indent=2)
print('retired fixture written')
PY
```

- [ ] **Step 5: Commit all three fixtures**

```bash
git add src/lib/__fixtures__/premier-match-6190.json \
        src/lib/__fixtures__/premier-match-2set.json \
        src/lib/__fixtures__/premier-match-retired.json
git commit -m "test(premier): add frozen match-detail fixtures for parser tests"
```

---

### Task 6: Parser — types + signature

**Files:**
- Create: `src/lib/premier-stats-parser.ts`

- [ ] **Step 1: Write the row type + signature + empty skeleton**

Create `src/lib/premier-stats-parser.ts`:

```ts
// src/lib/premier-stats-parser.ts
//
// Pure function: PremierMatchDetail → MatchStatsRow[]
// Returns one row per section in match_state:
//   - set_number = 0 for the 'Match' aggregate
//   - set_number = 1..5 for individual sets
//
// The 'total_points' category only exists on the 'Match' section, so per-set
// rows have NULL for all total_* columns. The raw_payload is stored only on
// the set_number = 0 row to avoid duplication.

import type { PremierMatchDetail, PremierStatRow } from './premier-api'

export interface MatchStatsRow {
  set_number: number

  // Service stats
  team1_first_serve_won: number | null
  team1_first_serve_played: number | null
  team1_second_serve_won: number | null
  team1_second_serve_played: number | null
  team1_service_games: number | null
  team2_first_serve_won: number | null
  team2_first_serve_played: number | null
  team2_second_serve_won: number | null
  team2_second_serve_played: number | null
  team2_service_games: number | null

  // Return stats
  team1_first_return_won: number | null
  team1_first_return_played: number | null
  team1_second_return_won: number | null
  team1_second_return_played: number | null
  team1_return_games: number | null
  team2_first_return_won: number | null
  team2_first_return_played: number | null
  team2_second_return_won: number | null
  team2_second_return_played: number | null
  team2_return_games: number | null

  // Total points (null on per-set rows)
  team1_total_points_won: number | null
  team1_total_points_played: number | null
  team1_serve_points_won: number | null
  team1_serve_points_played: number | null
  team1_return_points_won: number | null
  team1_return_points_played: number | null
  team1_longest_streak: number | null
  team2_total_points_won: number | null
  team2_total_points_played: number | null
  team2_serve_points_won: number | null
  team2_serve_points_played: number | null
  team2_return_points_won: number | null
  team2_return_points_played: number | null
  team2_longest_streak: number | null
}

// Coerce Premier's mixed string/number/empty values to nullable numbers.
function num(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

// Find a named stat row inside a section category.
function findStat(
  rows: PremierStatRow[] | undefined,
  title: string,
): PremierStatRow | undefined {
  return rows?.find(s => s.title === title)
}

export function parseMatchStatsPayload(
  payload: PremierMatchDetail | null | undefined,
): MatchStatsRow[] | null {
  // Implementation in next task
  return null
}
```

- [ ] **Step 2: Commit the skeleton**

```bash
git add src/lib/premier-stats-parser.ts
git commit -m "feat(premier): scaffold parser module with row type + signature"
```

---

### Task 7: Parser — write the failing test

**Files:**
- Create: `src/lib/__tests__/premier-stats-parser.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/lib/__tests__/premier-stats-parser.test.ts`:

```ts
// src/lib/__tests__/premier-stats-parser.test.ts

import { describe, it, expect } from 'vitest'
import { parseMatchStatsPayload } from '../premier-stats-parser'
import fixture6190 from '../__fixtures__/premier-match-6190.json'
import fixture2set from '../__fixtures__/premier-match-2set.json'

// The fixtures are stored as full API responses { status, data: {...} }
// The parser expects just the `data` object.
const payload6190 = (fixture6190 as { data: unknown }).data
const payload2set = (fixture2set as { data: unknown }).data

describe('parseMatchStatsPayload', () => {
  it('returns null when payload is null', () => {
    expect(parseMatchStatsPayload(null)).toBeNull()
  })

  it('returns null when payload is undefined', () => {
    expect(parseMatchStatsPayload(undefined)).toBeNull()
  })

  it('returns null when match_state is empty', () => {
    expect(parseMatchStatsPayload({ match_state: [] } as never)).toBeNull()
  })

  it('returns null when match_state is missing', () => {
    expect(parseMatchStatsPayload({} as never)).toBeNull()
  })

  it('parses the Miami P1 SF fixture into 4 rows', () => {
    // Match + set 1 + set 2 + set 3
    const rows = parseMatchStatsPayload(payload6190 as never)
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(4)
    const setNumbers = rows!.map(r => r.set_number).sort()
    expect(setNumbers).toEqual([0, 1, 2, 3])
  })

  it('extracts Miami P1 SF aggregate stats correctly (spot check)', () => {
    const rows = parseMatchStatsPayload(payload6190 as never)
    const agg = rows!.find(r => r.set_number === 0)!
    // Values taken from a manual inspection of the fixture
    expect(agg.team1_first_serve_won).toBe(23)
    expect(agg.team1_first_serve_played).toBe(41)
    expect(agg.team2_first_serve_won).toBe(28)
    expect(agg.team2_first_serve_played).toBe(39)
    expect(agg.team1_total_points_won).toBe(39)
    expect(agg.team2_total_points_won).toBe(55)
    expect(agg.team2_longest_streak).toBe(7)
  })

  it('sets total_points fields to null on per-set rows', () => {
    const rows = parseMatchStatsPayload(payload6190 as never)
    const set1 = rows!.find(r => r.set_number === 1)!
    expect(set1.team1_total_points_won).toBeNull()
    expect(set1.team2_total_points_won).toBeNull()
    expect(set1.team1_longest_streak).toBeNull()
    expect(set1.team2_longest_streak).toBeNull()
  })

  it('populates service and return stats on per-set rows', () => {
    const rows = parseMatchStatsPayload(payload6190 as never)
    const set1 = rows!.find(r => r.set_number === 1)!
    // Service/return should be non-null on per-set rows
    expect(set1.team1_first_serve_won).not.toBeNull()
    expect(set1.team2_first_serve_won).not.toBeNull()
    expect(set1.team1_service_games).not.toBeNull()
  })

  it('parses a 2-set match into 3 rows (Match + set 1 + set 2)', () => {
    const rows = parseMatchStatsPayload(payload2set as never)
    expect(rows!.length).toBe(3)
    expect(rows!.map(r => r.set_number).sort()).toEqual([0, 1, 2])
  })

  it('coerces empty strings to null', () => {
    const payload = {
      match_state: [{
        title: 'Match',
        service: [{
          title: 'First Serve Points Won',
          team_1: { title: '', won: '', played: '', percentage: '', is_winner: 'No' },
          team_2: { title: '', won: '', played: '', percentage: '', is_winner: 'No' },
        }],
        return: [],
        total_points: [],
      }],
    }
    const rows = parseMatchStatsPayload(payload as never)
    expect(rows).not.toBeNull()
    expect(rows![0].team1_first_serve_won).toBeNull()
    expect(rows![0].team1_first_serve_played).toBeNull()
  })

  it('skips malformed sections with invalid titles', () => {
    const payload = {
      match_state: [
        { title: 'Match', service: [], return: [], total_points: [] },
        { title: 'garbage title', service: [], return: [] },
      ],
    }
    const rows = parseMatchStatsPayload(payload as never)
    expect(rows).not.toBeNull()
    expect(rows!.length).toBe(1)
    expect(rows![0].set_number).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

```bash
npx vitest run src/lib/__tests__/premier-stats-parser.test.ts 2>&1 | tail -30
```

Expected: all tests FAIL (parser currently returns `null` for everything).

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/lib/__tests__/premier-stats-parser.test.ts
git commit -m "test(premier): add failing parser tests"
```

---

### Task 8: Parser — implementation

**Files:**
- Modify: `src/lib/premier-stats-parser.ts`

- [ ] **Step 1: Replace the empty `parseMatchStatsPayload` body with the real implementation**

Open `src/lib/premier-stats-parser.ts` and replace:

```ts
export function parseMatchStatsPayload(
  payload: PremierMatchDetail | null | undefined,
): MatchStatsRow[] | null {
  // Implementation in next task
  return null
}
```

with:

```ts
export function parseMatchStatsPayload(
  payload: PremierMatchDetail | null | undefined,
): MatchStatsRow[] | null {
  if (!payload) return null
  const sections = payload.match_state
  if (!Array.isArray(sections) || sections.length === 0) return null

  const rows: MatchStatsRow[] = []

  for (const section of sections) {
    // Parse set number from title: 'Match' → 0, 'set 1' → 1, etc.
    let setNumber: number
    if (section.title === 'Match') {
      setNumber = 0
    } else {
      const m = /^set\s+(\d+)$/i.exec(section.title ?? '')
      if (!m) continue  // Skip malformed section titles
      setNumber = parseInt(m[1], 10)
      if (!Number.isFinite(setNumber)) continue
    }

    const fs = findStat(section.service, 'First Serve Points Won')
    const ss = findStat(section.service, 'Second Serve Points Won')
    const sg = findStat(section.service, 'Services Games Played')
    const fr = findStat(section.return, 'First Return Points Won')
    const sr = findStat(section.return, 'Second Return Points Won')
    const rg = findStat(section.return, 'Return Games Played')
    // Total points only appear on the 'Match' section (set_number = 0)
    const tp = setNumber === 0 ? findStat(section.total_points, 'Total Points Won') : undefined
    const tsp = setNumber === 0 ? findStat(section.total_points, 'Total Serve Points Won') : undefined
    const trp = setNumber === 0 ? findStat(section.total_points, 'Total Return Points Won') : undefined
    const lps = setNumber === 0 ? findStat(section.total_points, 'Longest Points Won Streak') : undefined

    rows.push({
      set_number: setNumber,

      // Service
      team1_first_serve_won: num(fs?.team_1.won),
      team1_first_serve_played: num(fs?.team_1.played),
      team2_first_serve_won: num(fs?.team_2.won),
      team2_first_serve_played: num(fs?.team_2.played),
      team1_second_serve_won: num(ss?.team_1.won),
      team1_second_serve_played: num(ss?.team_1.played),
      team2_second_serve_won: num(ss?.team_2.won),
      team2_second_serve_played: num(ss?.team_2.played),
      team1_service_games: num(sg?.team_1.title),
      team2_service_games: num(sg?.team_2.title),

      // Return
      team1_first_return_won: num(fr?.team_1.won),
      team1_first_return_played: num(fr?.team_1.played),
      team2_first_return_won: num(fr?.team_2.won),
      team2_first_return_played: num(fr?.team_2.played),
      team1_second_return_won: num(sr?.team_1.won),
      team1_second_return_played: num(sr?.team_1.played),
      team2_second_return_won: num(sr?.team_2.won),
      team2_second_return_played: num(sr?.team_2.played),
      team1_return_games: num(rg?.team_1.title),
      team2_return_games: num(rg?.team_2.title),

      // Total points (null on per-set rows because tp/tsp/trp/lps are undefined there)
      team1_total_points_won: num(tp?.team_1.won),
      team1_total_points_played: num(tp?.team_1.played),
      team2_total_points_won: num(tp?.team_2.won),
      team2_total_points_played: num(tp?.team_2.played),
      team1_serve_points_won: num(tsp?.team_1.won),
      team1_serve_points_played: num(tsp?.team_1.played),
      team2_serve_points_won: num(tsp?.team_2.won),
      team2_serve_points_played: num(tsp?.team_2.played),
      team1_return_points_won: num(trp?.team_1.won),
      team1_return_points_played: num(trp?.team_1.played),
      team2_return_points_won: num(trp?.team_2.won),
      team2_return_points_played: num(trp?.team_2.played),
      team1_longest_streak: num(lps?.team_1.title),
      team2_longest_streak: num(lps?.team_2.title),
    })
  }

  return rows.length > 0 ? rows : null
}
```

- [ ] **Step 2: Run tests — expect all green**

```bash
npx vitest run src/lib/__tests__/premier-stats-parser.test.ts 2>&1 | tail -20
```

Expected: `10 passed (10)`.

If the Miami P1 SF spot check fails because the numbers differ from what I wrote, inspect the fixture and adjust the test expectations to match the actual fixture values (Premier data may have been updated since my research session):

```bash
python3 -c "
import json
d = json.load(open('src/lib/__fixtures__/premier-match-6190.json'))
match = next(s for s in d['data']['match_state'] if s['title'] == 'Match')
for stat in match['service']:
    print(stat['title'], stat['team_1'].get('won'), '/', stat['team_1'].get('played'),
          '|', stat['team_2'].get('won'), '/', stat['team_2'].get('played'))
"
```

- [ ] **Step 3: Commit the implementation**

```bash
git add src/lib/premier-stats-parser.ts
git commit -m "feat(premier): implement parseMatchStatsPayload"
```

---

### Task 9: Day-1 end-to-end verification (Miami P1 SF)

**Files:** none (this is a verification task)

- [ ] **Step 1: Write a temporary backfill test script**

Create `scripts/test-premier-backfill-one.ts`:

```ts
// scripts/test-premier-backfill-one.ts
// Temporary day-1 verification script. Fetches Miami P1 SF stats,
// parses them, and inserts into match_stats. DELETED after day-1.
//
// Usage:
//   node --experimental-strip-types scripts/test-premier-backfill-one.ts

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'
import { fetchPremierMatchDetail } from '../src/lib/premier-api'
import { parseMatchStatsPayload } from '../src/lib/premier-stats-parser'

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}
loadEnv()

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

async function main() {
  // Step 1: Find a Miami P1 SF match in our DB via player names. We manually
  // pick one match ID from the DB for this verification step.
  // Search for the Stupaczuk/Yanguas SF on Miami P1 2026
  const { data: matches } = await sb
    .from('matches')
    .select('id, round, category, tournament:tournaments(name)')
    .eq('tournament_id', (
      await sb.from('tournaments').select('id').eq('name', 'Miami P1 2026').single()
    ).data?.id)
    .eq('round', 'SF')
    .eq('category', 'men')

  if (!matches?.length) {
    console.error('No Miami P1 2026 Men SF matches found in DB')
    process.exit(1)
  }

  // Just use the first SF match for the smoke test — we only need one row
  const ourMatchId = matches[0].id
  console.log('Using our match_id:', ourMatchId)

  // Step 2: Fetch the Premier stats for match 6190
  const detail = await fetchPremierMatchDetail(6190)
  if (!detail) {
    console.error('Premier returned null for match 6190')
    process.exit(1)
  }
  console.log('Fetched Premier detail for:', detail.match_score.tournament_name,
              detail.match_score.round_name)

  // Step 3: Parse
  const rows = parseMatchStatsPayload(detail)
  if (!rows) {
    console.error('Parser returned null')
    process.exit(1)
  }
  console.log('Parsed', rows.length, 'rows')

  // Step 4: Upsert with our real match_id
  const toUpsert = rows.map(row => ({
    ...row,
    match_id: ourMatchId,
    source: 'premierpadel',
    source_match_id: '6190',
    raw_payload: row.set_number === 0 ? detail : null,
  }))

  const { error } = await sb.from('match_stats').upsert(toUpsert, {
    onConflict: 'match_id,set_number',
  })
  if (error) {
    console.error('Upsert error:', error)
    process.exit(1)
  }
  console.log('Upserted', toUpsert.length, 'rows into match_stats')

  // Step 5: Verify
  const { data: stored } = await sb
    .from('match_stats')
    .select('set_number, team1_first_serve_won, team1_first_serve_played')
    .eq('match_id', ourMatchId)
    .order('set_number')
  console.log('Stored rows:', stored)
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the script**

```bash
node --experimental-strip-types scripts/test-premier-backfill-one.ts
```

Expected output (shape):
```
Using our match_id: <uuid>
Fetched Premier detail for: MIAMI P1 Men SF
Parsed 4 rows
Upserted 4 rows into match_stats
Stored rows: [
  { set_number: 0, team1_first_serve_won: 23, team1_first_serve_played: 41 },
  { set_number: 1, team1_first_serve_won: ..., team1_first_serve_played: ... },
  { set_number: 2, ... },
  { set_number: 3, ... },
]
```

If it fails because "No Miami P1 2026 Men SF matches found in DB", pick a different tournament/round. Find any finished men's match in a Premier tournament:

```bash
# Fallback: dump all finished Premier matches to pick one
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('matches').select('id,round,category,tournament:tournaments(name,level)').eq('status','finished').limit(5).then(r => console.log(r.data));
"
```

- [ ] **Step 3: Delete the temporary script**

```bash
rm scripts/test-premier-backfill-one.ts
```

- [ ] **Step 4: Commit the cleanup**

```bash
git add -u scripts/test-premier-backfill-one.ts
git commit -m "chore: remove day-1 backfill verification script"
```

**Day 1 exit criteria verified:** parser tests green, real Premier stats in Supabase for one match.

---

## Day 2 (Thu Apr 9): Source matcher + discovery cron

**Exit criteria:** `premier-discovery` cron triggered via curl, links ≥35 tournaments and ≥300 matches. You've reviewed the unresolved queue in Supabase and manually linked any stragglers via SQL.

### Task 10: Source matcher — write the failing tests

**Files:**
- Create: `src/lib/__tests__/source-matcher.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/lib/__tests__/source-matcher.test.ts`:

```ts
// src/lib/__tests__/source-matcher.test.ts

import { describe, it, expect } from 'vitest'
import { tokenize, isTokenSubset, resolveSingleCandidate, yearOf } from '../source-matcher'

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumerics', () => {
    expect(tokenize('Newgiza P2 2026')).toEqual(['newgiza', 'p2'])
  })

  it('strips diacritics', () => {
    expect(tokenize('GIJÓN P2')).toEqual(['gijon', 'p2'])
  })

  it('strips 4-digit years', () => {
    expect(tokenize('Newgiza P2 2026')).toEqual(['newgiza', 'p2'])
    expect(tokenize('Brussels P2 1999')).toEqual(['brussels', 'p2'])
  })

  it('filters noise tokens (premier, padel, tour, etc.)', () => {
    const tokens = tokenize('LOTTO BRUSSELS PREMIER PADEL P2 PRESENTED BY BELFIUS')
    // 'premier', 'padel', 'presented', 'by' should be filtered
    expect(tokens).toContain('brussels')
    expect(tokens).toContain('p2')
    expect(tokens).not.toContain('premier')
    expect(tokens).not.toContain('padel')
    expect(tokens).not.toContain('presented')
    expect(tokens).not.toContain('by')
  })

  it('returns empty array for null/undefined/empty', () => {
    expect(tokenize(null)).toEqual([])
    expect(tokenize(undefined)).toEqual([])
    expect(tokenize('')).toEqual([])
  })
})

describe('isTokenSubset', () => {
  it('matches "Newgiza P2" inside "NEWGIZA P2"', () => {
    expect(isTokenSubset('NEWGIZA P2', 'Newgiza P2 2026')).toBe(true)
  })

  it('matches "Brussels P2" inside sponsored name', () => {
    expect(isTokenSubset(
      'Brussels P2',
      'Lotto Brussels Premier Padel P2 Presented By Belfius',
    )).toBe(true)
  })

  it('rejects different tiers (P1 vs P2)', () => {
    expect(isTokenSubset('Riyadh P1', 'Riyadh P2')).toBe(false)
    expect(isTokenSubset('Riyadh P2', 'Riyadh P1')).toBe(false)
  })

  it('rejects mismatched base names', () => {
    expect(isTokenSubset('Brussels P2', 'Madrid P2')).toBe(false)
  })

  it('returns true when all tokens of haystack are in needle (reverse subset)', () => {
    // Needle "Big Sponsor Miami P1 2026" is a supertset of "MIAMI P1"
    expect(isTokenSubset('Big Sponsor Miami P1 2026', 'MIAMI P1')).toBe(true)
  })
})

describe('yearOf', () => {
  it('extracts year from ISO date string', () => {
    expect(yearOf('2026-03-01')).toBe(2026)
    expect(yearOf('2026-03-01T10:00:00Z')).toBe(2026)
  })

  it('returns null for empty/null/invalid dates', () => {
    expect(yearOf(null)).toBeNull()
    expect(yearOf('')).toBeNull()
    expect(yearOf('not-a-date')).toBeNull()
  })
})

describe('resolveSingleCandidate', () => {
  const candidates = [
    { id: 'A', name: 'Newgiza P2 2026', starts_at: '2026-04-13' },
    { id: 'B', name: 'Miami P1 2026', starts_at: '2026-03-23' },
    { id: 'C', name: 'Brussels P2 2025', starts_at: '2025-04-15' },
  ]

  it('picks single year-matched candidate', () => {
    const result = resolveSingleCandidate(
      { name: 'NEWGIZA P2', year: 2026 },
      candidates,
    )
    expect(result.match?.id).toBe('A')
    expect(result.reason).toBe('single')
  })

  it('returns null when no candidate matches', () => {
    const result = resolveSingleCandidate(
      { name: 'FAKE TOURNAMENT', year: 2026 },
      candidates,
    )
    expect(result.match).toBeNull()
    expect(result.reason).toBe('no_candidate')
  })

  it('returns null when multiple candidates match', () => {
    const result = resolveSingleCandidate(
      { name: 'BRUSSELS P2', year: null },
      [
        { id: 'X', name: 'Brussels P2 2025', starts_at: '2025-04-15' },
        { id: 'Y', name: 'Brussels P2 2026', starts_at: '2026-04-20' },
      ],
    )
    expect(result.match).toBeNull()
    expect(result.reason).toBe('multiple_candidates')
  })

  it('filters by year when provided', () => {
    const result = resolveSingleCandidate(
      { name: 'BRUSSELS P2', year: 2025 },
      [
        { id: 'X', name: 'Brussels P2 2025', starts_at: '2025-04-15' },
        { id: 'Y', name: 'Brussels P2 2026', starts_at: '2026-04-20' },
      ],
    )
    expect(result.match?.id).toBe('X')
  })
})
```

- [ ] **Step 2: Run tests — expect all fail with import errors**

```bash
npx vitest run src/lib/__tests__/source-matcher.test.ts 2>&1 | tail -15
```

Expected: fail with `Cannot find module '../source-matcher'` or similar.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/source-matcher.test.ts
git commit -m "test(matcher): add failing tests for source-matcher module"
```

---

### Task 11: Source matcher — implementation

**Files:**
- Create: `src/lib/source-matcher.ts`

- [ ] **Step 1: Write the matcher module**

Create `src/lib/source-matcher.ts`:

```ts
// src/lib/source-matcher.ts
//
// Token-subset entity matcher for cross-source tournament deduplication.
// Extracted from scripts/merge-tournament-duplicates.ts so that cron routes
// can reuse it.
//
// Matching rule:
//   1. Normalize name: strip diacritics, lowercase, strip year tokens,
//      strip noise tokens ('premier', 'padel', 'tour', etc.)
//   2. isTokenSubset(a, b): every token in a must appear in b's token set
//      (or vice versa — we accept bidirectional subsets)
//   3. For resolving a single candidate, also filter by year extracted
//      from starts_at.

// ── Constants ────────────────────────────────────────────────

export const NOISE_TOKENS: ReadonlySet<string> = new Set([
  'premier',
  'padel',
  'tour',
  'open',
  'presented',
  'by',
  'championship',
  'championships',
  'season',
  'the',
  'of',
  'cup',
  // Sponsor prefixes commonly attached to Premier events
  'lotto',
  'belfius',
  'betclic',
  'bnl',
  'gnp',
  'greenweez',
  'ooredoo',
  'alpine',
  'motorola',
  'razr',
  'banco',
  'chile',
  'oysho',
])

// ── Normalization ─────────────────────────────────────────────

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Tokenize a tournament name, stripping years, noise words, and punctuation. */
export function tokenize(s: string | null | undefined): string[] {
  if (!s) return []
  return stripAccents(s)
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0 && !NOISE_TOKENS.has(t))
}

/** Extract a 4-digit year from an ISO date string. Returns null on failure. */
export function yearOf(date: string | Date | null | undefined): number | null {
  if (!date) return null
  try {
    const d = typeof date === 'string' ? new Date(date) : date
    const y = d.getFullYear()
    if (!Number.isFinite(y) || y < 1900 || y > 2100) return null
    return y
  } catch {
    return null
  }
}

// ── Matching ──────────────────────────────────────────────────

/**
 * Returns true when every token of `a` appears in `b`'s token set, OR vice
 * versa. Bidirectional subset handles both "Brussels P2" → sponsored name
 * and the reverse direction.
 */
export function isTokenSubset(a: string, b: string): boolean {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 || tb.size === 0) return false
  // Forward: every token in ta is in tb
  if ([...ta].every(t => tb.has(t))) return true
  // Reverse: every token in tb is in ta
  if ([...tb].every(t => ta.has(t))) return true
  return false
}

/** Jaccard similarity 0..1 — used by match-level player name overlap. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(tokenize(a))
  const tb = new Set(tokenize(b))
  if (ta.size === 0 && tb.size === 0) return 0
  const intersection = [...ta].filter(t => tb.has(t)).length
  const union = new Set([...ta, ...tb]).size
  return union === 0 ? 0 : intersection / union
}

// ── Candidate resolution ──────────────────────────────────────

export interface CandidateTournament {
  id: string
  name: string
  starts_at: string | null
}

export interface ResolveInput {
  name: string
  year: number | null
}

export type ResolveReason =
  | 'single'
  | 'no_candidate'
  | 'multiple_candidates'

export interface ResolveResult {
  match: CandidateTournament | null
  reason: ResolveReason
  candidateCount: number
}

/**
 * Given a source tournament's (name, year) and a list of candidates from our
 * DB, returns the unique match if exactly one candidate matches.
 */
export function resolveSingleCandidate(
  input: ResolveInput,
  candidates: CandidateTournament[],
): ResolveResult {
  const yearFiltered = input.year !== null
    ? candidates.filter(c => yearOf(c.starts_at) === input.year)
    : candidates
  const matches = yearFiltered.filter(c => isTokenSubset(input.name, c.name))

  if (matches.length === 0) {
    return { match: null, reason: 'no_candidate', candidateCount: 0 }
  }
  if (matches.length === 1) {
    return { match: matches[0], reason: 'single', candidateCount: 1 }
  }
  return { match: null, reason: 'multiple_candidates', candidateCount: matches.length }
}
```

- [ ] **Step 2: Run tests — expect all green**

```bash
npx vitest run src/lib/__tests__/source-matcher.test.ts 2>&1 | tail -20
```

Expected: `17 passed (17)` (or however many test cases end up being). If any fail because the sponsor token list doesn't cover your test names, add the missing tokens to `NOISE_TOKENS`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/source-matcher.ts
git commit -m "feat(matcher): extract token-subset matcher to reusable module"
```

---

### Task 12: Refactor `merge-tournament-duplicates.ts` to use the new matcher

**Files:**
- Modify: `scripts/merge-tournament-duplicates.ts`

- [ ] **Step 1: Replace the inline `normalizeName` helper with an import**

Open `scripts/merge-tournament-duplicates.ts`. Find the existing `stripAccents` and `normalizeName` functions (around line 60-70) and replace them with an import at the top of the file and a shim function that keeps the existing `normalizeName` API for backward compat:

At the top of the imports section, add:

```ts
import { tokenize } from '../src/lib/source-matcher'
```

Then replace the `stripAccents` + `normalizeName` block with:

```ts
function normalizeName(n: string): string {
  return tokenize(n).join(' ')
}
```

- [ ] **Step 2: Verify the script still runs dry**

```bash
node --experimental-strip-types scripts/merge-tournament-duplicates.ts --dry-run 2>&1 | tail -20
```

Expected: same output as before (zero or few duplicates found, no errors). If the normalization produces different groupings than before, revert and investigate — the old logic might have preserved noise tokens the new matcher strips.

- [ ] **Step 3: Commit**

```bash
git add scripts/merge-tournament-duplicates.ts
git commit -m "refactor(scripts): use shared tokenize helper from source-matcher"
```

---

### Task 13: Discovery cron — tournament linking

**Files:**
- Create: `src/app/api/cron/premier-discovery/route.ts`

- [ ] **Step 1: Scaffold the route with auth + tournament linking only**

Create `src/app/api/cron/premier-discovery/route.ts`:

```ts
// src/app/api/cron/premier-discovery/route.ts
//
// Links Premier Padel tournaments and matches to our DB via entity_external_ids.
// Day 1: triggered manually via curl. Day 2+: scheduled weekly via Vercel.
//
// Matching:
//   - Tournament: token-subset on name + year from starts_at
//   - Match: player last-name overlap (>= 3/4 names) within linked tournament
//     (implemented in Task 14)
//
// Unresolved entities are written to match_stats_unresolved for manual review.

import { createClient } from '@supabase/supabase-js'
import {
  fetchPremierTournamentDropdown,
  fetchPremierUpcomingMatches,
  withThrottle,
  type PremierTournamentSummary,
  type PremierUpcomingMatch,
} from '@/lib/premier-api'
import {
  resolveSingleCandidate,
  yearOf,
  type CandidateTournament,
} from '@/lib/source-matcher'
import { findEntityBySourceId, registerSourceId } from '@/lib/external-id-registry'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const IN_SCOPE_LEVELS = ['p1', 'p2', 'major', 'finals', 'fip_platinum', 'fip_gold']

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const result = {
    ok: true,
    tournaments: { linked: 0, already: 0, unresolved: 0 },
    matches: { linked: 0, already: 0, unresolved: 0, skipped_byes: 0 },
    by_reason: { no_candidate: 0, multiple_candidates: 0, no_player_match: 0 },
  }

  // Step 1: Fetch Premier's tournament dropdown
  const premiers = await fetchPremierTournamentDropdown('en')
  console.log(`[premier-discovery] fetched ${premiers.length} Premier tournaments`)

  // Step 2: Pre-fetch all our in-scope tournaments
  const { data: ours } = await supabase
    .from('tournaments')
    .select('id, name, level, source, starts_at')
    .in('level', IN_SCOPE_LEVELS)
  const candidates: CandidateTournament[] = (ours ?? []).map(t => ({
    id: t.id as string,
    name: t.name as string,
    starts_at: t.starts_at as string | null,
  }))
  console.log(`[premier-discovery] candidates: ${candidates.length} of our tournaments`)

  // Step 3: Link tournaments
  const linkedTournamentIds: Array<{ ourId: string; premierId: number }> = []
  for (const p of premiers) {
    // Only consider tournaments with either a known start date in 2026+ OR no date
    // (we retry these with year=null fallback).
    const premierYear = yearOf(p.accommodation_start_date)
    if (premierYear !== null && premierYear < 2026) continue

    // Skip if already linked
    const existing = await findEntityBySourceId(
      supabase,
      'tournament',
      'premierpadel',
      String(p.tournaments_id),
    )
    if (existing) {
      result.tournaments.already++
      linkedTournamentIds.push({ ourId: existing, premierId: p.tournaments_id })
      continue
    }

    // Resolve candidate
    const resolve = resolveSingleCandidate(
      { name: p.full_name, year: premierYear },
      candidates,
    )

    if (resolve.match) {
      await registerSourceId(supabase, {
        entityType: 'tournament',
        entityId: resolve.match.id,
        source: 'premierpadel',
        externalId: String(p.tournaments_id),
        metadata: {
          name: p.full_name,
          accommodation_start_date: p.accommodation_start_date,
          accommodation_end_date: p.accommodation_end_date,
        },
      })
      result.tournaments.linked++
      linkedTournamentIds.push({ ourId: resolve.match.id, premierId: p.tournaments_id })
    } else {
      await supabase.from('match_stats_unresolved').upsert({
        source: 'premierpadel',
        source_kind: 'tournament',
        source_id: String(p.tournaments_id),
        source_payload: p,
        candidate_count: resolve.candidateCount,
        reason: resolve.reason,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source,source_kind,source_id' })
      result.tournaments.unresolved++
      result.by_reason[resolve.reason as 'no_candidate' | 'multiple_candidates']++
    }
  }

  // Step 4: Link matches for each newly-linked tournament
  // (implemented in Task 14)

  return Response.json({
    ...result,
    elapsed_ms: Date.now() - startedAt,
  })
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E 'premier-discovery' | head -10
```

Expected: no errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/premier-discovery/route.ts
git commit -m "feat(cron): premier-discovery links tournaments via token-subset matcher"
```

---

### Task 14: Discovery cron — match linking

**Files:**
- Modify: `src/app/api/cron/premier-discovery/route.ts`

- [ ] **Step 1: Add the match-linking helper functions**

Below the `supabase` client declaration in `premier-discovery/route.ts`, add:

```ts
// ── Last-name extraction ─────────────────────────────────────

function lastNameOf(full: string | null | undefined): string {
  if (!full) return ''
  const norm = full.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const parts = norm.trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

// ── Round mapping ────────────────────────────────────────────

/**
 * Maps Premier's round_name (e.g. "Men SF", "Women QF") to our
 * (category, round) pair.
 */
function mapPremierRound(roundName: string | undefined): { category: 'men' | 'women' | null; round: string | null } {
  if (!roundName) return { category: null, round: null }
  const lower = roundName.toLowerCase()
  const isMen = lower.startsWith('men')
  const isWomen = lower.startsWith('women')
  const category = isMen ? 'men' : isWomen ? 'women' : null
  const round = lower.replace(/^(men|women)\s+/, '').toUpperCase().trim() || null
  return { category, round }
}

// ── Our match row type (narrow shape for matching) ───────────

interface OurMatchRow {
  id: string
  round: string | null
  category: string | null
  pair1_player1: { name: string | null } | null
  pair1_player2: { name: string | null } | null
  pair2_player1: { name: string | null } | null
  pair2_player2: { name: string | null } | null
}

// ── Match-level player-name matcher ──────────────────────────

/**
 * Score a Premier match against a candidate by counting how many of the
 * 4 last names overlap. Returns the best candidate + its score (0-4).
 */
function matchPremierMatchToOurs(
  pm: PremierUpcomingMatch,
  candidates: OurMatchRow[],
): { matched: OurMatchRow | null; score: number } {
  const premierNames = new Set(
    [
      lastNameOf(pm.team1_player_name),
      lastNameOf(pm.team1_partner_name),
      lastNameOf(pm.team2_player_name),
      lastNameOf(pm.team2_partner_player_name),
    ].filter(Boolean),
  )

  if (premierNames.size === 0) return { matched: null, score: 0 }

  const { category: pmCategory, round: pmRound } = mapPremierRound(pm.round_name)

  let best: OurMatchRow | null = null
  let bestScore = 0

  for (const c of candidates) {
    if (pmCategory && c.category && c.category !== pmCategory) continue
    if (pmRound && c.round && c.round !== pmRound) continue

    const ourNames = new Set(
      [
        lastNameOf(c.pair1_player1?.name),
        lastNameOf(c.pair1_player2?.name),
        lastNameOf(c.pair2_player1?.name),
        lastNameOf(c.pair2_player2?.name),
      ].filter(Boolean),
    )
    const overlap = [...premierNames].filter(n => ourNames.has(n)).length
    if (overlap > bestScore) {
      bestScore = overlap
      best = c
    }
  }

  return { matched: best, score: bestScore }
}
```

- [ ] **Step 2: Add the match-linking loop to the `GET` handler**

In the `GET` handler, replace the `// Step 4: Link matches...` comment with:

```ts
// Step 4: Link matches for each linked tournament
for (const { ourId, premierId } of linkedTournamentIds) {
  // Pull our matches for this tournament with player names joined
  const { data: ourMatches } = await supabase
    .from('matches')
    .select(`
      id, round, category,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('tournament_id', ourId)

  if (!ourMatches?.length) continue

  // Fetch Premier's match list for this tournament
  const premierMatches = await withThrottle(
    () => fetchPremierUpcomingMatches(premierId),
  )

  for (const pm of premierMatches) {
    // Skip byes — no stats to collect
    if (pm.is_bye === 'Yes') {
      result.matches.skipped_byes++
      continue
    }

    // Skip if already linked
    const existing = await findEntityBySourceId(
      supabase,
      'match',
      'premierpadel',
      String(pm.tournaments_match_id),
    )
    if (existing) {
      result.matches.already++
      continue
    }

    const { matched, score } = matchPremierMatchToOurs(
      pm,
      ourMatches as unknown as OurMatchRow[],
    )

    if (matched && score >= 3) {
      await registerSourceId(supabase, {
        entityType: 'match',
        entityId: matched.id,
        source: 'premierpadel',
        externalId: String(pm.tournaments_match_id),
        metadata: {
          draw_type: pm.draw_type,
          round_name: pm.round_name,
          matchId: pm.tournaments_match_id,
        },
      })
      result.matches.linked++
    } else {
      await supabase.from('match_stats_unresolved').upsert({
        source: 'premierpadel',
        source_kind: 'match',
        source_id: String(pm.tournaments_match_id),
        source_payload: pm,
        candidate_count: ourMatches.length,
        reason: 'no_player_match',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source,source_kind,source_id' })
      result.matches.unresolved++
      result.by_reason.no_player_match++
    }
  }
}
```

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | grep premier-discovery
```

Expected: no errors from the discovery route.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/premier-discovery/route.ts
git commit -m "feat(cron): premier-discovery links matches via player last-name overlap"
```

---

### Task 15: Trigger discovery cron end-to-end

**Files:** none (verification task)

- [ ] **Step 1: Start the dev server in a background shell**

```bash
npm run dev &
# Wait ~5 seconds for server to come up
sleep 5
```

- [ ] **Step 2: Trigger the cron via curl**

```bash
curl -s -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2 | tr -d '\"')" \
     http://localhost:3002/api/cron/premier-discovery | python3 -m json.tool
```

Expected response shape:

```json
{
  "ok": true,
  "tournaments": {
    "linked": 38,
    "already": 0,
    "unresolved": 3
  },
  "matches": {
    "linked": 320,
    "already": 0,
    "unresolved": 14,
    "skipped_byes": 8
  },
  "by_reason": {
    "no_candidate": 2,
    "multiple_candidates": 1,
    "no_player_match": 14
  },
  "elapsed_ms": 142300
}
```

**Acceptance thresholds:**
- `tournaments.linked >= 35`
- `matches.linked >= 300`
- `matches.unresolved < 70` (i.e. resolved >80%)

If thresholds aren't met, inspect the `match_stats_unresolved` table and debug the matcher before proceeding.

- [ ] **Step 3: Review the unresolved queue in Supabase**

Open the Supabase dashboard SQL editor and run:

```sql
SELECT source_kind, source_id, reason, candidate_count,
       source_payload->>'full_name' AS premier_name,
       source_payload->>'accommodation_start_date' AS starts_at,
       source_payload->>'round_name' AS round_name,
       source_payload->>'team1_player_name' AS t1_p1,
       source_payload->>'team1_partner_name' AS t1_p2
FROM match_stats_unresolved
WHERE resolved_at IS NULL
ORDER BY source_kind, candidate_count DESC;
```

**Coordinate with the user:** for each row, decide whether to manually link (via SQL INSERT into `entity_external_ids`) or leave unresolved. The user runs these SQL statements from the spec doc's "Ops workflow" section.

- [ ] **Step 4: Stop the dev server**

```bash
# Find the dev server PID and kill it
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
```

- [ ] **Step 5: Commit — nothing to commit for this task (verification only)**

**Day 2 exit criteria verified:** ≥35 tournaments linked, ≥300 matches linked, unresolved queue reviewed.

---

## Day 3 (Fri Apr 10): Stats sync cron + backfill + API endpoint

**Exit criteria:** ~360 rows in `match_stats` for `set_number = 0` (one per finished Premier match). `GET /api/match-stats?matchId=<uuid>` returns real data.

### Task 16: Stats cron — implementation

**Files:**
- Create: `src/app/api/cron/premier-stats/route.ts`

- [ ] **Step 1: Write the stats cron route**

Create `src/app/api/cron/premier-stats/route.ts`:

```ts
// src/app/api/cron/premier-stats/route.ts
//
// Fetches Premier Padel stats for finished matches that have a Premier
// mapping but no (or stale) stats in match_stats.
//
// Day 1: manually triggered with ?limit=500&full_backfill=true to drain
// the 2026 backlog.
// Day 2+: scheduled hourly with default limit=100 and 7-day window.

import { createClient } from '@supabase/supabase-js'
import { fetchPremierMatchDetail, withThrottle } from '@/lib/premier-api'
import { parseMatchStatsPayload } from '@/lib/premier-stats-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const LOOKBACK_DAYS = 7
const BACKFILL_CUTOFF = '2026-01-01'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const requestedLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT)
  const limit = Math.min(Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_LIMIT), MAX_LIMIT)
  const fullBackfill = url.searchParams.get('full_backfill') === 'true'

  const startedAt = Date.now()
  const cutoff = fullBackfill
    ? BACKFILL_CUTOFF
    : new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Find candidates: finished matches in the window with Premier mapping
  // but no fresh stats. We can't easily do this with a single PostgREST
  // query — split into two steps.
  const { data: eeiRows, error: eeiErr } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'match')
    .eq('source', 'premierpadel')
    .limit(2000)  // Safety cap

  if (eeiErr) {
    return Response.json({ error: 'Failed to load mappings', detail: eeiErr.message }, { status: 500 })
  }

  const mappedMatchIds = (eeiRows ?? []).map(r => r.entity_id as string)
  if (mappedMatchIds.length === 0) {
    return Response.json({
      ok: true,
      synced: 0,
      errored: 0,
      skipped: 0,
      candidates: 0,
      reason: 'no mappings',
      elapsed_ms: Date.now() - startedAt,
    })
  }

  // Get finished matches in window, sorted by finished_at desc
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select('id, finished_at')
    .in('id', mappedMatchIds)
    .eq('status', 'finished')
    .gte('finished_at', cutoff)
    .order('finished_at', { ascending: false })
    .limit(limit)

  if (matchErr) {
    return Response.json({ error: 'Failed to load matches', detail: matchErr.message }, { status: 500 })
  }

  const candidateMatchIds = (matchRows ?? []).map(m => m.id as string)

  // Load existing match_stats (set_number = 0 only) for these matches to
  // check freshness.
  const { data: existingStats } = await supabase
    .from('match_stats')
    .select('match_id, computed_at')
    .in('match_id', candidateMatchIds)
    .eq('set_number', 0)

  const freshByMatchId = new Map<string, string>()
  for (const s of existingStats ?? []) {
    freshByMatchId.set(s.match_id as string, s.computed_at as string)
  }

  // Build premier_match_id lookup
  const premierIdByMatchId = new Map<string, string>()
  for (const r of eeiRows ?? []) {
    premierIdByMatchId.set(r.entity_id as string, r.external_id as string)
  }

  // Filter to the ones that need sync
  const needsSync: Array<{ matchId: string; premierMatchId: string; finishedAt: string }> = []
  for (const m of matchRows ?? []) {
    const existing = freshByMatchId.get(m.id as string)
    const finishedAt = m.finished_at as string
    if (!existing || new Date(existing) < new Date(finishedAt)) {
      const premierMatchId = premierIdByMatchId.get(m.id as string)
      if (premierMatchId) {
        needsSync.push({
          matchId: m.id as string,
          premierMatchId,
          finishedAt,
        })
      }
    }
  }

  let synced = 0
  let errored = 0
  let skipped = 0

  for (const row of needsSync) {
    const detail = await withThrottle(
      () => fetchPremierMatchDetail(Number(row.premierMatchId)),
    )
    if (!detail) {
      skipped++
      continue
    }
    const parsed = parseMatchStatsPayload(detail)
    if (!parsed) {
      skipped++
      continue
    }

    const upsertRows = parsed.map(r => ({
      match_id: row.matchId,
      ...r,
      source: 'premierpadel' as const,
      source_match_id: row.premierMatchId,
      raw_payload: r.set_number === 0 ? detail : null,
      computed_at: new Date().toISOString(),
    }))

    const { error } = await supabase
      .from('match_stats')
      .upsert(upsertRows, { onConflict: 'match_id,set_number' })

    if (error) {
      console.error(`[premier-stats] upsert error for match ${row.matchId}:`, error)
      errored++
    } else {
      synced++
    }
  }

  return Response.json({
    ok: true,
    synced,
    errored,
    skipped,
    candidates: needsSync.length,
    total_mapped: mappedMatchIds.length,
    limit,
    full_backfill: fullBackfill,
    elapsed_ms: Date.now() - startedAt,
  })
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | grep premier-stats
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/premier-stats/route.ts
git commit -m "feat(cron): premier-stats hourly sync + manual full-backfill mode"
```

---

### Task 17: Run the full 2026 backfill

**Files:** none (data task)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev &
sleep 5
```

- [ ] **Step 2: Trigger the full backfill**

```bash
curl -s -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2 | tr -d '\"')" \
     "http://localhost:3002/api/cron/premier-stats?limit=500&full_backfill=true" \
     | python3 -m json.tool
```

This call will take 5-15 minutes (waits for up to 500 matches × ~300ms each). Expected response:

```json
{
  "ok": true,
  "synced": 347,
  "errored": 4,
  "skipped": 5,
  "candidates": 356,
  "total_mapped": 356,
  "limit": 500,
  "full_backfill": true,
  "elapsed_ms": 892043
}
```

**Acceptance thresholds:**
- `synced >= 300`
- `errored < 20`

- [ ] **Step 3: Verify the data in Supabase**

```sql
-- Count of aggregate rows (should be ~300+)
SELECT count(*) FROM match_stats WHERE set_number = 0;

-- Count of set rows (should be ~700-900)
SELECT count(*) FROM match_stats WHERE set_number > 0;

-- Sample a few matches with their stats
SELECT m.id, t.name, m.round, m.category,
       ms.team1_first_serve_won, ms.team1_first_serve_played,
       ms.team2_first_serve_won, ms.team2_first_serve_played
FROM match_stats ms
JOIN matches m ON m.id = ms.match_id
JOIN tournaments t ON t.id = m.tournament_id
WHERE ms.set_number = 0
ORDER BY m.finished_at DESC
LIMIT 5;
```

- [ ] **Step 4: Re-trigger the cron with default params to confirm idempotence**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET_FROM_ENV" \
     http://localhost:3002/api/cron/premier-stats | python3 -m json.tool
```

Expected: `synced: 0` (everything's already fresh) or a small number (matches whose `finished_at` is more recent than their `computed_at`).

- [ ] **Step 5: Stop the dev server**

```bash
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
```

**Day 3 partial exit criteria:** `SELECT count(*) FROM match_stats WHERE set_number = 0` returns ~300+.

---

### Task 18: `/api/match-stats` GET endpoint

**Files:**
- Create: `src/app/api/match-stats/route.ts`

- [ ] **Step 1: Write the endpoint**

Create `src/app/api/match-stats/route.ts`:

```ts
// src/app/api/match-stats/route.ts
//
// Public GET endpoint for the Stats tab on match detail.
// Returns per-set stats plus a `status` field that lets the UI pick an
// empty state.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

type StatsStatus = 'ok' | 'no_mapping' | 'pending_sync' | 'upcoming'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const matchId = url.searchParams.get('matchId')
  if (!matchId) {
    return Response.json({ error: 'Missing matchId' }, { status: 400 })
  }

  // Fetch match status
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id, status')
    .eq('id', matchId)
    .maybeSingle()

  if (matchErr) {
    return Response.json({ error: matchErr.message }, { status: 500 })
  }
  if (!match) {
    return Response.json({ error: 'Match not found' }, { status: 404 })
  }

  // Upcoming match? Short-circuit.
  if (match.status === 'scheduled') {
    return Response.json({ stats: null, status: 'upcoming' as StatsStatus })
  }

  // Does a Premier mapping exist?
  const { data: mapping } = await supabase
    .from('entity_external_ids')
    .select('external_id')
    .eq('entity_type', 'match')
    .eq('entity_id', matchId)
    .eq('source', 'premierpadel')
    .maybeSingle()

  if (!mapping) {
    return Response.json({ stats: null, status: 'no_mapping' as StatsStatus })
  }

  // Fetch the stats rows, strip raw_payload to keep response small
  const { data: rows, error } = await supabase
    .from('match_stats')
    .select('*')
    .eq('match_id', matchId)
    .order('set_number', { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return Response.json({ stats: null, status: 'pending_sync' as StatsStatus })
  }

  // Strip raw_payload (we don't need 9KB blob on every client fetch)
  const stats = rows.map(({ raw_payload: _raw, ...rest }) => rest)

  return Response.json(
    { stats, status: 'ok' as StatsStatus },
    {
      headers: {
        'cache-control': 'public, max-age=30, stale-while-revalidate=300',
      },
    },
  )
}
```

- [ ] **Step 2: Test the endpoint against a real match**

```bash
npm run dev &
sleep 5

# Find a match ID that has stats
MATCH_ID=$(node -e "
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('match_stats').select('match_id').eq('set_number',0).limit(1).then(r => console.log(r.data?.[0]?.match_id));
")

curl -s "http://localhost:3002/api/match-stats?matchId=$MATCH_ID" | python3 -m json.tool
```

Expected: `status: "ok"` with a `stats` array of 2-4 row objects.

- [ ] **Step 3: Test edge cases**

```bash
# Invalid match ID
curl -s "http://localhost:3002/api/match-stats?matchId=00000000-0000-0000-0000-000000000000" \
  | python3 -m json.tool
# Expected: { "error": "Match not found" }, 404

# Missing param
curl -s "http://localhost:3002/api/match-stats" | python3 -m json.tool
# Expected: { "error": "Missing matchId" }, 400

# Stop dev server
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/match-stats/route.ts
git commit -m "feat(api): GET /api/match-stats for the Stats tab"
```

**Day 3 exit criteria verified:** backfill complete, API endpoint returning real data.

---

## Day 4 (Sat Apr 11): Stats tab UI

**Exit criteria:** 10 real match URLs tested on mobile. Stats tab renders bars, empty states work for non-Premier matches, pill tabs switch between sets.

### Task 19: `<MatchStatsBar>` reusable component

**Files:**
- Create: `src/components/MatchStatsBar.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/MatchStatsBar.tsx`:

```tsx
'use client'
// src/components/MatchStatsBar.tsx
//
// Single side-by-side stat row. Two variants:
// - percentage: shows pct + fraction, bar fills inward from each side
// - count: just the number, no bar, no fraction

import type { CSSProperties } from 'react'

const PAIR1_COLOR = '#7ed321'
const PAIR2_COLOR = '#4a90e2'
const MUTED = '#8a8f98'
const BORDER = 'rgba(255, 255, 255, 0.08)'

export interface MatchStatsBarProps {
  label: string
  kind: 'percentage' | 'count'
  t1Value: number | null
  t1Total: number | null
  t2Value: number | null
  t2Total: number | null
}

function pct(value: number | null, total: number | null): number | null {
  if (value == null || total == null || total === 0) return null
  return Math.round((value / total) * 100)
}

function formatDisplay(kind: 'percentage' | 'count', value: number | null, total: number | null): string {
  if (kind === 'count') return value == null ? '—' : String(value)
  const p = pct(value, total)
  return p == null ? '—' : `${p}%`
}

function formatFraction(value: number | null, total: number | null): string {
  if (value == null || total == null) return ''
  return `${value}/${total}`
}

const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '60px 1fr 60px',
  alignItems: 'center',
  gap: 12,
  padding: '10px 16px',
  borderBottom: `0.5px solid ${BORDER}`,
}

export function MatchStatsBar({ label, kind, t1Value, t1Total, t2Value, t2Total }: MatchStatsBarProps) {
  const t1Display = formatDisplay(kind, t1Value, t1Total)
  const t2Display = formatDisplay(kind, t2Value, t2Total)
  const t1Frac = kind === 'percentage' ? formatFraction(t1Value, t1Total) : ''
  const t2Frac = kind === 'percentage' ? formatFraction(t2Value, t2Total) : ''

  const t1Pct = kind === 'percentage' ? (pct(t1Value, t1Total) ?? 0) : 0
  const t2Pct = kind === 'percentage' ? (pct(t2Value, t2Total) ?? 0) : 0

  return (
    <div style={rowStyle}>
      {/* Team 1 — left */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: PAIR1_COLOR, fontFamily: 'monospace' }}>
          {t1Display}
        </div>
        {t1Frac && (
          <div style={{ fontSize: 9, color: MUTED, fontFamily: 'monospace' }}>{t1Frac}</div>
        )}
      </div>

      {/* Center — label + optional bar */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>
          {label}
        </div>
        {kind === 'percentage' && (
          <div
            style={{
              display: 'flex',
              height: 4,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${t1Pct}%`,
                background: PAIR1_COLOR,
                opacity: 0.8,
              }}
            />
            <div style={{ flex: 1 }} />
            <div
              style={{
                width: `${t2Pct}%`,
                background: PAIR2_COLOR,
                opacity: 0.8,
              }}
            />
          </div>
        )}
      </div>

      {/* Team 2 — right */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: PAIR2_COLOR, fontFamily: 'monospace' }}>
          {t2Display}
        </div>
        {t2Frac && (
          <div style={{ fontSize: 9, color: MUTED, fontFamily: 'monospace' }}>{t2Frac}</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MatchStatsBar.tsx
git commit -m "feat(ui): MatchStatsBar reusable side-by-side stat row"
```

---

### Task 20: `<MatchStatsSetTabs>` pill tabs

**Files:**
- Create: `src/components/MatchStatsSetTabs.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/MatchStatsSetTabs.tsx`:

```tsx
'use client'
// src/components/MatchStatsSetTabs.tsx
//
// Horizontal pill row used at the top of the Stats tab. Lets the user switch
// between the match aggregate and individual sets.

import type { CSSProperties } from 'react'

const GREEN = '#7ed321'
const MUTED = '#8a8f98'
const BORDER = 'rgba(255, 255, 255, 0.08)'

export interface SetTabItem {
  setNumber: number       // 0 = Match aggregate, 1..5 = individual sets
  label: string           // 'Match' | 'Set 1' | 'Set 2' | ...
  disabled: boolean       // true when there's no data for this set
}

export interface MatchStatsSetTabsProps {
  tabs: SetTabItem[]
  active: number
  onChange: (setNumber: number) => void
}

const containerStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  padding: '8px 16px',
  borderBottom: `0.5px solid ${BORDER}`,
  background: 'rgba(0, 0, 0, 0.2)',
  overflowX: 'auto',
}

const pillBase: CSSProperties = {
  fontSize: 10,
  padding: '4px 12px',
  border: `0.5px solid ${BORDER}`,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
  borderRadius: 4,
}

export function MatchStatsSetTabs({ tabs, active, onChange }: MatchStatsSetTabsProps) {
  return (
    <div style={containerStyle}>
      {tabs.map(tab => {
        const isActive = tab.setNumber === active
        const style: CSSProperties = {
          ...pillBase,
          fontWeight: isActive ? 700 : 500,
          background: isActive
            ? 'rgba(126, 211, 33, 0.12)'
            : tab.disabled ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.04)',
          borderColor: isActive ? 'rgba(126, 211, 33, 0.3)' : BORDER,
          color: isActive ? GREEN : tab.disabled ? 'rgba(138, 143, 152, 0.4)' : MUTED,
          cursor: tab.disabled ? 'not-allowed' : 'pointer',
        }
        return (
          <button
            key={tab.setNumber}
            type="button"
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.setNumber)}
            style={style}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MatchStatsSetTabs.tsx
git commit -m "feat(ui): MatchStatsSetTabs per-set pill tab row"
```

---

### Task 21: `<MatchStatsView>` container

**Files:**
- Create: `src/components/MatchStatsView.tsx`

- [ ] **Step 1: Write the container component**

Create `src/components/MatchStatsView.tsx`:

```tsx
'use client'
// src/components/MatchStatsView.tsx
//
// Stats tab container. Fetches /api/match-stats on mount, renders the
// appropriate state (loading / empty / success).

import { useEffect, useState } from 'react'
import { MatchStatsBar } from './MatchStatsBar'
import { MatchStatsSetTabs, type SetTabItem } from './MatchStatsSetTabs'

const MUTED = '#8a8f98'
const BORDER = 'rgba(255, 255, 255, 0.08)'

interface MatchStatsRow {
  set_number: number
  team1_first_serve_won: number | null
  team1_first_serve_played: number | null
  team1_second_serve_won: number | null
  team1_second_serve_played: number | null
  team1_service_games: number | null
  team2_first_serve_won: number | null
  team2_first_serve_played: number | null
  team2_second_serve_won: number | null
  team2_second_serve_played: number | null
  team2_service_games: number | null
  team1_first_return_won: number | null
  team1_first_return_played: number | null
  team1_second_return_won: number | null
  team1_second_return_played: number | null
  team1_return_games: number | null
  team2_first_return_won: number | null
  team2_first_return_played: number | null
  team2_second_return_won: number | null
  team2_second_return_played: number | null
  team2_return_games: number | null
  team1_total_points_won: number | null
  team1_total_points_played: number | null
  team1_serve_points_won: number | null
  team1_serve_points_played: number | null
  team1_return_points_won: number | null
  team1_return_points_played: number | null
  team1_longest_streak: number | null
  team2_total_points_won: number | null
  team2_total_points_played: number | null
  team2_serve_points_won: number | null
  team2_serve_points_played: number | null
  team2_return_points_won: number | null
  team2_return_points_played: number | null
  team2_longest_streak: number | null
}

type StatsStatus = 'ok' | 'no_mapping' | 'pending_sync' | 'upcoming'

interface ApiResponse {
  stats: MatchStatsRow[] | null
  status: StatsStatus
}

export function MatchStatsView({ matchId }: { matchId: string }) {
  const [response, setResponse] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeSet, setActiveSet] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/match-stats?matchId=${matchId}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as ApiResponse
      })
      .then(data => {
        if (cancelled) return
        setResponse(data)
        setLoading(false)
      })
      .catch(err => {
        if (cancelled) return
        setError(err.message || 'Failed to load stats')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [matchId])

  if (loading) return <SkeletonBars />
  if (error) return <ErrorState message={error} />
  if (!response) return <ErrorState message="No data" />
  if (response.status === 'upcoming') return <EmptyState icon="⏰" text="Match hasn't started yet" />
  if (response.status === 'no_mapping') return <EmptyState icon="📊" text="Stats not available for this match" />
  if (response.status === 'pending_sync') return <EmptyState icon="⏳" text="Stats coming soon — sync runs hourly" />

  const stats = response.stats ?? []
  if (stats.length === 0) return <EmptyState icon="📊" text="No stats data" />

  const activeRow = stats.find(s => s.set_number === activeSet) ?? stats[0]
  const availableSetNumbers = new Set(stats.map(s => s.set_number))

  // Build pill tabs: Match + sets 1..3 (or up to max set number found)
  const maxSet = Math.max(...stats.map(s => s.set_number))
  const tabs: SetTabItem[] = [
    { setNumber: 0, label: 'Match', disabled: false },
    ...Array.from({ length: Math.max(maxSet, 2) }, (_, i) => ({
      setNumber: i + 1,
      label: `Set ${i + 1}`,
      disabled: !availableSetNumbers.has(i + 1),
    })),
  ]

  return (
    <div>
      <MatchStatsSetTabs tabs={tabs} active={activeSet} onChange={setActiveSet} />

      {/* Service section */}
      <Section title="Service">
        <MatchStatsBar label="1st Serve %" kind="percentage"
          t1Value={activeRow.team1_first_serve_won} t1Total={activeRow.team1_first_serve_played}
          t2Value={activeRow.team2_first_serve_won} t2Total={activeRow.team2_first_serve_played} />
        <MatchStatsBar label="2nd Serve %" kind="percentage"
          t1Value={activeRow.team1_second_serve_won} t1Total={activeRow.team1_second_serve_played}
          t2Value={activeRow.team2_second_serve_won} t2Total={activeRow.team2_second_serve_played} />
        <MatchStatsBar label="Service Games" kind="count"
          t1Value={activeRow.team1_service_games} t1Total={null}
          t2Value={activeRow.team2_service_games} t2Total={null} />
      </Section>

      {/* Return section */}
      <Section title="Return">
        <MatchStatsBar label="1st Return %" kind="percentage"
          t1Value={activeRow.team1_first_return_won} t1Total={activeRow.team1_first_return_played}
          t2Value={activeRow.team2_first_return_won} t2Total={activeRow.team2_first_return_played} />
        <MatchStatsBar label="2nd Return %" kind="percentage"
          t1Value={activeRow.team1_second_return_won} t1Total={activeRow.team1_second_return_played}
          t2Value={activeRow.team2_second_return_won} t2Total={activeRow.team2_second_return_played} />
        <MatchStatsBar label="Return Games" kind="count"
          t1Value={activeRow.team1_return_games} t1Total={null}
          t2Value={activeRow.team2_return_games} t2Total={null} />
      </Section>

      {/* Total Points — only on Match tab */}
      {activeSet === 0 && (
        <Section title="Total Points">
          <MatchStatsBar label="Total Points Won" kind="percentage"
            t1Value={activeRow.team1_total_points_won} t1Total={activeRow.team1_total_points_played}
            t2Value={activeRow.team2_total_points_won} t2Total={activeRow.team2_total_points_played} />
          <MatchStatsBar label="Serve Points Won" kind="percentage"
            t1Value={activeRow.team1_serve_points_won} t1Total={activeRow.team1_serve_points_played}
            t2Value={activeRow.team2_serve_points_won} t2Total={activeRow.team2_serve_points_played} />
          <MatchStatsBar label="Return Points Won" kind="percentage"
            t1Value={activeRow.team1_return_points_won} t1Total={activeRow.team1_return_points_played}
            t2Value={activeRow.team2_return_points_won} t2Total={activeRow.team2_return_points_played} />
          <MatchStatsBar label="Longest Streak" kind="count"
            t1Value={activeRow.team1_longest_streak} t1Total={null}
            t2Value={activeRow.team2_longest_streak} t2Total={null} />
        </Section>
      )}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          padding: '12px 16px 8px',
          fontSize: 9,
          fontWeight: 700,
          color: MUTED,
          textTransform: 'uppercase',
          letterSpacing: '1px',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

// ── States ────────────────────────────────────────────────────

function SkeletonBars() {
  return (
    <div style={{ padding: 16 }}>
      {[...Array(10)].map((_, i) => (
        <div
          key={i}
          style={{
            height: 44,
            marginBottom: 8,
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 4,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
    </div>
  )
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px', color: MUTED, fontSize: 12 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>{icon}</div>
      <div>{text}</div>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 16px', color: MUTED, fontSize: 12 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
      <div>{message}</div>
    </div>
  )
}
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | grep MatchStatsView
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MatchStatsView.tsx
git commit -m "feat(ui): MatchStatsView stats tab container with set tabs + sections"
```

---

### Task 22: Wire `<MatchStatsView>` into the match page

**Files:**
- Modify: `src/app/match/[id]/page.tsx`

- [ ] **Step 1: Find the `FinishedStatsSection` call site**

Open `src/app/match/[id]/page.tsx` and search for `<FinishedStatsSection`. Currently at line ~831:

```tsx
<FinishedStatsSection match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
```

- [ ] **Step 2: Add the import at the top of the file**

Near the other component imports, add:

```tsx
import { MatchStatsView } from '@/components/MatchStatsView'
```

- [ ] **Step 3: Replace the `FinishedStatsSection` render with `<MatchStatsView>`**

Replace:

```tsx
<FinishedStatsSection match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
```

with:

```tsx
<MatchStatsView matchId={match.id} />
```

**Important:** keep the old `FinishedStatsSection` function definition in place for now — it may still be referenced elsewhere in the file. Just stop rendering it. After day 4 QA confirms `MatchStatsView` is working, a cleanup task will remove `FinishedStatsSection`.

- [ ] **Step 4: Verify the page still builds**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`. If there's an error from `FinishedStatsSection` being unused, add `// eslint-disable-next-line @typescript-eslint/no-unused-vars` above its declaration.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/match/[id]/page.tsx'
git commit -m "feat(match-page): wire MatchStatsView into the Stats tab"
```

---

### Task 23: Manual mobile QA pass

**Files:** none (QA task)

- [ ] **Step 1: Start the dev server**

```bash
npm run dev &
sleep 5
```

- [ ] **Step 2: Pick 10 test matches**

Get a mix from Supabase:

```sql
-- 5 mapped matches (should show full stats)
SELECT m.id, t.name, m.round, m.category
FROM matches m
JOIN tournaments t ON t.id = m.tournament_id
JOIN entity_external_ids eei ON eei.entity_id = m.id AND eei.source = 'premierpadel'
JOIN match_stats ms ON ms.match_id = m.id AND ms.set_number = 0
WHERE m.status = 'finished'
ORDER BY m.finished_at DESC
LIMIT 5;

-- 3 unmapped matches (should show no_mapping empty state)
SELECT m.id, t.name, m.round, m.category, t.level
FROM matches m
JOIN tournaments t ON t.id = m.tournament_id
LEFT JOIN entity_external_ids eei ON eei.entity_id = m.id AND eei.source = 'premierpadel'
WHERE eei.entity_id IS NULL
  AND m.status = 'finished'
  AND t.level IN ('fip_silver', 'fip_bronze', 'fip_other')
LIMIT 3;

-- 2 upcoming matches (should show upcoming empty state)
SELECT m.id, t.name, m.round
FROM matches m
JOIN tournaments t ON t.id = m.tournament_id
WHERE m.status = 'scheduled'
ORDER BY t.starts_at ASC
LIMIT 2;
```

- [ ] **Step 3: Open each URL on mobile viewport**

In Chrome DevTools, set viewport to iPhone 12 (390x844). For each match ID from step 2, navigate to:

```
http://localhost:3002/match/<uuid>
```

Click the Stats tab. Verify the following checklist for each match:

```
[ ] Miami P1 SF URL → Match tab shows 10 stat bars (3 service + 3 return + 4 total)
[ ] Pill tabs show Match, Set 1, Set 2, Set 3 (or fewer)
[ ] Clicking Set 1 → Total Points section disappears, service + return show
[ ] Clicking a greyed-out set (e.g. Set 3 on a 2-set match) does nothing
[ ] No overflow — all bars fit within 390px width
[ ] Numbers read cleanly in monospace font
[ ] FIP Silver URL → "Stats not available for this match" empty state
[ ] Upcoming URL → "Match hasn't started yet" empty state
[ ] Switching between Stats tab and other tabs preserves active set
[ ] Deep link /match/<id>?tab=stats loads directly into the Stats tab
```

- [ ] **Step 4: Fix any issues found**

Common issues to expect:
- Grid column widths don't fit mobile → adjust the `gridTemplateColumns` on `MatchStatsBar`
- Text overlaps → check `fontSize` values
- Loading skeleton flickers → add `key={matchId}` to `MatchStatsView` if needed

Make fixes inline, commit each fix with `fix(ui): ...` message.

- [ ] **Step 5: Stop dev server**

```bash
lsof -ti:3002 | xargs kill -9 2>/dev/null || true
```

**Day 4 exit criteria:** checklist complete, no open issues.

---

## Day 5 (Sun Apr 12): Buffer + Vercel cron + production deploy

**Exit criteria:** `vercel.json` updated, code deployed to production, `source-priority.ts` updated, CLAUDE.md updated. Backfill re-run against production Supabase.

### Task 24: Update `vercel.json` with cron schedules

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Read the current vercel.json**

```bash
cat vercel.json
```

- [ ] **Step 2: Add the two new cron entries**

Using the Edit tool, add these two cron objects to the existing `crons` array in `vercel.json`:

```json
{ "path": "/api/cron/premier-discovery", "schedule": "0 4 * * 1" },
{ "path": "/api/cron/premier-stats",     "schedule": "13 * * * *" }
```

Insert them at the end of the existing `crons` array (before the closing `]`). Make sure to add a comma to the previous entry.

- [ ] **Step 3: Validate JSON**

```bash
python3 -c "import json; json.load(open('vercel.json')); print('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add vercel.json
git commit -m "chore(cron): schedule premier-discovery weekly + premier-stats hourly"
```

---

### Task 25: Update `source-priority.ts`

**Files:**
- Modify: `src/lib/source-priority.ts`

- [ ] **Step 1: Read the file to find the priorities map**

```bash
head -60 src/lib/source-priority.ts
```

- [ ] **Step 2: Add the new field entry**

In the `FIELD_PRIORITIES` object (or whatever the priority map is called — inspect the file), add:

```ts
'match.stats': ['premierpadel'],
```

Place it near the other `match.*` entries to keep the map organized.

- [ ] **Step 3: Verify compilation**

```bash
npx tsc --noEmit 2>&1 | grep source-priority
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/source-priority.ts
git commit -m "chore(priority): register premierpadel as authoritative for match.stats"
```

---

### Task 26: Update CLAUDE.md docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the "Data Model" section**

```bash
grep -n "Data Model\|premierpadel\|source.*priority" CLAUDE.md | head -10
```

- [ ] **Step 2: Add a paragraph documenting the premierpadel source**

In the "Data Model: Canonical IDs & Source Identity" section, after the existing sidecar documentation, add:

```markdown
### Premier Padel source (stats only)

`premierpadel` is a tertiary source added in 2026-04 that provides per-set
service/return/points match statistics. It's scoped to `match.stats` only —
Premier doesn't own any canonical fields like names or rankings.

- **Storage:** `entity_external_ids` sidecar (no hot column)
- **Table:** `match_stats` (composite PK `(match_id, set_number)`)
- **Queue:** `match_stats_unresolved` for manual linking
- **Crons:** `/api/cron/premier-discovery` (weekly) + `/api/cron/premier-stats` (hourly)
- **UI:** `<MatchStatsView>` on the match detail Stats tab

See `docs/superpowers/specs/2026-04-08-premier-stats-2026-backfill-design.md` for details.
```

- [ ] **Step 3: Update the "Scheduled Jobs" table**

Find the table that lists all cron jobs in CLAUDE.md and add two rows:

```markdown
| `/api/cron/premier-discovery` | Mon 4am UTC | Link Premier tournaments + matches to our DB |
| `/api/cron/premier-stats` | Hourly at :13 | Sync per-set stats from Premier Padel API |
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document premierpadel source + new cron schedules in CLAUDE.md"
```

---

### Task 27: Remove the legacy `FinishedStatsSection` function

**Files:**
- Modify: `src/app/match/[id]/page.tsx`

- [ ] **Step 1: Confirm `FinishedStatsSection` is no longer referenced**

```bash
grep -n 'FinishedStatsSection' 'src/app/match/[id]/page.tsx'
```

Expected: only the function definition itself is returned, no call sites.

- [ ] **Step 2: Delete the function**

Open `src/app/match/[id]/page.tsx` and delete the entire `function FinishedStatsSection(...)` definition (the lines starting at `// ── Finished Stats Section ──` and ending at the closing brace of the function, around lines 1231-1270).

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully`. If there are unused-import errors for symbols like `parseSetScore`, `CHUNKY`, etc. that were only used by the removed function, remove those imports too.

- [ ] **Step 4: Commit**

```bash
git add 'src/app/match/[id]/page.tsx'
git commit -m "chore(cleanup): remove legacy FinishedStatsSection replaced by MatchStatsView"
```

---

### Task 28: Push to branch + verify deploy

**Files:** none (deploy task)

- [ ] **Step 1: Push the branch**

```bash
git push origin claude/happy-lumiere
```

- [ ] **Step 2: Wait for Vercel to deploy**

Wait ~2-3 minutes. Verify with:

```bash
curl -sI https://padelnachos.com/api/cron/premier-discovery | head -5
```

Expected: HTTP/2 response (any status code — the endpoint responds).

- [ ] **Step 3: Trigger discovery cron against production**

```bash
curl -s -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2 | tr -d '\"')" \
     https://padelnachos.com/api/cron/premier-discovery | python3 -m json.tool
```

Expected: tournaments.already ≈ 38 (everything already linked from day 2 local runs), matches.already high.

If the production Supabase is a different project from local (rare), all counts will be zero and the endpoint will link everything fresh — that's fine, it's idempotent.

- [ ] **Step 4: Trigger full stats backfill against production**

```bash
curl -s -H "Authorization: Bearer $(grep CRON_SECRET .env.local | cut -d= -f2 | tr -d '\"')" \
     "https://padelnachos.com/api/cron/premier-stats?limit=500&full_backfill=true" \
     | python3 -m json.tool
```

Expected: `synced >= 300`, `errored < 20`.

- [ ] **Step 5: Test the Stats tab on production URLs**

Open https://padelnachos.com/match/<uuid> for 3-5 known finished Premier matches. Verify the Stats tab renders.

- [ ] **Step 6: Eyeball the cron health**

```sql
-- Run in Supabase dashboard
SELECT count(*) FROM match_stats WHERE set_number = 0;
-- Expected: 300+
```

**Day 5 exit criteria:** production deployed, backfill complete on prod, Stats tab visible to real users.

---

## Day 6 (Mon Apr 13): Launch day monitoring

**Exit criteria:** NewGiza P2 matches start finishing. Hourly cron picks them up within the hour. Users see live stats.

### Task 29: Monitor first NewGiza matches

**Files:** none (monitoring task)

- [ ] **Step 1: Check for mapped NewGiza matches**

After the first NewGiza matches finish (typically 2-4 hours into the tournament):

```sql
SELECT count(*)
FROM matches m
JOIN tournaments t ON t.id = m.tournament_id
JOIN entity_external_ids eei ON eei.entity_id = m.id AND eei.source = 'premierpadel'
WHERE t.name LIKE 'Newgiza%'
  AND m.status = 'finished';
```

Expected: non-zero (auto-mapping happened during a weekly discovery run).

If zero, manually trigger discovery to force link:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
     https://padelnachos.com/api/cron/premier-discovery | python3 -m json.tool
```

- [ ] **Step 2: Wait for the next hourly stats cron at :13**

The Vercel dashboard shows cron execution times. After the first :13 tick post-match-finish, verify:

```sql
SELECT count(*) FROM match_stats ms
JOIN matches m ON m.id = ms.match_id
JOIN tournaments t ON t.id = m.tournament_id
WHERE t.name LIKE 'Newgiza%' AND ms.set_number = 0;
```

Expected: non-zero.

- [ ] **Step 3: Visit a finished NewGiza match URL on mobile**

Confirm stats render cleanly.

- [ ] **Step 4: If anything is broken, manually trigger stats cron**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
     https://padelnachos.com/api/cron/premier-stats | python3 -m json.tool
```

**Day 6 exit criteria: launch successful, stats visible on NewGiza matches.**

---

## Verification checklist (before merging to main)

- [ ] `npm run build` clean
- [ ] `npx vitest run src/lib/__tests__/premier-stats-parser.test.ts` green (10 passed)
- [ ] `npx vitest run src/lib/__tests__/source-matcher.test.ts` green (17 passed)
- [ ] Discovery cron returns `tournaments.linked >= 35` on production
- [ ] Stats cron returns `synced >= 300` on initial backfill
- [ ] `SELECT count(*) FROM match_stats WHERE set_number = 0` >= 300 on production
- [ ] Stats tab renders on 10 test URLs spanning Men/Women, 2-set and 3-set, across 4+ tournaments
- [ ] Empty state visible on a FIP Silver match
- [ ] Upcoming state visible on a scheduled match
- [ ] `vercel.json` updated with both cron entries
- [ ] `source-priority.ts` updated
- [ ] CLAUDE.md documents `premierpadel` source
- [ ] `FinishedStatsSection` removed from match page

---

## Rollback plan

If any day's exit criteria fail and the fix is not obvious, revert by:

```bash
# Day 1-3 (data layer): drop the tables, matching restores work
DROP TABLE match_stats CASCADE;
DROP TABLE match_stats_unresolved CASCADE;
# Plus delete rows from entity_external_ids:
DELETE FROM entity_external_ids WHERE source = 'premierpadel';

# Day 4-5 (UI): revert the match page change
git revert <MatchStatsView wire-up commit>
git revert <legacy function removal commit>
```

The crons are idempotent — re-running them after a partial revert is safe.

---

**End of plan.** Ready to execute task-by-task via superpowers:subagent-driven-development or superpowers:executing-plans.
