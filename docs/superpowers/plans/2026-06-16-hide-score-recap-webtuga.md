# Hide Score Recap for webtuga matches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the match-detail page, hide the "Score Recap" tab for webtuga-sourced matches (their recap is a breaks-only view built from a best-effort point log, not real Crionet stats).

**Architecture:** A match is webtuga-sourced iff it has an `entity_external_ids (entity_type='match', source='webtuga')` row. Because that table is anon-RLS-locked, the flag is produced server-side: `/api/match-stats` returns a new `webtugaSourced` boolean. The match page fetches that once for finished matches, uses it to drop the Score Recap tab + fix the default landing tab, and passes the already-fetched payload into `MatchStatsView` (new `preloaded` prop) so there's no double fetch.

**Tech Stack:** Next.js 16 (App Router, React 19), TypeScript, Supabase JS, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-hide-score-recap-webtuga-design.md`

All paths are relative to the repo root (`.claude/worktrees/recap-hide`). Run all commands from the repo root. Tests use Vitest (`npx vitest run <path>`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/webtuga-source.ts` | NEW. Pure-ish `isMatchWebtugaSourced(supabase, matchId)` — the single source of the "is this match webtuga-fed" check. |
| `src/lib/__tests__/webtuga-source.test.ts` | NEW. Unit test with a fake supabase. |
| `src/app/api/match-stats/route.ts` | MODIFY. Add `webtugaSourced` to every response branch via the helper. |
| `src/app/[locale]/match/[id]/recap-visibility.ts` | NEW. Pure `shouldShowRecap` + `defaultFinishedTab` decision helpers. |
| `src/app/[locale]/match/[id]/__tests__/recap-visibility.test.ts` | NEW. Unit tests for the two helpers. |
| `src/components/MatchStatsView.tsx` | MODIFY. Export `MatchStatsResponse`; add optional `preloaded` prop (parent-owned fetch); add `webtugaSourced` to the response type. |
| `src/app/[locale]/match/[id]/page.tsx` | MODIFY. Fetch match-stats when finished; gate `showRecap` + default tab via the helpers; pass `preloaded` to `MatchStatsView`. |

---

## Task 1: `isMatchWebtugaSourced` helper

**Files:**
- Create: `src/lib/webtuga-source.ts`
- Test: `src/lib/__tests__/webtuga-source.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/webtuga-source.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { isMatchWebtugaSourced } from '../webtuga-source'

/** Minimal supabase stub: from().select().eq().eq().eq().maybeSingle() */
function fakeSupabase(row: unknown) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  }
  return { from: vi.fn(() => chain) } as any
}

describe('isMatchWebtugaSourced', () => {
  it('returns true when a webtuga external-id row exists', async () => {
    const out = await isMatchWebtugaSourced(fakeSupabase({ entity_id: 'm1' }), 'm1')
    expect(out).toBe(true)
  })

  it('returns false when there is no webtuga row', async () => {
    const out = await isMatchWebtugaSourced(fakeSupabase(null), 'm1')
    expect(out).toBe(false)
  })

  it('returns false (never throws) on a query error', async () => {
    const supabase: any = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }) }),
        }),
      }),
    }
    const out = await isMatchWebtugaSourced(supabase, 'm1')
    expect(out).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/webtuga-source.test.ts`
Expected: FAIL — `Cannot find module '../webtuga-source'`.

- [ ] **Step 3: Write the helper**

Create `src/lib/webtuga-source.ts`:

```typescript
// Single source of the "is this match fed by the webtuga live worker" check.
// A match is webtuga-sourced iff it has an entity_external_ids row with
// (entity_type='match', source='webtuga') — written by padelgod's
// webtuga-live-fetcher on resolve. Used to hide the Score Recap for these
// matches (their recap would be a breaks-only view from a best-effort point
// log, not real Crionet stats). Server-side only: entity_external_ids is
// anon-RLS-locked, so this must run with the service-role client.
import type { SupabaseClient } from '@supabase/supabase-js'

export async function isMatchWebtugaSourced(
  supabase: SupabaseClient,
  matchId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', 'match')
    .eq('source', 'webtuga')
    .eq('entity_id', matchId)
    .maybeSingle()
  if (error) return false
  return !!data
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/webtuga-source.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/webtuga-source.ts src/lib/__tests__/webtuga-source.test.ts
git commit -m "feat(match): isMatchWebtugaSourced helper"
```

