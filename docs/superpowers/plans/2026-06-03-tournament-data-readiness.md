# Tournament Data Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-tournament data-readiness view in the ops admin that scores every in-scope 2026 main-tier tournament against status- and tier-aware expectations, measured against what's actually in the public tables, surfacing the "scraped but not populated" gap (the FIP Ijuí case).

**Architecture:** Approach A — a pure, unit-tested rules engine (`readiness.ts`) plus one read API route that assembles set-based rollups and feeds the engine, rendered by a new view with List + Calendar modes. No new tables, no worker. Recomputed per page load.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Supabase (`@supabase/supabase-js`) · Vitest · token-driven CSS (light/dark).

**Spec:** `docs/superpowers/specs/2026-06-03-tournament-data-readiness-design.md`

---

## v1 implementation notes (refinements vs the spec, all consistent with its intent)

- **Page location:** `/system/data-readiness` (folder `app/(app)/system/data-readiness/`), to match the Rail's System group where the entry lives. (Spec sketched `tournament-readiness/`; this reconciles it with the approved Rail placement.)
- **Results signal:** a finished match counts as "scored" by `winner_pair != null`. We do **not** fetch the `sets` table in v1 (avoids a large secondary fetch); sets-level rigor is a future refinement.
- **Stats expectation:** Premier Stats is **partial** (missing → Gaps, never Broken) — analytics, not core data. FIP → always N/A.
- **Streams:** FIP via `fip_court_streams` presence; **Premier → N/A in v1** (no reliable Premier streams source in-repo). Streams can never push a verdict past Gaps.
- **Divergence** uses snapshot **presence** (a `captured_at` exists) paired with absent public data — not recency — because the Ijuí snapshots are months old yet still prove "scraped."

## File structure

