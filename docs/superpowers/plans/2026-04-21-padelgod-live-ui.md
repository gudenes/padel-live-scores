# Padelgod Live UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shadow-mode live-match UI with two surfaces — an ops validation view and a hidden, `noindex`ed PadelNachos preview page — both consuming one shared API, both showing a 🎾 server indicator and a plain point-by-point log.

**Architecture:** A single server route (`/api/padelgod-shadow/live-cards`) builds the payload by joining `public.matches` + `padelgod.shadow_sets` + `padelgod.shadow_match_points`. All data-shaping logic lives in pure helpers in `src/lib/padelgod-live-cards.ts` and is unit-tested. Two thin UI surfaces poll this route every 5s: the `PadelgodShadowTab` gets a "Live cards" section + a "Preview live UI" button; a new `/x/live-preview` page sits outside the `[locale]` tree, off the sitemap, and returns `noindex,nofollow`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind inline styles (matching existing ops tab style), Supabase JS client (service key, server-side), Vitest for pure-function tests.

**Spec:** `docs/superpowers/specs/2026-04-21-padelgod-live-ui-design.md`

**Branch:** `feat/padelgod-live-ui` (already created)

---

## File Structure

```
NEW:
  src/lib/padelgod-live-cards.ts                         # Types + pure helpers (the heart of the feature)
  src/lib/__tests__/padelgod-live-cards.test.ts          # Vitest tests for the helpers
  src/app/api/padelgod-shadow/live-cards/route.ts    # Thin route: Supabase → helpers → Response
  src/components/ShadowMatchCard.tsx                     # Presentational, MatchCard-lookalike with 🎾
  src/components/PointLog.tsx                            # Presentational, <pre>-style log
  src/app/x/live-preview/page.tsx                        # Server component wrapper (noindex metadata)
  src/app/x/live-preview/ShadowLivePreview.tsx           # Client component that polls + renders

MODIFY:
  src/proxy.ts                                           # Add /x/ to the i18n-skip list
  src/app/robots.ts                                      # Add /x/ to disallow
  src/app/ops/PadelgodShadowTab.tsx                      # Add "Live cards" section + "Preview live UI" button
```

Responsibilities:
- **`src/lib/padelgod-live-cards.ts`** — owns every piece of derivation logic. Types, the latest-point selector, the `score_after` parser, the "is this the current set?" marker, and the single-match payload builder. 100% pure; no I/O. Anything testable lives here.
- **Route file** — thin shell; runs queries, passes rows to helpers, formats the response. Verified manually.
- **Components** — pure presentation; no logic. Format strings with tiny inline formatters, render JSX.
- **Client poller** (`ShadowLivePreview.tsx`) — `useEffect` + `setInterval`, `visibilitychange` listener, fetch + state.

---

## Task 1 — Proxy skip + robots disallow for `/x/`

**Files:**
- Modify: `src/proxy.ts`
- Modify: `src/app/robots.ts`

- [ ] **Step 1: Read the current proxy skip structure**

Run: `grep -n "pathname.startsWith" src/proxy.ts`

Expected output lists the existing skip conditions for `/api`, `/ops`, `/auth`, `/admin` (order may vary). Note the line number of the last `NextResponse.next()` before the `handleI18nRouting(request)` call — that's where you insert.

- [ ] **Step 2: Add `/x/` skip in proxy.ts**

Insert a new block immediately before the `handleI18nRouting(request)` call:

```typescript
// 6. Hidden /x/ preview routes — English-only, skip i18n
if (pathname.startsWith('/x/')) {
  return NextResponse.next()
}
```

Use the comment number matching the project's convention (check what number the block *before* `handleI18nRouting` has; use that+1).

- [ ] **Step 3: Update robots.ts disallow**

Open `src/app/robots.ts`. The file currently reads:

```typescript
import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/ops/', '/auth/'],
      },
    ],
    sitemap: 'https://padelnachos.com/sitemap.xml',
  }
}
```

Change the disallow array to:

```typescript
        disallow: ['/api/', '/ops/', '/auth/', '/x/'],
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0 (same warnings as before, no new errors).

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts src/app/robots.ts
git commit -m "$(cat <<'EOF'
feat(shadow-ui): reserve /x/ for hidden preview pages

Add /x/ to the i18n-skip list in proxy.ts and to the robots.txt disallow.
No page lives here yet — this clears the routing + SEO gate before
/x/live-preview lands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Types + `parseScoreAfter` helper (TDD)

**Files:**
- Create: `src/lib/padelgod-live-cards.ts`
- Create: `src/lib/__tests__/padelgod-live-cards.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/padelgod-live-cards.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseScoreAfter } from '../padelgod-live-cards'

