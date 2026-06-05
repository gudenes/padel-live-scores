# Today → Live Odds Scoreboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `apps/ops` `/today` page with a real-time live-odds scoreboard (KPI row + unified live/scheduled matches table + selected-match detail panel with a win-probability chart), backed by the already-shipped `match_live_odds` data layer.

**Architecture:** A server component (`/today/page.tsx`) fetches an initial snapshot (today's matches merged from live `match_live_odds` + scheduled `model_predictions`) and hands it to a client orchestrator (`ScoreboardView`) that subscribes to Supabase Realtime on `match_live_odds`, recomputes KPIs, drives selection/filters, and renders motion. Pure logic (movement deltas, KPI aggregation, contract mapping) lives in tested, I/O-free modules. Presentational components are ported from the recovered mockup (`docs/superpowers/mockups/live-odds-admin.html`) into a co-located `scoreboard.css`.

**Tech Stack:** Next.js 16 (App Router, server + client components), React 19, TypeScript, Supabase JS (service client server-side, anon Realtime client-side), recharts (reuse `OddsMovementChart`), Vitest for unit tests.

**Spec:** `docs/superpowers/specs/2026-06-04-today-live-odds-scoreboard-design.md`

---

## Conventions for this plan

- All paths are relative to repo root `/Volumes/Crucial/dev/padel-live-scores`.
- The ops app root is `apps/ops`. Run commands from there unless stated.
- Dev server: `cd apps/ops && npm run dev` → http://localhost:3004.
- Unit tests: `cd apps/ops && npx vitest run <path>`.
- Supabase: server code uses `createServiceClient()` from `apps/ops/src/lib/supabase.ts`; client code uses the anon key (`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- **The mockup is the visual contract.** When a presentational step says "port from mockup," open `docs/superpowers/mockups/live-odds-admin.html` and copy the matching markup/CSS, adapting class names into `scoreboard.css`. Keep the color discipline: lime = only hero accent, red = LIVE / down-movement only, orange = hot swing / game points / Break.

---

## File Structure

**Create:**
- `apps/ops/src/app/(app)/today/_lib/types.ts` — the data contract (`Match`, `Pair`, `LiveOddsSnapshot`, `ConnectionState`, `Confidence`, `MatchStatus`, `KpiData`).
- `apps/ops/src/app/(app)/today/_lib/movement.ts` — pure: 15m delta, biggest-swing, history-cap, confidence mapping.
- `apps/ops/src/app/(app)/today/_lib/movement.test.ts` — unit tests for movement.ts.
- `apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts` — server: build initial `LiveOddsSnapshot` (live + scheduled merge).
- `apps/ops/src/app/(app)/today/_lib/scoreboard-data.test.ts` — unit tests for the pure mapping helpers in scoreboard-data.ts.
- `apps/ops/src/app/(app)/today/_lib/useScoreboard.ts` — client hook: Realtime + poll → `{ snapshot, connection, selectedId, select, filters, setFilters }`.
- `apps/ops/src/app/(app)/today/_components/ScoreboardView.tsx` — client orchestrator.
- `apps/ops/src/app/(app)/today/_components/KpiRow.tsx`
- `apps/ops/src/app/(app)/today/_components/MatchesTable.tsx`
- `apps/ops/src/app/(app)/today/_components/MatchRow.tsx`
- `apps/ops/src/app/(app)/today/_components/OddsBar.tsx`
- `apps/ops/src/app/(app)/today/_components/DetailPanel.tsx`
- `apps/ops/src/app/(app)/today/_components/WinProbChart.tsx`
- `apps/ops/src/app/(app)/today/_components/ConnectionBanner.tsx`
- `apps/ops/src/app/(app)/today/scoreboard.css`

**Modify:**
- `apps/ops/src/app/(app)/today/page.tsx` — replace body with scoreboard.
- `apps/ops/src/app/(app)/odds/page.tsx` — replace with a redirect to `/today`.

**Delete (Task 14, after confirming no other importers):**
- `apps/ops/src/components/TodayLiveNow.tsx`, `TodayRequiresAttention.tsx`, `TodaySchedule.tsx`, `TodayStatusPill.tsx`, `TodayRefreshButton.tsx`, `apps/ops/src/lib/today-aggregator.ts`, `apps/ops/src/components/Odds/LiveNowSection.tsx`.

---

## Phase 1 — Data contract + pure logic

### Task 1: Data contract types

**Files:**
- Create: `apps/ops/src/app/(app)/today/_lib/types.ts`

- [ ] **Step 1: Write the contract**

```ts
// apps/ops/src/app/(app)/today/_lib/types.ts
// The typed data contract for the Today scoreboard. Pure types, no runtime.

export type ConnectionState = 'loading' | 'live' | 'reconnecting' | 'offline'
export type Confidence = 'full' | 'med' | 'low'
export type MatchStatus = 'live' | 'break' | 'scheduled'
export type AnchorSource = 'model-prediction' | 'cold-start-elo'

export interface Pair {
  name: string            // short display name (last token), e.g. "Di Nenno / Navarro"
  player1Name: string
  player2Name: string
  gender: 'men' | 'women'
  serving: boolean        // true if this pair is currently serving (live only)
}

export interface SetScore { a: number; b: number; current: boolean }

export interface Match {
  id: string
  pair1: Pair
  pair2: Pair
  tournament: string
  court: string | null
  round: string | null
  tier: string | null            // tournaments.level
  status: MatchStatus
  scheduledAt: string | null     // ISO
  setScores: SetScore[]
  gamePoints: { a: string; b: string } | null  // null when break/scheduled
  winProb1: number               // pair1 win prob 0-1
  fairOdds1: number
  fairOdds2: number
  movement15m: number            // signed delta in pair1 prob over ~15m (0 if unknown)
  confidence: Confidence
  anchorSource: AnchorSource | null
  lastUpdatedSeconds: number     // now - computed_at (0 for scheduled)
  winProbHistory: number[]       // pair1 prob series, oldest→newest, cap 30 (live only)
  currentSetStartedAt: string | null  // ISO, for the chart's Set view (live only)
}

export interface KpiData {
  liveMatches: number
  preMatchModeled: number
  biggestSwing: { pct: number; label: string }   // signed pct (×100), match label
  lowCoverage: number
}

export interface LiveOddsSnapshot {
  matches: Match[]
  kpis: KpiData
  fetchedAt: string  // ISO
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit -p tsconfig.json 2>&1 | grep today/_lib/types || echo "types ok"`
Expected: `types ok`

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_lib/types.ts"
git commit -m "feat(today): scoreboard data contract types"
```

---

### Task 2: movement.ts — pure helpers (TDD)

**Files:**
- Create: `apps/ops/src/app/(app)/today/_lib/movement.ts`
- Test: `apps/ops/src/app/(app)/today/_lib/movement.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/ops/src/app/(app)/today/_lib/movement.test.ts
import { describe, it, expect } from 'vitest'
import { movement15m, capHistory, coverageToConfidence, biggestSwing } from './movement'

describe('capHistory', () => {
  it('keeps the last N values, oldest→newest', () => {
    const xs = Array.from({ length: 40 }, (_, i) => i / 100)
    expect(capHistory(xs, 30)).toHaveLength(30)
    expect(capHistory(xs, 30)[0]).toBeCloseTo(0.1)      // 40-30 = index 10
    expect(capHistory(xs, 30)[29]).toBeCloseTo(0.39)
  })
  it('returns all when shorter than cap', () => {
    expect(capHistory([0.5, 0.6], 30)).toEqual([0.5, 0.6])
  })
})

describe('movement15m', () => {
  // series of {prob, atMs}; "now" passed explicitly for determinism
  const now = 1_000_000_000_000
  it('is the signed delta vs the value closest to 15m ago', () => {
    const series = [
      { prob: 0.40, atMs: now - 16 * 60_000 },
      { prob: 0.55, atMs: now - 1 * 60_000 },
    ]
    expect(movement15m(series, now)).toBeCloseTo(0.15)
  })
  it('is 0 when fewer than 2 points', () => {
    expect(movement15m([{ prob: 0.5, atMs: now }], now)).toBe(0)
    expect(movement15m([], now)).toBe(0)
  })
  it('uses the oldest point if none is older than 15m', () => {
    const series = [
      { prob: 0.50, atMs: now - 5 * 60_000 },
      { prob: 0.58, atMs: now - 1 * 60_000 },
    ]
    expect(movement15m(series, now)).toBeCloseTo(0.08)
  })
})

describe('coverageToConfidence', () => {
  it('maps live-pbp→full, live-coarse→low, else med', () => {
    expect(coverageToConfidence('live-pbp')).toBe('full')
    expect(coverageToConfidence('live-coarse')).toBe('low')
    expect(coverageToConfidence(null)).toBe('med')
  })
})

describe('biggestSwing', () => {
  it('picks the max absolute movement and returns signed pct + label', () => {
    const res = biggestSwing([
      { movement15m: 0.10, label: 'A' },
      { movement15m: -0.34, label: 'B' },
      { movement15m: 0.05, label: 'C' },
    ])
    expect(res.pct).toBeCloseTo(-34)
    expect(res.label).toBe('B')
  })
  it('returns zeroed result for empty input', () => {
    expect(biggestSwing([])).toEqual({ pct: 0, label: '—' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/ops && npx vitest run "src/app/(app)/today/_lib/movement.test.ts"`
Expected: FAIL — `movement` module not found.

- [ ] **Step 3: Implement movement.ts**

```ts
// apps/ops/src/app/(app)/today/_lib/movement.ts
// Pure helpers for the scoreboard. No I/O. "now" is injected for testability.
import type { Confidence } from './types'

export function capHistory(values: number[], cap = 30): number[] {
  return values.length <= cap ? values : values.slice(values.length - cap)
}

export interface ProbPoint { prob: number; atMs: number }

// Signed delta in prob over ~15m: latest minus the value at-or-before 15m ago
// (or the oldest available if none is that old). 0 when <2 points.
export function movement15m(series: ProbPoint[], nowMs: number): number {
  if (series.length < 2) return 0
  const sorted = [...series].sort((a, b) => a.atMs - b.atMs)
  const latest = sorted[sorted.length - 1]
  const cutoff = nowMs - 15 * 60_000
  let baseline = sorted[0]
  for (const p of sorted) {
    if (p.atMs <= cutoff) baseline = p
    else break
  }
  return latest.prob - baseline.prob
}

export function coverageToConfidence(coverage: string | null): Confidence {
  if (coverage === 'live-pbp') return 'full'
  if (coverage === 'live-coarse') return 'low'
  return 'med'
}

export function biggestSwing(
  rows: Array<{ movement15m: number; label: string }>,
): { pct: number; label: string } {
  if (rows.length === 0) return { pct: 0, label: '—' }
  const top = rows.reduce((m, r) => (Math.abs(r.movement15m) > Math.abs(m.movement15m) ? r : m))
  return { pct: Math.round(top.movement15m * 100), label: top.label }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/ops && npx vitest run "src/app/(app)/today/_lib/movement.test.ts"`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_lib/movement.ts" "apps/ops/src/app/(app)/today/_lib/movement.test.ts"
git commit -m "feat(today): pure movement/confidence/swing helpers + tests"
```

---

### Task 3: Score parsing helpers (TDD)

The padelgod score parser lives in `padelgod/src/lib/live-score-state.ts` but isn't importable from `apps/ops`. Replicate the small `gamePoints` split as a local pure helper.

**Files:**
- Modify: `apps/ops/src/app/(app)/today/_lib/movement.ts` (append) — OR create `score.ts`. Use `score.ts` for one-responsibility-per-file.
- Create: `apps/ops/src/app/(app)/today/_lib/score.ts`
- Test: `apps/ops/src/app/(app)/today/_lib/score.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/ops/src/app/(app)/today/_lib/score.test.ts
import { describe, it, expect } from 'vitest'
import { splitGameScore } from './score'

describe('splitGameScore', () => {
  it('splits "40-30" into {a:"40", b:"30"}', () => {
    expect(splitGameScore('40-30')).toEqual({ a: '40', b: '30' })
  })
  it('handles AD', () => {
    expect(splitGameScore('AD-40')).toEqual({ a: 'AD', b: '40' })
  })
  it('returns null for null/empty', () => {
    expect(splitGameScore(null)).toBeNull()
    expect(splitGameScore('')).toBeNull()
  })
  it('trims whitespace', () => {
    expect(splitGameScore(' 15 - 0 ')).toEqual({ a: '15', b: '0' })
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/ops && npx vitest run "src/app/(app)/today/_lib/score.test.ts"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement score.ts**

```ts
// apps/ops/src/app/(app)/today/_lib/score.ts
// Pure: split a "40-30" / "AD-40" game-score string into per-pair labels.
export function splitGameScore(score: string | null): { a: string; b: string } | null {
  if (!score || !score.trim()) return null
  const [a, b] = score.split('-').map((x) => x.trim())
  return { a: a || '0', b: b || '0' }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/ops && npx vitest run "src/app/(app)/today/_lib/score.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_lib/score.ts" "apps/ops/src/app/(app)/today/_lib/score.test.ts"
git commit -m "feat(today): pure game-score splitter + tests"
```

---

## Phase 2 — Server snapshot

### Task 4: `buildScheduledMatches` mapping (TDD-able pure core)

`scoreboard-data.ts` does I/O, but its row→`Match` mapping is pure and testable. Build the mapping function first.

**Files:**
- Create: `apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts`
- Test: `apps/ops/src/app/(app)/today/_lib/scoreboard-data.test.ts`

- [ ] **Step 1: Write failing test for the pure mapper**

```ts
// apps/ops/src/app/(app)/today/_lib/scoreboard-data.test.ts
import { describe, it, expect } from 'vitest'
import { shortName, mapLiveRowToMatch } from './scoreboard-data'

describe('shortName', () => {
  it('returns the last token', () => {
    expect(shortName('Martin Di Nenno')).toBe('Nenno')
    expect(shortName('Navarro')).toBe('Navarro')
    expect(shortName(null)).toBe('—')
  })
})

describe('mapLiveRowToMatch', () => {
  const nowMs = 1_000_000_000_000
  const base = {
    match_id: 'm1',
    pair1_prob: 0.82,
    pair2_prob: 0.18,
    pair1_decimal_odds: 1.22,
    pair2_decimal_odds: 5.54,
    anchor_source: 'model-prediction' as const,
    coverage: 'live-pbp' as const,
    computed_at: new Date(nowMs - 30_000).toISOString(),
    matches: {
      status: 'live',
      court: 'Campo 5',
      round_canonical: 'QF',
      category: 'men',
      tournament: { name: 'Italy Major', level: 'major' },
      p1a: { id: 'a', name: 'Martin Di Nenno' },
      p1b: { id: 'b', name: 'Francisco Navarro' },
      p2a: { id: 'c', name: 'Alonso Rodriguez' },
      p2b: { id: 'd', name: 'Juan De Pascual' },
    },
  }
  it('maps probs, names, confidence, status', () => {
    const m = mapLiveRowToMatch(base, {
      sets: [{ pair1_games: 6, pair2_games: 4, is_current: false }, { pair1_games: 3, pair2_games: 2, is_current: true }],
      gameScore: '40-30',
      servingPlayerId: 'a',
      history: [{ prob: 0.7, atMs: nowMs - 16 * 60_000 }, { prob: 0.82, atMs: nowMs - 30_000 }],
      currentSetStartedAt: null,
    }, nowMs)
    expect(m.winProb1).toBeCloseTo(0.82)
    expect(m.pair1.name).toBe('Nenno / Navarro')
    expect(m.confidence).toBe('full')
    expect(m.status).toBe('live')
    expect(m.pair1.serving).toBe(true)
    expect(m.gamePoints).toEqual({ a: '40', b: '30' })
    expect(m.setScores).toHaveLength(2)
    expect(m.setScores[1].current).toBe(true)
    expect(m.movement15m).toBeCloseTo(0.12)
    expect(m.lastUpdatedSeconds).toBe(30)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `cd apps/ops && npx vitest run "src/app/(app)/today/_lib/scoreboard-data.test.ts"`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement the pure mappers in scoreboard-data.ts**

```ts
// apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts
import { createServiceClient } from '@/lib/supabase'
import { getMatchOddsForDay } from '@/lib/odds-data'
import type { Match, LiveOddsSnapshot, MatchStatus, AnchorSource } from './types'
import { movement15m, capHistory, coverageToConfidence, biggestSwing, type ProbPoint } from './movement'
import { splitGameScore } from './score'

export function shortName(name: string | null | undefined): string {
  if (!name) return '—'
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] || '—'
}

const pairName = (a: string | null, b: string | null) =>
  [shortName(a), shortName(b)].filter((x) => x !== '—').join(' / ') || 'TBD'

const statusOf = (s: string): MatchStatus =>
  s === 'break' ? 'break' : s === 'live' || s === 'on_court' ? 'live' : 'scheduled'

// Shape of a match_live_odds row joined to match/player/tournament display fields.
export interface LiveOddsRow {
  match_id: string
  pair1_prob: number; pair2_prob: number
  pair1_decimal_odds: number; pair2_decimal_odds: number
  anchor_source: AnchorSource
  coverage: 'live-pbp' | 'live-coarse'
  computed_at: string
  matches: {
    status: string; court: string | null; round_canonical: string | null; category: string
    tournament: { name: string | null; level: string | null } | null
    p1a: { id: string; name: string | null } | null
    p1b: { id: string; name: string | null } | null
    p2a: { id: string; name: string | null } | null
    p2b: { id: string; name: string | null } | null
  } | null
}

export interface LiveExtras {
  sets: Array<{ pair1_games: number; pair2_games: number; is_current: boolean }>
  gameScore: string | null
  servingPlayerId: string | null
  history: ProbPoint[]
  currentSetStartedAt: string | null
}

export function mapLiveRowToMatch(row: LiveOddsRow, extra: LiveExtras, nowMs: number): Match {
  const m = row.matches
  const serving = extra.servingPlayerId
  const p1a = m?.p1a?.id, p1b = m?.p1b?.id
  const servingPair1 = serving != null && (serving === p1a || serving === p1b)
  const servingPair2 = serving != null && (serving === m?.p2a?.id || serving === m?.p2b?.id)
  const status = statusOf(m?.status ?? 'scheduled')
  return {
    id: row.match_id,
    pair1: {
      name: pairName(m?.p1a?.name ?? null, m?.p1b?.name ?? null),
      player1Name: m?.p1a?.name ?? 'TBD', player2Name: m?.p1b?.name ?? 'TBD',
      gender: (m?.category === 'women' ? 'women' : 'men'),
      serving: status !== 'scheduled' && servingPair1,
    },
    pair2: {
      name: pairName(m?.p2a?.name ?? null, m?.p2b?.name ?? null),
      player1Name: m?.p2a?.name ?? 'TBD', player2Name: m?.p2b?.name ?? 'TBD',
      gender: (m?.category === 'women' ? 'women' : 'men'),
      serving: status !== 'scheduled' && servingPair2,
    },
    tournament: m?.tournament?.name ?? 'Unknown',
    court: m?.court ?? null,
    round: m?.round_canonical ?? null,
    tier: m?.tournament?.level ?? null,
    status,
    scheduledAt: null,
    setScores: extra.sets.map((s) => ({ a: s.pair1_games, b: s.pair2_games, current: s.is_current })),
    gamePoints: status === 'live' ? splitGameScore(extra.gameScore) : null,
    winProb1: Number(row.pair1_prob),
    fairOdds1: Number(row.pair1_decimal_odds),
    fairOdds2: Number(row.pair2_decimal_odds),
    movement15m: movement15m(extra.history, nowMs),
    confidence: coverageToConfidence(row.coverage),
    anchorSource: row.anchor_source,
    lastUpdatedSeconds: Math.max(0, Math.round((nowMs - +new Date(row.computed_at)) / 1000)),
    winProbHistory: capHistory(extra.history.map((h) => h.prob), 30),
    currentSetStartedAt: extra.currentSetStartedAt,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/ops && npx vitest run "src/app/(app)/today/_lib/scoreboard-data.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts" "apps/ops/src/app/(app)/today/_lib/scoreboard-data.test.ts"
git commit -m "feat(today): pure live-row→Match mapper + tests"
```

---

### Task 5: `getScoreboardSnapshot` — the server fetch

**Files:**
- Modify: `apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts` (append the I/O function)

- [ ] **Step 1: Append the fetch function**

```ts
// --- append to scoreboard-data.ts ---

const LIVE_SELECT =
  'match_id,pair1_prob,pair2_prob,pair1_decimal_odds,pair2_decimal_odds,anchor_source,coverage,computed_at,' +
  'matches!inner(status,court,round_canonical,category,tournament:tournaments(name,level),' +
  'p1a:players!matches_pair1_player1_id_fkey(id,name),p1b:players!matches_pair1_player2_id_fkey(id,name),' +
  'p2a:players!matches_pair2_player1_id_fkey(id,name),p2b:players!matches_pair2_player2_id_fkey(id,name))'

export async function getScoreboardSnapshot(dateIso: string): Promise<LiveOddsSnapshot> {
  const supabase = createServiceClient()
  const nowMs = Date.now()

  // 1) LIVE rows from match_live_odds (only currently-live matches)
  const { data: liveRows } = await supabase
    .from('match_live_odds')
    .select(LIVE_SELECT)
    .in('matches.status', ['live', 'on_court', 'break'])
    .returns<LiveOddsRow[]>()
  const live = liveRows ?? []
  const liveIds = live.map((r) => r.match_id)

  // 2) Per-match extras: sets, current game, serving, snapshot history
  const extrasById = new Map<string, LiveExtras>()
  if (liveIds.length) {
    const [{ data: sets }, { data: games }, { data: points }, { data: snaps }] = await Promise.all([
      supabase.from('sets').select('match_id,pair1_games,pair2_games,is_current,set_number').in('match_id', liveIds).order('set_number'),
      supabase.from('games').select('match_id,game_score,is_current').eq('is_current', true).in('match_id', liveIds),
      supabase.from('match_points').select('match_id,server_player_id,created_at').in('match_id', liveIds).order('created_at', { ascending: false }).limit(liveIds.length * 4),
      supabase.from('match_live_odds_snapshots').select('match_id,pair1_prob,computed_at').in('match_id', liveIds).order('computed_at', { ascending: true }).limit(liveIds.length * 40),
    ])
    for (const id of liveIds) {
      const mSets = (sets ?? []).filter((s) => s.match_id === id)
      const curGame = (games ?? []).find((g) => g.match_id === id)
      const latestPoint = (points ?? []).find((p) => p.match_id === id) // already desc-ordered
      const hist = (snaps ?? []).filter((s) => s.match_id === id)
        .map((s) => ({ prob: Number(s.pair1_prob), atMs: +new Date(s.computed_at) }))
      extrasById.set(id, {
        sets: mSets.map((s) => ({ pair1_games: s.pair1_games, pair2_games: s.pair2_games, is_current: s.is_current })),
        gameScore: curGame?.game_score ?? null,
        servingPlayerId: latestPoint?.server_player_id ?? null,
        history: hist,
        currentSetStartedAt: null, // set-window for chart deferred; see plan note
      })
    }
  }
  const liveMatches: Match[] = live.map((r) =>
    mapLiveRowToMatch(r, extrasById.get(r.match_id) ?? { sets: [], gameScore: null, servingPlayerId: null, history: [], currentSetStartedAt: null }, nowMs))

  // 3) SCHEDULED rows (today, not already live) from model_predictions
  const liveSet = new Set(liveIds)
  const dayRows = await getMatchOddsForDay(dateIso)
  const scheduled: Match[] = []
  // Hydrate player names for scheduled rows
  const ids = new Set<string>()
  for (const r of dayRows) {
    if (liveSet.has(r.match.id)) continue
    for (const k of ['pair1_player1_id','pair1_player2_id','pair2_player1_id','pair2_player2_id'] as const) {
      const v = (r.match as Record<string, string | null>)[k]; if (v) ids.add(v)
    }
  }
  const nameById = new Map<string, string>()
  if (ids.size) {
    const { data: pl } = await supabase.from('players').select('id,name').in('id', [...ids])
    for (const p of pl ?? []) nameById.set(p.id, p.name)
  }
  for (const r of dayRows) {
    const mm = r.match as Record<string, string | null> & { id: string; status: string; category: string; court: string | null; round_canonical: string | null; round: string | null; scheduled_at: string }
    if (liveSet.has(mm.id)) continue
    const nm = (id: string | null) => (id ? shortName(nameById.get(id) ?? '—') : 'TBD')
    const pr = r.prediction as { pair1_prob: number; pair2_prob: number; pair1_decimal_odds: number; pair2_decimal_odds: number } | null
    scheduled.push({
      id: mm.id,
      pair1: { name: [nm(mm.pair1_player1_id), nm(mm.pair1_player2_id)].join(' / '), player1Name: nameById.get(mm.pair1_player1_id ?? '') ?? 'TBD', player2Name: nameById.get(mm.pair1_player2_id ?? '') ?? 'TBD', gender: mm.category === 'women' ? 'women' : 'men', serving: false },
      pair2: { name: [nm(mm.pair2_player1_id), nm(mm.pair2_player2_id)].join(' / '), player1Name: nameById.get(mm.pair2_player1_id ?? '') ?? 'TBD', player2Name: nameById.get(mm.pair2_player2_id ?? '') ?? 'TBD', gender: mm.category === 'women' ? 'women' : 'men', serving: false },
      tournament: 'Unknown', court: mm.court, round: mm.round_canonical ?? mm.round, tier: null,
      status: 'scheduled', scheduledAt: mm.scheduled_at,
      setScores: [], gamePoints: null,
      winProb1: pr ? Number(pr.pair1_prob) : 0.5,
      fairOdds1: pr ? Number(pr.pair1_decimal_odds) : 0, fairOdds2: pr ? Number(pr.pair2_decimal_odds) : 0,
      movement15m: 0, confidence: 'med', anchorSource: null, lastUpdatedSeconds: 0,
      winProbHistory: [], currentSetStartedAt: null,
    })
  }

  const matches = [...liveMatches, ...scheduled]
  const kpis = {
    liveMatches: liveMatches.length,
    preMatchModeled: scheduled.length,
    biggestSwing: biggestSwing(liveMatches.map((m) => ({ movement15m: m.movement15m, label: `${m.pair1.name} vs ${m.pair2.name}` }))),
    lowCoverage: liveMatches.filter((m) => m.confidence === 'low').length,
  }
  return { matches, kpis, fetchedAt: new Date(nowMs).toISOString() }
}
```

> **Note (chart Set view):** `currentSetStartedAt` is left `null` in v1 — snapshots carry no set markers, so the chart's Set toggle (Task 11) falls back to the full series with the control disabled when this is null. Wiring a real set-window is a follow-up.
>
> **Note (scheduled tournament name):** `getMatchOddsForDay` doesn't currently return the tournament name. The `/odds` page hydrates it separately; here scheduled rows use `'Unknown'` until Task 5b. If the earlier `/odds` tournament-name change (joining `tournament:tournaments(name)` into `getMatchOddsForDay`) is merged, read `r.match.tournament?.name` instead. Add that join to `getMatchOddsForDay` as part of this task if not already present.

- [ ] **Step 2: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "today/_lib/scoreboard-data" || echo "ok"`
Expected: `ok` (fix any type errors shown).

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_lib/scoreboard-data.ts"
git commit -m "feat(today): server snapshot fetch (live + scheduled merge)"
```

---

### Task 6: Wire a minimal Today page (smoke test the data)

**Files:**
- Modify: `apps/ops/src/app/(app)/today/page.tsx`

- [ ] **Step 1: Replace the page body with a temporary raw render**

```tsx
// apps/ops/src/app/(app)/today/page.tsx
import { PageHeader } from '@/components/ui'
import { getScoreboardSnapshot } from './_lib/scoreboard-data'

export const metadata = { title: 'Today · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function TodayPage() {
  const today = new Date().toISOString().slice(0, 10)
  const snapshot = await getScoreboardSnapshot(today)
  return (
    <div className="ui-page">
      <PageHeader title="Today" />
      <pre style={{ fontSize: 11, overflow: 'auto' }}>{JSON.stringify(snapshot, null, 2)}</pre>
    </div>
  )
}
```

- [ ] **Step 2: Run the dev server and load the page**

Run: `cd apps/ops && npm run dev` (background), then open http://localhost:3004/today (log in if needed).
Expected: JSON renders with `matches`, `kpis`, `fetchedAt` — no server error. If the live-odds worker is off, `liveMatches` may be 0 and `matches` will be the scheduled set.

- [ ] **Step 3: Commit**

```bash
git add "apps/ops/src/app/(app)/today/page.tsx"
git commit -m "feat(today): wire scoreboard snapshot into Today page (raw)"
```

---

## Phase 3 — Presentational shell (static, from the snapshot)

> These tasks port the mockup. Open `docs/superpowers/mockups/live-odds-admin.html` alongside. Build `scoreboard.css` incrementally; copy the relevant rules per component. Keep color discipline.

### Task 7: `scoreboard.css` foundation + `OddsBar`

**Files:**
- Create: `apps/ops/src/app/(app)/today/scoreboard.css`
- Create: `apps/ops/src/app/(app)/today/_components/OddsBar.tsx`

- [ ] **Step 1: Port the odds-bar CSS** from the mockup (`.oddsbar`, fill, track, fair-odds row) into `scoreboard.css`. Use existing tokens (`var(--lime)`, `var(--track)`, `var(--text-3)`); add tabular-nums.

- [ ] **Step 2: Implement OddsBar**

```tsx
// apps/ops/src/app/(app)/today/_components/OddsBar.tsx
export function OddsBar({ prob1, fair1, fair2 }: { prob1: number; fair1: number; fair2: number }) {
  const pct1 = Math.round(prob1 * 100)
  return (
    <div className="sb-oddsbar">
      <div className="sb-oddsbar-track">
        <div className="sb-oddsbar-fill" style={{ width: `${pct1}%` }} />
        <span className="sb-oddsbar-pct sb-oddsbar-pct--fav">{pct1}%</span>
        <span className="sb-oddsbar-pct sb-oddsbar-pct--dog">{100 - pct1}%</span>
      </div>
      <div className="sb-oddsbar-fair">
        <span>{fair1 ? fair1.toFixed(2) : '—'}</span>
        <span>{fair2 ? fair2.toFixed(2) : '—'}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify** by importing into the raw page temporarily, or defer visual check to Task 9.

- [ ] **Step 4: Commit**

```bash
git add "apps/ops/src/app/(app)/today/scoreboard.css" "apps/ops/src/app/(app)/today/_components/OddsBar.tsx"
git commit -m "feat(today): scoreboard.css base + OddsBar"
```

---

### Task 8: `KpiRow`

**Files:**
- Create: `apps/ops/src/app/(app)/today/_components/KpiRow.tsx`
- Modify: `scoreboard.css` (KPI card rules)

- [ ] **Step 1: Implement KpiRow** (4 cards; port `.kpi` styling; orange accent on the swing card, lime on others)

```tsx
// apps/ops/src/app/(app)/today/_components/KpiRow.tsx
import type { KpiData } from '../_lib/types'

export function KpiRow({ kpis }: { kpis: KpiData }) {
  const swingPos = kpis.biggestSwing.pct >= 0
  return (
    <div className="sb-kpirow">
      <Card label="Live matches" value={kpis.liveMatches} accent="lime" />
      <Card label="Pre-match modeled" value={kpis.preMatchModeled} accent="lime" />
      <Card
        label="Biggest swing · 15m"
        value={`${swingPos ? '+' : ''}${kpis.biggestSwing.pct}%`}
        sub={kpis.biggestSwing.label}
        accent="orange"
      />
      <Card label="Low coverage" value={kpis.lowCoverage} accent="muted" />
    </div>
  )
}

function Card({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent: 'lime' | 'orange' | 'muted' }) {
  return (
    <div className={`sb-kpi sb-kpi--${accent}`}>
      <div className="sb-kpi-label">{label}</div>
      <div className="sb-kpi-value">{value}</div>
      {sub ? <div className="sb-kpi-sub">{sub}</div> : null}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_components/KpiRow.tsx" "apps/ops/src/app/(app)/today/scoreboard.css"
git commit -m "feat(today): KpiRow"
```

---

### Task 9: `MatchRow` + `MatchesTable` (static)

**Files:**
- Create: `apps/ops/src/app/(app)/today/_components/MatchRow.tsx`
- Create: `apps/ops/src/app/(app)/today/_components/MatchesTable.tsx`
- Modify: `scoreboard.css` (table, row, pair, serve dot, set columns, badges, movement chip, confidence meter)

- [ ] **Step 1: Implement MatchRow** — two stacked pair rows (serve dot via `pair.serving`, gender tag, lead/trail weighting), tournament + court/round subline, per-set columns (current-set lime, game-point box orange when `gamePoints`), `<OddsBar>`, movement chip (red when negative, orange/lime when positive), 3-bar confidence meter (`full`=3 bars, `med`=2, `low`=1), `lastUpdatedSeconds`. Port markup/classes from the mockup `<tbody>` row. Props:

```tsx
// apps/ops/src/app/(app)/today/_components/MatchRow.tsx
import type { Match } from '../_lib/types'
import { OddsBar } from './OddsBar'

export function MatchRow({ match, selected, onSelect }: { match: Match; selected: boolean; onSelect: (id: string) => void }) {
  // ...port mockup row markup; use match fields; call onSelect(match.id) on click
}
```

- [ ] **Step 2: Implement MatchesTable** — panel + header (title + live-count pill) + table with columns Match · Tournament · Sets·Pts · Win probability · 15m · Conf. · Upd; map `matches` to `<MatchRow>`. Filters added in Task 10 (leave a placeholder filter bar slot). Empty state via `EmptyState` when no matches.

- [ ] **Step 3: Render in the page** — update `today/page.tsx` to a client-less static composition for now:

```tsx
// today/page.tsx (interim)
import './scoreboard.css'
import { PageHeader } from '@/components/ui'
import { getScoreboardSnapshot } from './_lib/scoreboard-data'
import { KpiRow } from './_components/KpiRow'
import { MatchesTable } from './_components/MatchesTable'

export default async function TodayPage() {
  const today = new Date().toISOString().slice(0, 10)
  const snapshot = await getScoreboardSnapshot(today)
  return (
    <div className="ui-page sb-page">
      <PageHeader title="Today" />
      <KpiRow kpis={snapshot.kpis} />
      <MatchesTable matches={snapshot.matches} />
    </div>
  )
}
```

(`MatchesTable` is a client component for selection later; for now it can be server-rendered with no selection.)

- [ ] **Step 4: Visual check** at http://localhost:3004/today — KPI row + table render with real data, odds bars fill correctly, styling matches the mockup.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_components/MatchRow.tsx" "apps/ops/src/app/(app)/today/_components/MatchesTable.tsx" "apps/ops/src/app/(app)/today/scoreboard.css" "apps/ops/src/app/(app)/today/page.tsx"
git commit -m "feat(today): static MatchesTable + MatchRow from real snapshot"
```

---

## Phase 4 — Interactivity (orchestrator, filters, selection, realtime)

### Task 10: `ScoreboardView` orchestrator + filters + selection

**Files:**
- Create: `apps/ops/src/app/(app)/today/_components/ScoreboardView.tsx`
- Modify: `today/page.tsx` (render `<ScoreboardView initial={snapshot} />`)
- Modify: `MatchesTable.tsx` (accept filter state + selection callbacks)

- [ ] **Step 1: Implement ScoreboardView** (client) holding: `snapshot` state (seeded from `initial`), `selectedId` (default first match), `filters` (`{ status: 'all'|'live'|'break'|'sched', tournament, gender, tier, round }`). Apply filters to `snapshot.matches` before passing to `MatchesTable`. Render `KpiRow`, `MatchesTable`, `DetailPanel` (Task 11) in the 2-column layout from the mockup.

```tsx
// apps/ops/src/app/(app)/today/_components/ScoreboardView.tsx
'use client'
import { useMemo, useState } from 'react'
import type { LiveOddsSnapshot } from '../_lib/types'
import { KpiRow } from './KpiRow'
import { MatchesTable } from './MatchesTable'
import { DetailPanel } from './DetailPanel'

export function ScoreboardView({ initial }: { initial: LiveOddsSnapshot }) {
  const [snapshot] = useState(initial)
  const [selectedId, setSelectedId] = useState<string | null>(initial.matches[0]?.id ?? null)
  const [filters, setFilters] = useState({ status: 'all' as 'all'|'live'|'break'|'sched' })
  const visible = useMemo(() => snapshot.matches.filter((m) =>
    filters.status === 'all' ? true :
    filters.status === 'sched' ? m.status === 'scheduled' : m.status === filters.status
  ), [snapshot.matches, filters])
  const selected = snapshot.matches.find((m) => m.id === selectedId) ?? null
  return (
    <div className="sb-grid">
      <div className="sb-main">
        <KpiRow kpis={snapshot.kpis} />
        <MatchesTable matches={visible} filters={filters} setFilters={setFilters} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      <DetailPanel match={selected} />
    </div>
  )
}
```

- [ ] **Step 2: Wire page.tsx** to render `<ScoreboardView initial={snapshot} />` (drop the direct KpiRow/MatchesTable usage).

- [ ] **Step 3: Implement the filter bar** in `MatchesTable` — segmented `All / Live / Break / Sched` (+ tournament/gender/tier/round pill selectors derived from the visible set; port mockup `.filterbar`). Clicking sets `filters`.

- [ ] **Step 4: Visual check** — clicking segments filters the table; clicking a row highlights it.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_components/ScoreboardView.tsx" "apps/ops/src/app/(app)/today/_components/MatchesTable.tsx" "apps/ops/src/app/(app)/today/page.tsx"
git commit -m "feat(today): ScoreboardView orchestrator + filters + selection"
```

---

### Task 11: `DetailPanel` + `WinProbChart`

**Files:**
- Create: `apps/ops/src/app/(app)/today/_components/DetailPanel.tsx`
- Create: `apps/ops/src/app/(app)/today/_components/WinProbChart.tsx`
- Modify: `scoreboard.css` (detail panel, well, driver bars)

- [ ] **Step 1: Implement WinProbChart** reusing `OddsMovementChart`. Convert `winProbHistory` (favorite-side pair1 prob) into a single series. Synthesize timestamps by index when only values are stored (the chart only needs ordering):

```tsx
// apps/ops/src/app/(app)/today/_components/WinProbChart.tsx
'use client'
import { OddsMovementChart } from '@/components/Odds/OddsMovementChart'
import type { Match } from '../_lib/types'

export function WinProbChart({ match }: { match: Match }) {
  const pts = match.winProbHistory.map((value, i) => ({ t: `t${String(i).padStart(2, '0')}`, value }))
  if (pts.length < 2) {
    return <div className="sb-chart-empty">No live probability history yet.</div>
  }
  return <OddsMovementChart series={[{ name: match.pair1.name, color: 'var(--lime)', points: pts }]} yLabel="Win prob" yDomain={[0, 1]} />
}
```

> Set/Match toggle: render the control; Match = full `winProbHistory`. Set view is disabled when `match.currentSetStartedAt` is null (v1) — show a tooltip "Set view unavailable". This honours the spec's graceful-degrade note.

- [ ] **Step 2: Implement DetailPanel** — head (SELECTED MATCH + title + meta), two probability rows (pair name + big % + fair odds), `<WinProbChart>`, then driver stat bars **only when `match.tier` is Premier-tier and stats exist** (fetch deferred — see Step 3). No CTAs. Empty state when `match` is null.

```tsx
// apps/ops/src/app/(app)/today/_components/DetailPanel.tsx
'use client'
import type { Match } from '../_lib/types'
import { WinProbChart } from './WinProbChart'

export function DetailPanel({ match }: { match: Match | null }) {
  if (!match) return <aside className="sb-detail sb-detail--empty">Select a match</aside>
  // ...port mockup detail markup; probability rows; <WinProbChart match={match} />
}
```

- [ ] **Step 3: Driver bars (Premier-only).** v1: render driver bars only if a `match_stats` row is available. Since stats aren't in the snapshot, either (a) omit driver bars in v1 and leave a `{/* drivers: follow-up */}` slot, or (b) add a small client fetch to `/api/match-stats?matchId=...` if that endpoint exists. **Recommended v1: omit** (the spec lists drivers as graceful-degrade). Document the omission in the commit message.

- [ ] **Step 4: Visual check** — selecting a live match with snapshot history shows the chart; scheduled/insufficient-history shows the empty state.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_components/DetailPanel.tsx" "apps/ops/src/app/(app)/today/_components/WinProbChart.tsx" "apps/ops/src/app/(app)/today/scoreboard.css"
git commit -m "feat(today): DetailPanel + WinProbChart (drivers deferred)"
```

---

### Task 12: Realtime + self-clearing poll (`useScoreboard`)

**Files:**
- Create: `apps/ops/src/app/(app)/today/_lib/useScoreboard.ts`
- Modify: `ScoreboardView.tsx` (use the hook instead of static `useState(initial)`)

- [ ] **Step 1: Implement the hook** — anon Supabase client; subscribe to `match_live_odds` Realtime (`postgres_changes`, event `*`); on any event, re-fetch the snapshot via a client-callable route or by re-running a client query. Because `getScoreboardSnapshot` is server-only (service client), expose a thin **route** `GET /api/internal/today-scoreboard?date=YYYY-MM-DD` that returns the snapshot, and have the hook fetch it. Also poll every 30s (the self-clear pattern). Track `connection` from the channel subscribe status.

```ts
// apps/ops/src/app/(app)/today/_lib/useScoreboard.ts
'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import type { LiveOddsSnapshot, ConnectionState } from './types'

export function useScoreboard(initial: LiveOddsSnapshot, dateIso: string) {
  const [snapshot, setSnapshot] = useState(initial)
  const [connection, setConnection] = useState<ConnectionState>('live')
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    const load = async () => {
      try {
        const res = await fetch(`/api/internal/today-scoreboard?date=${dateIso}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        const data = (await res.json()) as LiveOddsSnapshot
        if (active.current) { setSnapshot(data); setConnection('live') }
      } catch {
        if (active.current) setConnection('reconnecting')
      }
    }
    const ch = supabase.channel('today_live_odds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_live_odds' }, load)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnection('live')
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('offline')
      })
    const poll = setInterval(load, 30_000)
    return () => { active.current = false; clearInterval(poll); supabase.removeChannel(ch) }
  }, [dateIso])
  return { snapshot, connection }
}
```

- [ ] **Step 2: Create the route** `apps/ops/src/app/api/internal/today-scoreboard/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { getScoreboardSnapshot } from '@/app/(app)/today/_lib/scoreboard-data'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
  return NextResponse.json(await getScoreboardSnapshot(date))
}
```

(Confirm `/api/internal/*` is operator-gated like the rest; if not, follow the auth pattern used by the existing `/api/internal/today` route.)

- [ ] **Step 3: Use the hook in ScoreboardView** — replace `useState(initial)` with `const { snapshot, connection } = useScoreboard(initial, dateIso)`; pass `dateIso` as a prop from the page; keep `selectedId`/`filters` local.

- [ ] **Step 4: Visual check** — with the live-odds worker enabled, numbers update without a reload; finished matches drop within 30s.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_lib/useScoreboard.ts" "apps/ops/src/app/api/internal/today-scoreboard/route.ts" "apps/ops/src/app/(app)/today/_components/ScoreboardView.tsx" "apps/ops/src/app/(app)/today/page.tsx"
git commit -m "feat(today): realtime + 30s poll via useScoreboard + snapshot route"
```

---

### Task 13: Connection states (`ConnectionBanner`) + motion polish

**Files:**
- Create: `apps/ops/src/app/(app)/today/_components/ConnectionBanner.tsx`
- Modify: `ScoreboardView.tsx`, `scoreboard.css`

- [ ] **Step 1: Implement ConnectionBanner** — hidden when `live`; orange + spinner on `reconnecting`; red + Retry on `offline`. Port the mockup banner.

- [ ] **Step 2: Set `data-conn` on the page wrapper** from `connection`, and port the mockup's `[data-conn]` descendant CSS (frozen/desaturated odds, grayed LIVE badges) into `scoreboard.css`.

- [ ] **Step 3: Motion polish** — score-flash on set/game change (CSS `@keyframes` from the mockup; gate on `prefers-reduced-motion`), ticking `lastUpdatedSeconds` (local 1s interval recomputing display only). Keep motion off when `connection !== 'live'` or reduced-motion.

- [ ] **Step 4: Visual check** — stop the worker / throttle network → reconnecting/offline render; reduced-motion disables animation.

- [ ] **Step 5: Commit**

```bash
git add "apps/ops/src/app/(app)/today/_components/ConnectionBanner.tsx" "apps/ops/src/app/(app)/today/_components/ScoreboardView.tsx" "apps/ops/src/app/(app)/today/scoreboard.css"
git commit -m "feat(today): connection states + motion polish"
```

---

## Phase 5 — Retire `/odds` landing + cleanup

### Task 14: Redirect `/odds` → `/today`, delete dead Today/odds-landing code

**Files:**
- Modify: `apps/ops/src/app/(app)/odds/page.tsx`
- Delete: `TodayLiveNow.tsx`, `TodayRequiresAttention.tsx`, `TodaySchedule.tsx`, `TodayStatusPill.tsx`, `TodayRefreshButton.tsx`, `apps/ops/src/lib/today-aggregator.ts`, `apps/ops/src/components/Odds/LiveNowSection.tsx`

- [ ] **Step 1: Confirm reachability** — verify Needs Review, OOP/Schedule are reachable from the Rail (`grep` the Rail nav config). Confirm the deleted components aren't imported elsewhere:

Run: `cd apps/ops && for f in TodayLiveNow TodayRequiresAttention TodaySchedule TodayStatusPill TodayRefreshButton today-aggregator LiveNowSection; do echo "== $f =="; grep -rln "$f" src --include=*.tsx --include=*.ts | grep -v "/today/" ; done`
Expected: only the `odds/page.tsx` import of `LiveNowSection` (removed next step); no other importers.

- [ ] **Step 2: Replace `/odds` landing with a redirect**

```tsx
// apps/ops/src/app/(app)/odds/page.tsx
import { redirect } from 'next/navigation'
export default function OddsLandingRedirect() {
  redirect('/today')
}
```

- [ ] **Step 3: Delete the dead files**

```bash
cd apps/ops
git rm src/components/TodayLiveNow.tsx src/components/TodayRequiresAttention.tsx src/components/TodaySchedule.tsx src/components/TodayStatusPill.tsx src/components/TodayRefreshButton.tsx src/lib/today-aggregator.ts src/components/Odds/LiveNowSection.tsx
```

- [ ] **Step 4: Typecheck + build**

Run: `cd apps/ops && npx tsc --noEmit -p tsconfig.json && echo "TS OK"`
Expected: `TS OK` (resolve any orphaned imports).

- [ ] **Step 5: Visual check** — `/odds` redirects to `/today`; `/odds/calibration`, `/odds/methodology`, `/odds/match/[id]`, `/odds/tournament/[id]` still load.

- [ ] **Step 6: Commit**

```bash
git add -A "apps/ops/src/app/(app)/odds/page.tsx"
git commit -m "feat(odds): retire /odds landing → redirect to /today; remove dead Today + LiveNowSection"
```

---

### Task 15: Enable the live-odds worker (ops toggle)

**Files:**
- None in-repo (env var). Document only.

- [ ] **Step 1:** Decide with the operator whether to set `ENABLE_LIVE_ODDS_UPDATER=true` (padelgod env, Railway). Until enabled, Today shows scheduled rows + empty live state. This is an ops action, not a code change — note it in the PR description.

- [ ] **Step 2:** If enabled, verify on a real live match that `match_live_odds` rows appear and Today's live section + win-prob chart populate.

---

### Task 16: Final review + full test run

- [ ] **Step 1: Run all new unit tests**

Run: `cd apps/ops && npx vitest run "src/app/(app)/today"`
Expected: PASS.

- [ ] **Step 2: Production build**

Run: `cd apps/ops && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual pass** against the running app: live matches show moving odds; scheduled rows show pre-match odds; filters work; selection drives the panel + chart; connection states render; `/odds` redirects.

- [ ] **Step 4: Request code review** (superpowers:requesting-code-review) before opening the PR.

---

## Self-Review (author checklist — completed)

- **Spec coverage:** §3 routing → Task 6/9/10/14; §4 data mapping → Tasks 4–5, 12; KPIs → Tasks 5, 8; serving → Task 5; movement/biggest-swing → Tasks 2, 5; confidence → Task 2; chart → Task 11; connection states → Task 13; retire landing → Task 14; worker flag → Task 15; fonts (keep stack + tabular-nums) → Task 7 CSS. All covered.
- **Graceful-degrade gaps explicitly handled:** driver bars omitted v1 (Task 11 Step 3); chart Set view disabled when no set-window (Task 5/11 notes); confidence 2-level mapping (Task 2).
- **Type consistency:** `Match`/`KpiData`/`LiveOddsSnapshot` defined in Task 1 are used unchanged in Tasks 4, 5, 8, 10, 11, 12. `getScoreboardSnapshot(dateIso)` signature consistent across Tasks 5, 6, 12. `movement15m(series, nowMs)` and `coverageToConfidence`/`biggestSwing` signatures match between Task 2 defs and Task 5 calls.
- **Placeholder scan:** no TBD/TODO left as work items; the two deferrals (drivers, Set view) are explicit, scoped, and spec-sanctioned.