**Create:**
- `apps/ops/src/lib/db-paginate.ts` — mirror of the root helper (apps/ops doesn't have one).
- `apps/ops/src/lib/tier-colors.ts` — shared tier→color map (extracted from CalendarView).
- `apps/ops/src/lib/readiness.ts` — pure rules engine (types + `computeReadiness`).
- `apps/ops/src/lib/__tests__/readiness.test.ts` — Vitest suite for the engine.
- `apps/ops/src/app/api/internal/tournament-readiness/route.ts` — the read endpoint.
- `apps/ops/src/app/(app)/system/data-readiness/page.tsx` — route page.
- `apps/ops/src/app/(app)/system/data-readiness/_components/types.ts` — shared view types (the API response shape).
- `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx` — shell (fetch, view toggle, filters, KPI strip).
- `apps/ops/src/app/(app)/system/data-readiness/_components/DimensionMatrix.tsx` — the 7-dot matrix + legend + `ReadinessDot`.
- `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessList.tsx` — grouped table.
- `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx` — verdict-colored lane calendar.

**Modify:**
- `apps/ops/src/app/globals.css` — add `--rd-*` tokens to both theme blocks.
- `apps/ops/src/app/(app)/tournament-explorer/_components/CalendarView.tsx` — import the shared tier-colors map instead of its local `LEVEL_COLOR`.
- `apps/ops/src/components/shell/Rail.tsx` — add the "Data Readiness" System nav entry.

**Test command:** `cd apps/ops && npx vitest run src/lib/__tests__/readiness.test.ts`
**Lint:** `cd apps/ops && npx eslint <files>`
**Build:** `cd apps/ops && npm run build`

---

## Task 1: Theme tokens for verdict/cell states

**Files:**
- Modify: `apps/ops/src/app/globals.css` (the `:root{…}` dark block, ends ~line 142; and the `:root[data-theme="light"]{…}` block, ends ~line 195)

- [ ] **Step 1: Add tokens to the dark `:root` block.** Insert just before the closing `}` of `:root{` (right after the `--men/--women` category lines, ~line 122):

```css
  /* readiness — verdict + cell states (data-readiness view) */
  --rd-ok:#5FB83A;   --rd-ok-bg:rgba(95,184,58,.14);   --rd-ok-border:rgba(95,184,58,.40);
  --rd-gap:#D9A441;  --rd-gap-bg:rgba(217,164,65,.14);  --rd-gap-border:rgba(217,164,65,.40);
  --rd-bad:#E0533D;  --rd-bad-bg:rgba(224,83,61,.16);   --rd-bad-border:rgba(224,83,61,.45);
  --rd-na:#3A3A3A;   --rd-na-border:#4A4A4A;
```

- [ ] **Step 2: Add the light-theme overrides.** Insert before the closing `}` of `:root[data-theme="light"]{`:

```css
  --rd-ok:#3F8B22;   --rd-ok-bg:rgba(63,139,34,.12);   --rd-ok-border:rgba(63,139,34,.34);
  --rd-gap:#B07D14;  --rd-gap-bg:rgba(176,125,20,.12);  --rd-gap-border:rgba(176,125,20,.34);
  --rd-bad:#C8341F;  --rd-bad-bg:rgba(200,52,31,.10);   --rd-bad-border:rgba(200,52,31,.32);
  --rd-na:#CDD2C2;   --rd-na-border:#B9BFA9;
```

- [ ] **Step 3: Commit.**

```bash
git add apps/ops/src/app/globals.css
git commit -m "feat(ops): add readiness verdict/cell theme tokens (light+dark)"
```

---

## Task 2: Extract shared tier colors

Extract the `LEVEL_COLOR` map so the new calendar and the existing one share one source.

**Files:**
- Create: `apps/ops/src/lib/tier-colors.ts`
- Modify: `apps/ops/src/app/(app)/tournament-explorer/_components/CalendarView.tsx:55-66` (remove local `LEVEL_COLOR`, import the shared one)

- [ ] **Step 1: Create the shared map** (verbatim values from the current CalendarView, plus the default):

```ts
// apps/ops/src/lib/tier-colors.ts
//
// Tier → bar colors, shared by the Tournament Explorer calendar and the
// Data Readiness calendar. Medal-themed for FIP, warm/saturated for Premier
// so headline events pop. Kept as one source of truth (DRY).

export interface TierColor { bg: string; border: string; text: string }

export const TIER_COLOR: Record<string, TierColor> = {
  major:        { bg: '#FF4655', border: '#C8313D', text: '#fff' },
  p1:           { bg: '#FF6B2B', border: '#CC5A23', text: '#fff' },
  p2:           { bg: '#F5A623', border: '#C2841C', text: '#000' },
  finals:       { bg: '#7C2D8E', border: '#5C2169', text: '#fff' },
  fip_platinum: { bg: '#9CA3AF', border: '#6B7280', text: '#000' },
  fip_gold:     { bg: '#D4AF37', border: '#A88A2B', text: '#000' },
  fip_silver:   { bg: '#C0C0C0', border: '#919191', text: '#000' },
  fip_bronze:   { bg: '#CD7F32', border: '#9F6325', text: '#fff' },
  fip_other:    { bg: '#94A3B8', border: '#64748B', text: '#fff' },
}

export const DEFAULT_TIER_COLOR: TierColor = {
  bg: 'var(--bg-hover)', border: 'var(--border-strong)', text: 'var(--text-2)',
}

/** Short tag label for a tier code, e.g. "P1", "Gold". */
export function tierTag(level: string | null): string {
  switch (level) {
    case 'major': return 'M'
    case 'p1': return 'P1'
    case 'p2': return 'P2'
    case 'finals': return 'F'
    case 'fip_platinum': return 'Pt'
    case 'fip_gold': return 'G'
    case 'fip_silver': return 'S'
    case 'fip_bronze': return 'B'
    default: return '·'
  }
}
```

- [ ] **Step 2: Refactor CalendarView** to use it. Replace the local `LEVEL_COLOR` (and `DEFAULT_COLOR`) constants at lines 55–66 with an import at the top of the file:

```ts
import { TIER_COLOR, DEFAULT_TIER_COLOR } from '@/lib/tier-colors'
```

Then replace usages: `LEVEL_COLOR[...]` → `TIER_COLOR[...]` and `DEFAULT_COLOR` → `DEFAULT_TIER_COLOR`. (Grep within the file to catch every reference.)

- [ ] **Step 3: Verify the explorer still builds/lints.**

Run: `cd apps/ops && npx eslint "src/app/(app)/tournament-explorer/_components/CalendarView.tsx" src/lib/tier-colors.ts`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add apps/ops/src/lib/tier-colors.ts "apps/ops/src/app/(app)/tournament-explorer/_components/CalendarView.tsx"
git commit -m "refactor(ops): extract shared tier-color map for reuse"
```

---

## Task 3: Mirror the db-paginate helper into apps/ops

`paginatedSelect` lives only in the root app. Copy it so the readiness route can beat the 10k PostgREST cap on the matches fetch.

**Files:**
- Create: `apps/ops/src/lib/db-paginate.ts`

- [ ] **Step 1: Copy the helper** from the root (`/Volumes/Crucial/dev/padel-live-scores/src/lib/db-paginate.ts`) verbatim into `apps/ops/src/lib/db-paginate.ts`. Read the source file first and reproduce it exactly (the signature is `paginatedSelect<T>(buildQuery, { pageSize?, maxRows?, what })`).

- [ ] **Step 2: Verify it lints/compiles.**

Run: `cd apps/ops && npx eslint src/lib/db-paginate.ts`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add apps/ops/src/lib/db-paginate.ts
git commit -m "chore(ops): mirror db-paginate helper into apps/ops"
```

---

## Task 4: Readiness rules engine (TDD)

The heart. Pure functions, fully unit-tested. This task is intentionally fine-grained.

**Files:**
- Create: `apps/ops/src/lib/readiness.ts`
- Test: `apps/ops/src/lib/__tests__/readiness.test.ts`

- [ ] **Step 1: Write the failing test file.**

```ts
// apps/ops/src/lib/__tests__/readiness.test.ts
import { describe, it, expect } from 'vitest'
import {
  deriveStage, computeReadiness, isPremierTier, IN_SCOPE_TIERS,
  type TournamentRollup,
} from '@/lib/readiness'

const TODAY = '2026-06-03'

// A fully-healthy completed FIP Bronze event.
function healthyCompletedFip(): TournamentRollup {
  return {
    id: 't-ok', level: 'fip_bronze',
    startsAt: '2026-03-02', endsAt: '2026-03-08', registrationStatus: 'closed',
    finalPlayed: true,
    matchCount: 60, liveOrScheduledCount: 0,
    finishedCount: 60, finishedWithWinner: 60,
    playerSlotsTotal: 240, playerSlotsResolved: 240,
    oopPopulated: 60,
    hasMatchStats: false, entryListResolved: true, hasStreams: false,
    drawSnapshotAt: '2026-03-02', oopSnapshotAt: '2026-03-05', resultsSnapshotAt: '2026-03-08',
  }
}

describe('isPremierTier', () => {
  it('classifies Premier tiers', () => {
    expect(isPremierTier('p1')).toBe(true)
    expect(isPremierTier('major')).toBe(true)
    expect(isPremierTier('fip_bronze')).toBe(false)
    expect(isPremierTier(null)).toBe(false)
  })
  it('IN_SCOPE_TIERS excludes fip_other', () => {
    expect(IN_SCOPE_TIERS).not.toContain('fip_other')
    expect(IN_SCOPE_TIERS).toContain('fip_bronze')
  })
})

describe('deriveStage', () => {
  it('completed when finalPlayed', () => {
    const r = { ...healthyCompletedFip(), endsAt: '2026-12-31', finalPlayed: true }
    expect(deriveStage(r, TODAY)).toBe('completed')
  })
  it('completed when ends_at in the past', () => {
    const r = { ...healthyCompletedFip(), finalPlayed: false, endsAt: '2026-05-01' }
    expect(deriveStage(r, TODAY)).toBe('completed')
  })
  it('ongoing when within the date window', () => {
    const r = { ...healthyCompletedFip(), finalPlayed: false, startsAt: '2026-06-01', endsAt: '2026-06-07' }
    expect(deriveStage(r, TODAY)).toBe('ongoing')
  })
  it('ongoing when it has live/scheduled matches even outside the window', () => {
    const r = { ...healthyCompletedFip(), finalPlayed: false, startsAt: '2026-06-20', endsAt: '2026-06-26', liveOrScheduledCount: 12 }
    expect(deriveStage(r, TODAY)).toBe('ongoing')
  })
  it('upcoming when start is in the future and nothing has played', () => {
    const r = { ...healthyCompletedFip(), finalPlayed: false, startsAt: '2026-08-01', endsAt: '2026-08-07', liveOrScheduledCount: 0, matchCount: 0, finishedCount: 0, finishedWithWinner: 0 }
    expect(deriveStage(r, TODAY)).toBe('upcoming')
  })
})

describe('computeReadiness', () => {
  const cell = (res: ReturnType<typeof computeReadiness>, key: string) =>
    res.dimensions.find(d => d.key === key)!.state

  it('healthy completed FIP → OK, no divergence', () => {
    const res = computeReadiness(healthyCompletedFip(), TODAY)
    expect(res.stage).toBe('completed')
    expect(res.verdict).toBe('ok')
    expect(res.divergent).toBe(false)
    expect(cell(res, 'stats')).toBe('na')   // FIP → N/A
    expect(cell(res, 'matches')).toBe('ok')
  })

  it('Ijuí case: snapshots present but 0 matches → Broken + divergent', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-ijui',
      matchCount: 0, finishedCount: 0, finishedWithWinner: 0,
      playerSlotsTotal: 0, playerSlotsResolved: 0, oopPopulated: 0,
      // snapshots still present (scraped) — this is the signal
      drawSnapshotAt: '2026-04-26', oopSnapshotAt: '2026-04-26', resultsSnapshotAt: '2026-04-26',
    }
    const res = computeReadiness(r, TODAY)
    expect(res.verdict).toBe('broken')
    expect(res.divergent).toBe(true)
    expect(cell(res, 'matches')).toBe('divergent')
    expect(cell(res, 'results')).toBe('divergent')
  })

  it('Premier ongoing missing stats → Gaps, never Broken', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-p1', level: 'p1',
      finalPlayed: false, startsAt: '2026-06-01', endsAt: '2026-06-07',
      hasMatchStats: false,
      finishedCount: 20, finishedWithWinner: 20,
    }
    const res = computeReadiness(r, TODAY)
    expect(res.stage).toBe('ongoing')
    expect(cell(res, 'stats')).toBe('missing')
    expect(res.verdict).toBe('gaps')
  })

  it('completed event with matches but zero winners → Broken (results required)', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-nowin',
      finishedCount: 60, finishedWithWinner: 0,
      // no results snapshot → not divergence, just missing
      resultsSnapshotAt: null,
    }
    const res = computeReadiness(r, TODAY)
    expect(cell(res, 'results')).toBe('missing')
    expect(res.verdict).toBe('broken')
  })

  it('upcoming event is not penalised for empty matches/results', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-up', finalPlayed: false,
      startsAt: '2026-08-01', endsAt: '2026-08-07',
      matchCount: 0, liveOrScheduledCount: 0, finishedCount: 0, finishedWithWinner: 0,
      playerSlotsTotal: 0, playerSlotsResolved: 0, oopPopulated: 0,
      drawSnapshotAt: null, oopSnapshotAt: null, resultsSnapshotAt: null,
      entryListResolved: true,
    }
    const res = computeReadiness(r, TODAY)
    expect(res.stage).toBe('upcoming')
    expect(cell(res, 'matches')).toBe('missing')   // present-as-missing…
    expect(res.verdict).toBe('ok')                  // …but optional, so OK
    expect(cell(res, 'players')).toBe('na')
  })

  it('partial player resolution during ongoing → Gaps', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-part', finalPlayed: false,
      startsAt: '2026-06-01', endsAt: '2026-06-07',
      playerSlotsTotal: 240, playerSlotsResolved: 120, // 50%
      finishedCount: 20, finishedWithWinner: 20,
      hasMatchStats: true,
    }
    const res = computeReadiness(r, TODAY)
    expect(cell(res, 'players')).toBe('partial')
    expect(res.verdict).toBe('gaps')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails.**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/readiness.test.ts`
Expected: FAIL — `Cannot find module '@/lib/readiness'`.

- [ ] **Step 3: Implement the engine.**

```ts
// apps/ops/src/lib/readiness.ts
//
// Pure rules engine for the Data Readiness view. No I/O. Given a
// per-tournament rollup (assembled by the route from set-based queries),
// it derives the lifecycle stage, evaluates each of the 7 dimensions
// against status- & tier-aware expectations, and rolls up a verdict.
// Design: docs/superpowers/specs/2026-06-03-tournament-data-readiness-design.md

export type Stage = 'upcoming' | 'ongoing' | 'completed'
export type CellState = 'ok' | 'partial' | 'missing' | 'na' | 'divergent'
export type Verdict = 'ok' | 'gaps' | 'broken'
export type DimensionKey =
  | 'matches' | 'players' | 'oop' | 'results' | 'entry' | 'stats' | 'streams'

export const IN_SCOPE_TIERS = [
  'major', 'p1', 'p2', 'finals',
  'fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze',
] as const

export function isPremierTier(level: string | null): boolean {
  return level === 'major' || level === 'p1' || level === 'p2' || level === 'finals'
}

export interface TournamentRollup {
  id: string
  level: string | null
  startsAt: string | null      // ISO (date or timestamp)
  endsAt: string | null
  registrationStatus: string | null
  finalPlayed: boolean
  matchCount: number
  liveOrScheduledCount: number // matches with status live/scheduled/ended/finished
  finishedCount: number
  finishedWithWinner: number
  playerSlotsTotal: number     // 4 * matchCount
  playerSlotsResolved: number  // non-null player FK slots
  oopPopulated: number         // matches with court or scheduled_at
  hasMatchStats: boolean
  entryListResolved: boolean
  hasStreams: boolean
  drawSnapshotAt: string | null
  oopSnapshotAt: string | null
  resultsSnapshotAt: string | null
}

export interface DimensionResult { key: DimensionKey; state: CellState; detail: string }
export interface ReadinessResult {
  stage: Stage
  verdict: Verdict
  divergent: boolean
  dimensions: DimensionResult[]
}

type Expect = 'required' | 'partial' | 'optional' | 'na'

const RESOLVED_OK = 0.95   // ≥95% slots resolved → ok
const RESULTS_OK = 0.99    // ≥99% finished matches have a winner → ok

export function deriveStage(r: TournamentRollup, today: string): Stage {
  const t = today.slice(0, 10)
  const starts = r.startsAt ? r.startsAt.slice(0, 10) : null
  const ends = r.endsAt ? r.endsAt.slice(0, 10) : null
  if (r.finalPlayed || (ends && ends < t)) return 'completed'
  const inWindow = !!(starts && ends && starts <= t && t <= ends)
  if (inWindow || r.liveOrScheduledCount > 0) return 'ongoing'
  return 'upcoming'
}

const EXPECT: Record<Stage, Record<DimensionKey, Expect>> = {
  upcoming:  { matches:'optional', players:'na',       oop:'na',       results:'na',      entry:'required', stats:'na',      streams:'optional' },
  ongoing:   { matches:'required', players:'required', oop:'required', results:'partial', entry:'required', stats:'partial', streams:'partial'  },
  completed: { matches:'required', players:'required', oop:'optional', results:'required', entry:'optional', stats:'partial', streams:'na'      },
}

/** Apply tier overrides on top of the base expectation. */
function expectFor(stage: Stage, key: DimensionKey, premier: boolean): Expect {
  const base = EXPECT[stage][key]
  if (key === 'stats' && !premier) return 'na'      // stats are Premier-only
  if (key === 'streams' && premier) return 'na'     // no Premier streams source in v1
  return base
}

function ratioState(num: number, denom: number, okAt: number): CellState {
  if (denom <= 0) return 'missing'
  const r = num / denom
  if (r >= okAt) return 'ok'
  if (r > 0) return 'partial'
  return 'missing'
}

/** Raw actual state per dimension, before expectation is applied. */
function actualState(key: DimensionKey, r: TournamentRollup, premier: boolean): CellState {
  const anyMatchSnapshot = !!(r.drawSnapshotAt || r.oopSnapshotAt || r.resultsSnapshotAt)
  switch (key) {
    case 'matches':
      if (anyMatchSnapshot && r.matchCount === 0) return 'divergent'
      return r.matchCount > 0 ? 'ok' : 'missing'
    case 'players':
      return ratioState(r.playerSlotsResolved, r.playerSlotsTotal, RESOLVED_OK)
    case 'oop':
      if (r.oopSnapshotAt && r.matchCount > 0 && r.oopPopulated === 0) return 'divergent'
      return ratioState(r.oopPopulated, r.matchCount, RESOLVED_OK)
    case 'results':
      if (r.resultsSnapshotAt && (r.matchCount === 0 || (r.finishedCount > 0 && r.finishedWithWinner === 0))) return 'divergent'
      return ratioState(r.finishedWithWinner, r.finishedCount, RESULTS_OK)
    case 'entry':
      return r.entryListResolved ? 'ok' : 'missing'
    case 'stats':
      if (!premier) return 'na'
      return r.hasMatchStats ? 'ok' : 'missing'
    case 'streams':
      if (premier) return 'na'
      return r.hasStreams ? 'ok' : 'missing'
  }
}

function severity(expect: Expect, state: CellState): Verdict {
  if (state === 'divergent') return 'broken'
  if (state === 'na') return 'ok'
  switch (expect) {
    case 'required': return state === 'missing' ? 'broken' : state === 'partial' ? 'gaps' : 'ok'
    case 'partial':  return state === 'missing' ? 'gaps' : 'ok'
    case 'optional': return 'ok'
    case 'na':       return 'ok'
  }
}

const RANK: Record<Verdict, number> = { ok: 0, gaps: 1, broken: 2 }

const DETAIL: Record<DimensionKey, (r: TournamentRollup) => string> = {
  matches: r => `${r.matchCount} matches`,
  players: r => r.playerSlotsTotal ? `${Math.round((r.playerSlotsResolved / r.playerSlotsTotal) * 100)}% resolved` : 'no matches',
  oop:     r => r.matchCount ? `${Math.round((r.oopPopulated / r.matchCount) * 100)}% scheduled` : 'no matches',
  results: r => r.finishedCount ? `${r.finishedWithWinner}/${r.finishedCount} scored` : 'no finished matches',
  entry:   r => (r.entryListResolved ? 'resolved' : 'no entry/draw data'),
  stats:   r => (r.hasMatchStats ? 'present' : 'none'),
  streams: r => (r.hasStreams ? 'present' : 'none'),
}

const ALL_DIMS: DimensionKey[] = ['matches', 'players', 'oop', 'results', 'entry', 'stats', 'streams']

export function computeReadiness(r: TournamentRollup, today: string): ReadinessResult {
  const stage = deriveStage(r, today)
  const premier = isPremierTier(r.level)

  const dimensions: DimensionResult[] = ALL_DIMS.map(key => {
    const expect = expectFor(stage, key, premier)
    const state: CellState = expect === 'na' ? 'na' : actualState(key, r, premier)
    return { key, state, detail: state === 'na' ? 'N/A' : DETAIL[key](r) }
  })

  const verdict = dimensions
    .map(d => severity(expectFor(stage, d.key, premier), d.state))
    .reduce<Verdict>((worst, v) => (RANK[v] > RANK[worst] ? v : worst), 'ok')

  const divergent = dimensions.some(d => d.state === 'divergent')
  return { stage, verdict, divergent, dimensions }
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/readiness.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Lint.**

Run: `cd apps/ops && npx eslint src/lib/readiness.ts src/lib/__tests__/readiness.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/lib/readiness.ts src/lib/__tests__/readiness.test.ts
git commit -m "feat(ops): readiness rules engine + unit tests"
```

---

## Task 5: The read API route

Assembles the in-scope set + rollups and runs the engine.

**Files:**
- Create: `apps/ops/src/app/api/internal/tournament-readiness/route.ts`
- Reference patterns: `apps/ops/src/app/api/internal/tournament-explorer/route.ts` (auth, snapshot queries, matches aggregation) and `apps/ops/src/app/api/internal/search/route.ts` (auth boilerplate).

- [ ] **Step 1: Write the route.**

```ts
// apps/ops/src/app/api/internal/tournament-readiness/route.ts
//
// Backing API for the Data Readiness view. For every in-scope 2026
// main-tier tournament it assembles a per-tournament rollup from set-based
// queries, then runs the pure readiness engine. Auth: isOperator.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { paginatedSelect } from '@/lib/db-paginate'
import {
  computeReadiness, isPremierTier, IN_SCOPE_TIERS,
  type TournamentRollup, type ReadinessResult,
} from '@/lib/readiness'

export const dynamic = 'force-dynamic'

const FROM = '2026-01-01'
const TO = '2026-12-31'

export interface ReadinessRow extends ReadinessResult {
  id: string
  name: string
  level: string | null
  startsAt: string | null
  endsAt: string | null
  matchCount: number
}

function isFinalRound(round: string | null): boolean {
  if (!round) return false
  const r = (round.trim().split(/\s+/).pop() ?? '').toLowerCase()
  return r === 'f' || r === 'final' || r === 'finals'
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()
  const today = new Date().toISOString().slice(0, 10)

  // 1) In-scope tournaments: 2026 window × main tiers.
  const { data: tData, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, level, source, status, starts_at, ends_at, registration_status, entry_list_status')
    .in('level', IN_SCOPE_TIERS as unknown as string[])
    .or(`and(starts_at.gte.${FROM},starts_at.lte.${TO}),and(ends_at.gte.${FROM},ends_at.lte.${TO})`)
    .order('starts_at', { ascending: true, nullsFirst: false })
    .limit(1000)
  if (tErr) return NextResponse.json({ error: `tournaments: ${tErr.message}` }, { status: 500 })

  const tournaments = (tData ?? []) as Array<{
    id: string; name: string | null; level: string | null; source: string | null
    status: string | null; starts_at: string | null; ends_at: string | null
    registration_status: string | null; entry_list_status: string | null
  }>
  const ids = tournaments.map(t => t.id)
  if (ids.length === 0) return NextResponse.json({ rows: [] as ReadinessRow[] })

  // 2) Matches rollup (paginated — can approach the 10k cap).
  const matchRows = await paginatedSelect<{
    id: string; tournament_id: string | null; status: string | null; round: string | null
    winner_pair: number | null; court: string | null; scheduled_at: string | null
    pair1_player1_id: string | null; pair1_player2_id: string | null
    pair2_player1_id: string | null; pair2_player2_id: string | null
  }>(
    (start, end) => supabase
      .from('matches')
      .select('id, tournament_id, status, round, winner_pair, court, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
      .in('tournament_id', ids)
      .range(start, end),
    { what: 'readiness matches rollup' },
  )

  // Aggregate per tournament.
  interface Agg {
    matchCount: number; liveOrScheduledCount: number; finishedCount: number; finishedWithWinner: number
    playerSlotsTotal: number; playerSlotsResolved: number; oopPopulated: number; finalPlayed: boolean
    matchIds: string[]
  }
  const agg = new Map<string, Agg>()
  const blank = (): Agg => ({ matchCount: 0, liveOrScheduledCount: 0, finishedCount: 0, finishedWithWinner: 0, playerSlotsTotal: 0, playerSlotsResolved: 0, oopPopulated: 0, finalPlayed: false, matchIds: [] })
  const ACTIVE = new Set(['live', 'scheduled', 'ended', 'finished'])
  for (const m of matchRows) {
    if (!m.tournament_id) continue
    const a = agg.get(m.tournament_id) ?? blank()
    a.matchCount += 1
    a.matchIds.push(m.id)
    if (m.status && ACTIVE.has(m.status)) a.liveOrScheduledCount += 1
    if (m.status === 'finished' || m.status === 'retired' || m.status === 'walkover') {
      a.finishedCount += 1
      if (m.winner_pair !== null) a.finishedWithWinner += 1
    }
    if (isFinalRound(m.round) && m.winner_pair !== null) a.finalPlayed = true
    const slots = [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id]
    a.playerSlotsTotal += 4
    a.playerSlotsResolved += slots.filter(Boolean).length
    if (m.court || m.scheduled_at) a.oopPopulated += 1
    agg.set(m.tournament_id, a)
  }

  // 3) match_stats presence per tournament (Premier only — bounded set).
  const premierMatchIds = tournaments
    .filter(t => isPremierTier(t.level))
    .flatMap(t => agg.get(t.id)?.matchIds ?? [])
  const statsTournamentIds = new Set<string>()
  if (premierMatchIds.length > 0) {
    const statsRows = await paginatedSelect<{ match_id: string }>(
      (start, end) => supabase.from('match_stats').select('match_id').in('match_id', premierMatchIds).range(start, end),
      { what: 'readiness match_stats' },
    )
    const matchToTournament = new Map<string, string>()
    for (const t of tournaments) for (const mid of agg.get(t.id)?.matchIds ?? []) matchToTournament.set(mid, t.id)
    for (const s of statsRows) {
      const tid = matchToTournament.get(s.match_id)
      if (tid) statsTournamentIds.add(tid)
    }
  }

  // 4) entry/draw presence + snapshot freshness + streams presence.
  const [drawsRes, streamsRes, entrySnapRes, drawSnapRes, oopSnapRes, resultsSnapRes] = await Promise.all([
    supabase.from('tournament_draws').select('tournament_id').in('tournament_id', ids),
    supabase.from('fip_court_streams').select('tournament_id').in('tournament_id', ids),
    supabase.schema('padelgod').from('entry_list_snapshots').select('tournament_id, captured_at').in('tournament_id', ids).order('captured_at', { ascending: false }),
    supabase.schema('padelgod').from('draw_snapshots').select('tournament_id, captured_at').in('tournament_id', ids).order('captured_at', { ascending: false }),
    supabase.schema('padelgod').from('oop_snapshots').select('tournament_id, captured_at').in('tournament_id', ids).order('captured_at', { ascending: false }),
    supabase.schema('padelgod').from('results_snapshots').select('tournament_id, captured_at').in('tournament_id', ids).order('captured_at', { ascending: false }),
  ])

  const setOf = (rows: Array<{ tournament_id: string }> | null) => new Set((rows ?? []).map(r => r.tournament_id))
  const latest = (rows: Array<{ tournament_id: string; captured_at: string }> | null) => {
    const m = new Map<string, string>()
    for (const r of rows ?? []) if (!m.has(r.tournament_id)) m.set(r.tournament_id, r.captured_at)
    return m
  }
  const hasDraws = setOf(drawsRes.data as Array<{ tournament_id: string }> | null)
  const hasStreams = setOf(streamsRes.data as Array<{ tournament_id: string }> | null)
  const entrySnap = latest(entrySnapRes.data as Array<{ tournament_id: string; captured_at: string }> | null)
  const drawSnap = latest(drawSnapRes.data as Array<{ tournament_id: string; captured_at: string }> | null)
  const oopSnap = latest(oopSnapRes.data as Array<{ tournament_id: string; captured_at: string }> | null)
  const resultsSnap = latest(resultsSnapRes.data as Array<{ tournament_id: string; captured_at: string }> | null)

  // 5) Build rollups and run the engine.
  const rows: ReadinessRow[] = tournaments.map(t => {
    const a = agg.get(t.id) ?? blank()
    const rollup: TournamentRollup = {
      id: t.id,
      level: t.level,
      startsAt: t.starts_at,
      endsAt: t.ends_at,
      registrationStatus: t.registration_status,
      finalPlayed: a.finalPlayed,
      matchCount: a.matchCount,
      liveOrScheduledCount: a.liveOrScheduledCount,
      finishedCount: a.finishedCount,
      finishedWithWinner: a.finishedWithWinner,
      playerSlotsTotal: a.playerSlotsTotal,
      playerSlotsResolved: a.playerSlotsResolved,
      oopPopulated: a.oopPopulated,
      hasMatchStats: statsTournamentIds.has(t.id),
      entryListResolved: hasDraws.has(t.id) || entrySnap.has(t.id),
      hasStreams: hasStreams.has(t.id),
      drawSnapshotAt: drawSnap.get(t.id) ?? null,
      oopSnapshotAt: oopSnap.get(t.id) ?? null,
      resultsSnapshotAt: resultsSnap.get(t.id) ?? null,
    }
    const result = computeReadiness(rollup, today)
    return { id: t.id, name: t.name ?? '(unnamed)', level: t.level, startsAt: t.starts_at, endsAt: t.ends_at, matchCount: a.matchCount, ...result }
  })

  return NextResponse.json({ rows })
}
```

- [ ] **Step 2: Lint.**

Run: `cd apps/ops && npx eslint src/app/api/internal/tournament-readiness/route.ts`
Expected: no errors.

- [ ] **Step 3: Verify live against the DB.** Start the ops dev server (`cd apps/ops && npm run dev`, port 3004) and, in the running preview, hit the endpoint:

Run (browser console / preview_eval): `fetch('/api/internal/tournament-readiness').then(r=>r.json()).then(d=>({count:d.rows?.length, ijui:d.rows?.find(r=>/IJU/i.test(r.name))}))`
Expected: a non-empty `rows` array; the Ijuí row has `verdict:'broken'`, `divergent:true`, and `matches`/`results` dimension cells `'divergent'`.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/internal/tournament-readiness/route.ts
git commit -m "feat(ops): tournament-readiness API route"
```

---

## Task 6: View shell — page, types, fetch, filters, KPI strip

**Files:**
- Create: `apps/ops/src/app/(app)/system/data-readiness/page.tsx`
- Create: `apps/ops/src/app/(app)/system/data-readiness/_components/types.ts`
- Create: `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx`

- [ ] **Step 1: Shared view types.**

```ts
// apps/ops/src/app/(app)/system/data-readiness/_components/types.ts
import type { Stage, Verdict, CellState, DimensionKey } from '@/lib/readiness'

export type { Stage, Verdict, CellState, DimensionKey }

export interface DimensionResult { key: DimensionKey; state: CellState; detail: string }
export interface ReadinessRow {
  id: string
  name: string
  level: string | null
  startsAt: string | null
  endsAt: string | null
  matchCount: number
  stage: Stage
  verdict: Verdict
  divergent: boolean
  dimensions: DimensionResult[]
}

export type ViewMode = 'list' | 'calendar'
export type GroupBy = 'tier' | 'stage' | 'verdict'
```

- [ ] **Step 2: The page.**

```tsx
// apps/ops/src/app/(app)/system/data-readiness/page.tsx
import ReadinessView from './_components/ReadinessView'

export const metadata = { title: 'Data Readiness · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function DataReadinessPage() {
  return <ReadinessView />
}
```

- [ ] **Step 3: The shell** — fetch, KPI strip, filters, view toggle. (List/Calendar bodies arrive in Tasks 7–8; render a placeholder for calendar for now.)

```tsx
// apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessView.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageHeader, KpiStrip, Kpi, Button, EmptyState, Skeleton } from '@/components/ui'
import type { ReadinessRow, ViewMode, GroupBy, Verdict, Stage } from './types'
import ReadinessList from './ReadinessList'
import ReadinessCalendar from './ReadinessCalendar'

const TIER_FILTERS: Array<{ code: string; label: string }> = [
  { code: 'major', label: 'Major' }, { code: 'p1', label: 'P1' }, { code: 'p2', label: 'P2' }, { code: 'finals', label: 'Finals' },
  { code: 'fip_platinum', label: 'Platinum' }, { code: 'fip_gold', label: 'Gold' }, { code: 'fip_silver', label: 'Silver' }, { code: 'fip_bronze', label: 'Bronze' },
]

export default function ReadinessView() {
  const [rows, setRows] = useState<ReadinessRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const [groupBy, setGroupBy] = useState<GroupBy>('tier')
  const [tierFilter, setTierFilter] = useState<Set<string>>(new Set())
  const [stageFilter, setStageFilter] = useState<Stage | null>(null)
  const [verdictFilter, setVerdictFilter] = useState<Verdict | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/internal/tournament-readiness')
      .then(r => r.json())
      .then((d: { rows?: ReadinessRow[]; error?: string }) => {
        if (cancelled) return
        if (d.error) { setError(d.error); return }
        setRows(d.rows ?? [])
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'failed') })
    return () => { cancelled = true }
  }, [])

  const filtered = useMemo(() => (rows ?? []).filter(r =>
    (tierFilter.size === 0 || (r.level !== null && tierFilter.has(r.level))) &&
    (stageFilter === null || r.stage === stageFilter) &&
    (verdictFilter === null || r.verdict === verdictFilter),
  ), [rows, tierFilter, stageFilter, verdictFilter])

  const counts = useMemo(() => {
    const c = { total: filtered.length, broken: 0, gaps: 0, ok: 0, divergent: 0 }
    for (const r of filtered) { c[r.verdict] += 1; if (r.divergent) c.divergent += 1 }
    return c
  }, [filtered])

  const toggleTier = (code: string) => setTierFilter(prev => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next
  })

  return (
    <div className="ui-page">
      <PageHeader
        title="Tournament Data Readiness"
        subtitle="2026 · main tiers. Each tournament is scored against status- & tier-aware expectations, measured against the public tables. Red = data the app needs is missing or was scraped-but-not-populated."
        actions={
          <div style={{ display: 'flex', gap: 4 }}>
            <Button variant={view === 'list' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('list')}>List</Button>
            <Button variant={view === 'calendar' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('calendar')}>Calendar</Button>
          </div>
        }
      />

      <KpiStrip cols={5}>
        <Kpi label="In scope" value={counts.total} />
        <Kpi label="Broken" value={counts.broken} tone="urgent" />
        <Kpi label="Gaps" value={counts.gaps} tone="warn" />
        <Kpi label="OK" value={counts.ok} tone="lime" />
        <Kpi label="Scraped, not populated" value={counts.divergent} tone="urgent" pulse={counts.divergent > 0} />
      </KpiStrip>

      {/* filters */}
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', margin: '14px 0' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Tier</span>
          {TIER_FILTERS.map(t => (
            <button key={t.code} onClick={() => toggleTier(t.code)} className="ui-chip" data-on={tierFilter.has(t.code)}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Stage</span>
          {(['upcoming', 'ongoing', 'completed'] as Stage[]).map(s => (
            <button key={s} onClick={() => setStageFilter(stageFilter === s ? null : s)} className="ui-chip" data-on={stageFilter === s}>{s}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Verdict</span>
          {(['broken', 'gaps', 'ok'] as Verdict[]).map(v => (
            <button key={v} onClick={() => setVerdictFilter(verdictFilter === v ? null : v)} className="ui-chip" data-on={verdictFilter === v}>{v}</button>
          ))}
        </div>
        {view === 'list' && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Group by</span>
            {(['tier', 'stage', 'verdict'] as GroupBy[]).map(g => (
              <button key={g} onClick={() => setGroupBy(g)} className="ui-chip" data-on={groupBy === g}>{g}</button>
            ))}
          </div>
        )}
      </div>

      {error && <EmptyState title="Couldn’t load readiness" hint={error} />}
      {!error && rows === null && <Skeleton rows={8} />}
      {!error && rows !== null && filtered.length === 0 && <EmptyState title="No tournaments match" hint="Adjust the filters." />}
      {!error && rows !== null && filtered.length > 0 && (
        view === 'list'
          ? <ReadinessList rows={filtered} groupBy={groupBy} />
          : <ReadinessCalendar rows={filtered} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add the `.ui-chip` class** (used above) to `apps/ops/src/app/ui.css` if it doesn't already exist (grep first):

```css
.ui-chip { padding:4px 11px; border-radius:999px; border:1px solid var(--border-strong); background:transparent; color:var(--text-2); font-size:12px; cursor:pointer; font-family:var(--font); }
.ui-chip[data-on="true"] { background:var(--lime-bg); border-color:var(--lime-border); color:var(--lime-text); }
```

- [ ] **Step 5: Add temporary stubs** so the shell compiles before Tasks 7–8. Create minimal `ReadinessList.tsx` and `ReadinessCalendar.tsx` that render `null` (they'll be filled next). This keeps each task independently compilable.

```tsx
// apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessList.tsx
'use client'
import type { ReadinessRow, GroupBy } from './types'
export default function ReadinessList({ rows, groupBy }: { rows: ReadinessRow[]; groupBy: GroupBy }) {
  return <div data-stub>{`list stub: ${rows.length} rows, group=${groupBy}`}</div>
}
```

```tsx
// apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx
'use client'
import type { ReadinessRow } from './types'
export default function ReadinessCalendar({ rows }: { rows: ReadinessRow[] }) {
  return <div data-stub>{`calendar stub: ${rows.length} rows`}</div>
}
```

- [ ] **Step 6: Lint + visual check.** Lint the new files; then load `/system/data-readiness` in the running preview (logged in as operator).

Run: `cd apps/ops && npx eslint "src/app/(app)/system/data-readiness"`
Expected: no errors; the page shows the header, KPI strip with real counts, and the filter chips.

- [ ] **Step 7: Commit.**

```bash
git add "src/app/(app)/system/data-readiness" src/app/ui.css
git commit -m "feat(ops): data-readiness view shell (fetch, filters, KPIs)"
```

---

## Task 7: List body + dimension matrix

**Files:**
- Create: `apps/ops/src/app/(app)/system/data-readiness/_components/DimensionMatrix.tsx`
- Modify (replace stub): `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessList.tsx`

- [ ] **Step 1: DimensionMatrix + ReadinessDot.** Token-driven (no hardcoded hex).

```tsx
// apps/ops/src/app/(app)/system/data-readiness/_components/DimensionMatrix.tsx
'use client'
import type { CellState, DimensionResult, DimensionKey } from './types'

export const DIM_LABELS: Record<DimensionKey, string> = {
  matches: 'Matches', players: 'Players', oop: 'OOP', results: 'Results', entry: 'Entry', stats: 'Stats', streams: 'Streams',
}
export const DIM_ORDER: DimensionKey[] = ['matches', 'players', 'oop', 'results', 'entry', 'stats', 'streams']

function dotStyle(state: CellState): React.CSSProperties {
  const base: React.CSSProperties = { width: 13, height: 13, borderRadius: '50%', display: 'inline-block' }
  switch (state) {
    case 'ok': return { ...base, background: 'var(--rd-ok)' }
    case 'partial': return { ...base, background: 'var(--rd-gap)' }
    case 'missing': return { ...base, background: 'transparent', border: '2px solid var(--rd-bad)' }
    case 'divergent': return { ...base, background: 'var(--rd-bad)', boxShadow: '0 0 0 3px var(--rd-bad-bg)' }
    case 'na': return { ...base, background: 'var(--rd-na)' }
  }
}

export function ReadinessDot({ state, title }: { state: CellState; title?: string }) {
  return <span style={dotStyle(state)} title={title} />
}

/** Inline 7-dot strip for a table row. */
export function DimensionDots({ dimensions }: { dimensions: DimensionResult[] }) {
  const byKey = new Map(dimensions.map(d => [d.key, d]))
  return (
    <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
      {DIM_ORDER.map(k => {
        const d = byKey.get(k)
        return <ReadinessDot key={k} state={d?.state ?? 'na'} title={`${DIM_LABELS[k]}: ${d?.detail ?? 'N/A'}`} />
      })}
    </span>
  )
}

/** Expanded per-dimension reasoning. */
export function DimensionBreakdown({ dimensions }: { dimensions: DimensionResult[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '5px 16px', padding: '12px 16px', fontSize: 12 }}>
      {DIM_ORDER.map(k => {
        const d = dimensions.find(x => x.key === k)
        if (!d) return null
        return (
          <FragmentRow key={k} label={DIM_LABELS[k]} state={d.state} detail={d.detail} />
        )
      })}
    </div>
  )
}

function FragmentRow({ label, state, detail }: { label: string; state: CellState; detail: string }) {
  const color = state === 'divergent' || state === 'missing' ? 'var(--rd-bad)' : state === 'partial' ? 'var(--rd-gap)' : state === 'na' ? 'var(--text-3)' : 'var(--rd-ok)'
  return (
    <>
      <div style={{ color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 8 }}><ReadinessDot state={state} /> {label}</div>
      <div style={{ color }}>{state === 'divergent' ? `⚠ scraped, not populated — ${detail}` : detail}</div>
    </>
  )
}
```

- [ ] **Step 2: ReadinessList** — group, headline verdict pill, expandable rows.

```tsx
// apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessList.tsx
'use client'
import { Fragment, useMemo, useState } from 'react'
import { Pill } from '@/components/ui'
import { tierTag } from '@/lib/tier-colors'
import type { ReadinessRow, GroupBy, Verdict } from './types'
import { DimensionDots, DimensionBreakdown, DIM_LABELS, DIM_ORDER } from './DimensionMatrix'

const TIER_GROUP_LABEL: Record<string, string> = {
  major: 'Premier · Major', p1: 'Premier · P1', p2: 'Premier · P2', finals: 'Premier · Finals',
  fip_platinum: 'Cupra FIP · Platinum', fip_gold: 'Cupra FIP · Gold', fip_silver: 'Cupra FIP · Silver', fip_bronze: 'Cupra FIP · Bronze',
}
const TIER_ORDER = ['major', 'p1', 'p2', 'finals', 'fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze']
const VERDICT_ORDER: Verdict[] = ['broken', 'gaps', 'ok']
const VERDICT_PILL: Record<Verdict, { tone: 'urgent' | 'warn' | 'lime'; label: string }> = {
  broken: { tone: 'urgent', label: 'Broken' }, gaps: { tone: 'warn', label: 'Gaps' }, ok: { tone: 'lime', label: 'OK' },
}

function groupKey(r: ReadinessRow, by: GroupBy): string {
  if (by === 'tier') return r.level ?? 'other'
  if (by === 'stage') return r.stage
  return r.verdict
}
function groupLabel(key: string, by: GroupBy): string {
  if (by === 'tier') return TIER_GROUP_LABEL[key] ?? key
  return key.charAt(0).toUpperCase() + key.slice(1)
}
function orderedKeys(by: GroupBy, present: Set<string>): string[] {
  const order = by === 'tier' ? TIER_ORDER : by === 'verdict' ? VERDICT_ORDER : ['ongoing', 'upcoming', 'completed']
  return order.filter(k => present.has(k)).concat([...present].filter(k => !order.includes(k)))
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); if (!m) return '—'
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${Number(m[3])} ${months[Number(m[2]) - 1]}`
}

export default function ReadinessList({ rows, groupBy }: { rows: ReadinessRow[]; groupBy: GroupBy }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const groups = useMemo(() => {
    const m = new Map<string, ReadinessRow[]>()
    for (const r of rows) { const k = groupKey(r, groupBy); (m.get(k) ?? m.set(k, []).get(k)!).push(r) }
    return m
  }, [rows, groupBy])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {orderedKeys(groupBy, new Set(groups.keys())).map(key => {
        const list = groups.get(key)!
        return (
          <div key={key}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 8px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '.3px' }}>{groupLabel(key, groupBy)}</span>
              <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{list.length}</span>
              <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 10, overflow: 'hidden' }}>
              <thead>
                <tr>
                  <th style={thL}>Tournament</th><th style={th}>Stage</th><th style={th}>Verdict</th>
                  {DIM_ORDER.map(k => <th key={k} style={th}>{DIM_LABELS[k]}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map(r => (
                  <Fragment key={r.id}>
                    <tr onClick={() => toggle(r.id)} style={{ cursor: 'pointer', borderTop: '1px solid var(--border)' }}>
                      <td style={tdL}>
                        <span style={{ fontWeight: 600 }}>{tierTag(r.level)} · {r.name}</span>
                        <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 6 }}>{fmtDate(r.startsAt)}–{fmtDate(r.endsAt)}</span>
                      </td>
                      <td style={td}><span style={{ fontSize: 11, color: 'var(--text-2)' }}>{r.stage}</span></td>
                      <td style={td}><Pill tone={VERDICT_PILL[r.verdict].tone}>{VERDICT_PILL[r.verdict].label}</Pill></td>
                      <td colSpan={DIM_ORDER.length} style={{ ...td, textAlign: 'left' }}><DimensionDots dimensions={r.dimensions} /></td>
                    </tr>
                    {open.has(r.id) && (
                      <tr style={{ background: 'var(--bg-sunken)' }}>
                        <td colSpan={3 + DIM_ORDER.length} style={{ padding: 0 }}><DimensionBreakdown dimensions={r.dimensions} /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

const th: React.CSSProperties = { fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-3)', fontWeight: 600, textAlign: 'center', padding: '9px 6px' }
const thL: React.CSSProperties = { ...th, textAlign: 'left' }
const td: React.CSSProperties = { padding: '10px 6px', textAlign: 'center', verticalAlign: 'middle' }
const tdL: React.CSSProperties = { ...td, textAlign: 'left' }
```

> Note: the 7 dimension header columns are present for alignment, but the dots render in a single `colSpan` cell for compactness — matching the mockup. If per-column alignment is preferred during review, split `DimensionDots` into one `<td>` per dimension.

- [ ] **Step 3: Lint + visual check.** Lint; reload `/system/data-readiness`, default List grouped by Tier. Confirm Ijuí appears under **Cupra FIP · Bronze** with a **Broken** pill; expand it and confirm the breakdown shows Matches + Results as "⚠ scraped, not populated".

Run: `cd apps/ops && npx eslint "src/app/(app)/system/data-readiness"`
Expected: no errors.

- [ ] **Step 4: Commit.**

```bash
git add "src/app/(app)/system/data-readiness"
git commit -m "feat(ops): data-readiness list view + dimension matrix"
```

---

## Task 8: Calendar body

Verdict-colored lane calendar with month paging + sort.

**Files:**
- Modify (replace stub): `apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx`

- [ ] **Step 1: Implement the calendar.** Self-contained lane packing (mirrors `CalendarView.assignLanes`), month nav, sort control. Verdict drives bar color; tier shown as a tag.

```tsx
// apps/ops/src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx
'use client'
import { useMemo, useState } from 'react'
import { tierTag } from '@/lib/tier-colors'
import type { ReadinessRow, Verdict } from './types'

const VERDICT_BG: Record<Verdict, string> = { ok: 'var(--rd-ok-bg)', gaps: 'var(--rd-gap-bg)', broken: 'var(--rd-bad-bg)' }
const VERDICT_BORDER: Record<Verdict, string> = { ok: 'var(--rd-ok)', gaps: 'var(--rd-gap)', broken: 'var(--rd-bad)' }
const VERDICT_RANK: Record<Verdict, number> = { broken: 0, gaps: 1, ok: 2 }
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
type SortBy = 'start' | 'verdict' | 'tier'
const TIER_ORDER = ['major','p1','p2','finals','fip_platinum','fip_gold','fip_silver','fip_bronze']

function daysInMonth(year: number, month0: number): number { return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate() }
function dayOfMonth(iso: string | null): number | null { const m = iso && /^\d{4}-(\d{2})-(\d{2})/.exec(iso); return m ? Number(m[2]) : null }

export default function ReadinessCalendar({ rows }: { rows: ReadinessRow[] }) {
  // Default the calendar to the current month.
  const now = new Date()
  const [year, setYear] = useState(now.getUTCFullYear() === 2026 ? 2026 : 2026)
  const [month0, setMonth0] = useState(now.getUTCFullYear() === 2026 ? now.getUTCMonth() : 0)
  const [sortBy, setSortBy] = useState<SortBy>('start')

  const ndays = daysInMonth(year, month0)
  const monthStart = `${year}-${String(month0 + 1).padStart(2, '0')}-01`
  const monthEnd = `${year}-${String(month0 + 1).padStart(2, '0')}-${String(ndays).padStart(2, '0')}`

  // Tournaments overlapping this month.
  const visible = useMemo(() => rows.filter(r => {
    const s = (r.startsAt ?? '').slice(0, 10), e = (r.endsAt ?? r.startsAt ?? '').slice(0, 10)
    return s && e && s <= monthEnd && e >= monthStart
  }), [rows, monthStart, monthEnd])

  const sorted = useMemo(() => {
    const arr = [...visible]
    if (sortBy === 'verdict') arr.sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict])
    else if (sortBy === 'tier') arr.sort((a, b) => TIER_ORDER.indexOf(a.level ?? '') - TIER_ORDER.indexOf(b.level ?? ''))
    else arr.sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? ''))
    return arr
  }, [visible, sortBy])

  // Greedy lane packing within the month.
  const lanes: Array<{ r: ReadinessRow; startDay: number; endDay: number; lane: number }> = []
  const laneEnds: number[] = []
  for (const r of sorted) {
    const sD = Math.max(1, dayOfMonth((r.startsAt ?? '').slice(0, 10) >= monthStart ? r.startsAt : monthStart) ?? 1)
    const eRaw = (r.endsAt ?? r.startsAt ?? '')
    const eD = Math.min(ndays, (eRaw.slice(0, 10) <= monthEnd ? dayOfMonth(eRaw) : ndays) ?? ndays)
    let lane = laneEnds.findIndex(end => end < sD)
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(eD) } else { laneEnds[lane] = eD }
    lanes.push({ r, startDay: sD, endDay: eD, lane })
  }
  const laneCount = laneEnds.length || 1

  const todayD = (now.getUTCFullYear() === year && now.getUTCMonth() === month0) ? now.getUTCDate() : null

  const prev = () => { if (month0 === 0) { setYear(y => y - 1); setMonth0(11) } else setMonth0(m => m - 1) }
  const next = () => { if (month0 === 11) { setYear(y => y + 1); setMonth0(0) } else setMonth0(m => m + 1) }
  const today = () => { setYear(now.getUTCFullYear()); setMonth0(now.getUTCMonth()) }

  const pct = (day: number) => ((day - 1) / ndays) * 100
  const widthPct = (s: number, e: number) => ((e - s + 1) / ndays) * 100

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={prev} className="ui-chip" aria-label="Previous month">‹</button>
          <div style={{ fontSize: 15, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>{MONTHS[month0]} {year}</div>
          <button onClick={next} className="ui-chip" aria-label="Next month">›</button>
          <button onClick={today} className="ui-chip">Today</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--text-3)' }}>Sort lanes</span>
          {(['start', 'verdict', 'tier'] as SortBy[]).map(s => (
            <button key={s} onClick={() => setSortBy(s)} className="ui-chip" data-on={sortBy === s}>{s === 'start' ? 'Start date' : s === 'verdict' ? 'Verdict' : 'Tier'}</button>
          ))}
        </div>
      </div>

      {lanes.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '24px 0' }}>No tournaments overlap {MONTHS[month0]} {year}.</div>
      ) : (
        <div style={{ position: 'relative', background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 10, padding: '10px 0' }}>
          {/* day header */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ndays}, 1fr)`, borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
            {Array.from({ length: ndays }, (_, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: 9, color: 'var(--text-4)', padding: '4px 0', borderRight: '1px solid var(--border-inner)' }}>{i + 1}</div>
            ))}
          </div>
          {/* lanes */}
          <div style={{ position: 'relative', height: laneCount * 34 }}>
            {todayD !== null && (
              <div style={{ position: 'absolute', top: -8, bottom: 0, left: `${pct(todayD) + (100 / ndays) / 2}%`, width: 2, background: 'var(--lime)', zIndex: 3 }} />
            )}
            {lanes.map(({ r, startDay, endDay, lane }) => (
              <button
                key={r.id}
                title={`${r.name} — ${r.verdict}`}
                style={{
                  position: 'absolute', top: lane * 34, height: 28,
                  left: `${pct(startDay)}%`, width: `calc(${widthPct(startDay, endDay)}% - 4px)`,
                  display: 'flex', alignItems: 'center', gap: 7, padding: '0 9px',
                  background: VERDICT_BG[r.verdict], borderLeft: `4px solid ${VERDICT_BORDER[r.verdict]}`,
                  border: '1px solid var(--border-card)', borderRadius: 6, cursor: 'pointer', overflow: 'hidden',
                  color: 'var(--text-1)', font: 'inherit',
                }}
              >
                <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 4px', borderRadius: 3, background: 'var(--bg-hover)', color: 'var(--text-2)', flexShrink: 0 }}>{tierTag(r.level)}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* legend */}
      <div style={{ display: 'flex', gap: 18, marginTop: 14, fontSize: 11, color: 'var(--text-2)' }}>
        <span><span style={{ display: 'inline-block', width: 22, height: 12, borderRadius: 3, background: 'var(--rd-ok-bg)', borderLeft: '3px solid var(--rd-ok)', verticalAlign: 'middle', marginRight: 6 }} />OK</span>
        <span><span style={{ display: 'inline-block', width: 22, height: 12, borderRadius: 3, background: 'var(--rd-gap-bg)', borderLeft: '3px solid var(--rd-gap)', verticalAlign: 'middle', marginRight: 6 }} />Gaps</span>
        <span><span style={{ display: 'inline-block', width: 22, height: 12, borderRadius: 3, background: 'var(--rd-bad-bg)', borderLeft: '3px solid var(--rd-bad)', verticalAlign: 'middle', marginRight: 6 }} />Broken</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Lint + visual check.** Lint; switch to Calendar mode, page months with ‹ ›, click Today, and confirm verdict colors + tier tags render, and a Broken event shows red.

Run: `cd apps/ops && npx eslint "src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx"`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add "src/app/(app)/system/data-readiness/_components/ReadinessCalendar.tsx"
git commit -m "feat(ops): data-readiness calendar view"
```

---

## Task 9: Rail navigation entry

**Files:**
- Modify: `apps/ops/src/components/shell/Rail.tsx:39-49` (the System group)

- [ ] **Step 1: Add the entry** right after the Data Quality item:

```ts
  { href: '/system/data-quality', label: 'Data Quality', icon: 'check' },
  { href: '/system/data-readiness', label: 'Data Readiness', icon: 'check' },
```

(If a more fitting icon than `'check'` exists in the Rail's icon set, use it; otherwise `'check'` is fine — grep the icon map in `Rail.tsx` to confirm valid names.)

- [ ] **Step 2: Verify.** Reload the app; confirm "Data Readiness" appears under System and navigates to the page.

Run: `cd apps/ops && npx eslint src/components/shell/Rail.tsx`
Expected: no errors.

- [ ] **Step 3: Commit.**

```bash
git add src/components/shell/Rail.tsx
git commit -m "feat(ops): add Data Readiness to the System nav"
```

---

## Task 10: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Unit tests green.**

Run: `cd apps/ops && npx vitest run src/lib/__tests__/readiness.test.ts`
Expected: all PASS.

- [ ] **Step 2: Production build.**

Run: `cd apps/ops && npm run build`
Expected: build succeeds; `/system/data-readiness` and `/api/internal/tournament-readiness` appear in the route manifest.

- [ ] **Step 3: Theme check.** In the running app, toggle light/dark (theme switch in the header). Confirm verdict colors, dots, calendar bars, and KPI tones read correctly in **both** themes (no invisible text, no hardcoded-hex artifacts).

- [ ] **Step 4: Ijuí end-to-end.** On `/system/data-readiness`, filter Tier=Bronze (or search), confirm **FIP Bronze Ijuí** shows **Broken** with Matches + Results dots in the divergent (red ring) state, and the calendar shows it red in its month (April 2026).

- [ ] **Step 5: Final commit (if any verification fixups were needed).**

```bash
git add -A
git commit -m "chore(ops): data-readiness verification fixups"
```

---

## Self-review notes (author)

- **Spec coverage:** stage derivation (Task 4), 7 dimensions + expectations + tier rules (Task 4), divergence (Task 4 + tests), verdict roll-up (Task 4), live route with set-based rollups + pagination (Task 5), list grouped + matrix (Tasks 6–7), calendar with nav + sort + verdict color (Task 8), Rail entry (Task 9), light/dark tokens (Task 1 + Task 10 check), Ijuí acceptance (Task 10). All covered.
- **v1 simplifications** are listed at the top and reflected in the engine/tests (Results via winner_pair, Premier streams N/A, Stats=partial, divergence by presence). These match the spec's intent (Streams never Broken; thresholds locked by tests).
- **Type consistency:** `TournamentRollup`, `ReadinessResult`, `DimensionResult`, `CellState`, `Verdict`, `Stage`, `DimensionKey` are defined once in `readiness.ts` and re-exported via the view `types.ts`; `tierTag`/`TIER_COLOR` defined once in `tier-colors.ts`; `--rd-*` tokens defined in Task 1 and consumed by Tasks 7–8.