describe('parseScoreAfter', () => {
  it('parses a standard score string', () => {
    expect(parseScoreAfter('40-30')).toEqual({ pair1Score: '40', pair2Score: '30' })
  })

  it('parses deuce', () => {
    expect(parseScoreAfter('40-40')).toEqual({ pair1Score: '40', pair2Score: '40' })
  })

  it('parses advantage (Ad-40)', () => {
    expect(parseScoreAfter('Ad-40')).toEqual({ pair1Score: 'Ad', pair2Score: '40' })
  })

  it('returns 0-0 for null', () => {
    expect(parseScoreAfter(null)).toEqual({ pair1Score: '0', pair2Score: '0' })
  })

  it('returns 0-0 for malformed input', () => {
    expect(parseScoreAfter('nonsense')).toEqual({ pair1Score: '0', pair2Score: '0' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/padelgod-live-cards.test.ts`
Expected: all 5 tests fail with "Failed to resolve import '../padelgod-live-cards'".

- [ ] **Step 3: Create the types + parseScoreAfter**

Create `src/lib/padelgod-live-cards.ts`:

```typescript
// src/lib/padelgod-live-cards.ts
// Pure types + helpers for the Padelgod shadow-mode live UI.
// No I/O. All Supabase interaction lives in the route file.

export type PlayerLite = { name: string; country: string | null } | null

export type PointEntry = {
  set: number
  game: number
  pt: number
  server: 1 | 2 | null
  score: string
  winner: 1 | 2
  isGoldenPoint: boolean
  at: string
}

export type SetEntry = {
  setNumber: number
  pair1Games: number
  pair2Games: number
  isCurrent: boolean
}

export type CurrentGame = {
  pair1Score: string
  pair2Score: string
  isGoldenPoint: boolean
}

export type LiveCard = {
  id: string
  tournamentId: string
  tournamentName: string
  status: 'live' | 'scheduled' | 'finished'
  court: string | null
  round: string | null
  scheduledAt: string | null
  pair1: { player1: PlayerLite; player2: PlayerLite }
  pair2: { player1: PlayerLite; player2: PlayerLite }
  sets: SetEntry[]
  currentGame: CurrentGame
  servingTeam: 1 | 2 | null
  points: PointEntry[]
}

export type LiveCardsResponse = {
  observedAt: string
  matches: LiveCard[]
}

// Raw row shapes coming out of Supabase (mirror the DB columns we read)
export type ShadowSetRow = {
  match_id: string
  set_number: number
  pair1_games: number | null
  pair2_games: number | null
  updated_at: string | null
}

export type ShadowPointRow = {
  match_id: string
  set_number: number
  game_number: number
  point_number: number
  winner_pair: 1 | 2
  score_after: string | null
  server_team: 1 | 2 | null
  is_golden_point: boolean
  created_at: string
}

export type MatchRow = {
  id: string
  tournament_id: string
  status: string
  court: string | null
  round: string | null
  scheduled_at: string | null
  pair1_player1: { name: string; country: string | null } | null
  pair1_player2: { name: string; country: string | null } | null
  pair2_player1: { name: string; country: string | null } | null
  pair2_player2: { name: string; country: string | null } | null
}

// ---------------------------------------------------------------------------
// parseScoreAfter — split "40-30" into { pair1Score, pair2Score }
// Returns { "0", "0" } for null or malformed input.
// ---------------------------------------------------------------------------
export function parseScoreAfter(score: string | null): {
  pair1Score: string
  pair2Score: string
} {
  if (!score) return { pair1Score: '0', pair2Score: '0' }
  const parts = score.split('-')
  if (parts.length !== 2) return { pair1Score: '0', pair2Score: '0' }
  const [a, b] = parts
  if (!a || !b) return { pair1Score: '0', pair2Score: '0' }
  return { pair1Score: a.trim(), pair2Score: b.trim() }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/padelgod-live-cards.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/padelgod-live-cards.ts src/lib/__tests__/padelgod-live-cards.test.ts
git commit -m "$(cat <<'EOF'
feat(shadow-ui): add types + parseScoreAfter helper

First slice of the pure-helper module for the shadow-mode live UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — `deriveLiveState` + `markCurrentSets` helpers (TDD)

**Files:**
- Modify: `src/lib/padelgod-live-cards.ts`
- Modify: `src/lib/__tests__/padelgod-live-cards.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/__tests__/padelgod-live-cards.test.ts`:

```typescript
import { deriveLiveState, markCurrentSets } from '../padelgod-live-cards'
import type { ShadowPointRow, ShadowSetRow } from '../padelgod-live-cards'

const mkPoint = (o: Partial<ShadowPointRow>): ShadowPointRow => ({
  match_id: 'm1',
  set_number: 1,
  game_number: 1,
  point_number: 1,
  winner_pair: 1,
  score_after: '15-0',
  server_team: 1,
  is_golden_point: false,
  created_at: '2026-04-21T09:00:00.000Z',
  ...o,
})

describe('deriveLiveState', () => {
  it('returns 0-0 and null server when no points', () => {
    expect(deriveLiveState([])).toEqual({
      currentGame: { pair1Score: '0', pair2Score: '0', isGoldenPoint: false },
      servingTeam: null,
    })
  })

  it('uses the latest point by (set, game, pt) — newest-last input', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, score_after: '15-0',  server_team: 1 }),
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, score_after: '30-40', server_team: 2 }),
    ]
    expect(deriveLiveState(points)).toEqual({
      currentGame: { pair1Score: '30', pair2Score: '40', isGoldenPoint: false },
      servingTeam: 2,
    })
  })

  it('flags a golden-point correctly', () => {
    const points = [mkPoint({ score_after: '40-40', server_team: 1, is_golden_point: true })]
    expect(deriveLiveState(points)).toEqual({
      currentGame: { pair1Score: '40', pair2Score: '40', isGoldenPoint: true },
      servingTeam: 1,
    })
  })

  it('returns null server when server_team is null', () => {
    const points = [mkPoint({ server_team: null, score_after: '15-0' })]
    expect(deriveLiveState(points).servingTeam).toBeNull()
  })
})

const mkSet = (o: Partial<ShadowSetRow>): ShadowSetRow => ({
  match_id: 'm1',
  set_number: 1,
  pair1_games: 0,
  pair2_games: 0,
  updated_at: null,
  ...o,
})

describe('markCurrentSets', () => {
  it('returns empty array for empty input', () => {
    expect(markCurrentSets([])).toEqual([])
  })

  it('marks the highest-numbered set as current', () => {
    const sets = [
      mkSet({ set_number: 1, pair1_games: 6, pair2_games: 3 }),
      mkSet({ set_number: 2, pair1_games: 3, pair2_games: 4 }),
    ]
    expect(markCurrentSets(sets)).toEqual([
      { setNumber: 1, pair1Games: 6, pair2Games: 3, isCurrent: false },
      { setNumber: 2, pair1Games: 3, pair2Games: 4, isCurrent: true },
    ])
  })

  it('returns sets sorted by set_number ascending regardless of input order', () => {
    const sets = [
      mkSet({ set_number: 2, pair1_games: 3, pair2_games: 4 }),
      mkSet({ set_number: 1, pair1_games: 6, pair2_games: 3 }),
    ]
    const result = markCurrentSets(sets)
    expect(result.map(s => s.setNumber)).toEqual([1, 2])
    expect(result[1].isCurrent).toBe(true)
  })

  it('handles null games as 0', () => {
    const sets = [mkSet({ set_number: 1, pair1_games: null, pair2_games: null })]
    expect(markCurrentSets(sets)).toEqual([
      { setNumber: 1, pair1Games: 0, pair2Games: 0, isCurrent: true },
    ])
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/__tests__/padelgod-live-cards.test.ts`
Expected: `deriveLiveState` and `markCurrentSets` tests fail with "not exported".

- [ ] **Step 3: Implement both helpers**

Append to `src/lib/padelgod-live-cards.ts`:

```typescript
// ---------------------------------------------------------------------------
// deriveLiveState — from a flat list of shadow points, return the currentGame
// state and the servingTeam for "right now".
// ---------------------------------------------------------------------------
export function deriveLiveState(points: ShadowPointRow[]): {
  currentGame: CurrentGame
  servingTeam: 1 | 2 | null
} {
  if (points.length === 0) {
    return {
      currentGame: { pair1Score: '0', pair2Score: '0', isGoldenPoint: false },
      servingTeam: null,
    }
  }
  // Find the latest by (set, game, pt)
  const latest = points.reduce((acc, cur) => {
    if (cur.set_number > acc.set_number) return cur
    if (cur.set_number < acc.set_number) return acc
    if (cur.game_number > acc.game_number) return cur
    if (cur.game_number < acc.game_number) return acc
    return cur.point_number > acc.point_number ? cur : acc
  }, points[0])

  const { pair1Score, pair2Score } = parseScoreAfter(latest.score_after)
  return {
    currentGame: { pair1Score, pair2Score, isGoldenPoint: latest.is_golden_point },
    servingTeam: latest.server_team,
  }
}

// ---------------------------------------------------------------------------
// markCurrentSets — normalise shadow_set rows into SetEntry[], sorted ascending
// with isCurrent=true on the highest set_number.
// ---------------------------------------------------------------------------
export function markCurrentSets(sets: ShadowSetRow[]): SetEntry[] {
  if (sets.length === 0) return []
  const sorted = [...sets].sort((a, b) => a.set_number - b.set_number)
  const maxIdx = sorted.length - 1
  return sorted.map((s, i) => ({
    setNumber: s.set_number,
    pair1Games: s.pair1_games ?? 0,
    pair2Games: s.pair2_games ?? 0,
    isCurrent: i === maxIdx,
  }))
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/lib/__tests__/padelgod-live-cards.test.ts`
Expected: all tests (Task 2 + Task 3) passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/padelgod-live-cards.ts src/lib/__tests__/padelgod-live-cards.test.ts
git commit -m "$(cat <<'EOF'
feat(shadow-ui): add deriveLiveState + markCurrentSets helpers

Pure functions for driving the 🎾 server indicator and the set-score
row from raw shadow_* rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — `buildLiveCard` helper (TDD)

**Files:**
- Modify: `src/lib/padelgod-live-cards.ts`
- Modify: `src/lib/__tests__/padelgod-live-cards.test.ts`

- [ ] **Step 1: Append failing tests**

Append to the test file:

```typescript
import { buildLiveCard } from '../padelgod-live-cards'
import type { MatchRow } from '../padelgod-live-cards'

const baseMatch: MatchRow = {
  id: 'match-1',
  tournament_id: 'tour-1',
  status: 'live',
  court: 'COURT NEXTENSA',
  round: 'Q3',
  scheduled_at: null,
  pair1_player1: { name: 'Coello', country: 'ESP' },
  pair1_player2: { name: 'Tapia', country: 'ARG' },
  pair2_player1: { name: 'Galán', country: 'ESP' },
  pair2_player2: { name: 'Chingotto', country: 'ARG' },
}

describe('buildLiveCard', () => {
  it('builds a live card with servingTeam=null when points are empty', () => {
    const card = buildLiveCard(baseMatch, 'Brussels P2 2026', [], [])
    expect(card.status).toBe('live')
    expect(card.servingTeam).toBeNull()
    expect(card.currentGame).toEqual({ pair1Score: '0', pair2Score: '0', isGoldenPoint: false })
    expect(card.sets).toEqual([])
    expect(card.points).toEqual([])
    expect(card.tournamentName).toBe('Brussels P2 2026')
    expect(card.pair1.player1).toEqual({ name: 'Coello', country: 'ESP' })
  })

  it('sets servingTeam and currentGame from the latest point', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, score_after: '15-0',  server_team: 1 }),
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, score_after: '30-40', server_team: 2 }),
    ]
    const card = buildLiveCard(baseMatch, 'Brussels P2 2026', [], points)
    expect(card.servingTeam).toBe(2)
    expect(card.currentGame).toEqual({ pair1Score: '30', pair2Score: '40', isGoldenPoint: false })
  })

  it('orders points oldest-first regardless of input order', () => {
    const points: ShadowPointRow[] = [
      mkPoint({ set_number: 1, game_number: 2, point_number: 3, created_at: 't2' }),
      mkPoint({ set_number: 1, game_number: 1, point_number: 1, created_at: 't1' }),
    ]
    const card = buildLiveCard(baseMatch, 'T', [], points)
    expect(card.points.map(p => `${p.set}-${p.game}-${p.pt}`)).toEqual([
      '1-1-1', '1-2-3',
    ])
  })

  it('caps points at 50, keeping the most recent', () => {
    const points: ShadowPointRow[] = []
    for (let i = 1; i <= 60; i++) {
      points.push(mkPoint({ set_number: 1, game_number: 1, point_number: i }))
    }
    const card = buildLiveCard(baseMatch, 'T', [], points)
    expect(card.points).toHaveLength(50)
    // First entry should be point_number 11 (oldest of the kept 50)
    expect(card.points[0].pt).toBe(11)
    expect(card.points[49].pt).toBe(60)
  })

  it('hides servingTeam for finished matches', () => {
    const match: MatchRow = { ...baseMatch, status: 'finished' }
    const points = [mkPoint({ server_team: 1 })]
    const card = buildLiveCard(match, 'T', [], points)
    expect(card.status).toBe('finished')
    expect(card.servingTeam).toBeNull()
  })

  it('normalises status "ended" to "finished"', () => {
    const match: MatchRow = { ...baseMatch, status: 'ended' }
    const card = buildLiveCard(match, 'T', [], [])
    expect(card.status).toBe('finished')
  })

  it('passes scheduled status through untouched', () => {
    const match: MatchRow = { ...baseMatch, status: 'scheduled' }
    const card = buildLiveCard(match, 'T', [], [])
    expect(card.status).toBe('scheduled')
    expect(card.servingTeam).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failures**

Run: `npx vitest run src/lib/__tests__/padelgod-live-cards.test.ts`
Expected: the 7 new `buildLiveCard` tests fail.

- [ ] **Step 3: Implement `buildLiveCard`**

Append to `src/lib/padelgod-live-cards.ts`:

```typescript
// ---------------------------------------------------------------------------
// buildLiveCard — compose a LiveCard from a match row + its shadow sets + its
// shadow points. Points ordered oldest-first, capped at 50.
// ---------------------------------------------------------------------------

const MAX_POINTS = 50

function normaliseStatus(raw: string): 'live' | 'scheduled' | 'finished' {
  if (raw === 'live') return 'live'
  if (raw === 'ended' || raw === 'finished' || raw === 'retired' || raw === 'walkover') return 'finished'
  return 'scheduled'
}

function comparePoints(a: ShadowPointRow, b: ShadowPointRow): number {
  if (a.set_number !== b.set_number) return a.set_number - b.set_number
  if (a.game_number !== b.game_number) return a.game_number - b.game_number
  return a.point_number - b.point_number
}

export function buildLiveCard(
  match: MatchRow,
  tournamentName: string,
  sets: ShadowSetRow[],
  points: ShadowPointRow[],
): LiveCard {
  const status = normaliseStatus(match.status)
  const sortedPoints = [...points].sort(comparePoints)
  const cappedPoints = sortedPoints.slice(-MAX_POINTS)

  const live = status === 'live'
    ? deriveLiveState(sortedPoints)
    : {
        currentGame: { pair1Score: '0', pair2Score: '0', isGoldenPoint: false } as CurrentGame,
        servingTeam: null as 1 | 2 | null,
      }

  return {
    id: match.id,
    tournamentId: match.tournament_id,
    tournamentName,
    status,
    court: match.court,
    round: match.round,
    scheduledAt: match.scheduled_at,
    pair1: {
      player1: match.pair1_player1,
      player2: match.pair1_player2,
    },
    pair2: {
      player1: match.pair2_player1,
      player2: match.pair2_player2,
    },
    sets: markCurrentSets(sets),
    currentGame: live.currentGame,
    servingTeam: live.servingTeam,
    points: cappedPoints.map(p => ({
      set: p.set_number,
      game: p.game_number,
      pt: p.point_number,
      server: p.server_team,
      score: p.score_after ?? '0-0',
      winner: p.winner_pair,
      isGoldenPoint: p.is_golden_point,
      at: p.created_at,
    })),
  }
}
```

- [ ] **Step 4: Run to verify all pass**

Run: `npx vitest run src/lib/__tests__/padelgod-live-cards.test.ts`
Expected: all tests passing (Tasks 2, 3, 4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/padelgod-live-cards.ts src/lib/__tests__/padelgod-live-cards.test.ts
git commit -m "$(cat <<'EOF'
feat(shadow-ui): add buildLiveCard — the main payload builder

Composes a LiveCard from a match row + its shadow sets + its shadow points.
Points ordered oldest-first, capped at 50. Finished/ended matches have
servingTeam=null. Fully unit-tested.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — `/api/padelgod-shadow/live-cards` route

**Files:**
- Create: `src/app/api/padelgod-shadow/live-cards/route.ts`

- [ ] **Step 1: Skim existing sibling route for pattern**

Run: `sed -n '1,40p' src/app/api/ops/padelgod-shadow/live/route.ts`

Confirm the imports and the `checkOpsAuth()` + service-key `createClient` shape. The new route mirrors this.

- [ ] **Step 2: Create the route file**

Create `src/app/api/padelgod-shadow/live-cards/route.ts`:

```typescript
// src/app/api/padelgod-shadow/live-cards/route.ts
// GET live match cards for shadow-enabled tournaments.
//
// Scopes:
//   scope=live                  → only status='live' (no auth required)
//   scope=live+next+recent      → live + next 6 upcoming + last 6 finished (requires ops auth)
//
// Optional filter:
//   tournament_id=<uuid>        → restrict to one tournament

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import {
  buildLiveCard,
  type LiveCard,
  type LiveCardsResponse,
  type MatchRow,
  type ShadowPointRow,
  type ShadowSetRow,
} from '@/lib/padelgod-live-cards'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const UPCOMING_LIMIT = 6
const RECENT_LIMIT = 6

export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope') ?? 'live'
  const tournamentId = url.searchParams.get('tournament_id')

  if (scope !== 'live' && scope !== 'live+next+recent') {
    return Response.json({ error: 'invalid scope' }, { status: 400 })
  }

  // Auth gating: anything beyond scope=live requires ops token
  if (scope === 'live+next+recent') {
    const authErr = await checkOpsAuth()
    if (authErr) return authErr
  }

  // 1. Find shadow-enabled tournaments (optionally filtered to one)
  let tournamentsQ = supabase
    .from('tournaments')
    .select('id, name')
    .eq('shadow_enabled', true)
  if (tournamentId) tournamentsQ = tournamentsQ.eq('id', tournamentId)

  const { data: tournaments, error: tErr } = await tournamentsQ
  if (tErr) {
    console.error('[live-cards] tournaments query failed:', tErr.message)
    return Response.json({ error: tErr.message }, { status: 500 })
  }
  if (!tournaments || tournaments.length === 0) {
    return Response.json<LiveCardsResponse>({ observedAt: new Date().toISOString(), matches: [] })
  }

  const tournamentNames = new Map<string, string>(tournaments.map(t => [t.id, t.name]))
  const tournamentIds = tournaments.map(t => t.id)

  // 2. Find matches in scope. Note: DB status column has 'ended', 'retired',
  // 'walkover' as final states alongside 'finished'. normaliseStatus() folds
  // them all into 'finished', so we must fetch all of them.
  const wantedStatuses = scope === 'live'
    ? ['live']
    : ['live', 'scheduled', 'finished', 'ended', 'retired', 'walkover']

  const { data: matchData, error: mErr } = await supabase
    .from('matches')
    .select(`
      id, tournament_id, status, court, round, scheduled_at, updated_at,
      pair1_player1:players!pair1_player1_id(name, country),
      pair1_player2:players!pair1_player2_id(name, country),
      pair2_player1:players!pair2_player1_id(name, country),
      pair2_player2:players!pair2_player2_id(name, country)
    `)
    .in('tournament_id', tournamentIds)
    .in('status', wantedStatuses)

  if (mErr) {
    console.error('[live-cards] matches query failed:', mErr.message)
    return Response.json({ error: mErr.message }, { status: 500 })
  }
  const matches = (matchData ?? []) as unknown as (MatchRow & { updated_at: string | null })[]
  if (matches.length === 0) {
    return Response.json<LiveCardsResponse>({ observedAt: new Date().toISOString(), matches: [] })
  }

  const matchIds = matches.map(m => m.id)

  // 3. Fetch shadow sets for these matches
  const { data: setData } = await supabase
    .schema('padelgod')
    .from('shadow_sets')
    .select('match_id, set_number, pair1_games, pair2_games, updated_at')
    .in('match_id', matchIds)
  const shadowSets = (setData ?? []) as ShadowSetRow[]

  // 4. Fetch shadow points for these matches (we'll cap per-match in buildLiveCard)
  const { data: pointData } = await supabase
    .schema('padelgod')
    .from('shadow_match_points')
    .select('match_id, set_number, game_number, point_number, winner_pair, score_after, server_team, is_golden_point, created_at')
    .in('match_id', matchIds)
  const shadowPoints = (pointData ?? []) as ShadowPointRow[]

  const setsByMatch = new Map<string, ShadowSetRow[]>()
  for (const s of shadowSets) {
    const arr = setsByMatch.get(s.match_id) ?? []
    arr.push(s)
    setsByMatch.set(s.match_id, arr)
  }
  const pointsByMatch = new Map<string, ShadowPointRow[]>()
  for (const p of shadowPoints) {
    const arr = pointsByMatch.get(p.match_id) ?? []
    arr.push(p)
    pointsByMatch.set(p.match_id, arr)
  }

  // 5. Build cards
  const allCards: LiveCard[] = matches.map(m => buildLiveCard(
    m,
    tournamentNames.get(m.tournament_id) ?? '',
    setsByMatch.get(m.id) ?? [],
    pointsByMatch.get(m.id) ?? [],
  ))

  // 6. Bucket + sort
  const live = allCards.filter(c => c.status === 'live')
  let upcoming: LiveCard[] = []
  let recent: LiveCard[] = []
  if (scope === 'live+next+recent') {
    upcoming = allCards
      .filter(c => c.status === 'scheduled')
      .sort((a, b) => {
        const aT = a.scheduledAt ? Date.parse(a.scheduledAt) : Infinity
        const bT = b.scheduledAt ? Date.parse(b.scheduledAt) : Infinity
        return aT - bT
      })
      .slice(0, UPCOMING_LIMIT)

    // Use updated_at on the raw match row for "recent finished" sort
    const updatedAtById = new Map(matches.map(m => [m.id, m.updated_at ?? '']))
    recent = allCards
      .filter(c => c.status === 'finished')
      .sort((a, b) => (updatedAtById.get(b.id) ?? '').localeCompare(updatedAtById.get(a.id) ?? ''))
      .slice(0, RECENT_LIMIT)
  }

  const body: LiveCardsResponse = {
    observedAt: new Date().toISOString(),
    matches: [...live, ...upcoming, ...recent],
  }
  return Response.json(body)
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Smoke-test against live DB**

Start the dev server if it's not running (`npm run dev`), then in a second terminal:

```bash
curl -s 'http://localhost:3002/api/padelgod-shadow/live-cards?scope=live' | python3 -m json.tool | head -80
```

Expected: JSON with `observedAt` and a `matches` array. If Brussels has live matches, each card should have `servingTeam` populated (1, 2, or null), `points` (up to 50), and `sets`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/padelgod-shadow/live-cards/route.ts
git commit -m "$(cat <<'EOF'
feat(shadow-ui): add GET /api/padelgod-shadow/live-cards

Thin route that joins public.matches + padelgod.shadow_sets +
padelgod.shadow_match_points for shadow-enabled tournaments and returns
LiveCard[] via buildLiveCard(). scope=live is unauth; scope=live+next+recent
requires ops token.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — `ShadowMatchCard` component

**Files:**
- Create: `src/components/ShadowMatchCard.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/ShadowMatchCard.tsx`:

```typescript
// src/components/ShadowMatchCard.tsx
// Presentational card for a shadow-captured match. Mirrors MatchCard's look
// but reads from LiveCard (shadow-derived) data. 🎾 emoji marks the serving team.

import type { LiveCard, PlayerLite } from '@/lib/padelgod-live-cards'

const SERVE_BALL = '🎾'

function playerDisplay(p: PlayerLite): string {
  if (!p) return 'TBD'
  return p.name
}

function freshnessSec(observedAt: string): number {
  return Math.max(0, Math.floor((Date.now() - Date.parse(observedAt)) / 1000))
}

export default function ShadowMatchCard({
  card,
  observedAt,
  children,
}: {
  card: LiveCard
  observedAt: string
  children?: React.ReactNode
}) {
  const isLive = card.status === 'live'
  const isFinished = card.status === 'finished'
  const ageSec = freshnessSec(observedAt)
  const stale = ageSec > 30

  const pair1Names = `${playerDisplay(card.pair1.player1)} · ${playerDisplay(card.pair1.player2)}`
  const pair2Names = `${playerDisplay(card.pair2.player1)} · ${playerDisplay(card.pair2.player2)}`

  return (
    <div style={{
      background: '#141414',
      border: '1px solid #2a2a2a',
      borderRadius: 8,
      padding: 14,
      marginBottom: 12,
      fontFamily: '-apple-system, system-ui, sans-serif',
      color: '#e5e5e5',
    }}>
      {/* Header: court + round + status badge */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
        <span style={{ color: '#888' }}>
          {[card.court, card.round].filter(Boolean).join(' · ') || card.tournamentName}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span
            aria-label={stale ? 'stale' : 'fresh'}
            style={{
              display: 'inline-block',
              width: 6, height: 6, borderRadius: '50%',
              background: stale ? '#555' : '#7ED321',
              boxShadow: stale ? 'none' : '0 0 4px #7ED321',
            }}
          />
          {isLive && (
            <span style={{ color: '#fff', background: '#dc2626', padding: '2px 6px', borderRadius: 3, fontWeight: 700, fontSize: 10 }}>
              ● LIVE
            </span>
          )}
          {isFinished && (
            <span style={{ color: '#bbb', fontSize: 10 }}>FINISHED</span>
          )}
          {card.status === 'scheduled' && (
            <span style={{ color: '#7ED321', fontSize: 10 }}>NEXT UP</span>
          )}
        </span>
      </div>

      {/* Pair 1 row */}
      <TeamRow
        names={pair1Names}
        isServing={card.servingTeam === 1 && isLive}
        sets={card.sets.map(s => s.pair1Games)}
        currentPoint={isLive ? card.currentGame.pair1Score : undefined}
        isGoldenPoint={card.currentGame.isGoldenPoint}
      />
      {/* Pair 2 row */}
      <TeamRow
        names={pair2Names}
        isServing={card.servingTeam === 2 && isLive}
        sets={card.sets.map(s => s.pair2Games)}
        currentPoint={isLive ? card.currentGame.pair2Score : undefined}
        isGoldenPoint={card.currentGame.isGoldenPoint}
      />

      {/* Slot for PointLog */}
      {children}
    </div>
  )
}

function TeamRow({
  names,
  isServing,
  sets,
  currentPoint,
  isGoldenPoint,
}: {
  names: string
  isServing: boolean
  sets: number[]
  currentPoint?: string
  isGoldenPoint?: boolean
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `1fr ${sets.map(() => 'auto').join(' ')} auto`,
      alignItems: 'center',
      gap: 12,
      padding: '6px 0',
      fontSize: 14,
    }}>
      <span style={{ color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {names}
        {isServing && <span style={{ marginLeft: 6 }} aria-label="serving">{SERVE_BALL}</span>}
      </span>
      {sets.map((g, i) => (
        <span key={i} style={{
          color: i === sets.length - 1 ? '#fff' : '#bbb',
          fontWeight: i === sets.length - 1 ? 700 : 500,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 18,
          textAlign: 'center',
        }}>
          {g}
        </span>
      ))}
      {currentPoint !== undefined && (
        <span style={{
          color: isGoldenPoint ? '#facc15' : '#7ED321',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 32,
          textAlign: 'right',
        }}>
          {currentPoint}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ShadowMatchCard.tsx
git commit -m "$(cat <<'EOF'
feat(shadow-ui): add ShadowMatchCard presentational component

MatchCard-lookalike driven by LiveCard data. 🎾 emoji next to the serving
team when status='live'. Slot for children (PointLog goes here).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — `PointLog` component

**Files:**
- Create: `src/components/PointLog.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/PointLog.tsx`:

```typescript
// src/components/PointLog.tsx
// Plain monospace point-by-point log. Newest at the bottom. Auto-scrolls to
// the bottom when at bottom, otherwise respects the user's scroll position.

'use client'

import { useEffect, useRef, useState } from 'react'
import type { PointEntry } from '@/lib/padelgod-live-cards'

function fmtTime(iso: string): string {
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  const ss = String(d.getUTCSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function fmtLine(p: PointEntry): string {
  const srv = p.server === 1 ? 'Pair 1 serves' : p.server === 2 ? 'Pair 2 serves' : 'server unknown'
  const gp = p.isGoldenPoint ? '🥇 ' : ''
  return `[${fmtTime(p.at)}] S${p.set} G${p.game} P${p.pt} · ${srv} · ${gp}${p.score} → Pair ${p.winner} wins`
}

export default function PointLog({
  points,
  collapsible = false,
  defaultOpen = true,
}: {
  points: PointEntry[]
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const boxRef = useRef<HTMLPreElement | null>(null)
  const wasAtBottomRef = useRef(true)

  // Track whether the user is at the bottom BEFORE updates
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      wasAtBottomRef.current = distance < 8
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [open])

  // After new points arrive, if user was at bottom, scroll them back to bottom
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [points, open])

  if (collapsible && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#7ED321',
          fontSize: 11,
          cursor: 'pointer',
          padding: '4px 0',
          marginTop: 6,
        }}
      >
        Show point log ▸
      </button>
    )
  }

  return (
    <div style={{ marginTop: 8 }}>
      {collapsible && (
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#888',
            fontSize: 11,
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          ▾ Hide point log
        </button>
      )}
      <pre
        ref={boxRef}
        style={{
          background: '#0A0A0A',
          border: '1px solid #222',
          borderRadius: 4,
          padding: 8,
          maxHeight: 200,
          overflow: 'auto',
          fontFamily: 'ui-monospace, SF Mono, Monaco, monospace',
          fontSize: 11,
          lineHeight: 1.5,
          color: '#ccc',
          margin: 0,
        }}
      >
        {points.length === 0 && (
          <span style={{ color: '#666' }}>No points yet.</span>
        )}
        {points.map((p, i) => {
          const isRecent = i >= points.length - 3
          return (
            <div
              key={`${p.set}-${p.game}-${p.pt}-${p.at}`}
              style={{ color: isRecent ? '#fff' : '#888' }}
            >
              {fmtLine(p)}
            </div>
          )
        })}
      </pre>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/PointLog.tsx
git commit -m "$(cat <<'EOF'
feat(shadow-ui): add PointLog component

Monospace scrollable log of every captured point. Newest at bottom.
Auto-scrolls iff the user is at the bottom. Collapsible toggle for
the padelnachos page; always-open for ops.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Hidden `/x/live-preview` page

**Files:**
- Create: `src/app/x/live-preview/page.tsx`
- Create: `src/app/x/live-preview/ShadowLivePreview.tsx`

- [ ] **Step 1: Create the client poller component**

Create `src/app/x/live-preview/ShadowLivePreview.tsx`:

```typescript
// src/app/x/live-preview/ShadowLivePreview.tsx
// Client component: polls /api/padelgod-shadow/live-cards every 5s and
// renders a ShadowMatchCard per match with a collapsible PointLog.

'use client'

import { useEffect, useState, useRef } from 'react'
import ShadowMatchCard from '@/components/ShadowMatchCard'
import PointLog from '@/components/PointLog'
import type { LiveCardsResponse } from '@/lib/padelgod-live-cards'

const POLL_MS = 5_000

export default function ShadowLivePreview() {
  const [data, setData] = useState<LiveCardsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function tick() {
      try {
        const res = await fetch('/api/padelgod-shadow/live-cards?scope=live', {
          cache: 'no-store',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const body = (await res.json()) as LiveCardsResponse
        if (!cancelled) {
          setData(body)
          setErr(null)
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      }
    }

    function startPolling() {
      tick()
      timerRef.current = window.setInterval(tick, POLL_MS)
    }
    function stopPolling() {
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (!timerRef.current) startPolling()
      } else {
        stopPolling()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    startPolling()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      stopPolling()
    }
  }, [])

  if (!data && !err) {
    return <div style={{ padding: 24, color: '#888' }}>Loading…</div>
  }

  const liveCards = data?.matches.filter(c => c.status === 'live') ?? []

  return (
    <div style={{ background: '#0A0A0A', minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ color: '#fff', fontSize: 18, fontWeight: 700, margin: '0 0 16px' }}>
          Shadow Live Preview
        </h1>
        <div style={{ color: '#666', fontSize: 11, marginBottom: 16 }}>
          {err
            ? `Last fetch failed: ${err}`
            : `observedAt ${data?.observedAt ?? ''} · ${liveCards.length} live`}
        </div>
        {liveCards.length === 0 ? (
          <div style={{ color: '#888', padding: 24, textAlign: 'center' }}>
            No matches currently live in shadow mode.
          </div>
        ) : (
          liveCards.map(card => (
            <ShadowMatchCard
              key={card.id}
              card={card}
              observedAt={data?.observedAt ?? new Date().toISOString()}
            >
              <PointLog points={card.points} collapsible defaultOpen={false} />
            </ShadowMatchCard>
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the page wrapper**

Create `src/app/x/live-preview/page.tsx`:

```typescript
// src/app/x/live-preview/page.tsx
// Hidden preview page — noindex, nofollow, no public linking.

import type { Metadata } from 'next'
import ShadowLivePreview from './ShadowLivePreview'

export const metadata: Metadata = {
  title: 'Shadow Live Preview',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default function Page() {
  return <ShadowLivePreview />
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 4: Manual smoke test**

With `npm run dev` running, open `http://localhost:3002/x/live-preview` in a browser.

Expected:
- Page renders, dark theme
- Header: "Shadow Live Preview"
- If Brussels has live matches: one card per match with player names, set scores, 🎾 on whichever team is serving, and a "Show point log ▸" button
- If no live matches: "No matches currently live in shadow mode."
- Response headers do NOT cache the page (force-dynamic is active).

Open DevTools → view page source. Expected: the `<head>` includes `<meta name="robots" content="noindex,nofollow">`.

- [ ] **Step 5: Commit**

```bash
git add src/app/x/live-preview/page.tsx src/app/x/live-preview/ShadowLivePreview.tsx
git commit -m "$(cat <<'EOF'
feat(shadow-ui): add hidden /x/live-preview page

Non-indexed, non-linked preview of padelgod's live captures using the
real MatchCard-style UI. Polls /api/padelgod-shadow/live-cards
every 5s; pauses when the tab is hidden.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — Extend `PadelgodShadowTab` with Live cards section

**Files:**
- Modify: `src/app/ops/PadelgodShadowTab.tsx`

- [ ] **Step 1: Locate the insertion point**

Run: `grep -n "Live matches" src/app/ops/PadelgodShadowTab.tsx`

Note the line where the current "Live matches" comment/section starts. Your new "Live cards" section goes IMMEDIATELY ABOVE it.

- [ ] **Step 2: Add imports and the new state/poller to the component**

Near the top of `PadelgodShadowTab.tsx`, with the other imports, add:

```typescript
import ShadowMatchCard from '@/components/ShadowMatchCard'
import PointLog from '@/components/PointLog'
import type { LiveCardsResponse } from '@/lib/padelgod-live-cards'
```

Within the existing `PadelgodShadowTab` component function, beside the existing `useState`/`useEffect` blocks, add a new polling hook (place it immediately after the existing `useEffect` that sets up `healthTimer`/`enrollmentsTimer`):

```typescript
  const [liveCards, setLiveCards] = useState<LiveCardsResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      const res = await fetchJson<LiveCardsResponse>(
        '/api/padelgod-shadow/live-cards?scope=live+next+recent'
      )
      if (!cancelled && res) setLiveCards(res)
    }
    tick()
    const t = window.setInterval(tick, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])
```

- [ ] **Step 3: Add the JSX section immediately above the "Live matches" comment**

Insert this block right before `{/* Live matches */}`:

```tsx
  {/* Live cards (padelgod-only, replicated MatchCard look) */}
  <div style={{ marginTop: 20 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <h3 style={{ margin: 0, fontSize: 14, color: '#111', fontWeight: 700 }}>
        Live cards
      </h3>
      <a
        href="/x/live-preview"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontSize: 11,
          color: '#3b82f6',
          textDecoration: 'none',
          padding: '4px 10px',
          border: '1px solid #3b82f6',
          borderRadius: 4,
          fontWeight: 600,
        }}
      >
        Preview live UI ↗
      </a>
    </div>

    {liveCards && liveCards.matches.length === 0 && (
      <div style={{ color: '#666', fontSize: 12, padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        No matches in the live / next-up / recent buckets for shadow-enabled tournaments.
      </div>
    )}

    {liveCards?.matches.map(card => (
      <div key={card.id}>
        <ShadowMatchCard card={card} observedAt={liveCards.observedAt}>
          <PointLog points={card.points} collapsible={false} />
        </ShadowMatchCard>
      </div>
    ))}
  </div>
```

- [ ] **Step 4: Verify TypeScript + manual check**

Run: `npx tsc --noEmit`
Expected: exits 0.

Refresh `/ops` in the browser (login via `/ops?token=<CRON_SECRET>` if needed). Expected:
- New "Live cards" section appears above the existing "Live matches" table
- "Preview live UI ↗" button top-right — clicking opens `/x/live-preview` in a new tab
- Cards render with expanded point logs
- Existing "Live matches" table still appears below, unchanged

- [ ] **Step 5: Commit**

```bash
git add src/app/ops/PadelgodShadowTab.tsx
git commit -m "$(cat <<'EOF'
feat(shadow-ui): add Live cards section + preview button to ops tab

Extends PadelgodShadowTab with a second live view:
- ShadowMatchCard grid (live + next 6 upcoming + last 6 finished)
- Always-expanded point log under each card
- 'Preview live UI ↗' button linking to /x/live-preview

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — Final verification + PR

**Files:** none to change; verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run src/lib/__tests__/padelgod-live-cards.test.ts`
Expected: all tests pass (targeting 15+ tests across Tasks 2–4).

- [ ] **Step 2: Full type check**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Lint new/modified files**

Run:

```bash
npx eslint \
  src/lib/padelgod-live-cards.ts \
  src/lib/__tests__/padelgod-live-cards.test.ts \
  src/app/api/padelgod-shadow/live-cards/route.ts \
  src/components/ShadowMatchCard.tsx \
  src/components/PointLog.tsx \
  src/app/x/live-preview/page.tsx \
  src/app/x/live-preview/ShadowLivePreview.tsx \
  src/proxy.ts \
  src/app/robots.ts \
  src/app/ops/PadelgodShadowTab.tsx
```

Expected: 0 errors. Warnings in pre-existing code (PadelgodShadowTab, proxy) may remain — ignore those.

- [ ] **Step 4: Live smoke test**

With Brussels still in play (or any shadow-enabled tournament with live matches):

1. `curl -s 'http://localhost:3002/api/padelgod-shadow/live-cards?scope=live' | python3 -m json.tool` — should return the payload shape defined in the spec
2. Open `http://localhost:3002/x/live-preview` — cards render, serving team marked with 🎾, clicking "Show point log" reveals the log
3. Open `http://localhost:3002/ops` (with ops token) → Padelgod Shadow tab → new "Live cards" section visible with Preview button
4. Wait ~10s → watch a point log line get added (newest appears at the bottom)

- [ ] **Step 5: Robots sanity check**

Run: `curl -s http://localhost:3002/robots.txt`

Expected: the `Disallow` block includes `/x/` (plus existing `/api/`, `/ops/`, `/auth/`).

- [ ] **Step 6: Push + open PR**

```bash
git push -u origin feat/padelgod-live-ui
gh pr create --title "feat(shadow-ui): padelgod live UI (ops + hidden /x/live-preview)" --body "$(cat <<'EOF'
## Summary
- New API: `GET /api/padelgod-shadow/live-cards` — joins matches + shadow_sets + shadow_match_points for shadow-enabled tournaments
- New components: `ShadowMatchCard` (🎾 serving indicator) and `PointLog` (monospace point-by-point)
- Ops: PadelgodShadowTab gets a "Live cards" grid + "Preview live UI ↗" button
- PadelNachos: new hidden `/x/live-preview` page (`noindex,nofollow`, excluded from robots, not linked from any nav)
- All data-shaping logic lives in pure helpers with full unit-test coverage

## Design spec
`docs/superpowers/specs/2026-04-21-padelgod-live-ui-design.md`

## Test plan
- [ ] `npx vitest run src/lib/__tests__/padelgod-live-cards.test.ts` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `curl /api/padelgod-shadow/live-cards?scope=live` returns expected shape
- [ ] `/x/live-preview` renders with 🎾 on serving teams and working point log
- [ ] Ops tab shows the new section with Preview button
- [ ] `/robots.txt` disallows `/x/`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned.

---

## Self-review notes

- [x] **Spec coverage:** Every spec section is implemented — API route shape (Task 5), types (Task 2), server derivation (Task 3), point cap + golden point (Task 4), ShadowMatchCard 🎾 (Task 6), PointLog collapsed/expanded variants (Task 7), hidden page with noindex (Task 8), robots + proxy (Task 1), PadelgodShadowTab integration (Task 9), verification (Task 10).
- [x] **Placeholder scan:** No TBD, TODO, or "add error handling" language. All code blocks are complete.
- [x] **Type consistency:** `LiveCard`, `PointEntry`, `SetEntry`, `CurrentGame`, `ShadowPointRow`, `ShadowSetRow`, `MatchRow`, `LiveCardsResponse` are defined in Task 2 and used consistently in Tasks 3, 4, 5, 6, 7, 8, 9.
- [x] **Testing infra:** Plan acknowledges there's no `@testing-library/react`. All testable logic lives in pure helpers (Tasks 2–4) so Vitest alone suffices. Components are verified via manual smoke in Tasks 8 + 10.
- [x] **No unwritten dependencies:** `checkOpsAuth` already exists (used by existing `/api/ops/padelgod-shadow/live/route.ts`); `@/lib/ops-auth` is on disk today. No new shared utilities.
