# Picks Phase 2 + Leaderboards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist match predictions in a `predictions` DB table (replacing Phase-1 localStorage), and ship per-tournament + per-season leaderboards as new tabs on `/picks`.

**Architecture:** New `predictions` table with `result`/`reward`/`resolved_at` frozen at match-finish (Approach B from spec). A 5-min Vercel cron (`/api/cron/resolve-predictions`) classifies finished matches' picks. Leaderboards are SQL `SUM(reward) GROUP BY user_id`. `/picks` becomes 3 tabs: My picks · Season · Tournaments. `useMatchPrediction` becomes auth-aware: DB for authed, localStorage fallback for unauthed (with sign-in nudge).

**Tech Stack:** Next.js 16, Auth.js v5 (`public.users`), Supabase Postgres, next-intl, vitest.

**Reference docs:**
- Spec: `docs/superpowers/specs/2026-05-08-picks-leaderboard-phase-2-design.md`
- Existing scoring: `src/lib/predictions/scoring.ts`, `src/lib/predictions/probability.ts`
- Auth pattern: `src/app/api/user/_auth.ts`
- Cron pattern: `src/app/api/cron/scores/route.ts`

---

## File structure

**Create:**
- `supabase/migrations/20260508_predictions.sql` — schema
- `src/lib/predictions/server.ts` — server-side helpers (lock-window, server-computed prob/mult, upsert)
- `src/lib/predictions/__tests__/server.test.ts` — server helpers tests
- `src/lib/predictions/leaderboard-query.ts` — query builder (cursor encoding, tie-break SQL)
- `src/lib/predictions/__tests__/leaderboard-query.test.ts`
- `src/lib/predictions/api-client.ts` — fetch wrappers used by the auth-aware hook
- `src/app/api/predictions/route.ts` — POST + GET
- `src/app/api/predictions/[matchId]/route.ts` — DELETE
- `src/app/api/leaderboard/route.ts` — GET
- `src/app/api/cron/resolve-predictions/route.ts` — resolver cron
- `src/app/api/admin/predictions/re-resolve/route.ts` — manual re-resolve
- `src/components/picks/PicksTabs.tsx` — three-tab nav
- `src/components/picks/LeaderboardRow.tsx` — shared row component
- `src/components/picks/SeasonLeaderboard.tsx` — Season tab content
- `src/components/picks/TournamentLeaderboard.tsx` — Tournaments tab content (selector + leaderboard)
- `src/components/prediction/LoggedOutNudge.tsx` — inline sign-in prompt above the pick UI

**Modify:**
- `src/hooks/useMatchPrediction.ts` — auth-aware (DB read/write for authed, localStorage for unauthed)
- `src/app/[locale]/picks/page.tsx` — server fetches initial tab data, hydrates ClientPicks
- `src/app/[locale]/picks/ClientPicks.tsx` — wraps in PicksTabs, fetches from API for authed
- `src/components/prediction/PredictionPanel.tsx` — render LoggedOutNudge when `!session?.user`
- `vercel.json` — add `/api/cron/resolve-predictions` schedule
- `src/messages/{en,es,pt,it,fr}.json` — i18n keys for new UI

---

## Task 1: DB migration — `predictions` table

**Files:**
- Create: `supabase/migrations/20260508_predictions.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260508_predictions.sql` with:

```sql
-- Phase 2: persistent match predictions + leaderboard support.
-- See docs/superpowers/specs/2026-05-08-picks-leaderboard-phase-2-design.md.
--
-- One row per (user, match). Pick-time fields (pair, margin, probability,
-- multiplier, is_fallback) are frozen on insert. Match-finish fields
-- (result, reward, resolved_at) are written by /api/cron/resolve-predictions
-- once the match transitions to finished/retired/walkover.

CREATE TABLE IF NOT EXISTS predictions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id     UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- Frozen at pick-time
  pair         SMALLINT NOT NULL CHECK (pair IN (1, 2)),
  margin       TEXT     NOT NULL CHECK (margin IN ('2-0', '2-1')),
  probability  REAL     NOT NULL,
  multiplier   REAL     NOT NULL,
  is_fallback  BOOLEAN  NOT NULL DEFAULT false,

  -- Frozen at match-finish (resolver writes these)
  result       TEXT     NULL CHECK (result IN ('perfect','right','wrong','upset','invalidated')),
  reward       INTEGER  NULL,
  resolved_at  TIMESTAMPTZ NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, match_id)
);

CREATE INDEX IF NOT EXISTS predictions_user_idx
  ON predictions (user_id);
CREATE INDEX IF NOT EXISTS predictions_match_idx
  ON predictions (match_id);
CREATE INDEX IF NOT EXISTS predictions_unresolved_idx
  ON predictions (match_id) WHERE resolved_at IS NULL;

-- Auto-bump updated_at on row update
CREATE OR REPLACE FUNCTION predictions_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS predictions_set_updated_at ON predictions;
CREATE TRIGGER predictions_set_updated_at
  BEFORE UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION predictions_touch_updated_at();
```

- [ ] **Step 2: Apply migration in Supabase dashboard (or via CLI)**

Run the SQL above in Supabase → SQL Editor. Verify with:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'predictions'
ORDER BY ordinal_position;
```

Expected: 12 rows (id, user_id, match_id, pair, margin, probability, multiplier, is_fallback, result, reward, resolved_at, created_at, updated_at).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260508_predictions.sql
git commit -m "feat(predictions): create predictions table for Phase 2"
```

---

## Task 2: Server helper — lock-window check + server-side prediction creation

**Files:**
- Create: `src/lib/predictions/server.ts`
- Test: `src/lib/predictions/__tests__/server.test.ts`

This module is the single source of truth for server-side prediction validation and the prob/multiplier computation that the API endpoints use. Keeps logic out of route handlers.

- [ ] **Step 1: Write the failing test**

Create `src/lib/predictions/__tests__/server.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isPickWindowOpen, buildPredictionRow } from '../server'
import type { Match } from '@/types/match'

const baseMatch: Match = {
  id: 'm1',
  status: 'scheduled',
  scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  pair1_player1: { id: 'p1', ranking: 10 },
  pair1_player2: { id: 'p2', ranking: 12 },
  pair2_player1: { id: 'p3', ranking: 50 },
  pair2_player2: { id: 'p4', ranking: 55 },
} as unknown as Match

describe('isPickWindowOpen', () => {
  it('open when match is scheduled and starts in the future', () => {
    expect(isPickWindowOpen(baseMatch, new Date())).toBe(true)
  })

  it('closed when match has already started', () => {
    const m = { ...baseMatch, scheduled_at: new Date(Date.now() - 1000).toISOString() }
    expect(isPickWindowOpen(m, new Date())).toBe(false)
  })

  it('closed when status is not scheduled', () => {
    const m = { ...baseMatch, status: 'live' }
    expect(isPickWindowOpen(m, new Date())).toBe(false)
  })

  it('closed when status is finished', () => {
    const m = { ...baseMatch, status: 'finished' }
    expect(isPickWindowOpen(m, new Date())).toBe(false)
  })

  it('open when scheduled_at is null (unscheduled but not yet locked)', () => {
    const m = { ...baseMatch, scheduled_at: null as unknown as string }
    expect(isPickWindowOpen(m, new Date())).toBe(true)
  })
})

describe('buildPredictionRow', () => {
  it('computes probability and multiplier server-side from the match', () => {
    const row = buildPredictionRow(baseMatch, { userId: 'u1', pair: 1, margin: '2-0' })
    expect(row.user_id).toBe('u1')
    expect(row.match_id).toBe('m1')
    expect(row.pair).toBe(1)
    expect(row.margin).toBe('2-0')
    // pair 1 is the favorite (avg ranking 11 vs 52.5), so prob > 0.5
    expect(row.probability).toBeGreaterThan(0.5)
    expect(row.multiplier).toBeGreaterThanOrEqual(1)
    expect(row.is_fallback).toBe(false)
  })

  it('falls back to 50/50 when rankings missing', () => {
    const m = { ...baseMatch, pair1_player1: { id: 'p1', ranking: null } } as unknown as Match
    const row = buildPredictionRow(m, { userId: 'u1', pair: 1, margin: '2-1' })
    expect(row.probability).toBe(0.5)
    expect(row.is_fallback).toBe(true)
  })

  it('uses pair 2 probability when user picks pair 2', () => {
    const row = buildPredictionRow(baseMatch, { userId: 'u1', pair: 2, margin: '2-0' })
    // Pair 2 is underdog so prob < 0.5
    expect(row.probability).toBeLessThan(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/predictions/__tests__/server.test.ts`
