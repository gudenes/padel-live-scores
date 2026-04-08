# Premier Padel Match Stats Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest per-set service/return/points statistics from Premier Padel's public REST API and surface them on the Match Detail Stats tab. Foundation for future career stat aggregates on player profiles.

**Architecture:** Two new Vercel cron jobs (`premier-discovery` weekly, `premier-stats` hourly) populate one new table (`match_stats`) joined to existing `matches` rows via the existing `entity_external_ids` sidecar. UI consumes the data through a new `/api/match-stats` GET endpoint and a new `<MatchStatsView>` component on the existing Stats tab.

**Tech Stack:** Next.js 16 App Router, Supabase (PostgreSQL + service role), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-08-premier-padel-stats-integration-design.md`

**Pre-merge gating:** Wait until **after launch (April 13)**. None of these files exist on `main` yet — implementation can start in parallel on a feature branch but must not ship until launch is stable.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase/migrations/20260415_match_stats.sql` | Create | New `match_stats` table |
| `supabase/migrations/20260415_match_stats_unresolved.sql` | Create | Manual-link queue table |
| `src/lib/premier-api.ts` | Create | Thin REST client for premierpadel.com beforeauth API |
| `src/lib/premier-stats-parser.ts` | Create | Pure parser: API payload → match_stats row |
| `src/lib/source-matcher.ts` | Create | Token-subset entity matcher (extracted from merge-tournament-duplicates.ts) |
| `src/lib/__fixtures__/premier-match-6190.json` | Create | Frozen sample for parser tests |
| `src/lib/__tests__/premier-stats-parser.test.ts` | Create | Parser unit tests |
| `src/lib/__tests__/source-matcher.test.ts` | Create | Matcher unit tests |
| `src/lib/source-priority.ts` | Modify | Add `'match.stats': ['premierpadel']` |
| `src/app/api/cron/premier-discovery/route.ts` | Create | Weekly tournament + match link discovery |
| `src/app/api/cron/premier-stats/route.ts` | Create | Hourly stats sync for finished matches |
| `src/app/api/admin/premier-link/route.ts` | Create | Manual link override endpoint |
| `src/app/api/match-stats/route.ts` | Create | GET endpoint for the UI |
| `src/components/MatchStatsView.tsx` | Create | Stats tab content component |
| `src/components/MatchStatsBar.tsx` | Create | Reusable side-by-side stat bar |
| `src/app/match/[id]/page.tsx` | Modify | Wire `<MatchStatsView>` into existing stats tab |
| `src/app/ops/PremierLinkTab.tsx` | Create | Ops dashboard tab for unresolved queue |
| `src/app/ops/page.tsx` | Modify | Register PremierLinkTab |
| `vercel.json` | Modify | Add `premier-discovery` + `premier-stats` cron entries |
| `CLAUDE.md` | Modify | Document `premierpadel` as an additional source |

---

### Task 1: Migrations + schema

**Files:**
- Create: `supabase/migrations/20260415_match_stats.sql`
- Create: `supabase/migrations/20260415_match_stats_unresolved.sql`

- [ ] **Step 1: Write `match_stats` migration**

```sql
-- 20260415_match_stats.sql
-- Sidecar: per-match aggregate statistics (1:1 with matches).
-- Currently sourced exclusively from premierpadel.com beforeauth API.

CREATE TABLE IF NOT EXISTS public.match_stats (
  match_id            UUID PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,

  -- Service stats (per-team)
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

  -- Return stats (per-team)
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

  -- Total points
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

-- RLS: public read, service-role write
ALTER TABLE public.match_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read match_stats"
  ON public.match_stats FOR SELECT
  USING (true);

CREATE POLICY "Service role full access to match_stats"
  ON public.match_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

- [ ] **Step 2: Write `match_stats_unresolved` migration**

```sql
-- 20260415_match_stats_unresolved.sql
-- Queue for tournaments/matches that the auto-resolver couldn't link.
-- Read by the ops dashboard for manual override.