---

## Task 2: expose `webtugaSourced` from `/api/match-stats`

**Files:**
- Modify: `src/app/api/match-stats/route.ts`

The route currently returns `{ stats, status }` in three branches (`upcoming` / `ok` / `unavailable`). Add `webtugaSourced` to all three, computed once after the match is confirmed to exist. (No unit test here — the testable logic lives in Task 1's helper; this is mechanical wiring, verified by `tsc` + the manual curl in Task 6. The module-level service-role client makes a route-level test low-value and high-friction.)

- [ ] **Step 1: Add the import**

At the top of `src/app/api/match-stats/route.ts`, after the existing `import { createClient } from '@supabase/supabase-js'`:

```typescript
import { isMatchWebtugaSourced } from '@/lib/webtuga-source'
```

- [ ] **Step 2: Compute the flag once, after the match-exists check**

In `src/app/api/match-stats/route.ts`, immediately after the `if (!match) { return Response.json({ error: 'Match not found' }, { status: 404 }) }` block, add:

```typescript
  const webtugaSourced = await isMatchWebtugaSourced(supabase, matchId)
```

- [ ] **Step 3: Include `webtugaSourced` in all three response bodies**

Update the three `Response.json(...)` payloads:

`upcoming` branch:
```typescript
    return Response.json(
      { stats: null, status: 'upcoming' as StatsStatus, webtugaSourced },
      { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
    )
```

`ok` branch:
```typescript
    return Response.json(
      { stats, status: 'ok' as StatsStatus, webtugaSourced },
      { headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=600' } },
    )
```

`unavailable` branch (the final return):
```typescript
  return Response.json(
    { stats: null, status: 'unavailable' as StatsStatus, webtugaSourced },
    { headers: { 'cache-control': 'public, max-age=30, stale-while-revalidate=300' } },
  )
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "match-stats/route|webtuga-source" || echo "clean"`
Expected: `clean` (no errors for the touched files).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/match-stats/route.ts
git commit -m "feat(match): return webtugaSourced from /api/match-stats"
```

---

## Task 3: pure recap-visibility helpers

**Files:**
- Create: `src/app/[locale]/match/[id]/recap-visibility.ts`
- Test: `src/app/[locale]/match/[id]/__tests__/recap-visibility.test.ts`

Extract the two boolean decisions so they're unit-testable instead of buried in the page's render closure.

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/match/[id]/__tests__/recap-visibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { shouldShowRecap, defaultFinishedTab } from '../recap-visibility'

describe('shouldShowRecap', () => {
  it('shows for a Premier match with no breaks', () => {
    expect(shouldShowRecap({ isPremier: true, hasBreaks: false, webtugaSourced: false })).toBe(true)
  })
  it('shows for a non-Premier match that has break data', () => {
    expect(shouldShowRecap({ isPremier: false, hasBreaks: true, webtugaSourced: false })).toBe(true)
  })
  it('HIDES for a webtuga-sourced match even though it is Premier-classified', () => {
    expect(shouldShowRecap({ isPremier: true, hasBreaks: true, webtugaSourced: true })).toBe(false)
  })
  it('hides for a non-Premier match with no breaks', () => {
    expect(shouldShowRecap({ isPremier: false, hasBreaks: false, webtugaSourced: false })).toBe(false)
  })
})

describe('defaultFinishedTab', () => {
  it('lands on recap for a Premier non-webtuga match', () => {
    expect(defaultFinishedTab({ isPremier: true, webtugaSourced: false })).toBe('recap')
  })
  it('lands on players for a webtuga match (recap is hidden)', () => {
    expect(defaultFinishedTab({ isPremier: true, webtugaSourced: true })).toBe('players')
  })
  it('lands on players for a non-Premier match', () => {
    expect(defaultFinishedTab({ isPremier: false, webtugaSourced: false })).toBe('players')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/[locale]/match/[id]/__tests__/recap-visibility.test.ts"`
Expected: FAIL — `Cannot find module '../recap-visibility'`.

- [ ] **Step 3: Write the helpers**

Create `src/app/[locale]/match/[id]/recap-visibility.ts`:

```typescript
// Pure decisions for the match-detail Score Recap tab. The Score Recap shows
// Crionet stats (or a breaks-only fallback). For webtuga-sourced matches the
// breaks are computed from a best-effort point log, so we hide the recap
// entirely — see docs/superpowers/specs/2026-06-16-hide-score-recap-webtuga-design.md.

export function shouldShowRecap(opts: {
  isPremier: boolean
  hasBreaks: boolean
  webtugaSourced: boolean
}): boolean {
  if (opts.webtugaSourced) return false
  return opts.isPremier || opts.hasBreaks
}

/** The tab a finished match should land on by default. */
export function defaultFinishedTab(opts: {
  isPremier: boolean
  webtugaSourced: boolean
}): 'recap' | 'players' {
  return opts.isPremier && !opts.webtugaSourced ? 'recap' : 'players'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/[locale]/match/[id]/__tests__/recap-visibility.test.ts"`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/match/[id]/recap-visibility.ts" "src/app/[locale]/match/[id]/__tests__/recap-visibility.test.ts"
git commit -m "feat(match): pure recap-visibility helpers"
```

---

## Task 4: `MatchStatsView` — `preloaded` prop + exported type

**Files:**
- Modify: `src/components/MatchStatsView.tsx`

Let the parent own the `/api/match-stats` fetch and inject the result, so the page's fetch isn't duplicated. When `preloaded` is omitted (`undefined`), behave exactly as today (self-fetch) for back-compat.

- [ ] **Step 1: Export the response type + add `webtugaSourced`**

In `src/components/MatchStatsView.tsx`, replace the existing `interface ApiResponse { … }` (around line 27) with an exported, extended type:

```typescript
export interface MatchStatsResponse {
  stats: MatchStatsRow[] | null
  status: StatsStatus
  webtugaSourced?: boolean
}
```

Then replace every other reference to `ApiResponse` in this file with `MatchStatsResponse` (the `useState<ApiResponse | null>` and the `as ApiResponse` cast inside the fetch).

- [ ] **Step 2: Add the `preloaded` prop + skip the fetch when the parent owns it**

Change the component signature and the fetch effect. Replace:

```typescript
export function MatchStatsView({ matchId, breaks }: { matchId: string; breaks?: BreakStats }) {
  const t = useTranslations('matchDetail.stats')
  const [response, setResponse] = useState<MatchStatsResponse | null>(null)
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
        return (await r.json()) as MatchStatsResponse
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
    return () => {
      cancelled = true
    }
  }, [matchId])