Expected: FAIL — `isPickWindowOpen`/`buildPredictionRow` not defined.

- [ ] **Step 3: Write the server helper**

Create `src/lib/predictions/server.ts`:

```ts
// src/lib/predictions/server.ts
//
// Server-side helpers for prediction creation.
// Keep all client-untrusted logic (lock-window, prob/mult computation) here so
// the API routes stay thin and testable.

import { computeMatchProbability, computeMultiplier } from './probability'
import type { Match } from '@/types/match'
import type { Pair, Margin } from './types'

export function isPickWindowOpen(match: Match, now: Date): boolean {
  // Status gate: only 'scheduled' matches accept new picks.
  if (match.status !== 'scheduled') return false
  // Time gate: if scheduled_at is set and in the past, the window is closed.
  // scheduled_at being null means "TBD"; we still allow picks in that case.
  if (match.scheduled_at) {
    const startsAt = new Date(match.scheduled_at).getTime()
    if (Number.isFinite(startsAt) && startsAt <= now.getTime()) return false
  }
  return true
}

export interface BuildPredictionInput {
  userId: string
  pair: Pair
  margin: Margin
}

export interface PredictionRowDraft {
  user_id: string
  match_id: string
  pair: Pair
  margin: Margin
  probability: number
  multiplier: number
  is_fallback: boolean
}

export function buildPredictionRow(
  match: Match,
  input: BuildPredictionInput,
): PredictionRowDraft {
  const prob = computeMatchProbability(match)
  const userPairProb = input.pair === 1 ? prob.p1 : prob.p2
  // marginCorrect=false here freezes the BASE multiplier. The margin bonus
  // is applied later by computeReward() at finish-time.
  const multiplier = computeMultiplier(userPairProb, false)
  return {
    user_id: input.userId,
    match_id: match.id,
    pair: input.pair,
    margin: input.margin,
    probability: userPairProb,
    multiplier,
    is_fallback: prob.isFallback,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/predictions/__tests__/server.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/predictions/server.ts src/lib/predictions/__tests__/server.test.ts
git commit -m "feat(predictions): add server-side helpers for pick window + row build"
```

---

## Task 3: API — POST `/api/predictions`

**Files:**
- Create: `src/app/api/predictions/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/predictions/route.ts`:

```ts
// src/app/api/predictions/route.ts
//
// POST: create or update a prediction (upsert on (user_id, match_id))
// GET: list current user's predictions

import { getUserOrFail } from '../user/_auth'
import { isPickWindowOpen, buildPredictionRow } from '@/lib/predictions/server'
import type { Match } from '@/types/match'

export async function POST(request: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { matchId, pair, margin } = (body ?? {}) as {
    matchId?: string; pair?: number; margin?: string
  }
  if (typeof matchId !== 'string' || !matchId) {
    return Response.json({ error: 'matchId_required' }, { status: 400 })
  }
  if (pair !== 1 && pair !== 2) {
    return Response.json({ error: 'pair_must_be_1_or_2' }, { status: 400 })
  }
  if (margin !== '2-0' && margin !== '2-1') {
    return Response.json({ error: 'margin_must_be_2-0_or_2-1' }, { status: 400 })
  }

  // Load the match with player rankings so the probability computation works.
  // Match shape mirrors what computeMatchProbability expects.
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select(`
      id, status, scheduled_at,
      pair1_player1:pair1_player1_id ( id, ranking ),
      pair1_player2:pair1_player2_id ( id, ranking ),
      pair2_player1:pair2_player1_id ( id, ranking ),
      pair2_player2:pair2_player2_id ( id, ranking )
    `)
    .eq('id', matchId)
    .maybeSingle()

  if (matchErr || !match) {
    return Response.json({ error: 'match_not_found' }, { status: 404 })
  }

  if (!isPickWindowOpen(match as unknown as Match, new Date())) {
    return Response.json({ error: 'pick_window_closed' }, { status: 409 })
  }

  const draft = buildPredictionRow(match as unknown as Match, {
    userId: user.id,
    pair: pair as 1 | 2,
    margin: margin as '2-0' | '2-1',
  })

  const { data: row, error: upsertErr } = await supabase
    .from('predictions')
    .upsert(draft, { onConflict: 'user_id,match_id' })
    .select()
    .single()

  if (upsertErr) {
    return Response.json({ error: upsertErr.message }, { status: 500 })
  }
  return Response.json(row, { status: 200 })
}

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data, error: dbErr } = await supabase
    .from('predictions')
    .select('match_id, pair, margin, probability, multiplier, is_fallback, result, reward, resolved_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ items: data ?? [] })
}
```

- [ ] **Step 2: Smoke test (manual)**

Start dev: `npm run dev`. With a logged-in session, POST a prediction:

```bash
curl -X POST http://localhost:3002/api/predictions \
  -H 'content-type: application/json' \
  --cookie "$(cat /tmp/authcookie)" \
  -d '{"matchId":"<some-scheduled-match-uuid>","pair":1,"margin":"2-0"}'
```

Expected: 200 with row body, or 409 if match has already started.

GET the list:

```bash
curl http://localhost:3002/api/predictions --cookie "$(cat /tmp/authcookie)"
```

Expected: 200 with `{ items: [...] }`.

(If you can't easily produce an authed cookie locally, smoke-test these in production after deploy in Task 21.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/predictions/route.ts
git commit -m "feat(api): POST/GET /api/predictions"
```

---

## Task 4: API — DELETE `/api/predictions/:matchId`

**Files:**
- Create: `src/app/api/predictions/[matchId]/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/predictions/[matchId]/route.ts`:

```ts
// src/app/api/predictions/[matchId]/route.ts
//
// DELETE: remove the user's prediction for this match (only pre-lock-in)

import { getUserOrFail } from '../../user/_auth'
import { isPickWindowOpen } from '@/lib/predictions/server'
import type { Match } from '@/types/match'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data: match } = await supabase
    .from('matches')
    .select('id, status, scheduled_at')
    .eq('id', matchId)
    .maybeSingle()

  if (!match) return Response.json({ error: 'match_not_found' }, { status: 404 })
  if (!isPickWindowOpen(match as unknown as Match, new Date())) {
    return Response.json({ error: 'pick_window_closed' }, { status: 409 })
  }

  const { error: delErr } = await supabase
    .from('predictions')
    .delete()
    .eq('user_id', user.id)
    .eq('match_id', matchId)

  if (delErr) return Response.json({ error: delErr.message }, { status: 500 })
  return new Response(null, { status: 204 })
}
```

- [ ] **Step 2: Commit**

```bash
git add 'src/app/api/predictions/[matchId]/route.ts'
git commit -m "feat(api): DELETE /api/predictions/:matchId"
```

---

## Task 5: Leaderboard query builder + tests

**Files:**
- Create: `src/lib/predictions/leaderboard-query.ts`
- Test: `src/lib/predictions/__tests__/leaderboard-query.test.ts`

The route handler stays thin; this module owns the logic. It returns the SQL parameters and applies cursor decoding/encoding.

- [ ] **Step 1: Write the failing test**

Create `src/lib/predictions/__tests__/leaderboard-query.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  encodeCursor,
  decodeCursor,
  rankRows,
  type LeaderboardRowInput,
} from '../leaderboard-query'

describe('encodeCursor / decodeCursor', () => {
  it('round-trips a cursor', () => {
    const c = { guacas: 100, accuracyPct: 67, picksCount: 12, earliestPickAt: '2026-01-01T00:00:00Z', userId: 'u1' }
    const round = decodeCursor(encodeCursor(c))
    expect(round).toEqual(c)
  })

  it('decode returns null for invalid input', () => {
    expect(decodeCursor('garbage')).toBeNull()
    expect(decodeCursor('')).toBeNull()
    expect(decodeCursor(null)).toBeNull()
  })
})