CREATE TABLE IF NOT EXISTS public.match_stats_unresolved (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source             TEXT NOT NULL,
  source_kind        TEXT NOT NULL CHECK (source_kind IN ('tournament', 'match')),
  source_id          TEXT NOT NULL,
  source_payload     JSONB,
  candidate_count    INT NOT NULL DEFAULT 0,
  reason             TEXT,
  resolved_at        TIMESTAMPTZ,
  resolved_match_id  UUID REFERENCES public.matches(id) ON DELETE SET NULL,
  resolved_tournament_id UUID REFERENCES public.tournaments(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS idx_match_stats_unresolved_unresolved
  ON public.match_stats_unresolved (source, source_kind)
  WHERE resolved_at IS NULL;

ALTER TABLE public.match_stats_unresolved ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to match_stats_unresolved"
  ON public.match_stats_unresolved FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

- [ ] **Step 3: Apply migrations via Supabase dashboard**

> **Manual step required.** The user must apply both migrations via the Supabase SQL editor before any cron will work.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260415_match_stats.sql supabase/migrations/20260415_match_stats_unresolved.sql
git commit -m "feat(db): add match_stats + match_stats_unresolved tables for Premier integration"
```

---

### Task 2: Premier API client

**Files:**
- Create: `src/lib/premier-api.ts`

- [ ] **Step 1: Define types**

```ts
// src/lib/premier-api.ts
// Thin client for premierpadel.com's public REST API (no auth required).
// All endpoints accept multipart/form-data and return { status: 1, data: ... }.

const API_BASE = 'https://premierpadel.com/premierpadel/api/'

export interface PremierTournamentSummary {
  tournaments_id: number
  full_name: string
  accommodation_start_date: string  // 'YYYY-MM-DD' or empty
  accommodation_end_date: string
  is_live: 'Yes' | 'No'
  is_recent_tournament: 'Yes' | 'No'
}

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
  total_points?: PremierStatRow[]  // only present on the 'Match' section
}

export interface PremierMatchScore {
  tournaments_match_id: number
  tournaments_id: number
  tournament_name: string
  court_name: string
  date: string
  start_time: string
  matchId: string         // bracket position 'MD003' / 'WQ012' etc
  draw_type: string       // 'MD' | 'MQ' | 'WD' | 'WQ' | 'MR' | 'WR'
  team1_player_name: string
  team1_partner_name: string
  team2_player_name: string
  team2_partner_player_name: string
  is_bye: 'Yes' | 'No'
  round: string
  round_name: string      // 'Men SF' | 'Women QF' | etc
  winner_id: string       // '0' | '1' | '2'
  status: string          // 'F' | 'P' | 'L' | 'S'
  team1_score: { set1?: number|null; set2?: number|null; set3?: number|null; set4?: number|null; set5?: number|null; tie1?: number|null; tie2?: number|null; tie3?: number|null; tie4?: number|null; tie5?: number|null; points?: string|null }
  team2_score: { set1?: number|null; set2?: number|null; set3?: number|null; set4?: number|null; set5?: number|null; tie1?: number|null; tie2?: number|null; tie3?: number|null; tie4?: number|null; tie5?: number|null; points?: string|null }
  // ...other fields ignored for v1
}

export interface PremierMatchDetail {
  match_score: PremierMatchScore
  match_state: PremierMatchStateSection[]
}
```

- [ ] **Step 2: Implement fetch helper**

```ts
async function premierFetch<T>(
  endpoint: string,
  fields: Record<string, string | number>,
  opts: { retries?: number; timeoutMs?: number } = {}
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
```

- [ ] **Step 3: Implement endpoint methods**

```ts
export async function fetchPremierTournamentDropdown(lang = 'en'): Promise<PremierTournamentSummary[]> {
  const data = await premierFetch<PremierTournamentSummary[]>('beforeauth/gettournamentsdropdown', { lang })
  return Array.isArray(data) ? data.filter(t => t.tournaments_id !== 28) : []  // 28 = "All"
}

export async function fetchPremierUpcomingMatches(tournamentsId: number) {
  const data = await premierFetch<{ tournaments_match: unknown[] }>('beforeauth/gettournamnetupcomingmatches', { tournaments_id: tournamentsId })
  return Array.isArray(data?.tournaments_match) ? data.tournaments_match : []
}

export async function fetchPremierMatchDetail(matchId: number, lang = 'en'): Promise<PremierMatchDetail | null> {
  try {
    const data = await premierFetch<PremierMatchDetail | unknown[]>('beforeauth/gettournamentsmatchdetail', { tournaments_match_id: matchId, lang })
    if (Array.isArray(data)) return null  // empty result
    return data
  } catch (err) {
    console.error(`[premier-api] match detail ${matchId} failed:`, err)
    return null
  }
}

// 200ms throttle helper for cron loops
export async function withThrottle<T>(fn: () => Promise<T>, ms = 200): Promise<T> {
  const result = await fn()
  await new Promise(r => setTimeout(r, ms))
  return result
}
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/premier-api.ts
git commit -m "feat(premier): add REST client for premierpadel.com beforeauth API"
```

---

### Task 3: Stats parser + tests

**Files:**
- Create: `src/lib/premier-stats-parser.ts`
- Create: `src/lib/__fixtures__/premier-match-6190.json`
- Create: `src/lib/__tests__/premier-stats-parser.test.ts`

- [ ] **Step 1: Save the fixture**

Save the actual response from `gettournamentsmatchdetail?tournaments_match_id=6190` to `src/lib/__fixtures__/premier-match-6190.json`. (Can be re-fetched via curl during implementation; the design doc has the curl command.)

- [ ] **Step 2: Write the parser**

```ts
// src/lib/premier-stats-parser.ts
import type { PremierMatchDetail, PremierStatRow } from './premier-api'

export interface MatchStatsRow {
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

const num = (v: unknown): number | null => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

export function parseMatchStatsPayload(payload: PremierMatchDetail): MatchStatsRow | null {
  const matchSection = payload?.match_state?.find(s => s.title === 'Match')
  if (!matchSection) return null

  const findStat = (rows: PremierStatRow[] | undefined, title: string) =>
    rows?.find(s => s.title === title)

  const fs = findStat(matchSection.service, 'First Serve Points Won')
  const ss = findStat(matchSection.service, 'Second Serve Points Won')
  const sg = findStat(matchSection.service, 'Services Games Played')
  const fr = findStat(matchSection.return, 'First Return Points Won')
  const sr = findStat(matchSection.return, 'Second Return Points Won')
  const rg = findStat(matchSection.return, 'Return Games Played')
  const tp = findStat(matchSection.total_points, 'Total Points Won')
  const tsp = findStat(matchSection.total_points, 'Total Serve Points Won')
  const trp = findStat(matchSection.total_points, 'Total Return Points Won')
  const lps = findStat(matchSection.total_points, 'Longest Points Won Streak')

  return {
    team1_first_serve_won:    num(fs?.team_1.won),
    team1_first_serve_played: num(fs?.team_1.played),
    team2_first_serve_won:    num(fs?.team_2.won),
    team2_first_serve_played: num(fs?.team_2.played),
    team1_second_serve_won:    num(ss?.team_1.won),
    team1_second_serve_played: num(ss?.team_1.played),
    team2_second_serve_won:    num(ss?.team_2.won),
    team2_second_serve_played: num(ss?.team_2.played),
    team1_service_games: num(sg?.team_1.title),
    team2_service_games: num(sg?.team_2.title),

    team1_first_return_won:    num(fr?.team_1.won),
    team1_first_return_played: num(fr?.team_1.played),
    team2_first_return_won:    num(fr?.team_2.won),
    team2_first_return_played: num(fr?.team_2.played),
    team1_second_return_won:    num(sr?.team_1.won),
    team1_second_return_played: num(sr?.team_1.played),
    team2_second_return_won:    num(sr?.team_2.won),
    team2_second_return_played: num(sr?.team_2.played),
    team1_return_games: num(rg?.team_1.title),
    team2_return_games: num(rg?.team_2.title),

    team1_total_points_won:    num(tp?.team_1.won),
    team1_total_points_played: num(tp?.team_1.played),
    team2_total_points_won:    num(tp?.team_2.won),
    team2_total_points_played: num(tp?.team_2.played),
    team1_serve_points_won:    num(tsp?.team_1.won),
    team1_serve_points_played: num(tsp?.team_1.played),
    team2_serve_points_won:    num(tsp?.team_2.won),
    team2_serve_points_played: num(tsp?.team_2.played),
    team1_return_points_won:    num(trp?.team_1.won),
    team1_return_points_played: num(trp?.team_1.played),
    team2_return_points_won:    num(trp?.team_2.won),
    team2_return_points_played: num(trp?.team_2.played),
    team1_longest_streak: num(lps?.team_1.title),
    team2_longest_streak: num(lps?.team_2.title),
  }
}
```

- [ ] **Step 3: Write tests**

```ts
// src/lib/__tests__/premier-stats-parser.test.ts
import { describe, it, expect } from 'vitest'
import fixture from '../__fixtures__/premier-match-6190.json'
import { parseMatchStatsPayload } from '../premier-stats-parser'

describe('parseMatchStatsPayload', () => {
  it('returns null when match_state is missing', () => {
    expect(parseMatchStatsPayload({} as never)).toBeNull()
  })

  it('returns null when no Match section exists', () => {
    expect(parseMatchStatsPayload({ match_state: [{ title: 'set 1', service: [], return: [] }] } as never)).toBeNull()
  })

  it('parses Miami P1 SF (Stupaczuk/Yanguas vs Galán/Chingotto)', () => {
    const out = parseMatchStatsPayload(fixture as never)
    expect(out).not.toBeNull()
    // Spot-check known values from the live API
    expect(out!.team1_first_serve_won).toBe(23)
    expect(out!.team1_first_serve_played).toBe(41)
    expect(out!.team2_first_serve_won).toBe(28)
    expect(out!.team2_first_serve_played).toBe(39)
    expect(out!.team1_total_points_won).toBe(39)
    expect(out!.team2_total_points_won).toBe(55)
    expect(out!.team2_longest_streak).toBe(7)
  })

  it('coerces empty strings to null', () => {
    const payload = {
      match_state: [{
        title: 'Match',
        service: [{ title: 'First Serve Points Won', team_1: { won: '', played: '', percentage: '', is_winner: 'No' }, team_2: { won: '', played: '', percentage: '', is_winner: 'No' } }],
        return: [],
        total_points: [],
      }],
    }
    const out = parseMatchStatsPayload(payload as never)
    expect(out!.team1_first_serve_won).toBeNull()
    expect(out!.team1_first_serve_played).toBeNull()
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/premier-stats-parser.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/premier-stats-parser.ts src/lib/__fixtures__/premier-match-6190.json src/lib/__tests__/premier-stats-parser.test.ts
git commit -m "feat(premier): parser + fixture + tests for match stats payload"
```

---

### Task 4: Source matcher (extract from existing dedup script)

**Files:**
- Create: `src/lib/source-matcher.ts`
- Create: `src/lib/__tests__/source-matcher.test.ts`

- [ ] **Step 1: Extract token-subset matcher from `scripts/merge-tournament-duplicates.ts`**

Move the normalization + matching helpers into `src/lib/source-matcher.ts`. Export:

```ts
export const NOISE_TOKENS: ReadonlySet<string>
export function tokenize(s: string | null | undefined): string[]
export function isTokenSubset(needle: string, haystack: string): boolean
export function tokenSimilarity(a: string, b: string): number  // 0..1 Jaccard
export function yearOf(date: string | Date | null | undefined): number | null
```

- [ ] **Step 2: Update `merge-tournament-duplicates.ts` to import from the lib**

Replace the inline helpers with `import { tokenize, isTokenSubset, yearOf } from '../src/lib/source-matcher'`. Verify the existing dedup behavior is unchanged via dry-run.

- [ ] **Step 3: Add unit tests**

Cases:
- Diacritic stripping: `Núñez` matches `Nunez`
- Year stripping: `Newgiza P2 2026` tokens = `['newgiza','p2']`
- Noise filtering: `LOTTO BRUSSELS PREMIER PADEL P2 PRESENTED BY BELFIUS` tokens = `['brussels','p2']`
- Subset directionality: `Newgiza P2` is a subset of `Newgiza P2 2026`
- Cross-source: `Brussels P2` matches `Lotto Brussels Premier Padel P2 Presented by Belfius`

- [ ] **Step 4: Commit**

```bash
git add src/lib/source-matcher.ts src/lib/__tests__/source-matcher.test.ts scripts/merge-tournament-duplicates.ts
git commit -m "refactor(matcher): extract token-subset matcher to src/lib/source-matcher.ts"
```

---

### Task 5: Discovery cron — tournament linking

**Files:**
- Create: `src/app/api/cron/premier-discovery/route.ts`

- [ ] **Step 1: Implement tournament discovery loop**

```ts
// src/app/api/cron/premier-discovery/route.ts
// Weekly: pull all Premier tournaments, attempt to link to our DB,
// then for newly-linked tournaments, attempt to link individual matches.

import { createClient } from '@supabase/supabase-js'
import { fetchPremierTournamentDropdown, fetchPremierUpcomingMatches, withThrottle } from '@/lib/premier-api'
import { tokenize, isTokenSubset, yearOf } from '@/lib/source-matcher'
import { findEntityBySourceId, registerSourceId } from '@/lib/external-id-registry'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const premiers = await fetchPremierTournamentDropdown('en')
  let tournamentsLinked = 0
  let tournamentsAlready = 0
  let tournamentsUnresolved = 0

  // Pre-fetch ALL our tournaments once (small dataset, ~150 rows)
  const { data: ours } = await supabase
    .from('tournaments')
    .select('id, padelapi_id, fip_id, name, level, source, starts_at')
    .in('source', ['padelapi', 'fip'])

  for (const p of premiers) {
    // Skip if already linked
    const existing = await findEntityBySourceId(supabase, 'tournament', 'premierpadel', String(p.tournaments_id))
    if (existing) { tournamentsAlready++; continue }

    // Token-subset match within ±90 days of Premier's date
    const py = yearOf(p.accommodation_start_date)
    const pName = p.full_name
    const candidates = (ours ?? []).filter(o => {
      if (py && yearOf(o.starts_at) !== py) return false
      return isTokenSubset(pName, o.name) || isTokenSubset(o.name, pName)
    })

    if (candidates.length === 1) {
      await registerSourceId(supabase, {
        entityType: 'tournament',
        entityId: candidates[0].id,
        source: 'premierpadel',
        externalId: String(p.tournaments_id),
        metadata: { name: p.full_name, accommodation_start_date: p.accommodation_start_date },
      })
      tournamentsLinked++
    } else {
      // Queue for manual review
      await supabase.from('match_stats_unresolved').upsert({
        source: 'premierpadel',
        source_kind: 'tournament',
        source_id: String(p.tournaments_id),
        source_payload: p,
        candidate_count: candidates.length,
        reason: candidates.length === 0 ? 'no_candidate' : 'multiple_candidates',
      }, { onConflict: 'source,source_kind,source_id' })
      tournamentsUnresolved++
    }
  }

  // Phase 2 of this cron: walk newly-linked tournaments and link their matches
  // (implemented in Task 6)
  const matchResult = await linkMatchesForLinkedTournaments()

  return Response.json({
    ok: true,
    tournaments: { linked: tournamentsLinked, already: tournamentsAlready, unresolved: tournamentsUnresolved },
    matches: matchResult,
  })
}
```

- [ ] **Step 2: Test locally with curl**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/premier-discovery | python3 -m json.tool
```

Expect ~46 tournaments linked, ~28 unresolved on first run.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/premier-discovery/route.ts
git commit -m "feat(cron): premier-discovery links tournaments via token-subset matcher"
```

---

### Task 6: Discovery cron — match linking

**Files:**
- Modify: `src/app/api/cron/premier-discovery/route.ts`

- [ ] **Step 1: Implement `linkMatchesForLinkedTournaments`**

```ts
async function linkMatchesForLinkedTournaments() {
  // Find tournaments that have a premier mapping but where matches are not yet linked
  const { data: linkedTournaments } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'tournament')
    .eq('source', 'premierpadel')

  let matchesLinked = 0
  let matchesUnresolved = 0

  for (const lt of linkedTournaments ?? []) {
    const ourTournamentId = lt.entity_id as string
    const premierTournamentId = Number(lt.external_id)

    // Pull our matches for this tournament with player names
    const { data: ourMatches } = await supabase
      .from('matches')
      .select(`
        id, round, category,
        pair1_player1:players!matches_pair1_player1_id_fkey(name),
        pair1_player2:players!matches_pair1_player2_id_fkey(name),
        pair2_player1:players!matches_pair2_player1_id_fkey(name),
        pair2_player2:players!matches_pair2_player2_id_fkey(name)
      `)
      .eq('tournament_id', ourTournamentId)

    if (!ourMatches?.length) continue

    // Pull Premier's match list
    const premierMatches = await withThrottle(() => fetchPremierUpcomingMatches(premierTournamentId))

    for (const pm of premierMatches as Array<Record<string, unknown>>) {
      // Skip already-linked
      const existing = await findEntityBySourceId(supabase, 'match', 'premierpadel', String(pm.tournaments_match_id))
      if (existing) continue

      const { matched, score } = matchPremierMatchToOurs(pm, ourMatches)
      if (matched && score >= 3) {
        await registerSourceId(supabase, {
          entityType: 'match',
          entityId: matched.id,
          source: 'premierpadel',
          externalId: String(pm.tournaments_match_id),
          metadata: {
            draw_type: pm.draw_type,
            round_name: pm.round_name,
            matchId: pm.matchId,
          },
        })
        matchesLinked++
      } else {
        await supabase.from('match_stats_unresolved').upsert({
          source: 'premierpadel',
          source_kind: 'match',
          source_id: String(pm.tournaments_match_id),
          source_payload: pm,
          candidate_count: ourMatches.length,
          reason: 'no_player_match',
        }, { onConflict: 'source,source_kind,source_id' })
        matchesUnresolved++
      }
    }
  }

  return { linked: matchesLinked, unresolved: matchesUnresolved }
}
```

- [ ] **Step 2: Implement `matchPremierMatchToOurs`**

```ts
function lastNameOf(full: string | null | undefined): string {
  if (!full) return ''
  const norm = full.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const parts = norm.trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

interface OurMatchRow {
  id: string
  round: string | null
  category: string | null
  pair1_player1: { name: string | null } | null
  pair1_player2: { name: string | null } | null
  pair2_player1: { name: string | null } | null
  pair2_player2: { name: string | null } | null
}

function matchPremierMatchToOurs(pm: Record<string, unknown>, candidates: OurMatchRow[]): { matched: OurMatchRow | null; score: number } {
  const premierLastNames = new Set([
    lastNameOf(pm.team1_player_name as string),
    lastNameOf(pm.team1_partner_name as string),
    lastNameOf(pm.team2_player_name as string),
    lastNameOf(pm.team2_partner_player_name as string),
  ].filter(Boolean))

  // Map Premier round_name → our round
  const roundFromPremier = (pm.round_name as string ?? '').toLowerCase()
  const isMen = roundFromPremier.startsWith('men')
  const ourCategory = isMen ? 'men' : 'women'
  const ourRound = roundFromPremier.replace(/^(men|women)\s+/, '').toUpperCase().trim()  // 'SF', 'QF', 'R32', 'F'

  let best: OurMatchRow | null = null
  let bestScore = 0

  for (const c of candidates) {
    if (c.category && c.category !== ourCategory) continue
    if (c.round && c.round !== ourRound) continue
    const ourLastNames = new Set([
      lastNameOf(c.pair1_player1?.name),
      lastNameOf(c.pair1_player2?.name),
      lastNameOf(c.pair2_player1?.name),
      lastNameOf(c.pair2_player2?.name),
    ].filter(Boolean))
    const overlap = [...premierLastNames].filter(n => ourLastNames.has(n)).length
    if (overlap > bestScore) {
      bestScore = overlap
      best = c
    }
  }

  return { matched: best, score: bestScore }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/premier-discovery/route.ts
git commit -m "feat(cron): premier-discovery links matches via player last-name overlap"
```

---

### Task 7: Stats sync cron

**Files:**
- Create: `src/app/api/cron/premier-stats/route.ts`

- [ ] **Step 1: Implement the sync loop**

```ts
// src/app/api/cron/premier-stats/route.ts
// Hourly: fetch stats for matches finished in the last 7 days that have a Premier mapping.

import { createClient } from '@supabase/supabase-js'
import { fetchPremierMatchDetail, withThrottle } from '@/lib/premier-api'
import { parseMatchStatsPayload } from '@/lib/premier-stats-parser'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const MAX_PER_RUN = 100
const LOOKBACK_DAYS = 7

export async function GET(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // Find candidates: finished matches in lookback window with Premier mapping but no fresh stats
  const { data: candidates } = await supabase.rpc('select_premier_stats_candidates', {
    cutoff,
    limit_count: MAX_PER_RUN,
  })
  // ^ Defined as a Postgres function for efficiency. SQL in Step 2.

  let synced = 0
  let errored = 0
  let skipped = 0

  for (const row of candidates ?? []) {
    const result = await withThrottle(() => fetchPremierMatchDetail(Number(row.premier_match_id)))
    if (!result) { skipped++; continue }
    const parsed = parseMatchStatsPayload(result)
    if (!parsed) { skipped++; continue }

    const { error } = await supabase.from('match_stats').upsert({
      match_id: row.match_id,
      ...parsed,
      source: 'premierpadel',
      source_match_id: String(row.premier_match_id),
      raw_payload: result,
      computed_at: new Date().toISOString(),
    }, { onConflict: 'match_id' })

    if (error) { errored++; console.error('[premier-stats] upsert error', error) }
    else synced++
  }

  return Response.json({ ok: true, synced, errored, skipped, candidates: candidates?.length ?? 0 })
}
```

- [ ] **Step 2: Add the helper RPC**

Migration `20260415_premier_stats_candidates_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION public.select_premier_stats_candidates(
  cutoff TIMESTAMPTZ,
  limit_count INT
)
RETURNS TABLE (match_id UUID, premier_match_id TEXT)
LANGUAGE SQL STABLE AS $$
  SELECT m.id AS match_id, eei.external_id AS premier_match_id
  FROM matches m
  JOIN entity_external_ids eei
    ON eei.entity_type = 'match'
    AND eei.entity_id = m.id
    AND eei.source = 'premierpadel'
  LEFT JOIN match_stats ms ON ms.match_id = m.id
  WHERE m.status = 'finished'
    AND m.finished_at >= cutoff
    AND (ms.match_id IS NULL OR ms.computed_at < m.finished_at)
  ORDER BY m.finished_at DESC
  LIMIT limit_count;
$$;
```

- [ ] **Step 3: Test locally**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/premier-stats | python3 -m json.tool
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/premier-stats/route.ts supabase/migrations/20260415_premier_stats_candidates_rpc.sql
git commit -m "feat(cron): premier-stats hourly sync for finished matches"
```

---

### Task 8: Wire up Vercel cron

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add cron entries**

```json
{
  "crons": [
    /* ...existing... */
    { "path": "/api/cron/premier-discovery", "schedule": "0 4 * * 1" },
    { "path": "/api/cron/premier-stats",     "schedule": "13 * * * *" }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "chore(cron): schedule premier-discovery weekly + premier-stats hourly"
```

---

### Task 9: Match stats API endpoint

**Files:**
- Create: `src/app/api/match-stats/route.ts`

- [ ] **Step 1: Implement GET handler**

```ts
// src/app/api/match-stats/route.ts
// Public read endpoint for the match Stats tab.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const matchId = url.searchParams.get('matchId')
  if (!matchId) return Response.json({ error: 'Missing matchId' }, { status: 400 })

  const { data, error } = await supabase
    .from('match_stats')
    .select('*')
    .eq('match_id', matchId)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!data) return Response.json({ stats: null })

  // Return only the columns the UI needs (drop raw_payload for payload size)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { raw_payload, ...stats } = data
  return Response.json({ stats }, { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/match-stats/route.ts
git commit -m "feat(api): GET /api/match-stats for the Stats tab"
```

---

### Task 10: Stats UI component

**Files:**
- Create: `src/components/MatchStatsBar.tsx`
- Create: `src/components/MatchStatsView.tsx`
- Modify: `src/app/match/[id]/page.tsx`

- [ ] **Step 1: Create reusable bar component**

```tsx
// src/components/MatchStatsBar.tsx
'use client'
interface Props {
  label: string
  team1Value: number | null
  team2Value: number | null
  team1Display: string
  team2Display: string
}

export function MatchStatsBar({ label, team1Value, team2Value, team1Display, team2Display }: Props) {
  // Render side-by-side bars with chunky styling matching existing design system
  // ...
}
```

- [ ] **Step 2: Create the stats view**

```tsx
// src/components/MatchStatsView.tsx
'use client'
import { useEffect, useState } from 'react'
import { MatchStatsBar } from './MatchStatsBar'

export function MatchStatsView({ matchId }: { matchId: string }) {
  const [stats, setStats] = useState<Record<string, number | null> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/match-stats?matchId=${matchId}`)
      .then(r => r.json())
      .then(d => { setStats(d.stats); setLoading(false) })
      .catch(() => setLoading(false))
  }, [matchId])

  if (loading) return <SkeletonBars />
  if (!stats) return <EmptyState />

  return (
    <div>
      <Section title="Service">
        <MatchStatsBar label="1st Serve %" team1Value={pct(stats.team1_first_serve_won, stats.team1_first_serve_played)} team2Value={pct(stats.team2_first_serve_won, stats.team2_first_serve_played)} team1Display={`${stats.team1_first_serve_won}/${stats.team1_first_serve_played}`} team2Display={`${stats.team2_first_serve_won}/${stats.team2_first_serve_played}`} />
        {/* ...etc... */}
      </Section>
      {/* Return + Total sections */}
    </div>
  )
}

function pct(won: number | null, played: number | null) {
  if (won == null || played == null || played === 0) return null
  return Math.round((won / played) * 100)
}
```

- [ ] **Step 3: Wire into the match page**

Replace the existing stats tab placeholder in `src/app/match/[id]/page.tsx`:

```tsx
{tab === 'stats' && <MatchStatsView matchId={match.id} />}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/MatchStatsView.tsx src/components/MatchStatsBar.tsx src/app/match/[id]/page.tsx
git commit -m "feat(ui): MatchStatsView renders Premier stats on match detail"
```

---

### Task 11: Manual link override + ops UI

**Files:**
- Create: `src/app/api/admin/premier-link/route.ts`
- Create: `src/app/ops/PremierLinkTab.tsx`
- Modify: `src/app/ops/page.tsx`

- [ ] **Step 1: Implement POST /api/admin/premier-link**

```ts
// src/app/api/admin/premier-link/route.ts
// Manual override: link a Premier tournament/match to one of our rows.

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { registerSourceId } from '@/lib/external-id-registry'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

async function checkOpsAuth(): Promise<Response | null> {
  const c = await cookies()
  if (c.get('ops_token')?.value !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

export async function POST(request: Request) {
  const authError = await checkOpsAuth()
  if (authError) return authError

  const body = await request.json() as { kind: 'tournament' | 'match'; ourId: string; premierId: string }
  const { kind, ourId, premierId } = body

  await registerSourceId(supabase, {
    entityType: kind,
    entityId: ourId,
    source: 'premierpadel',
    externalId: premierId,
  })

  // Mark unresolved row as resolved
  await supabase.from('match_stats_unresolved')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_match_id: kind === 'match' ? ourId : null,
      resolved_tournament_id: kind === 'tournament' ? ourId : null,
    })
    .eq('source', 'premierpadel')
    .eq('source_kind', kind)
    .eq('source_id', premierId)

  return Response.json({ ok: true })
}
```

- [ ] **Step 2: Build the ops dashboard tab**

`src/app/ops/PremierLinkTab.tsx` — list unresolved rows from `match_stats_unresolved` with two dropdowns (our entity selector + Premier source preview) and a "Link" button. Mirror the existing `EntryListTab.tsx` patterns.

- [ ] **Step 3: Register the new tab**

In `src/app/ops/page.tsx`, add `<PremierLinkTab />` to the existing tab array.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/premier-link/route.ts src/app/ops/PremierLinkTab.tsx src/app/ops/page.tsx
git commit -m "feat(ops): manual Premier link override + unresolved queue UI"
```

---

### Task 12: Source priority + docs

**Files:**
- Modify: `src/lib/source-priority.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add stats field to source priority map**

```ts
// In src/lib/source-priority.ts
'match.stats': ['premierpadel'],
```

- [ ] **Step 2: Document Premier source in CLAUDE.md**

Add a paragraph to the "Data Model" section noting:
- `premierpadel` is a tertiary source for `match.stats` only
- Mappings live in `entity_external_ids` (no hot column)
- Manual link queue in `match_stats_unresolved`
- Polling: weekly discovery + hourly stats sync

- [ ] **Step 3: Commit**

```bash
git add src/lib/source-priority.ts CLAUDE.md
git commit -m "docs: add premierpadel as tertiary source for match.stats"
```

---

### Task 13: End-to-end verification

> Manual verification before merging the branch.

- [ ] Run discovery cron locally; expect tournament linked count > 0
- [ ] Run stats sync cron locally; expect synced count > 0 for any recent finished match
- [ ] Open `/match/<uuid>` for a known finished Premier match → Stats tab renders bars
- [ ] Open `/match/<uuid>` for a FIP non-Premier match → Stats tab shows empty state gracefully
- [ ] Visit `/ops` → Premier Link tab → unresolved entries visible → manually link one → it disappears from queue
- [ ] `npm run build` clean
- [ ] All tests green

---

### Task 14: Phase 2 — Player career stat aggregates

> Defer until at least 2 weeks of stats data exists. References the existing `2026-04-07-player-stats-materialization-design.md` plan.

- [ ] Add new columns to `player_stats_snapshot`: career 1st serve %, return %, longest streak avg, etc.
- [ ] Modify the snapshot cron to JOIN through `match_stats`
- [ ] Add "Career Stats" card to player profile Overview tab
- [ ] Verify Tapia's profile shows real numbers

---

### Task 15: Phase 3 — Backfill historical Premier matches

- [ ] Drop the date filter on discovery cron
- [ ] Manually run discovery once to walk all 75 Premier tournaments
- [ ] Manually run stats sync repeatedly until backlog is drained (~50 runs at 100/run, or temporarily bump MAX_PER_RUN to 1000)
- [ ] Verify ~5,000 historical match_stats rows exist
- [ ] Run player-stats-snapshot cron to materialize career aggregates

---

## Estimated effort

| Task | LOC | Hours |
|---|---|---|
| 1. Migrations | 150 | 0.5 |
| 2. API client | 120 | 1.0 |
| 3. Parser + tests | 200 | 1.5 |
| 4. Source matcher extract | 80 | 1.0 |
| 5. Discovery cron tournaments | 150 | 1.5 |
| 6. Discovery cron matches | 150 | 1.5 |
| 7. Stats sync cron | 100 | 1.0 |
| 8. Vercel cron config | 5 | 0.1 |
| 9. Match stats API | 40 | 0.3 |
| 10. UI component | 200 | 2.0 |
| 11. Manual link UI | 150 | 1.5 |
| 12. Source priority + docs | 30 | 0.3 |
| 13. Verification | 0 | 1.0 |
| **Total** | **~1375** | **~13 hours** |

Roughly two days of focused work, or one week interleaved with launch hardening.

---

**End of plan.** Awaits user review before any implementation begins.