```

with:

```typescript
export function MatchStatsView({
  matchId,
  breaks,
  preloaded,
}: {
  matchId: string
  breaks?: BreakStats
  /** When provided (even as null=loading), the parent owns the fetch and this
   *  component renders from it instead of fetching itself. Omit for self-fetch. */
  preloaded?: MatchStatsResponse | null
}) {
  const t = useTranslations('matchDetail.stats')
  const parentOwnsFetch = preloaded !== undefined
  const [response, setResponse] = useState<MatchStatsResponse | null>(preloaded ?? null)
  const [loading, setLoading] = useState(!parentOwnsFetch)
  const [error, setError] = useState<string | null>(null)
  const [activeSet, setActiveSet] = useState(0)

  // Parent-owned mode: mirror the prop into render state, never self-fetch.
  useEffect(() => {
    if (!parentOwnsFetch) return
    setResponse(preloaded ?? null)
    setLoading(preloaded == null)
  }, [parentOwnsFetch, preloaded])

  // Self-fetch mode (back-compat for callers that don't pass `preloaded`).
  useEffect(() => {
    if (parentOwnsFetch) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/match-stats?matchId=${matchId}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return (await r.json()) as MatchStatsResponse
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
    return () => {
      cancelled = true
    }
  }, [matchId, parentOwnsFetch])
```

(The rest of the component body — `if (loading) …`, the `noPremierStats` branch, etc. — is unchanged.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "MatchStatsView" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add src/components/MatchStatsView.tsx
git commit -m "feat(match): MatchStatsView preloaded prop + exported response type"
```

---

## Task 5: wire the match page

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

Fetch match-stats when finished, store it, and use `webtugaSourced` to gate the recap tab + default tab via the Task 3 helpers; pass the payload to `MatchStatsView`.

- [ ] **Step 1: Add imports**

Near the existing `import { MatchStatsView } from '@/components/MatchStatsView'` (line ~19), add the exported type:

```typescript
import { MatchStatsView, type MatchStatsResponse } from '@/components/MatchStatsView'
```

And near the `import { isPremierLevel } from '@/lib/tournament-labels'` (line ~25):

```typescript
import { shouldShowRecap, defaultFinishedTab } from './recap-visibility'
```

- [ ] **Step 2: Add state for the fetched match-stats**

Find the component's other `useState` declarations (near the top of the component, e.g. alongside `const [subTab, setSubTab] = useState(...)`). Add:

```typescript
  const [matchStats, setMatchStats] = useState<MatchStatsResponse | null>(null)
  const webtugaSourced = matchStats?.webtugaSourced ?? false
```

- [ ] **Step 3: Fetch match-stats once when the match is finished**

Add a new effect (place it next to the other match-driven effects, e.g. just after the `useEffect(() => { if (match && match.status === 'finished' && (match as any).winner_pair) fetchNextMatch(match) }, …)` block around line 241):

```typescript
  // Eagerly fetch match-stats for finished matches: powers both the
  // Score Recap content (passed to MatchStatsView) and the webtugaSourced
  // flag that decides whether the recap tab shows at all.
  useEffect(() => {
    if (match?.status !== 'finished') { setMatchStats(null); return }
    let cancelled = false
    fetch(`/api/match-stats?matchId=${id}`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: MatchStatsResponse | null) => { if (!cancelled) setMatchStats(data) })
      .catch(() => { if (!cancelled) setMatchStats(null) })
    return () => { cancelled = true }
  }, [id, match?.status])
```

> Note: `id` is the route param already in scope on this page (used by the realtime subscriptions, e.g. `filter: \`id=eq.${id}\``). Use it as-is.

- [ ] **Step 4: Gate the default landing tab (line ~259)**

Replace:

```typescript
    if (match?.status === 'finished') setSubTab(isPremier ? 'recap' : 'players')
```

with:

```typescript
    if (match?.status === 'finished') setSubTab(defaultFinishedTab({ isPremier, webtugaSourced }))
```

Then add `webtugaSourced` to that effect's dependency array so the landing tab is re-evaluated once the flag loads. Change the deps line (around line 266) from:

```typescript
  }, [match?.status, (match as any)?.tournament?.level])
```

to:

```typescript
  }, [match?.status, (match as any)?.tournament?.level, webtugaSourced])
```

- [ ] **Step 5: Gate the recap tab (line ~1172)**

Replace:

```typescript
        const showRecap = isPremier || breaks.hasData
```

with:

```typescript
        const showRecap = shouldShowRecap({ isPremier, hasBreaks: breaks.hasData, webtugaSourced })
```

- [ ] **Step 6: Pass the payload into `MatchStatsView` (line ~1204)**

Replace:

```typescript
                  <MatchStatsView matchId={match.id} breaks={breaks} />
```

with:

```typescript
                  <MatchStatsView matchId={match.id} breaks={breaks} preloaded={matchStats} />
```

- [ ] **Step 7: Typecheck + run the existing match tests**

Run: `npx tsc --noEmit 2>&1 | grep -E "match/\[id\]/page" || echo "clean"`
Expected: `clean`.

Run: `npx vitest run "src/app/[locale]/match/[id]/__tests__/recap-visibility.test.ts" src/lib/__tests__/webtuga-source.test.ts`
Expected: PASS (10 tests total).

- [ ] **Step 8: Commit**

```bash
git add "src/app/[locale]/match/[id]/page.tsx"
git commit -m "feat(match): hide Score Recap tab for webtuga-sourced matches"
```

---

## Task 6: build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Production build (catches RSC/type issues the unit tests miss)**

Run: `npm run build`
Expected: build succeeds with no errors in `src/app/[locale]/match/[id]/page.tsx`, `src/components/MatchStatsView.tsx`, or `src/app/api/match-stats/route.ts`.

- [ ] **Step 2: Verify the API flag against real data (dev server)**

Start the dev server (`npm run dev`), then with a known **webtuga** match id (a finished Lusitania Q2 match — find one via:
`select m.id from matches m join entity_external_ids e on e.entity_id=m.id and e.source='webtuga' where m.status='finished' limit 1;`):

```bash
curl -s "http://localhost:3002/api/match-stats?matchId=<WEBTUGA_FINISHED_MATCH_ID>" | grep -o '"webtugaSourced":[a-z]*'
# expect: "webtugaSourced":true
curl -s "http://localhost:3002/api/match-stats?matchId=<PREMIER_FINISHED_MATCH_ID>" | grep -o '"webtugaSourced":[a-z]*'
# expect: "webtugaSourced":false
```

- [ ] **Step 3: Visual check**

- Open a **finished webtuga** Lusitania Q2 match detail → **no "Score Recap" tab**, lands on **Players**; **Live Feed** + Match Journey still present.
- Open a **finished Premier** match → **Score Recap unchanged** (tab present, lands on recap, stats render).

- [ ] **Step 4: Final commit (if any verification tweaks were needed)**

```bash
git add -A && git commit -m "chore(match): verification tweaks for recap hiding" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Detect via `entity_external_ids source='webtuga'` server-side → Task 1 + Task 2. ✔
- `webtugaSourced` on `/api/match-stats` (all branches) → Task 2. ✔
- `showRecap = (isPremier || breaks.hasData) && !webtugaSourced` → Task 3 (`shouldShowRecap`) + Task 5 Step 5. ✔
- Default tab fixed so finished webtuga lands on a real tab → Task 3 (`defaultFinishedTab`) + Task 5 Step 4. ✔
- No double fetch — `preloaded` prop → Task 4 + Task 5 Step 6. ✔
- No RLS change → only server-side read via service-role client (Task 1/2). ✔
- Live score / Live Feed / momentum unchanged → untouched (only `showRecap`, default tab, and `MatchStatsView` fetch ownership change). ✔
- Accepted trade-offs (eager fetch on finished; brief flag-load window) → documented in spec; the default-tab dep on `webtugaSourced` (Task 5 Step 4) re-corrects the landing tab once the flag loads. ✔

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `MatchStatsResponse` is defined+exported in Task 4 and imported in Task 5. `shouldShowRecap`/`defaultFinishedTab` signatures match between Task 3 (definition/tests) and Task 5 (call sites). `isMatchWebtugaSourced(supabase, matchId)` matches between Task 1 and Task 2.

**Open note for the implementer:** Task 5 Step 2/3 reference `id` and the component's `useState` block by description (the page is ~1200 lines). Confirm `id` is the in-scope route param (it is — used by the realtime `filter` strings) and place the new `useState`/`useEffect` among the existing ones; don't introduce a second source of truth for match-stats.