describe('rankRows', () => {
  const a: LeaderboardRowInput = { userId: 'a', name: 'A', avatar: null, picksCount: 10, accuracyPct: 80, guacas: 200, earliestPickAt: '2026-01-01' }
  const b: LeaderboardRowInput = { userId: 'b', name: 'B', avatar: null, picksCount: 8, accuracyPct: 75, guacas: 200, earliestPickAt: '2026-01-02' }
  const c: LeaderboardRowInput = { userId: 'c', name: 'C', avatar: null, picksCount: 12, accuracyPct: 60, guacas: 100, earliestPickAt: '2026-01-03' }

  it('sorts by guacas DESC, accuracy DESC, picks DESC, earliestPickAt ASC, userId ASC', () => {
    const ranked = rankRows([c, b, a])
    expect(ranked.map(r => r.userId)).toEqual(['a', 'b', 'c'])
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3])
  })

  it('breaks tie on guacas with accuracy', () => {
    const ranked = rankRows([b, a]) // both 200 guacas, A has higher accuracy
    expect(ranked.map(r => r.userId)).toEqual(['a', 'b'])
  })

  it('breaks tie on guacas+accuracy with picksCount', () => {
    const x: LeaderboardRowInput = { ...a, userId: 'x', picksCount: 5 }
    const y: LeaderboardRowInput = { ...a, userId: 'y', picksCount: 9 }
    const ranked = rankRows([x, y])
    expect(ranked[0].userId).toBe('y')
  })

  it('breaks all-equal tie on earliestPickAt ASC', () => {
    const x: LeaderboardRowInput = { ...a, userId: 'x', earliestPickAt: '2026-02-01' }
    const y: LeaderboardRowInput = { ...a, userId: 'y', earliestPickAt: '2026-01-15' }
    const ranked = rankRows([x, y])
    expect(ranked[0].userId).toBe('y')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/predictions/__tests__/leaderboard-query.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the leaderboard query module**

Create `src/lib/predictions/leaderboard-query.ts`:

```ts
// src/lib/predictions/leaderboard-query.ts
//
// Pure logic for the leaderboard endpoint. Sorting + cursor encoding live
// here so the route handler is thin. The actual SQL/JOIN is built directly
// in the route using the supabase client; this module handles the
// cursor-comparable ordering and ranks.

export interface LeaderboardRowInput {
  userId: string
  name: string | null
  avatar: string | null
  picksCount: number
  accuracyPct: number
  guacas: number
  earliestPickAt: string  // ISO timestamp
}

export interface RankedLeaderboardRow extends LeaderboardRowInput {
  rank: number
}

export interface LeaderboardCursor {
  guacas: number
  accuracyPct: number
  picksCount: number
  earliestPickAt: string
  userId: string
}

export function encodeCursor(c: LeaderboardCursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url')
}

export function decodeCursor(raw: string | null): LeaderboardCursor | null {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const obj = JSON.parse(json)
    if (
      typeof obj === 'object' && obj !== null &&
      typeof obj.guacas === 'number' &&
      typeof obj.accuracyPct === 'number' &&
      typeof obj.picksCount === 'number' &&
      typeof obj.earliestPickAt === 'string' &&
      typeof obj.userId === 'string'
    ) return obj as LeaderboardCursor
    return null
  } catch {
    return null
  }
}

/**
 * Sort rows by tie-break order and assign 1-based ranks.
 * Order: guacas DESC, accuracy DESC, picks DESC, earliestPickAt ASC, userId ASC.
 */
export function rankRows(rows: LeaderboardRowInput[]): RankedLeaderboardRow[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.guacas !== a.guacas) return b.guacas - a.guacas
    if (b.accuracyPct !== a.accuracyPct) return b.accuracyPct - a.accuracyPct
    if (b.picksCount !== a.picksCount) return b.picksCount - a.picksCount
    const da = new Date(a.earliestPickAt).getTime()
    const db = new Date(b.earliestPickAt).getTime()
    if (da !== db) return da - db
    return a.userId.localeCompare(b.userId)
  })
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/predictions/__tests__/leaderboard-query.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/predictions/leaderboard-query.ts src/lib/predictions/__tests__/leaderboard-query.test.ts
git commit -m "feat(predictions): leaderboard cursor + ranking helpers"
```

---

## Task 6: API — GET `/api/leaderboard`

**Files:**
- Create: `src/app/api/leaderboard/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/leaderboard/route.ts`:

```ts
// src/app/api/leaderboard/route.ts
//
// GET /api/leaderboard?scope=tournament&tournamentId=<uuid>
// GET /api/leaderboard?scope=season&seasonId=<int>  (seasonId = seasons.external_id)
//
// Returns ranked rows + a `currentUser` envelope so the UI can render the
// "your rank" sticky bottom row without a second roundtrip.

import { auth } from '@/auth'
import { createServiceClient } from '@/lib/supabase'
import { rankRows, encodeCursor, type LeaderboardRowInput } from '@/lib/predictions/leaderboard-query'

interface AggregateRow {
  user_id: string
  picks_count: number
  resolved_count: number
  right_count: number
  guacas: number
  earliest_pick_at: string
  name: string | null
  image: string | null
}

const PAGE_SIZE = 50

export async function GET(request: Request) {
  const url = new URL(request.url)
  const scope = url.searchParams.get('scope')
  const supabase = createServiceClient()

  // Build the base predictions filter as a list of match IDs in the scope.
  let matchIds: string[]
  if (scope === 'tournament') {
    const tournamentId = url.searchParams.get('tournamentId')
    if (!tournamentId) return Response.json({ error: 'tournamentId_required' }, { status: 400 })
    const { data, error } = await supabase
      .from('matches').select('id').eq('tournament_id', tournamentId)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    matchIds = (data ?? []).map(m => m.id)
  } else if (scope === 'season') {
    const seasonId = url.searchParams.get('seasonId')
    if (!seasonId) return Response.json({ error: 'seasonId_required' }, { status: 400 })
    const { data: tourns, error: tErr } = await supabase
      .from('tournaments').select('id').eq('season_external_id', Number(seasonId))
    if (tErr) return Response.json({ error: tErr.message }, { status: 500 })
    const tIds = (tourns ?? []).map(t => t.id)
    if (tIds.length === 0) {
      return Response.json({ rows: [], nextCursor: null, currentUser: { rank: null, row: null } })
    }
    const { data: ms, error: mErr } = await supabase
      .from('matches').select('id').in('tournament_id', tIds)
    if (mErr) return Response.json({ error: mErr.message }, { status: 500 })
    matchIds = (ms ?? []).map(m => m.id)
  } else {
    return Response.json({ error: 'scope_must_be_tournament_or_season' }, { status: 400 })
  }

  if (matchIds.length === 0) {
    return Response.json({ rows: [], nextCursor: null, currentUser: { rank: null, row: null } })
  }

  // Pull all predictions in this scope. For our user counts (<10k actives),
  // doing the aggregate in JS is simpler than building a SQL view.
  // If this becomes a hot path, swap for a Postgres function.
  const { data: preds, error: pErr } = await supabase
    .from('predictions')
    .select('user_id, result, reward, resolved_at, created_at')
    .in('match_id', matchIds)

  if (pErr) return Response.json({ error: pErr.message }, { status: 500 })

  const byUser = new Map<string, {
    picks: number
    resolved: number
    right: number
    guacas: number
    earliest: string
  }>()

  for (const p of preds ?? []) {
    const u = byUser.get(p.user_id) ?? { picks: 0, resolved: 0, right: 0, guacas: 0, earliest: p.created_at }
    u.picks++
    if (p.resolved_at && p.result && p.result !== 'invalidated') {
      u.resolved++
      if (p.result === 'right' || p.result === 'perfect' || p.result === 'upset') u.right++
      u.guacas += p.reward ?? 0
    }
    if (new Date(p.created_at) < new Date(u.earliest)) u.earliest = p.created_at
    byUser.set(p.user_id, u)
  }

  // Hydrate user names + avatars
  const userIds = [...byUser.keys()]
  const { data: users } = await supabase
    .from('users')
    .select('id, name, image')
    .in('id', userIds)
  const userById = new Map((users ?? []).map(u => [u.id, u]))

  const inputs: LeaderboardRowInput[] = userIds.map(uid => {
    const agg = byUser.get(uid)!
    const u = userById.get(uid)
    return {
      userId: uid,
      name: u?.name ?? null,
      avatar: u?.image ?? null,
      picksCount: agg.picks,
      accuracyPct: agg.resolved > 0 ? Math.round((agg.right / agg.resolved) * 100) : 0,
      guacas: agg.guacas,
      earliestPickAt: agg.earliest,
    }
  })

  const ranked = rankRows(inputs)

  // Apply cursor pagination
  const cursorRaw = url.searchParams.get('cursor')
  let startIdx = 0
  if (cursorRaw) {
    const idx = ranked.findIndex(r => r.userId === cursorRaw)
    if (idx >= 0) startIdx = idx + 1
  }
  const pageRows = ranked.slice(startIdx, startIdx + PAGE_SIZE)
  const nextRow = ranked[startIdx + PAGE_SIZE]
  const nextCursor = nextRow ? nextRow.userId : null

  // Hydrate the current user's row regardless of page
  const session = await auth()
  const meId = session?.user?.id ?? null
  const meRow = meId ? ranked.find(r => r.userId === meId) ?? null : null

  return Response.json({
    rows: pageRows,
    nextCursor,
    currentUser: { rank: meRow?.rank ?? null, row: meRow ?? null },
  })
}
```

(Note: `encodeCursor` is unused above because we use the simpler `userId`-as-cursor; keeping the import-free version. If later you need richer cursors, swap to `encodeCursor`.)

- [ ] **Step 2: Smoke-test the endpoint**

Tournaments scope, no auth needed:

```bash
curl 'http://localhost:3002/api/leaderboard?scope=tournament&tournamentId=<uuid>'
```

Expected: `{ rows: [...], nextCursor: null|string, currentUser: { rank: null, row: null } }`.

- [ ] **Step 3: Remove the unused import**

Open `src/app/api/leaderboard/route.ts` and remove `encodeCursor` from the import line — leave only `rankRows` and `LeaderboardRowInput` imported. (TypeScript will warn on the unused import otherwise.)

After edit the import line should read:

```ts
import { rankRows, type LeaderboardRowInput } from '@/lib/predictions/leaderboard-query'
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/leaderboard/route.ts
git commit -m "feat(api): GET /api/leaderboard for season + tournament scopes"
```

---

## Task 7: Resolver cron `/api/cron/resolve-predictions`

**Files:**
- Create: `src/app/api/cron/resolve-predictions/route.ts`

- [ ] **Step 1: Implement the cron**

Create `src/app/api/cron/resolve-predictions/route.ts`:

```ts
// src/app/api/cron/resolve-predictions/route.ts
//
// Every 5 min: find finished matches with unresolved picks, classify them,
// write result + reward + resolved_at. Idempotent: already-resolved rows
// are filtered out by the `resolved_at IS NULL` index.

import { createServiceClient } from '@/lib/supabase'
import { classifyResult, computeReward } from '@/lib/predictions/scoring'
import type { Match } from '@/types/match'
import type { Prediction } from '@/lib/predictions/types'

export async function GET(request: Request) {
  // CRON_SECRET gate (Vercel cron always supplies this)
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const startedAt = Date.now()

  // 1. Find distinct match IDs that are finished + have unresolved predictions
  const { data: candidatePicks, error: pErr } = await supabase
    .from('predictions')
    .select('match_id')
    .is('resolved_at', null)

  if (pErr) return Response.json({ error: pErr.message }, { status: 500 })

  const candidateMatchIds = [...new Set((candidatePicks ?? []).map(p => p.match_id))]
  if (candidateMatchIds.length === 0) {
    return Response.json({ resolved: 0, durationMs: Date.now() - startedAt })
  }

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select(`
      id, status, winner_pair,
      pair1_player1:pair1_player1_id ( id ),
      pair1_player2:pair1_player2_id ( id ),
      pair2_player1:pair2_player1_id ( id ),
      pair2_player2:pair2_player2_id ( id ),
      sets ( set_number, pair1_games, pair2_games )
    `)
    .in('id', candidateMatchIds)
    .in('status', ['finished', 'retired', 'walkover'])

  if (mErr) return Response.json({ error: mErr.message }, { status: 500 })

  let resolvedCount = 0
  for (const m of matches ?? []) {
    // Load all unresolved picks for this match
    const { data: picks, error: pickErr } = await supabase
      .from('predictions')
      .select('id, user_id, match_id, pair, margin, probability, multiplier, is_fallback, created_at')
      .eq('match_id', m.id)
      .is('resolved_at', null)

    if (pickErr || !picks) continue

    for (const p of picks) {
      const prediction: Prediction = {
        matchId: p.match_id,
        pair: p.pair as 1 | 2,
        margin: p.margin as '2-0' | '2-1',
        probability: p.probability,
        multiplier: p.multiplier,
        isFallback: p.is_fallback,
        createdAt: p.created_at,
      }
      const classified = classifyResult(prediction, m as unknown as Match)
      if (!classified) continue
      const reward = computeReward(prediction, classified)

      await supabase
        .from('predictions')
        .update({
          result: classified.result,
          reward,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', p.id)

      resolvedCount++
    }
  }

  return Response.json({
    resolved: resolvedCount,
    matchesScanned: matches?.length ?? 0,
    durationMs: Date.now() - startedAt,
  })
}
```

- [ ] **Step 2: Add to vercel.json**

Open `vercel.json` and add a cron entry inside the `crons` array:

```json
{
  "path": "/api/cron/resolve-predictions",
  "schedule": "*/5 * * * *"
}
```

- [ ] **Step 3: Smoke test (local)**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3002/api/cron/resolve-predictions
```

Expected: `{ resolved: 0, matchesScanned: 0, durationMs: <ms> }` on first run (no picks yet).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/resolve-predictions/route.ts vercel.json
git commit -m "feat(cron): /api/cron/resolve-predictions every 5 min"
```

---

## Task 8: Admin re-resolve endpoint

**Files:**
- Create: `src/app/api/admin/predictions/re-resolve/route.ts`

- [ ] **Step 1: Implement**

Create `src/app/api/admin/predictions/re-resolve/route.ts`:

```ts
// src/app/api/admin/predictions/re-resolve/route.ts
//
// POST /api/admin/predictions/re-resolve?matchId=<uuid>
// Clears resolved_at on all predictions for the match so the next
// resolve-predictions cron tick reclassifies them. Use after fixing
// match data (winner_pair, set scores) post-finish.

import { createServiceClient } from '@/lib/supabase'

export async function POST(request: Request) {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(request.url)
  const matchId = url.searchParams.get('matchId')
  if (!matchId) return Response.json({ error: 'matchId_required' }, { status: 400 })

  const supabase = createServiceClient()
  const { error, count } = await supabase
    .from('predictions')
    .update({ resolved_at: null, result: null, reward: null }, { count: 'exact' })
    .eq('match_id', matchId)
    .not('resolved_at', 'is', null)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ cleared: count ?? 0 })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/admin/predictions/re-resolve/route.ts
git commit -m "feat(admin): POST /api/admin/predictions/re-resolve?matchId=..."
```

---

## Task 9: API client wrappers

**Files:**
- Create: `src/lib/predictions/api-client.ts`

- [ ] **Step 1: Implement**

Create `src/lib/predictions/api-client.ts`:

```ts
'use client'
// src/lib/predictions/api-client.ts
//
// Thin fetch wrappers used by the auth-aware useMatchPrediction hook.
// Throws on network errors and on non-2xx so the hook can fall back.

import type { Prediction, Pair, Margin } from './types'

interface ServerPredictionRow {
  match_id: string
  pair: number
  margin: string
  probability: number
  multiplier: number
  is_fallback: boolean
  result: string | null
  reward: number | null
  resolved_at: string | null
  created_at: string
}

function toPrediction(r: ServerPredictionRow): Prediction {
  return {
    matchId: r.match_id,
    pair: r.pair as Pair,
    margin: r.margin as Margin,
    probability: r.probability,
    multiplier: r.multiplier,
    isFallback: r.is_fallback,
    createdAt: r.created_at,
  }
}

export async function fetchAllPredictions(): Promise<Prediction[]> {
  const res = await fetch('/api/predictions', { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch_predictions_${res.status}`)
  const body = await res.json() as { items: ServerPredictionRow[] }
  return body.items.map(toPrediction)
}

