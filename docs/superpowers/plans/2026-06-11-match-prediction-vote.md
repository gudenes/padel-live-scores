# Match Prediction + Fan Vote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the admin Elo win-probability (`model_predictions`) in the user-facing match UI as a "PadelNacho Prediction", and replace the hidden Guacas margin-pick game with a one-tap community "who will win" vote.

**Architecture:** The hourly padelgod `model-prediction-snapshot` worker denormalizes its latest per-match probability onto three new `matches` columns (`pred_pair1_prob`, `pred_model_version`, `pred_computed_at`) so anon/browser code reads it for free via existing match fetches. The match detail page swaps its prediction widget for a new `MatchPredictionVote` (model bar + fan vote), and `MatchCard` grows an inline favorite tag with a tap-to-explain popover. Fan votes live in a new `match_votes` table written through a service-role API route (`/api/match-vote`), mirroring the existing `projection_votes` pattern exactly. A single feature flag `NEXT_PUBLIC_MATCH_PREDICTION_ENABLED` swaps the old Guacas UI for the new vote UI (dark-launch + instant revert; Guacas code is retained).

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (Postgres + service-role routes), padelgod worker (TS, Railway), vitest.

**Spec:** [docs/superpowers/specs/2026-06-11-match-prediction-vote-design.md](../specs/2026-06-11-match-prediction-vote-design.md)

---

## Resolved decisions (from spec open questions)

1. **One column** `pred_pair1_prob` (pair2 implied as `1 - p`).
2. **"How we predict →"** link navigates to the match detail page (`/match/<id>`), where the full model bar lives. No new methodology page in v1.
3. **No staleness filter** in v1 — show whenever `pred_pair1_prob` is non-null.
4. **One feature flag** `NEXT_PUBLIC_MATCH_PREDICTION_ENABLED`: `'true'` → new vote UI + card tag; otherwise → existing Guacas margin-pick UI (current behavior). Default unset (= off) until launch.

## File structure

**Create:**
- `supabase/migrations/20260611120000_matches_prediction_columns.sql` — 3 `matches` columns
- `supabase/migrations/20260611120100_match_votes.sql` — `match_votes` table (RLS off)
- `src/lib/match-prediction.ts` — pure `getMatchPrediction(match)` helper + types
- `src/lib/__tests__/match-prediction.test.ts` — unit tests for the helper
- `src/app/api/match-vote/route.ts` — GET/POST vote endpoint (service-role)
- `src/hooks/useMatchVote.ts` — client vote hook
- `src/components/prediction/ModelPredictionBar.tsx` — the lime model bar
- `src/components/prediction/MatchVoteCard.tsx` — vote buttons + reveal split
- `src/components/prediction/MatchPredictionVote.tsx` — lifecycle wrapper (scheduled/live/finished)
- `src/components/prediction/__tests__/MatchVoteCard.test.tsx` — component test
- `src/components/__tests__/MatchCardPredictionTag.test.tsx` — card tag test

**Modify:**
- `padelgod/src/workers/model-prediction-snapshot.ts` — denormalize UPSERT onto `matches`
- `src/types/match.ts` — add `pred_*` fields to `Match`
- `src/lib/fetch-matches-day.ts` — add `pred_*` to `MATCH_SELECT`
- `src/app/[locale]/match/[id]/page.tsx` — swap prediction widget behind the flag
- `src/components/MatchCard.tsx` — inline favorite tag + popover
- `src/lib/feature-flags.ts` (or inline `process.env` read) — expose the flag
- `src/messages/{en,es,pt,it,fr}.json` — new i18n keys

---

## Phase A — Prediction read-path (data plumbing)

### Task 1: Migration — prediction columns on `matches`

**Files:**
- Create: `supabase/migrations/20260611120000_matches_prediction_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260611120000_matches_prediction_columns.sql
-- Denormalized "latest" Elo win-probability per match, mirrored from the
-- append-only model_predictions table by the hourly model-prediction-snapshot
-- worker. Lets anon/browser code read the current prediction via the existing
-- (anon-readable) matches row — no new RLS surface, no per-card N+1.
-- pair2 probability is implied as (1 - pred_pair1_prob).
alter table public.matches
  add column if not exists pred_pair1_prob   numeric,        -- 0..1, null = no prediction
  add column if not exists pred_model_version text,
  add column if not exists pred_computed_at  timestamptz;

comment on column public.matches.pred_pair1_prob is
  'Latest Elo model win probability for pair 1 (0..1). Mirror of model_predictions; written by padelgod model-prediction-snapshot. Null when no prediction.';
```

- [ ] **Step 2: Apply the migration**

Per project memory, apply via the pg driver + `DATABASE_URL`, NOT `supabase db push`.