export async function postPrediction(input: { matchId: string; pair: Pair; margin: Margin }): Promise<Prediction> {
  const res = await fetch('/api/predictions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `post_prediction_${res.status}`)
  }
  return toPrediction(await res.json())
}

export async function deletePrediction(matchId: string): Promise<void> {
  const res = await fetch(`/api/predictions/${encodeURIComponent(matchId)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `delete_prediction_${res.status}`)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/predictions/api-client.ts
git commit -m "feat(predictions): client wrappers for predictions API"
```

---

## Task 10: Auth-aware `useMatchPrediction`

**Files:**
- Modify: `src/hooks/useMatchPrediction.ts`

- [ ] **Step 1: Read the current file** to keep the localStorage path identical for unauthed users:

```bash
sed -n '1,90p' src/hooks/useMatchPrediction.ts
```

- [ ] **Step 2: Replace the file**

Overwrite `src/hooks/useMatchPrediction.ts` with:

```ts
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import type { Prediction, Pair, Margin } from '@/lib/predictions/types'
import { fetchAllPredictions, postPrediction, deletePrediction } from '@/lib/predictions/api-client'

const STORAGE_KEY = 'pn_match_predictions'

type LegacyPrediction = { pair: Pair; margin: Margin }

function readAllLocal(): Record<string, Prediction> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Prediction | LegacyPrediction>
    const out: Record<string, Prediction> = {}
    for (const [matchId, p] of Object.entries(parsed)) {
      if ('multiplier' in p && 'probability' in p) {
        out[matchId] = p as Prediction
      } else {
        out[matchId] = {
          matchId,
          pair: (p as LegacyPrediction).pair,
          margin: (p as LegacyPrediction).margin,
          probability: 0.5,
          multiplier: 2.0,
          isFallback: true,
          createdAt: new Date(0).toISOString(),
        }
      }
    }
    return out
  } catch { return {} }
}

function writeAllLocal(data: Record<string, Prediction>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch {}
}

// In-memory cache of authed user's predictions, keyed by match_id.
// Populated by the first useMatchPrediction call after auth load and shared
// across all hook instances on the page.
let authedCache: Record<string, Prediction> | null = null
let authedCacheLoading: Promise<Record<string, Prediction>> | null = null

async function loadAuthedCache(): Promise<Record<string, Prediction>> {
  if (authedCache) return authedCache
  if (authedCacheLoading) return authedCacheLoading
  authedCacheLoading = fetchAllPredictions().then(items => {
    authedCache = Object.fromEntries(items.map(p => [p.matchId, p]))
    authedCacheLoading = null
    return authedCache
  }).catch(err => {
    authedCacheLoading = null
    throw err
  })
  return authedCacheLoading
}

export type SetPredictionInput = Pick<Prediction, 'pair' | 'margin'>

export function useMatchPrediction(matchId: string) {
  const { status } = useSession()
  const isAuthed = status === 'authenticated'

  const [prediction, setPredictionState] = useState<Prediction | null>(() => {
    if (typeof window === 'undefined') return null
    return readAllLocal()[matchId] ?? null
  })

  // After auth resolves, prefer the DB cache. Falls back to local if fetch fails.
  useEffect(() => {
    let cancelled = false
    if (status === 'loading') return
    if (isAuthed) {
      loadAuthedCache()
        .then(cache => { if (!cancelled) setPredictionState(cache[matchId] ?? null) })
        .catch(() => { /* fall back to whatever's in local state */ })
    } else {
      // Logged out — read from localStorage.
      setPredictionState(readAllLocal()[matchId] ?? null)
    }
    return () => { cancelled = true }
  }, [status, isAuthed, matchId])

  const setPrediction = useCallback(
    async (p: SetPredictionInput) => {
      if (isAuthed) {
        try {
          const saved = await postPrediction({ matchId, pair: p.pair, margin: p.margin })
          if (authedCache) authedCache[matchId] = saved
          setPredictionState(saved)
          return
        } catch {
          // fall through to localStorage so the click isn't lost
        }
      }
      const all = readAllLocal()
      const full: Prediction = {
        matchId,
        pair: p.pair,
        margin: p.margin,
        probability: 0.5,        // overwritten by server on next fetch when authed
        multiplier: 2.0,
        isFallback: true,
        createdAt: new Date().toISOString(),
      }
      all[matchId] = full
      writeAllLocal(all)
      setPredictionState(full)
    },
    [matchId, isAuthed],
  )

  const clearPrediction = useCallback(async () => {
    if (isAuthed) {
      try {
        await deletePrediction(matchId)
        if (authedCache) delete authedCache[matchId]
        setPredictionState(null)
        return
      } catch {
        // fall through
      }
    }
    const all = readAllLocal()
    delete all[matchId]
    writeAllLocal(all)
    setPredictionState(null)
  }, [matchId, isAuthed])

  return { prediction, setPrediction, clearPrediction }
}

/** Read all predictions across matches (used by /picks). Synchronous for
 *  unauthed (localStorage); fetches DB for authed callers. */
export function readAllLocalPredictions(): Prediction[] {
  return Object.values(readAllLocal())
}

export async function readAllPredictionsAsync(isAuthed: boolean): Promise<Prediction[]> {
  if (!isAuthed) return readAllLocalPredictions()
  const cache = await loadAuthedCache()
  return Object.values(cache)
}

// Backward-compat alias used by any callers that haven't migrated yet.
export const readAllPredictions = readAllLocalPredictions
```

- [ ] **Step 3: Smoke test**

In a browser, while logged in, predict on a scheduled match. Reload the page — the prediction should still show. Open in another browser/incognito (logged out) — prediction is NOT visible (localStorage isn't shared).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useMatchPrediction.ts
git commit -m "feat(predictions): auth-aware useMatchPrediction (DB for authed, localStorage fallback)"
```

---

## Task 11: LoggedOutNudge component

**Files:**
- Create: `src/components/prediction/LoggedOutNudge.tsx`

- [ ] **Step 1: Implement**

Create `src/components/prediction/LoggedOutNudge.tsx`. The component dispatches a window event `pn:login-open` so it can be embedded anywhere without prop-drilling a sign-in handler — the LoginSheet host listens for the event (Task 12, Step 3).

```tsx
'use client'

import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'

const GREEN = '#7ED321'
const CHUNKY = 'polygon(2% 8%, 98% 0%, 100% 92%, 0% 100%)'

function dispatchLoginOpen() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('pn:login-open'))
  }
}

export function LoggedOutNudge() {
  const { status } = useSession()
  const t = useTranslations('prediction.loggedOutNudge')
  if (status !== 'unauthenticated') return null
  return (
    <div
      style={{
        background: 'rgba(126, 211, 33, 0.10)',
        border: '1px solid rgba(126, 211, 33, 0.35)',
        clipPath: CHUNKY,
        padding: '8px 10px',
        marginBottom: 10,
        fontSize: 11,
        color: 'rgba(255,255,255,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
      }}
    >
      <span>{t('body')}</span>
      <button
        type="button"
        onClick={dispatchLoginOpen}
        style={{
          background: GREEN,
          color: '#0a0a0a',
          border: 0,
          fontSize: 11,
          fontWeight: 800,
          padding: '5px 10px',
          cursor: 'pointer',
          clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
          flexShrink: 0,
        }}
      >
        {t('cta')}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/prediction/LoggedOutNudge.tsx
git commit -m "feat(prediction): LoggedOutNudge sign-in prompt"
```

---

## Task 12: Wire LoggedOutNudge into PredictionPanel

**Files:**
- Modify: `src/components/prediction/PredictionPanel.tsx`

- [ ] **Step 1: Find the existing LoginSheet host**

Run: `grep -rn "LoginSheet\b" src/components/ src/app/ 2>/dev/null | head -10`

Identify the component that owns the LoginSheet's open/close state — that's where the `pn:login-open` listener belongs.

- [ ] **Step 2: Verify a LoginSheet host listens for `pn:login-open`**

Run: `grep -rn "pn:login-open\|LoginSheet" src/components/ src/app/ 2>/dev/null | head -5`

If no listener exists, find the existing LoginSheet host and add:

```ts
useEffect(() => {
  const onOpen = () => setOpen(true)
  window.addEventListener('pn:login-open', onOpen)
  return () => window.removeEventListener('pn:login-open', onOpen)
}, [])
```

(Place where the LoginSheet's `open` state lives — typically a top-level provider or layout component.)

- [ ] **Step 3: Render the nudge inside PredictionPanel**

Open `src/components/prediction/PredictionPanel.tsx`. Add at the top of the imports:

```tsx
import { LoggedOutNudge } from './LoggedOutNudge'
```

Then, in the JSX, find the spot just before `<PredictionFlow ... />` (search for `onLockIn={(p) => setPrediction(p)}` near line 163) and insert the nudge above it:

```tsx
<LoggedOutNudge />
<PredictionFlow ... />
```

- [ ] **Step 4: Add i18n keys (English first; other locales filled in Task 18)**

Edit `src/messages/en.json` and add inside the existing `"prediction"` namespace:

```json
"loggedOutNudge": {
  "body": "Sign in to save your picks and join the leaderboard.",
  "cta": "Sign in"
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/prediction/LoggedOutNudge.tsx src/components/prediction/PredictionPanel.tsx src/messages/en.json
git commit -m "feat(prediction): show LoggedOutNudge above pick UI for unauthed users"
```

---

## Task 13: PicksTabs component

**Files:**
- Create: `src/components/picks/PicksTabs.tsx`

- [ ] **Step 1: Implement**

Create `src/components/picks/PicksTabs.tsx`:

```tsx
'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'

type TabId = 'mine' | 'season' | 'tournaments'

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const CHUNKY = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export function PicksTabs({
  myPicks,
  season,
  tournaments,
  initial = 'mine',
}: {
  myPicks: ReactNode
  season: ReactNode
  tournaments: ReactNode
  initial?: TabId
}) {
  const t = useTranslations('prediction.myPicks.tabs')
  const [tab, setTab] = useState<TabId>(initial)
  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'mine',        label: t('mine') },
    { id: 'season',      label: t('season') },
    { id: 'tournaments', label: t('tournaments') },
  ]
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
              background: tab === id ? GREEN : '#1A1A1A',
              color: tab === id ? '#0a0a0a' : MUTED,
              padding: '8px 14px', cursor: 'pointer', border: 0, flexShrink: 0,
              clipPath: CHUNKY,
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div>
        {tab === 'mine' && myPicks}
        {tab === 'season' && season}
        {tab === 'tournaments' && tournaments}
      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/picks/PicksTabs.tsx
git commit -m "feat(picks): PicksTabs three-tab navigation"
```

---

## Task 14: LeaderboardRow component

**Files:**
- Create: `src/components/picks/LeaderboardRow.tsx`

- [ ] **Step 1: Implement**

Create `src/components/picks/LeaderboardRow.tsx`:

```tsx
'use client'

import Image from 'next/image'

const GREEN = '#7ED321'
const GOLD = '#FFD166'
const MUTED = '#6B7280'

const CHUNKY_RANK = 'polygon(8% 10%, 92% 0%, 100% 90%, 0% 100%)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export interface LeaderboardRowData {
  rank: number
  userId: string
  name: string | null
  avatar: string | null
  picksCount: number
  accuracyPct: number
  guacas: number
}

export function LeaderboardRow({ row, isMe = false }: { row: LeaderboardRowData; isMe?: boolean }) {
  const displayName = row.name ?? `Player ${row.userId.slice(0, 4)}`
  const initial = displayName[0]?.toUpperCase() ?? '?'
  const rankBg = row.rank <= 3 ? GOLD : 'rgba(255,255,255,0.06)'
  const rankFg = row.rank <= 3 ? '#0a0a0a' : MUTED
  return (
    <div style={{
      background: isMe ? 'rgba(126, 211, 33, 0.08)' : '#141414',
      border: isMe ? `1px solid ${GREEN}` : '1px solid rgba(255,255,255,0.06)',
      padding: '8px 10px',
      marginBottom: 5,
      clipPath: CHUNKY_CARD,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
    }}>
      <div style={{
        width: 28, height: 28, clipPath: CHUNKY_RANK,
        background: rankBg, color: rankFg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 900, fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
      }}>{row.rank}</div>

      {row.avatar ? (
        <Image src={row.avatar} alt="" width={32} height={32}
          style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          background: 'rgba(126, 211, 33, 0.18)',
          color: GREEN, fontWeight: 900, fontSize: 13,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>{initial}</div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {displayName}{isMe ? ' · you' : ''}
        </div>
        <div style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>
          {row.picksCount} picks · {row.accuracyPct}%
        </div>
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, color: GREEN, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
        +{row.guacas} G
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/picks/LeaderboardRow.tsx
git commit -m "feat(picks): LeaderboardRow component"
```

---

## Task 15: SeasonLeaderboard component

**Files:**
- Create: `src/components/picks/SeasonLeaderboard.tsx`

- [ ] **Step 1: Implement**

Create `src/components/picks/SeasonLeaderboard.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { LeaderboardRow, type LeaderboardRowData } from './LeaderboardRow'

const MUTED = '#6B7280'

interface LeaderboardResponse {
  rows: LeaderboardRowData[]
  nextCursor: string | null
  currentUser: { rank: number | null; row: LeaderboardRowData | null }
}

export function SeasonLeaderboard({ seasonId }: { seasonId: number }) {
  const t = useTranslations('prediction.myPicks.leaderboard')
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/leaderboard?scope=season&seasonId=${seasonId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((body: LeaderboardResponse) => { if (!cancelled) { setData(body); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [seasonId])

  if (loading) return <div style={{ color: MUTED, fontSize: 12, padding: '20px 0' }}>…</div>
  if (error) return <div style={{ color: MUTED, fontSize: 12, padding: '20px 0' }}>{t('errorBody')}</div>
  if (!data || data.rows.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px', color: MUTED }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{t('emptyTitle')}</div>
        <div style={{ fontSize: 11 }}>{t('emptyBody')}</div>
      </div>
    )
  }

  const meId = data.currentUser.row?.userId
  const meIsOnPage = !!meId && data.rows.some(r => r.userId === meId)

  return (
    <>
      <div>
        {data.rows.map(row => (
          <LeaderboardRow key={row.userId} row={row} isMe={row.userId === meId} />
        ))}
      </div>
      {data.currentUser.row && !meIsOnPage && (
        <div style={{ position: 'sticky', bottom: 8, marginTop: 12 }}>
          <LeaderboardRow row={data.currentUser.row} isMe />
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/picks/SeasonLeaderboard.tsx
git commit -m "feat(picks): SeasonLeaderboard component"
```

---

## Task 16: TournamentLeaderboard component (with selector)

**Files:**
- Create: `src/components/picks/TournamentLeaderboard.tsx`

- [ ] **Step 1: Implement**

Create `src/components/picks/TournamentLeaderboard.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { LeaderboardRow, type LeaderboardRowData } from './LeaderboardRow'

const MUTED = '#6B7280'

interface TournamentOption { id: string; name: string; level: string | null }
interface LeaderboardResponse {
  rows: LeaderboardRowData[]
  nextCursor: string | null
  currentUser: { rank: number | null; row: LeaderboardRowData | null }
}

export function TournamentLeaderboard({ tournaments, defaultTournamentId }: {
  tournaments: TournamentOption[]
  defaultTournamentId: string | null
}) {
  const t = useTranslations('prediction.myPicks.leaderboard')
  const [tournamentId, setTournamentId] = useState<string | null>(defaultTournamentId)
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tournamentId) { setData(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    fetch(`/api/leaderboard?scope=tournament&tournamentId=${tournamentId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((body: LeaderboardResponse) => { if (!cancelled) { setData(body); setLoading(false) } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false) } })
    return () => { cancelled = true }
  }, [tournamentId])

  if (tournaments.length === 0) {
    return <div style={{ color: MUTED, fontSize: 12, padding: '20px 0' }}>{t('noTournaments')}</div>
  }

  const meId = data?.currentUser.row?.userId
  const meIsOnPage = !!meId && data?.rows.some(r => r.userId === meId)

  return (
    <>
      <select
        value={tournamentId ?? ''}
        onChange={e => setTournamentId(e.target.value || null)}
        style={{
          width: '100%', marginBottom: 10,
          background: '#1A1A1A', color: '#fff', border: '1px solid rgba(255,255,255,0.10)',
          padding: '8px 10px', fontSize: 12,
        }}
      >
        {tournaments.map(opt => (
          <option key={opt.id} value={opt.id}>
            {opt.level ? `${opt.level.toUpperCase()} · ` : ''}{opt.name}
          </option>
        ))}
      </select>

      {loading && <div style={{ color: MUTED, fontSize: 12 }}>…</div>}
      {!loading && (!data || data.rows.length === 0) && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: MUTED }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 4 }}>{t('emptyTitle')}</div>
          <div style={{ fontSize: 11 }}>{t('emptyBody')}</div>
        </div>
      )}
      {!loading && data && data.rows.map(row => (
        <LeaderboardRow key={row.userId} row={row} isMe={row.userId === meId} />
      ))}
      {!loading && data?.currentUser.row && !meIsOnPage && (
        <div style={{ position: 'sticky', bottom: 8, marginTop: 12 }}>
          <LeaderboardRow row={data.currentUser.row} isMe />
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/picks/TournamentLeaderboard.tsx
git commit -m "feat(picks): TournamentLeaderboard with tournament selector"
```

---

## Task 17: Wire `/picks` page — server-side data + tabs

**Files:**
- Modify: `src/app/[locale]/picks/page.tsx`
- Modify: `src/app/[locale]/picks/ClientPicks.tsx`

- [ ] **Step 1: Update the server page**

Replace `src/app/[locale]/picks/page.tsx` with:

```tsx
import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { redirect } from '@/i18n/navigation'
import { createServiceClient } from '@/lib/supabase'
import { ClientPicks } from './ClientPicks'

export default async function PicksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'prediction.myPicks' })
  const session = await auth()
  if (!session?.user) redirect({ href: '/home', locale })

  const supabase = createServiceClient()

  // Most recent active season — use the largest season_external_id present on any tournament
  const { data: latestSeason } = await supabase
    .from('tournaments')
    .select('season_external_id')
    .not('season_external_id', 'is', null)
    .order('season_external_id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const seasonId: number = latestSeason?.season_external_id ?? new Date().getFullYear()

  // Tournament options — show tournaments with at least one finished match in the last 90 days,
  // ordered most-recent-first
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentMatches } = await supabase
    .from('matches')
    .select('tournament_id, status, scheduled_at, tournament:tournaments(id, name, level, starts_at)')
    .in('status', ['finished', 'retired', 'walkover'])
    .gte('scheduled_at', ninetyDaysAgo)
    .order('scheduled_at', { ascending: false })
    .limit(500)

  const seenIds = new Set<string>()
  type TOpt = { id: string; name: string; level: string | null; starts_at: string | null }
  const tournaments: TOpt[] = []
  for (const m of recentMatches ?? []) {
    const tArr = m.tournament as unknown as TOpt | TOpt[] | null
    const tournament = Array.isArray(tArr) ? tArr[0] : tArr
    if (!tournament) continue
    if (seenIds.has(tournament.id)) continue
    seenIds.add(tournament.id)
    tournaments.push({
      id: tournament.id,
      name: tournament.name,
      level: tournament.level,
      starts_at: tournament.starts_at,
    })
  }

  // Default tournament: the user's most-picked, otherwise the most-recent finished
  const userId = session.user.id!
  const { data: userPicks } = await supabase
    .from('predictions')
    .select('match_id')
    .eq('user_id', userId)
    .limit(1000)

  let defaultTournamentId: string | null = tournaments[0]?.id ?? null
  if (userPicks && userPicks.length > 0) {
    const matchIds = userPicks.map(p => p.match_id)
    const { data: pickedMatches } = await supabase
      .from('matches')
      .select('tournament_id')
      .in('id', matchIds)
    const counts = new Map<string, number>()
    for (const m of pickedMatches ?? []) {
      if (!m.tournament_id) continue
      counts.set(m.tournament_id, (counts.get(m.tournament_id) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top && tournaments.some(t => t.id === top[0])) defaultTournamentId = top[0]
  }

  return (
    <main style={{ background: '#0a0a0a', minHeight: '100vh', padding: '16px 14px', color: '#fff' }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>{t('title')}</h1>
      <ClientPicks
        displayName={session.user.name ?? 'You'}
        seasonId={seasonId}
        tournaments={tournaments.map(t => ({ id: t.id, name: t.name, level: t.level }))}
        defaultTournamentId={defaultTournamentId}
      />
    </main>
  )
}
```

- [ ] **Step 2: Update ClientPicks to use tabs and the auth-aware reader**

Replace `src/app/[locale]/picks/ClientPicks.tsx` with:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { readAllPredictionsAsync } from '@/hooks/useMatchPrediction'
import type { Prediction } from '@/lib/predictions/types'
import type { Match } from '@/types/match'
import { classifyResult, computeReward } from '@/lib/predictions/scoring'
import { StatsHeader } from './StatsHeader'
import { PicksList } from './PicksList'
import { PicksTabs } from '@/components/picks/PicksTabs'
import { SeasonLeaderboard } from '@/components/picks/SeasonLeaderboard'
import { TournamentLeaderboard } from '@/components/picks/TournamentLeaderboard'

interface Props {
  displayName: string
  seasonId: number
  tournaments: Array<{ id: string; name: string; level: string | null }>
  defaultTournamentId: string | null
}

export function ClientPicks({ displayName, seasonId, tournaments, defaultTournamentId }: Props) {
  const locale = useLocale()
  const [picks, setPicks] = useState<Array<{ prediction: Prediction; match: Match }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const all = await readAllPredictionsAsync(true)  // /picks is auth-gated
      if (all.length === 0) { setLoading(false); return }
      const ids = all.map(p => p.matchId)
      const res = await fetch(`/api/matches/by-ids?ids=${ids.join(',')}`)
      const matches: Match[] = res.ok ? await res.json() : []
      const byId = new Map(matches.map(m => [m.id, m]))
      const enriched = all
        .map(p => ({ prediction: p, match: byId.get(p.matchId) }))
        .filter((e): e is { prediction: Prediction; match: Match } => !!e.match)
      if (!cancelled) { setPicks(enriched); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // Stats for the My picks tab header (logic unchanged from previous version)
  const totalGuacas = picks.reduce((sum, { prediction, match }) => {
    const c = classifyResult(prediction, match); if (!c) return sum
    return sum + computeReward(prediction, c)
  }, 0)
  const resolvedRight = picks.filter(({ prediction, match }) => {
    const r = classifyResult(prediction, match)?.result
    return r === 'right' || r === 'perfect' || r === 'upset'
  }).length
  const resolvedWrong = picks.filter(({ prediction, match }) =>
    classifyResult(prediction, match)?.result === 'wrong'
  ).length
  const accuracyPct = (resolvedRight + resolvedWrong > 0)
    ? Math.round((resolvedRight / (resolvedRight + resolvedWrong)) * 100) : 0

  const sorted = picks
    .map(p => ({ p, r: classifyResult(p.prediction, p.match)?.result ?? null }))
    .filter(x => x.r !== null && x.r !== 'invalidated')
    .sort((a, b) => new Date(b.p.prediction.createdAt).getTime() - new Date(a.p.prediction.createdAt).getTime())
  let currentStreak = 0
  for (const { r } of sorted) { if (r === 'right' || r === 'perfect' || r === 'upset') currentStreak++; else break }
  let bestStreak = 0, run = 0
  for (const { r } of sorted) {
    if (r === 'right' || r === 'perfect' || r === 'upset') { run++; bestStreak = Math.max(bestStreak, run) }
    else run = 0
  }

  if (loading) return <p style={{ color: '#6B7280' }}>Loading…</p>

  return (
    <PicksTabs
      myPicks={
        <>
          <StatsHeader
            displayName={displayName}
            rank={null}
            totalGuacas={totalGuacas}
            accuracyPct={accuracyPct}
            currentStreak={currentStreak}
            bestStreak={bestStreak}
          />
          <PicksList picks={picks} locale={locale} />
        </>
      }
      season={<SeasonLeaderboard seasonId={seasonId} />}
      tournaments={
        <TournamentLeaderboard
          tournaments={tournaments}
          defaultTournamentId={defaultTournamentId}
        />
      }
    />
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/picks/page.tsx src/app/[locale]/picks/ClientPicks.tsx
git commit -m "feat(picks): tabs hub at /picks (My picks + Season + Tournaments)"
```

---

## Task 18: i18n keys (5 locales)

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json`

- [ ] **Step 1: Update `en.json`**

Inside the existing `"prediction"` namespace, ensure both blocks exist (Task 12 already added `loggedOutNudge`):

```json
"loggedOutNudge": {
  "body": "Sign in to save your picks and join the leaderboard.",
  "cta": "Sign in"
}
```

Inside `"prediction.myPicks"`, add:

```json
"tabs": {
  "mine": "My picks",
  "season": "Season",
  "tournaments": "Tournaments"
},
"leaderboard": {
  "emptyTitle": "Nobody's on the board yet",
  "emptyBody": "Predict on any match to start earning guacas.",
  "errorBody": "Couldn't load the leaderboard. Try again.",
  "noTournaments": "No tournaments to rank yet."
}
```

- [ ] **Step 2: Update `es.json` (Spanish)**

Mirror the same keys with translations:

```json
"loggedOutNudge": {
  "body": "Inicia sesión para guardar tus picks y unirte al ranking.",
  "cta": "Inicia sesión"
}
```

```json
"tabs": {
  "mine": "Mis picks",
  "season": "Temporada",
  "tournaments": "Torneos"
},
"leaderboard": {
  "emptyTitle": "Aún no hay nadie en el ranking",
  "emptyBody": "Haz un pick en cualquier partido para empezar a ganar guacas.",
  "errorBody": "No se pudo cargar el ranking. Inténtalo de nuevo.",
  "noTournaments": "Aún no hay torneos para clasificar."
}
```

- [ ] **Step 3: Update `pt.json` (Portuguese)**

```json
"loggedOutNudge": {
  "body": "Entra para guardar os teus picks e juntar-te ao ranking.",
  "cta": "Entrar"
}
```

```json
"tabs": {
  "mine": "Os meus picks",
  "season": "Temporada",
  "tournaments": "Torneios"
},
"leaderboard": {
  "emptyTitle": "Ainda ninguém no ranking",
  "emptyBody": "Faz um pick em qualquer jogo para começar a ganhar guacas.",
  "errorBody": "Não foi possível carregar o ranking. Tenta novamente.",
  "noTournaments": "Ainda não há torneios para classificar."
}
```

- [ ] **Step 4: Update `it.json` (Italian)**

```json
"loggedOutNudge": {
  "body": "Accedi per salvare i tuoi pronostici e unirti alla classifica.",
  "cta": "Accedi"
}
```

```json
"tabs": {
  "mine": "I miei pronostici",
  "season": "Stagione",
  "tournaments": "Tornei"
},
"leaderboard": {
  "emptyTitle": "Nessuno ancora in classifica",
  "emptyBody": "Pronostica una partita per iniziare a guadagnare guacas.",
  "errorBody": "Impossibile caricare la classifica. Riprova.",
  "noTournaments": "Ancora nessun torneo da classificare."
}
```

- [ ] **Step 5: Update `fr.json` (French)**

```json
"loggedOutNudge": {
  "body": "Connectez-vous pour sauvegarder vos pronostics et rejoindre le classement.",
  "cta": "Connexion"
}
```

```json
"tabs": {
  "mine": "Mes pronostics",
  "season": "Saison",
  "tournaments": "Tournois"
},
"leaderboard": {
  "emptyTitle": "Personne dans le classement pour l'instant",
  "emptyBody": "Faites un pronostic sur n'importe quel match pour commencer à gagner des guacas.",
  "errorBody": "Impossible de charger le classement. Réessayez.",
  "noTournaments": "Pas encore de tournois à classer."
}
```

- [ ] **Step 6: Verify all 5 locales have the new keys**

Run a quick parity check:

```bash
node -e "const k=['prediction.loggedOutNudge.body','prediction.loggedOutNudge.cta','prediction.myPicks.tabs.mine','prediction.myPicks.tabs.season','prediction.myPicks.tabs.tournaments','prediction.myPicks.leaderboard.emptyTitle','prediction.myPicks.leaderboard.emptyBody','prediction.myPicks.leaderboard.errorBody','prediction.myPicks.leaderboard.noTournaments']; for(const f of ['en','es','pt','it','fr']){const m=require('./src/messages/'+f+'.json'); for(const key of k){const path=key.split('.');let v=m;for(const p of path){v=v?.[p]}if(typeof v!=='string'){console.log(f, key, 'MISSING');process.exitCode=1}}}console.log('OK if no MISSING above')"
```

Expected: no `MISSING` lines. Run `npm run dev` and click each tab while changing locale to confirm strings render.

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(i18n): picks tabs + leaderboard + logged-out nudge keys (5 locales)"
```

---

## Task 19: Smoke test the full flow locally

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Verify the empty leaderboard renders**

Navigate to `http://localhost:3002/picks` while logged in. Click each tab:
- **My picks** — your existing localStorage picks should render unchanged on first load (they will not be in DB yet; this is expected).
- **Season** — empty state ("Nobody's on the board yet").
- **Tournaments** — selector populated; leaderboard empty.

- [ ] **Step 3: Make a pick on a scheduled match**

Open a scheduled match detail page and lock in a prediction. Verify:
- Network tab shows `POST /api/predictions` returning 200
- Reload `/picks` — the pick appears in My picks (now from DB)

- [ ] **Step 4: Trigger the resolver manually against a finished match**

Pick a match that's already finished from the DB:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3002/api/cron/resolve-predictions
```

Expected: `{ resolved: 1, matchesScanned: 1, ... }` (assuming you predicted on a now-finished match).

- [ ] **Step 5: Verify leaderboard populates**

Reload `/picks → Season`. You should be on the board. Switch to **Tournaments**, pick the tournament containing your match — you should be there too.

---

## Task 20: Push to main

- [ ] **Step 1: Verify git state**

Run: `git status` — expect clean working tree.

Run: `git log --oneline -20` — confirm all 19 task commits are present.

- [ ] **Step 2: Push the feature branch + open PR**

Run:

```bash
git push -u origin HEAD
```

Then open a PR from the feature branch to `main` with title:

```
feat(picks): persistent picks + per-tournament & season leaderboards
```

PR body links the spec and lists the user-visible changes (tabs, nudge, leaderboard surfaces).

- [ ] **Step 3: Confirm rollout order from spec**

The spec says deploy in this order:
1. Migration applied (Task 1, Step 2 already done)
2. Resolver cron deployed (folded into the same branch)
3. API routes (same branch)
4. Client UI (same branch)
5. Vercel deploy lands

Single PR, single deploy. Vercel runs the cron starting on the next 5-min boundary.

---

## Self-review notes

This plan covers every spec section:
- Goals & non-goals: addressed by the task scope (no friends/country leaderboards, no opt-out toggle, no name override)
- Schema (Task 1)
- API surface (Tasks 3, 4, 6) — POST/GET/DELETE/Leaderboard
- Resolver mechanism (Task 7)
- Score corrections admin endpoint (Task 8)
- UI changes — `/picks` tabs (Tasks 13, 17), leaderboard rows (Tasks 14-16), logged-out nudge (Tasks 11-12)
- `useMatchPrediction` auth-aware (Task 10)
- i18n (Task 18)
- Smoke test (Task 19)
- Rollout (Task 20)

**Known limitations to revisit if the leaderboard query gets slow:**
- Task 6 aggregates in JS. At ~10k actives × ~50 picks/season this is fine; if it slows, swap for a Postgres function or a `leaderboard_rollups` table (Approach C from spec).
- Task 6 cursor uses `userId` (the stable last-segment of the tie-break key) instead of the full encoded cursor from `leaderboard-query.ts`. The richer encoder is shipped but unused — kept for the next iteration if pagination behavior needs to skip across rank ties.