Run: `node scripts/apply-migration.mjs supabase/migrations/20260611120000_matches_prediction_columns.sql` (or the repo's established apply method — confirm the exact script name with `ls scripts | grep -i migrat`).
Expected: columns added, no error. Verify:
`psql "$DATABASE_URL" -c "\d public.matches" | grep pred_`
Expected: three `pred_*` rows printed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260611120000_matches_prediction_columns.sql
git commit -m "feat(prediction): add denormalized prediction columns to matches"
```

### Task 2: Worker — denormalize latest prediction onto `matches`

**Files:**
- Modify: `padelgod/src/workers/model-prediction-snapshot.ts` (insert after the `model_predictions` insert near line 442)

- [ ] **Step 1: Add the denormalize UPSERT after the snapshot insert**

Locate (around line 442):

```ts
        if (matchRows.length > 0 && !dryRun) {
          const { error } = await supabase.from('model_predictions').insert(matchRows);
          if (error) throw error;
        }
        matchWritten += matchRows.length;
```

Replace with:

```ts
        if (matchRows.length > 0 && !dryRun) {
          const { error } = await supabase.from('model_predictions').insert(matchRows);
          if (error) throw error;

          // Denormalize the latest probability onto the matches row so anon
          // browser code can read it via the existing match fetch. matchRows
          // ids always already exist, so a plain UPDATE (not upsert) is safe.
          await Promise.all(
            matchRows.map((r) =>
              supabase
                .from('matches')
                .update({
                  pred_pair1_prob: r.pair1_prob,
                  pred_model_version: r.model_version,
                  pred_computed_at: nowIso,
                })
                .eq('id', r.match_id),
            ),
          );
        }
        matchWritten += matchRows.length;
```

(`nowIso` is already in scope — it's used above for `model_tournament_predictions` and the `.gte('scheduled_at', nowIso)` filter. Confirm with `grep -n "nowIso" padelgod/src/workers/model-prediction-snapshot.ts`; if absent, add `const nowIso = new Date().toISOString();` at the top of `runModelPredictionSnapshot`.)

- [ ] **Step 2: Typecheck the worker**

Run: `cd padelgod && npx tsc --noEmit && cd ..`
Expected: no errors.

- [ ] **Step 3: Dry-run verify (manual)**

Run the worker against a tournament with upcoming main-draw matches (use the worker's existing dry-run/CLI entry if available, e.g. `grep -rn "runModelPredictionSnapshot" padelgod/src` to find the runner). With `dryRun=false` on a dev DB, then:
`psql "$DATABASE_URL" -c "select id, pred_pair1_prob, pred_model_version, pred_computed_at from public.matches where pred_pair1_prob is not null limit 5;"`
Expected: rows with 0..1 probabilities.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/workers/model-prediction-snapshot.ts
git commit -m "feat(prediction): mirror latest prediction onto matches in snapshot worker"
```

### Task 3: `Match` type + pure prediction helper

**Files:**
- Modify: `src/types/match.ts` (add fields after `pair2_seed`, ~line 80)
- Create: `src/lib/match-prediction.ts`
- Test: `src/lib/__tests__/match-prediction.test.ts`

- [ ] **Step 1: Add fields to the `Match` interface**

In `src/types/match.ts`, after the `pair2_seed?: number | null` line, add:

```ts
  /** Latest Elo model win probability for pair 1 (0..1). Denormalized from
   *  model_predictions by padelgod's model-prediction-snapshot worker. Null
   *  when no prediction exists (FIP-tier, unranked, not yet computed). */
  pred_pair1_prob?: number | null
  pred_model_version?: string | null
  pred_computed_at?: string | null
```

- [ ] **Step 2: Write the failing helper test**

```ts
// src/lib/__tests__/match-prediction.test.ts
import { describe, it, expect } from 'vitest'
import { getMatchPrediction } from '@/lib/match-prediction'
import type { Match } from '@/types/match'

const base = { id: 'm1' } as unknown as Match

describe('getMatchPrediction', () => {
  it('returns null when no prediction', () => {
    expect(getMatchPrediction({ ...base, pred_pair1_prob: null })).toBeNull()
    expect(getMatchPrediction({ ...base })).toBeNull()
  })

  it('favors pair 1 when p >= 0.5 and rounds the displayed pct', () => {
    const r = getMatchPrediction({ ...base, pred_pair1_prob: 0.62 })!
    expect(r.favored).toBe(1)
    expect(r.pct).toBe(62)
    expect(r.pair1Prob).toBeCloseTo(0.62)
  })

  it('favors pair 2 when p < 0.5 and shows the larger side pct', () => {
    const r = getMatchPrediction({ ...base, pred_pair1_prob: 0.36 })!
    expect(r.favored).toBe(2)
    expect(r.pct).toBe(64)
  })

  it('treats exactly 0.5 as pair 1 favored at 50%', () => {
    const r = getMatchPrediction({ ...base, pred_pair1_prob: 0.5 })!
    expect(r.favored).toBe(1)
    expect(r.pct).toBe(50)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/match-prediction.test.ts`
Expected: FAIL — `getMatchPrediction` not found.

- [ ] **Step 4: Implement the helper**

```ts
// src/lib/match-prediction.ts
// Pure derivation of the user-facing prediction read from a Match's
// denormalized pred_pair1_prob. Single source of truth for "who does the
// model favor and by how much" across the match card + detail widget.
import type { Match } from '@/types/match'

export interface MatchPrediction {
  /** Which pair the model favors. */
  favored: 1 | 2
  /** Win probability of the FAVORED pair, as a whole-number percent (50..100). */
  pct: number
  /** Raw pair-1 probability (0..1). */
  pair1Prob: number
}

export function getMatchPrediction(match: Pick<Match, 'pred_pair1_prob'>): MatchPrediction | null {
  const p = match.pred_pair1_prob
  if (p == null || Number.isNaN(p)) return null
  const favored: 1 | 2 = p >= 0.5 ? 1 : 2
  const favoredProb = favored === 1 ? p : 1 - p
  return { favored, pct: Math.round(favoredProb * 100), pair1Prob: p }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/match-prediction.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types/match.ts src/lib/match-prediction.ts src/lib/__tests__/match-prediction.test.ts
git commit -m "feat(prediction): Match pred fields + getMatchPrediction helper"
```

### Task 4: Thread `pred_*` into explicit match select lists

**Files:**
- Modify: `src/lib/fetch-matches-day.ts:123` (`MATCH_SELECT`)

Note: `home/page.tsx` (`MATCH_SELECT_LIVE/LEAN/LEAN_PREMIER`) and `match-fetch.ts` (`MATCH_FETCH_SELECT`) use `*`, so they already include the new columns. Only explicit column lists need editing.

- [ ] **Step 1: Add columns to `MATCH_SELECT`**

In `src/lib/fetch-matches-day.ts`, change the top of `MATCH_SELECT` from:

```ts
const MATCH_SELECT = `
  id, status, category, scheduled_at, finished_at, duration, round, court, court_order,
  schedule_label, winner_pair, late_hint, pair1_seed, pair2_seed,
```

to:

```ts
const MATCH_SELECT = `
  id, status, category, scheduled_at, finished_at, duration, round, court, court_order,
  schedule_label, winner_pair, late_hint, pair1_seed, pair2_seed,
  pred_pair1_prob, pred_model_version, pred_computed_at,
```

- [ ] **Step 2: Find any other explicit `matches` selects feeding MatchCard**

Run: `grep -rn "select(\`\|select('id" src/lib src/app | grep -i "from('matches')\|MATCH_SELECT" `
Then manually check tournament-detail's match fetch (`grep -rn "from('matches')" "src/app/[locale]/(app)/tournaments"`). If any explicit list feeds `MatchCard` and lacks `pred_pair1_prob`, add the three columns there too.
Expected: tournament-detail uses `*` or a lean list; add columns only where the list is explicit.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/fetch-matches-day.ts
git commit -m "feat(prediction): include pred_* columns in match list selects"
```

---

## Phase B — Fan vote backend

### Task 5: Migration — `match_votes` table

**Files:**
- Create: `supabase/migrations/20260611120100_match_votes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260611120100_match_votes.sql
-- One-tap "who will win" fan votes per match. One changeable vote per
-- (match, voter) until the match starts. Mirrors projection_votes: RLS on
-- with NO policies, so all access is via the service-role API route.
create table if not exists public.match_votes (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches(id) on delete cascade,
  pair smallint not null check (pair in (1, 2)),
  voter_id text not null,                 -- device UUID (pn_device_id) or account id when logged in
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (match_id, voter_id)
);
create index if not exists match_votes_match_idx on public.match_votes (match_id);
create index if not exists match_votes_voter_idx on public.match_votes (voter_id);

alter table public.match_votes enable row level security;
```

- [ ] **Step 2: Apply the migration** (pg driver + `DATABASE_URL`)

Run: `node scripts/apply-migration.mjs supabase/migrations/20260611120100_match_votes.sql`
Verify: `psql "$DATABASE_URL" -c "\d public.match_votes"`
Expected: table exists with the unique constraint.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260611120100_match_votes.sql
git commit -m "feat(vote): match_votes table"
```

### Task 6: API route — `/api/match-vote`

**Files:**
- Create: `src/app/api/match-vote/route.ts`

Mirrors `src/app/api/projection-vote/route.ts` (voter resolution, reveal-after-vote, service-role upsert) with two differences: aggregate is **per-match pair tally**, and POST is **rejected once the match is no longer scheduled** (lock).

- [ ] **Step 1: Write the route**

```ts
// src/app/api/match-vote/route.ts
// One-tap "who will win" fan vote. Per-match pair tally, revealed only after
// the voter has cast a vote on THIS match. Voting locks once the match leaves
// 'scheduled'. All access via service-role (RLS-locked table).
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import type { SupabaseClient } from '@supabase/supabase-js'

async function matchTally(supabase: SupabaseClient, matchId: string): Promise<{ pair1: number; pair2: number; total: number }> {
  const [p1, p2] = await Promise.all([
    supabase.from('match_votes').select('*', { count: 'exact', head: true }).eq('match_id', matchId).eq('pair', 1),
    supabase.from('match_votes').select('*', { count: 'exact', head: true }).eq('match_id', matchId).eq('pair', 2),
  ])
  const pair1 = p1.count ?? 0
  const pair2 = p2.count ?? 0
  return { pair1, pair2, total: pair1 + pair2 }
}

async function resolveVoterId(deviceId: string | null): Promise<string | null> {
  const session = await auth().catch(() => null)
  if (session?.user?.id) return session.user.id
  return deviceId || null
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const matchId = sp.get('matchId')
  const voterId = await resolveVoterId(sp.get('deviceId'))
  if (!matchId || !voterId) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 })
  }
  const supabase = createServerClient()
  const { data: mine } = await supabase
    .from('match_votes')
    .select('pair')
    .eq('match_id', matchId).eq('voter_id', voterId)
    .maybeSingle()
  const yourPick = (mine?.pair as 1 | 2 | undefined) ?? null
  return NextResponse.json({
    yourPick,
    aggregate: yourPick ? await matchTally(supabase, matchId) : null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const matchId: string | undefined = body?.matchId
  const pair = body?.pair
  if (!matchId || (pair !== 1 && pair !== 2)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const voterId = await resolveVoterId(body?.deviceId ?? null)
  if (!voterId) return NextResponse.json({ error: 'Must provide deviceId or auth' }, { status: 400 })

  const supabase = createServerClient()

  // Lock: only scheduled matches accept votes.
  const { data: m } = await supabase.from('matches').select('status').eq('id', matchId).maybeSingle()
  if (!m) return NextResponse.json({ error: 'Match not found' }, { status: 404 })
  if (m.status !== 'scheduled') {
    return NextResponse.json({ error: 'locked', locked: true }, { status: 409 })
  }

  const { error } = await supabase.from('match_votes').upsert(
    { match_id: matchId, pair, voter_id: voterId, updated_at: new Date().toISOString() },
    { onConflict: 'match_id,voter_id' },
  )
  if (error) {
    console.error('[match-vote] upsert error:', error)
    return NextResponse.json({ error: 'Failed to save vote' }, { status: 500 })
  }
  return NextResponse.json({ yourPick: pair, aggregate: await matchTally(supabase, matchId) })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Smoke-test the endpoint (manual, dev server running)**

```bash
# vote
curl -s -X POST http://localhost:3002/api/match-vote -H 'Content-Type: application/json' \
  -d '{"matchId":"<a-scheduled-match-id>","pair":1,"deviceId":"test-dev-1"}'
# expect: {"yourPick":1,"aggregate":{"pair1":1,"pair2":0,"total":1}}
# read back
curl -s "http://localhost:3002/api/match-vote?matchId=<same-id>&deviceId=test-dev-1"
# expect: {"yourPick":1,"aggregate":{...}}
# lock check against a live/finished match id → expect 409 {"locked":true}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/match-vote/route.ts
git commit -m "feat(vote): /api/match-vote GET/POST with scheduled-only lock"
```

### Task 7: Client hook — `useMatchVote`

**Files:**
- Create: `src/hooks/useMatchVote.ts`

Mirrors `src/hooks/useProjectionVote.ts` (same `pn_device_id` key, optimistic update, reveal-after-vote).

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useMatchVote.ts
'use client'
import { useState, useCallback, useEffect } from 'react'

const DEVICE_ID_KEY = 'pn_device_id'

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY)
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, id) }
    return id
  } catch { return crypto.randomUUID() }
}

export interface MatchVoteAggregate { pair1: number; pair2: number; total: number }
export interface MatchVoteState {
  yourPick: 1 | 2 | null
  aggregate: MatchVoteAggregate | null  // null until the user votes (reveal-after-vote)
  loading: boolean
  locked: boolean
  vote: (pair: 1 | 2) => void
}

/** Per-match one-tap winner vote with a community split revealed after voting.
 *  `locked` blocks the UI from voting (caller passes it true once status != scheduled). */
export function useMatchVote(matchId: string, locked: boolean): MatchVoteState {
  const [yourPick, setYourPick] = useState<1 | 2 | null>(null)
  const [aggregate, setAggregate] = useState<MatchVoteAggregate | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const deviceId = getDeviceId()
    const qs = new URLSearchParams({ matchId, deviceId })
    fetch(`/api/match-vote?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setYourPick(data.yourPick ?? null)
        setAggregate(data.aggregate ?? null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [matchId])

  const vote = useCallback((pair: 1 | 2) => {
    if (locked) return
    setYourPick(pair)  // optimistic
    const deviceId = getDeviceId()
    fetch('/api/match-vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, pair, deviceId }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) { setYourPick(data.yourPick ?? pair); setAggregate(data.aggregate ?? null) } })
      .catch(() => {})
  }, [matchId, locked])

  return { yourPick, aggregate, loading, locked, vote }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useMatchVote.ts
git commit -m "feat(vote): useMatchVote client hook"
```

---

## Phase C — Match detail widget

### Task 8: `ModelPredictionBar` component

**Files:**
- Create: `src/components/prediction/ModelPredictionBar.tsx`

Renders the lime "Our Prediction" bar from `getMatchPrediction`. Returns null when no prediction. Reuses the existing chunky bar styling from `PredictionPanel`.

- [ ] **Step 1: Write the component**

```tsx
// src/components/prediction/ModelPredictionBar.tsx
'use client'
import { useTranslations } from 'next-intl'
import type { Match } from '@/types/match'
import { getMatchPrediction } from '@/lib/match-prediction'

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'
const KEYFRAMES = `@keyframes pn-pred-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }`

export function ModelPredictionBar({ match, pair1Label, pair2Label }: {
  match: Match; pair1Label: string; pair2Label: string
}) {
  const t = useTranslations('prediction')
  const pred = getMatchPrediction(match)
  if (!pred) return null
  const p1Pct = Math.round(pred.pair1Prob * 100)
  const p2Pct = 100 - p1Pct
  const leftBigger = pred.favored === 1
  return (
    <div style={{ background: '#141414', padding: '12px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      <style>{KEYFRAMES}</style>
      <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, color: GREEN, marginBottom: 8 }}>
        🥑 {t('modelTitle')}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#ddd', marginBottom: 4 }}>
        <span>{pair1Label}</span><span>{pair2Label}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
        <span style={{ color: leftBigger ? GREEN : MUTED }}>{p1Pct}%</span>
        <span style={{ color: !leftBigger ? GREEN : MUTED }}>{p2Pct}%</span>
      </div>
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', clipPath: CHUNKY_BAR }}>
        <div style={{
          height: '100%', width: `${p1Pct}%`,
          background: 'linear-gradient(90deg, #7ED321, #5fb314)',
          transformOrigin: 'left center',
          animation: 'pn-pred-grow 700ms cubic-bezier(0.16, 1, 0.3, 1) both',
        }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the `prediction.modelTitle` key is added in Task 13).

- [ ] **Step 3: Commit**

```bash
git add src/components/prediction/ModelPredictionBar.tsx
git commit -m "feat(prediction): ModelPredictionBar component"
```

### Task 9: `MatchVoteCard` component

**Files:**
- Create: `src/components/prediction/MatchVoteCard.tsx`
- Test: `src/components/prediction/__tests__/MatchVoteCard.test.tsx`

Two pair buttons before voting; after voting (or when locked + already voted) shows the community split with a "✓ you" marker on the user's pick. Model bar is lime; fan split bars are blue (`#3aa0ff`) per the design.

- [ ] **Step 1: Write the failing component test**

```tsx
// src/components/prediction/__tests__/MatchVoteCard.test.tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { MatchVoteCard } from '../MatchVoteCard'

const messages = { prediction: {
  whoWillWin: 'Who will win?', castVote: 'Cast your vote',
  fansVoted: '{count} fans voted', yourPick: 'you', beFirst: 'Be the first to vote',
} }

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="en" messages={messages}>{ui}</NextIntlClientProvider>)
}

describe('MatchVoteCard', () => {
  it('shows two vote buttons before voting', () => {
    wrap(<MatchVoteCard pair1Label="Galán/Chingotto" pair2Label="Tapia/Coello"
      yourPick={null} aggregate={null} locked={false} onVote={() => {}} />)
    expect(screen.getByRole('button', { name: /Galán\/Chingotto/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tapia\/Coello/ })).toBeTruthy()
  })

  it('calls onVote with the chosen pair', () => {
    const onVote = vi.fn()
    wrap(<MatchVoteCard pair1Label="A/B" pair2Label="C/D"
      yourPick={null} aggregate={null} locked={false} onVote={onVote} />)
    fireEvent.click(screen.getByRole('button', { name: /C\/D/ }))
    expect(onVote).toHaveBeenCalledWith(2)
  })

  it('reveals the community split after voting', () => {
    wrap(<MatchVoteCard pair1Label="A/B" pair2Label="C/D"
      yourPick={1} aggregate={{ pair1: 68, pair2: 32, total: 100 }} locked={false} onVote={() => {}} />)
    expect(screen.getByText('68%')).toBeTruthy()
    expect(screen.getByText('32%')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/prediction/__tests__/MatchVoteCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// src/components/prediction/MatchVoteCard.tsx
'use client'
import { useTranslations } from 'next-intl'

const GREEN = '#7ED321'
const FAN_BLUE = '#3aa0ff'
const CHUNKY = 'polygon(1% 5%, 99% 0%, 100% 95%, 0% 100%)'

interface Props {
  pair1Label: string
  pair2Label: string
  yourPick: 1 | 2 | null
  aggregate: { pair1: number; pair2: number; total: number } | null
  locked: boolean
  onVote: (pair: 1 | 2) => void
}

export function MatchVoteCard({ pair1Label, pair2Label, yourPick, aggregate, locked, onVote }: Props) {
  const t = useTranslations('prediction')
  const revealed = yourPick != null && aggregate != null
  const pct = (n: number) => (aggregate && aggregate.total > 0 ? Math.round((n / aggregate.total) * 100) : 0)

  return (
    <div style={{ background: '#141414', padding: '14px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{t('whoWillWin')}</div>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 11 }}>
        {aggregate && aggregate.total > 0 ? t('fansVoted', { count: aggregate.total }) : t('castVote')}
      </div>

      {!revealed && (
        <div style={{ display: 'flex', gap: 8 }}>
          {([1, 2] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={locked}
              onClick={() => onVote(p)}
              style={{
                flex: 1, border: `1.5px solid ${GREEN}73`, borderRadius: 14, padding: '9px 6px',
                background: yourPick === p ? GREEN : 'rgba(126,211,33,0.04)',
                color: yourPick === p ? '#0a0a0a' : '#fff',
                fontSize: 12, fontWeight: 700, cursor: locked ? 'default' : 'pointer', opacity: locked && yourPick !== p ? 0.5 : 1,
              }}
            >
              {p === 1 ? pair1Label : pair2Label}
            </button>
          ))}
        </div>
      )}

      {revealed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {([1, 2] as const).map((p) => {
            const count = p === 1 ? aggregate!.pair1 : aggregate!.pair2
            const v = pct(count)
            const mine = yourPick === p
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 22, background: '#23262d', borderRadius: 6, overflow: 'hidden', clipPath: CHUNKY }}>
                  <div style={{ height: '100%', width: `${v}%`, background: mine ? `linear-gradient(90deg, ${FAN_BLUE}, #1f7fd6)` : '#2b2f37',
                    display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11, fontWeight: 800, color: mine ? '#fff' : '#9aa' }}>{v}%</div>
                </div>
                <span style={{ width: 88, fontSize: 11, color: mine ? '#fff' : '#9aa', fontWeight: 600 }}>
                  {p === 1 ? pair1Label : pair2Label}{mine ? ` ✓ ${t('yourPick')}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/prediction/__tests__/MatchVoteCard.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/prediction/MatchVoteCard.tsx src/components/prediction/__tests__/MatchVoteCard.test.tsx
git commit -m "feat(vote): MatchVoteCard component"
```

### Task 10: `MatchPredictionVote` wrapper + wire into match page

**Files:**
- Create: `src/components/prediction/MatchPredictionVote.tsx`
- Modify: `src/app/[locale]/match/[id]/page.tsx` (scheduled block ~1015, live block ~1048, finished block ~1073)

- [ ] **Step 1: Write the wrapper**

```tsx
// src/components/prediction/MatchPredictionVote.tsx
'use client'
import type { Match } from '@/types/match'
import { useMatchVote } from '@/hooks/useMatchVote'
import { ModelPredictionBar } from './ModelPredictionBar'
import { MatchVoteCard } from './MatchVoteCard'

/** Combined model prediction bar + fan vote. Lifecycle:
 *  - scheduled: bar (if prediction) + open vote
 *  - live/finished: bar (frozen) + locked vote showing the community split */
export function MatchPredictionVote({ match, pair1Label, pair2Label }: {
  match: Match; pair1Label: string; pair2Label: string
}) {
  const locked = match.status !== 'scheduled'
  const { yourPick, aggregate, vote } = useMatchVote(match.id, locked)
  return (
    <>
      <ModelPredictionBar match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
      <MatchVoteCard
        pair1Label={pair1Label}
        pair2Label={pair2Label}
        yourPick={yourPick}
        aggregate={aggregate}
        locked={locked}
        onVote={vote}
      />
    </>
  )
}
```

- [ ] **Step 2: Add the feature-flag read at the top of `page.tsx`**

Near the other module constants in `src/app/[locale]/match/[id]/page.tsx`, add:

```ts
const MATCH_PREDICTION_ENABLED = process.env.NEXT_PUBLIC_MATCH_PREDICTION_ENABLED === 'true'
```

And add the import alongside the existing `PredictionSection` import:

```ts
import { MatchPredictionVote } from '@/components/prediction/MatchPredictionVote'
```

- [ ] **Step 3: Swap the SCHEDULED prediction block**

In the scheduled IIFE (~line 1021), replace:

```tsx
            {hasPbp && (
              <PredictionSection
                match={match}
                pair1Label={pair1Label}
                pair2Label={pair2Label}
                prediction={prediction}
                predStep={predStep}
                setPredStep={setPredStep}
                setPrediction={setPrediction}
                clearPrediction={clearPrediction}
              />
            )}
```

with:

```tsx
            {MATCH_PREDICTION_ENABLED ? (
              <MatchPredictionVote match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
            ) : (
              hasPbp && (
                <PredictionSection
                  match={match}
                  pair1Label={pair1Label}
                  pair2Label={pair2Label}
                  prediction={prediction}
                  predStep={predStep}
                  setPredStep={setPredStep}
                  setPrediction={setPrediction}
                  clearPrediction={clearPrediction}
                />
              )
            )}
```

- [ ] **Step 4: Swap the LIVE locked block**

Replace the `{isLive && prediction && ( ... )}` block (~line 1048) with:

```tsx
      {isLive && (
        MATCH_PREDICTION_ENABLED
          ? <MatchPredictionVote match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
          : (prediction && (
            <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, clipPath: CHUNKY.card }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(126,211,33,0.5)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>
                  {tPred('yourPrediction')}
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>
                  {tPred('win', { pair: prediction.pair === 1 ? pair1Label : pair2Label, margin: prediction.margin })}
                </div>
                <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{tPred('locked')}</div>
              </div>
            </div>
          ))
      )}
```

- [ ] **Step 5: Swap the FINISHED result block**

Replace `{isFinished && prediction && ( <PredictionResult ... /> )}` (~line 1073) with:

```tsx
      {isFinished && (
        MATCH_PREDICTION_ENABLED
          ? <MatchPredictionVote match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
          : (prediction && <PredictionResult match={match} prediction={prediction} pair1Label={pair1Label} pair2Label={pair2Label} />)
      )}
```

- [ ] **Step 6: Typecheck + run existing match-page-adjacent tests**

Run: `npx tsc --noEmit && npx vitest run src/lib/__tests__/match-prediction.test.ts src/components/prediction/__tests__/MatchVoteCard.test.tsx`
Expected: no type errors; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/prediction/MatchPredictionVote.tsx "src/app/[locale]/match/[id]/page.tsx"
git commit -m "feat(prediction): wire MatchPredictionVote into match page behind flag"
```

---

## Phase D — Match card favorite tag

### Task 11: Inline favorite tag + tap-to-explain popover in `MatchCard`

**Files:**
- Modify: `src/components/MatchCard.tsx` (favored pair row ~line 689; add a `PredictionFavTag` subcomponent near `LateHintPill`)
- Test: `src/components/__tests__/MatchCardPredictionTag.test.tsx`

The tag renders on the favored pair's row when `getMatchPrediction(match)` is non-null AND the flag is on. Tapping toggles a chunky popover, mirroring `LateHintPill`'s interaction (preventDefault/stopPropagation, dismiss on outside-tap/Escape/4.5s).

- [ ] **Step 1: Write the failing test for the pure tag-visibility decision**

Add an exported helper so the gating is unit-testable without rendering the whole card.

```tsx
// src/components/__tests__/MatchCardPredictionTag.test.tsx
import { describe, it, expect } from 'vitest'
import { shouldShowFavTag } from '@/components/MatchCard'
import type { Match } from '@/types/match'

const m = (pred: number | null, status = 'scheduled') =>
  ({ id: 'x', status, pred_pair1_prob: pred } as unknown as Match)

describe('shouldShowFavTag', () => {
  it('shows on the favored pair only', () => {
    expect(shouldShowFavTag(m(0.62), 1, true)).toBe(true)   // pair 1 favored
    expect(shouldShowFavTag(m(0.62), 2, true)).toBe(false)
    expect(shouldShowFavTag(m(0.36), 2, true)).toBe(true)   // pair 2 favored
    expect(shouldShowFavTag(m(0.36), 1, true)).toBe(false)
  })
  it('hidden when no prediction or flag off', () => {
    expect(shouldShowFavTag(m(null), 1, true)).toBe(false)
    expect(shouldShowFavTag(m(0.62), 1, false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/__tests__/MatchCardPredictionTag.test.tsx`
Expected: FAIL — `shouldShowFavTag` not exported.

- [ ] **Step 3: Add the gating helper + flag constant to `MatchCard.tsx`**

Near the top constants in `src/components/MatchCard.tsx`:

```ts
import { getMatchPrediction } from '@/lib/match-prediction'

const MATCH_PREDICTION_ENABLED = process.env.NEXT_PUBLIC_MATCH_PREDICTION_ENABLED === 'true'

/** True when the model favorite tag should render on this pair's row. */
export function shouldShowFavTag(match: Match, pairNum: 1 | 2, enabled: boolean): boolean {
  if (!enabled) return false
  const pred = getMatchPrediction(match)
  return pred != null && pred.favored === pairNum
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/__tests__/MatchCardPredictionTag.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Render the tag on the favored pair row**

In the pair-row map (after the `{isWinner && isFinished && ( ...W badge... )}` block, ~line 695), add:

```tsx
                    {shouldShowFavTag(match, pairNum as 1 | 2, MATCH_PREDICTION_ENABLED) && (
                      <PredictionFavTag match={match} pairLabel={pair} />
                    )}
```

- [ ] **Step 6: Add the `PredictionFavTag` subcomponent (mirror `LateHintPill`)**

At the bottom of `MatchCard.tsx`, next to `LateHintPill`:

```tsx
function PredictionFavTag({ match, pairLabel }: { match: Match; pairLabel: string }) {
  const tMatch = useTranslations('match')
  const [open, setOpen] = useState(false)
  const pred = getMatchPrediction(match)
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (dismissRef.current) clearTimeout(dismissRef.current) }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!pred) return null

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    setOpen((o) => !o)
    if (dismissRef.current) clearTimeout(dismissRef.current)
    if (!open) dismissRef.current = setTimeout(() => setOpen(false), 4500)
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={tMatch('predictionTag.aria', { pct: pred.pct })}
        aria-expanded={open}
        style={{
          flexShrink: 0, fontSize: 8, fontWeight: 800, letterSpacing: 0.4, fontVariantNumeric: 'tabular-nums',
          color: open ? '#0a0a0a' : GREEN, background: open ? GREEN : 'rgba(126,211,33,0.15)',
          boxShadow: 'inset 0 0 0 1px rgba(126,211,33,0.30)', padding: '2px 6px',
          clipPath: CHUNKY.badge, lineHeight: 1.1, cursor: 'pointer', border: 0,
        }}
      >
        🥑 {pred.pct}%
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
          style={{
            position: 'absolute', left: '50%', bottom: 8, transform: 'translateX(-50%)', zIndex: 4,
            maxWidth: 260, width: 'calc(100% - 24px)', padding: '10px 12px 10px 14px',
            background: 'linear-gradient(135deg, #1A1A1D 0%, #131316 100%)', clipPath: CHUNKY.badge,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.08)',
            cursor: 'pointer', animation: 'mc-locked-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
            display: 'flex', alignItems: 'flex-start', gap: 8,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 1, fontSize: 14 }}>🥑</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: GREEN, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 }}>
              {tMatch('predictionTag.header')}
            </div>
            <div style={{ color: '#D8D8DD', fontSize: 11, fontWeight: 500, lineHeight: 1.4 }}>
              {tMatch('predictionTag.body', { pair: pairLabel, pct: pred.pct })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

(The card body already has `position: relative` and `overflow: hidden`, and `mc-locked-pop` is defined in `PULSE_KEYFRAMES`, so the popover positions and animates correctly. The "How we predict →" affordance is implicit: tapping anywhere else on the card navigates to `/match/<id>` where the full bar lives — no extra link needed.)

- [ ] **Step 7: Typecheck + run card test**

Run: `npx tsc --noEmit && npx vitest run src/components/__tests__/MatchCardPredictionTag.test.tsx`
Expected: no type errors; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/MatchCard.tsx src/components/__tests__/MatchCardPredictionTag.test.tsx
git commit -m "feat(prediction): match card favorite tag + tap-to-explain popover"
```

---

## Phase E — i18n, flag, verification

### Task 12: i18n keys (5 locales)

**Files:**
- Modify: `src/messages/en.json`, `es.json`, `pt.json`, `it.json`, `fr.json`

- [ ] **Step 1: Add keys under the existing `prediction` namespace (en.json)**

Add to the `prediction` object in `src/messages/en.json`:

```json
"modelTitle": "PadelNacho Prediction",
"whoWillWin": "Who will win?",
"castVote": "Cast your vote",
"fansVoted": "{count} fans voted",
"yourPick": "you",
"beFirst": "Be the first to vote"
```

And under the existing `match` namespace, add:

```json
"predictionTag": {
  "aria": "Model prediction: favorite has a {pct}% win chance",
  "header": "Our prediction",
  "body": "{pair} has a {pct}% win chance from our Elo model. Not betting odds."
}
```

- [ ] **Step 2: Translate into es/pt/it/fr**

Mirror the same keys with translations. Example for `pt.json` (`prediction` + `match.predictionTag`):

```json
"modelTitle": "Previsão PadelNacho",
"whoWillWin": "Quem vai ganhar?",
"castVote": "Vota agora",
"fansVoted": "{count} fãs votaram",
"yourPick": "tu",
"beFirst": "Sê o primeiro a votar"
```
```json
"predictionTag": {
  "aria": "Previsão do modelo: o favorito tem {pct}% de hipóteses de ganhar",
  "header": "A nossa previsão",
  "body": "{pair} tem {pct}% de hipóteses de ganhar segundo o nosso modelo Elo. Não são odds de apostas."
}
```
(Provide es/it/fr equivalents in the same shape. Keep `{count}`, `{pair}`, `{pct}` placeholders intact.)

- [ ] **Step 3: Verify all 5 files parse + have matching keys**

Run: `node -e "['en','es','pt','it','fr'].forEach(l=>{const m=require('./src/messages/'+l+'.json'); if(!m.prediction?.modelTitle||!m.match?.predictionTag?.body) throw new Error('missing keys in '+l)}); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add src/messages/*.json
git commit -m "feat(prediction): i18n keys for prediction bar, vote, and card tag"
```

### Task 13: Enable the flag locally + manual verification

**Files:**
- Modify: `.env.local` (local only; not committed)

- [ ] **Step 1: Enable the flag**

Add to `.env.local`: `NEXT_PUBLIC_MATCH_PREDICTION_ENABLED=true`
Restart the dev server (`npm run dev`, port 3002).

- [ ] **Step 2: Verify on a scheduled match with a prediction (running app)**

Use the preview workflow. Navigate to a scheduled Premier match detail page that has `pred_pair1_prob` set (find one: `psql "$DATABASE_URL" -c "select id from matches where status='scheduled' and pred_pair1_prob is not null limit 1;"`).
- Confirm the lime "PadelNacho Prediction" bar shows the right %.
- Tap a pair in "Who will win?" → community split reveals with "✓ you".
- Reload → your pick persists; aggregate shown.
- On a match list (home/matches), confirm the `🥑 %` tag appears on the favored pair of predicted matches, and that matches WITHOUT a prediction look unchanged (no tag, no gap). Tap the tag → popover explains; tapping elsewhere navigates to the match.

- [ ] **Step 3: Verify graceful degradation + lock**

- Open a match with no `pred_pair1_prob`: model bar absent, vote still works.
- Open a live/finished match: vote buttons locked; if you voted earlier the split shows; `POST /api/match-vote` to that id returns 409.

- [ ] **Step 4: Run the full new-code test suite + lint**

Run: `npx vitest run src/lib/__tests__/match-prediction.test.ts src/components/prediction/__tests__/MatchVoteCard.test.tsx src/components/__tests__/MatchCardPredictionTag.test.tsx && npm run lint`
Expected: all PASS; lint clean.

- [ ] **Step 5: Commit any fixes found during verification**

```bash
git add -A
git commit -m "fix(prediction): address issues found during manual verification"
```

---

## Self-review notes

- **Spec coverage:** read-path (Tasks 1–4), detail widget Layout A (Tasks 8–10), vote storage + identity + lock (Tasks 5–7), card tag + popover (Task 11), framing/no-odds copy (Task 12), hide Guacas via flag swap (Task 10), graceful degradation (Tasks 9/11 + verify 13). Live in-play odds explicitly out of scope — not touched.
- **Guacas retention:** code for `PredictionPanel`/`PredictionFlow`/`/picks` is untouched; the flag simply renders the new widget instead. Flip the flag off to restore Guacas instantly.
- **Type consistency:** `getMatchPrediction` returns `{ favored, pct, pair1Prob }` and is consumed identically in `ModelPredictionBar`, `shouldShowFavTag`, and `PredictionFavTag`. Vote shape `{ pair1, pair2, total }` is identical across route, hook, and `MatchVoteCard`.
- **Open follow-ups (not v1):** guest→login vote merge; staleness filter on `pred_computed_at`; per-card community counts.
