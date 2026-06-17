# In-page Projection Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tournament-page Projection tab an instant in-page client switch (like Resumen/Historia/Partidos/Cuadro) instead of a full route navigation, while keeping `?tab`/`?pair` deep-links and the SEO route.

**Architecture:** Render `<ProjectionTab>` inline in `page.tsx` as a `pageTab === 'projection'` panel. Pair selection syncs into the URL shallowly (`?tab=projection&category=&pair=<slug>`) via a pure query-builder helper. Slug↔pairKey mapping lives inside `ProjectionTab` (the only component with the rows) behind two new optional props; the existing `initialPairKey`/`onPairChange` contract used by the SEO route's `ProjectionRouteClient` is untouched.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, next-intl, Vitest (+ jsdom + @testing-library/react), Supabase. Reuses `src/lib/projection-slug.ts` (`buildSlugIndex`, `resolvePairSlug`, `pairSlugFromNames`).

**Spec:** `docs/superpowers/specs/2026-06-17-projection-inpage-tab-design.md`

**Branch:** `feat/projection-inpage-tab` (worktree `.claude/worktrees/main-latest`)

**Run all commands from the worktree root:** `/Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/main-latest`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts` | Pure builder for the in-page projection query string | **Create** |
| `src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts` | Unit tests for the builder | **Create** |
| `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` | Add `initialPairSlug` + `onPairSlugChange` props; internal slug index | **Modify** |
| `src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx` | jsdom RTL test for slug resolution + emission | **Create** |
| `src/app/[locale]/(app)/tournaments/[id]/page.tsx` | Render panel in-page; tab handler → state; URL sync; init from `?tab`/`?category`/`?pair`; remove legacy redirect | **Modify** |

---

## Task 1: Pure projection query-string builder

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts`
- Test: `src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildProjectionQuery } from '../projection-url'

describe('buildProjectionQuery', () => {
  it('builds a tab+category query with no pair', () => {
    expect(buildProjectionQuery('men', null)).toBe('?tab=projection&category=men')
  })

  it('builds a tab+category query for women', () => {
    expect(buildProjectionQuery('women', null)).toBe('?tab=projection&category=women')
  })

  it('appends the pair slug when present', () => {
    expect(buildProjectionQuery('men', 'arce-tello')).toBe('?tab=projection&category=men&pair=arce-tello')
  })

  it('omits the pair param when slug is empty string', () => {
    expect(buildProjectionQuery('men', '')).toBe('?tab=projection&category=men')
  })

  it('url-encodes a slug with unusual characters', () => {
    expect(buildProjectionQuery('men', 'a b')).toBe('?tab=projection&category=men&pair=a%20b')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts"`
Expected: FAIL — `Failed to resolve import "../projection-url"` / `buildProjectionQuery is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/[locale]/(app)/tournaments/[id]/projection-url.ts`:

```ts
// Pure builder for the in-page Projection tab query string. Used by the
// tournament page to shallow-sync the active projection view into the URL
// (?tab=projection&category=<cat>[&pair=<slug>]) so it's deep-linkable
// without a route navigation.

export function buildProjectionQuery(
  category: 'men' | 'women',
  pairSlug: string | null,
): string {
  const params = new URLSearchParams()
  params.set('tab', 'projection')
  params.set('category', category)
  if (pairSlug) params.set('pair', pairSlug)
  return `?${params.toString()}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts"`
Expected: PASS (5 tests).

Note: `URLSearchParams` encodes a space as `+`, NOT `%20`. If the "a b" test fails with `pair=a+b`, change the implementation to encode manually:

```ts
export function buildProjectionQuery(
  category: 'men' | 'women',
  pairSlug: string | null,
): string {
  const base = `?tab=projection&category=${category}`
  return pairSlug ? `${base}&pair=${encodeURIComponent(pairSlug)}` : base
}
```

Re-run until PASS. (Slugs are `[a-z0-9-]` in practice, so either form works for real data; the encoding test just pins behavior.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/projection-url.ts" "src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts"
git commit -m "feat(projection): pure query-string builder for in-page tab URL sync"
```

---

## Task 2: Add slug-sync props to ProjectionTab

`ProjectionTab` is the only component with the projection `rows`, so slug↔pairKey
resolution must live here. Add two **optional** props; when omitted, behavior is
identical to today (the SEO route's `ProjectionRouteClient` keeps using
`initialPairKey`/`onPairChange`).

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`
- Test: `src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

// --- Fixed projection rows: two pairs with known player ids/names ---
// pairKeyFor sorts ids; ids chosen so canonical order is a-id < b-id.
const ROWS = [
  {
    tournament_id: 't1', category: 'men',
    pair_key: 'aaaa::bbbb',
    pair_player_ids: ['aaaa', 'bbbb'],
    tournament_level: 'fip_platinum', status: 'active', eliminated_round: null,
    champion_prob: 0.4, finalist_prob: 0.6, semifinal_prob: 0.8,
    predicted_finish_round: 'F',
    rounds: [], computed_at: '2026-06-17T00:00:00Z',
  },
  {
    tournament_id: 't1', category: 'men',
    pair_key: 'cccc::dddd',
    pair_player_ids: ['cccc', 'dddd'],
    tournament_level: 'fip_platinum', status: 'active', eliminated_round: null,
    champion_prob: 0.2, finalist_prob: 0.3, semifinal_prob: 0.5,
    predicted_finish_round: 'SF',
    rounds: [], computed_at: '2026-06-17T00:00:00Z',
  },
]

// Names → slugs: aaaa=Arce, bbbb=Tello → "arce-tello"; cccc=Lebron, dddd=Galan → "galan-lebron" (surname sort by id)
vi.mock('../useProjection', () => ({
  useProjection: () => ({ rows: ROWS, loading: false, error: false }),
}))
vi.mock('../usePairImages', () => ({
  usePairImages: () => new Map([
    ['aaaa', { name: 'Maxi Arce', country: null, avatarUrl: null, photoUrl: null }],
    ['bbbb', { name: 'Juan Tello', country: null, avatarUrl: null, photoUrl: null }],
    ['cccc', { name: 'Ale Galan', country: null, avatarUrl: null, photoUrl: null }],
    ['dddd', { name: 'Juan Lebron', country: null, avatarUrl: null, photoUrl: null }],
  ]),
}))
vi.mock('@/hooks/useFeatureFlag', () => ({
  useFeatureFlag: () => false,
}))
vi.mock('@/hooks/useProjectionVote', () => ({
  useProjectionVote: () => ({ aggregate: null, yourPick: null, vote: () => {}, loading: false }),
}))
vi.mock('../ChampionSparkline', () => ({ default: () => null }))

import ProjectionTab from '../ProjectionTab'

const messages = { projectionTab: {} as Record<string, string> }
// next-intl: return the key for any missing message instead of throwing.
function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} onError={() => {}} getMessageFallback={({ key }) => key}>
      {ui}
    </NextIntlClientProvider>,
  )
}

afterEach(cleanup)

describe('ProjectionTab slug sync', () => {
  it('resolves initialPairSlug to the matching pair (road view)', async () => {
    wrap(
      <ProjectionTab
        tournamentId="t1"
        matches={[]}
        category="men"
        tournamentLevel="fip_platinum"
        roundSchedule={null}
        initialPairSlug="arce-tello"
      />,
    )
    // The selected pair's surnames render in the road header.
    await waitFor(() => {
      expect(screen.getByText(/Arce/)).toBeTruthy()
      expect(screen.getByText(/Tello/)).toBeTruthy()
    })
  })

  it('emits the canonical slug via onPairSlugChange when a pair is opened', async () => {
    const onSlug = vi.fn()
    wrap(
      <ProjectionTab
        tournamentId="t1"
        matches={[]}
        category="men"
        tournamentLevel="fip_platinum"
        roundSchedule={null}
        initialPairSlug="arce-tello"
        onPairSlugChange={onSlug}
      />,
    )
    // Initial resolution emits the canonical slug for the resolved pair.
    await waitFor(() => {
      expect(onSlug).toHaveBeenCalledWith('arce-tello')
    })
  })

  it('emits null when no pair is selected (list view)', async () => {
    const onSlug = vi.fn()
    wrap(
      <ProjectionTab
        tournamentId="t1"
        matches={[]}
        category="men"
        tournamentLevel="fip_platinum"
        roundSchedule={null}
        initialPairSlug={null}
        onPairSlugChange={onSlug}
      />,
    )
    await waitFor(() => {
      expect(onSlug).toHaveBeenCalledWith(null)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx"`
Expected: FAIL — `initialPairSlug`/`onPairSlugChange` are not recognized props, so no pair resolves: the `getByText(/Arce/)` assertion times out and `onSlug` is never called with `'arce-tello'`.

- [ ] **Step 3: Add the slug-index import**

In `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`, add to the import block (after the `projection-picker` import, near line 14):

```ts
import { buildSlugIndex, resolvePairSlug } from '@/lib/projection-slug'
```

- [ ] **Step 4: Extend the props type + destructure**

Replace the component signature (current lines ~83-98):

```tsx
export default function ProjectionTab({
  tournamentId,
  matches,
  category,
  roundSchedule,
  initialPairKey,
  onPairChange,
}: {
  tournamentId: string
  matches: Match[]
  category: 'men' | 'women'
  tournamentLevel: string | null
  roundSchedule: Record<string, string> | null
  initialPairKey?: string | null
  onPairChange?: (pairKey: string | null) => void
}) {
```

with:

```tsx
export default function ProjectionTab({
  tournamentId,
  matches,
  category,
  roundSchedule,
  initialPairKey,
  onPairChange,
  initialPairSlug = null,
  onPairSlugChange,
}: {
  tournamentId: string
  matches: Match[]
  category: 'men' | 'women'
  tournamentLevel: string | null
  roundSchedule: Record<string, string> | null
  initialPairKey?: string | null
  onPairChange?: (pairKey: string | null) => void
  /** In-page mode: initial pair given as a URL slug (resolved once rows load). */
  initialPairSlug?: string | null
  /** In-page mode: emits the canonical pair slug (or null) on selection change. */
  onPairSlugChange?: (slug: string | null) => void
}) {
```

- [ ] **Step 5: Build the slug index + resolve initial slug**

`enrichedLookup` already exists (built from `matches` + `images`). Immediately AFTER
the `enrichedLookup` declaration (current line ~109), add:

```tsx
  // Slug index for in-page URL sync. Built from the same names the road VM uses,
  // so slugs match the SEO route's pairSlugFromNames output.
  const slugIndex = useMemo(() => {
    const nameById = new Map<string, string>()
    for (const [id, p] of enrichedLookup) nameById.set(id, p.name ?? id)
    return buildSlugIndex(rows, nameById)
  }, [rows, enrichedLookup])
```

Then find the existing `selectedPair` state (current line ~122):

```tsx
  const [selectedPair, setSelectedPair] = useState<string | null>(initialPairKey ?? null)
```

Immediately AFTER it, add a one-shot effect that resolves `initialPairSlug` once
rows/names are available:

```tsx
  // Resolve initialPairSlug → pair once (rows + names load async). Guard so it
  // runs a single time and never overrides a user tap during load.
  const slugResolvedRef = useRef(false)
  useEffect(() => {
    if (slugResolvedRef.current) return
    if (!initialPairSlug) return
    if (rows.length === 0) return
    slugResolvedRef.current = true
    const resolved = resolvePairSlug(slugIndex, initialPairSlug)
    if (resolved) {
      setSelectedPair(resolved.pairKey)
      setView('road')
    }
  }, [initialPairSlug, rows, slugIndex])
```

`useRef` is already imported? Check the import on line 2: `import { useCallback, useEffect, useMemo, useState } from 'react'`. Add `useRef`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
```

- [ ] **Step 6: Emit slug on selection change**

Find the existing effect that notifies the route wrapper (current lines ~125-127):

```tsx
  useEffect(() => {
    onPairChange?.(selectedPair)
  }, [selectedPair, onPairChange])
```

Replace it with one that also emits the slug:

```tsx
  useEffect(() => {
    onPairChange?.(selectedPair)
    onPairSlugChange?.(selectedPair ? (slugIndex.pairKeyToSlug.get(selectedPair) ?? null) : null)
  }, [selectedPair, onPairChange, onPairSlugChange, slugIndex])
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run "src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx"`
Expected: PASS (3 tests).

If `getByText(/Arce/)` fails because the road header shows only the last surname, adjust the assertion to match the rendered format (`pairName` uses last token, so "Arce / Tello" → text "Arce" and "Tello" should both be present as separate nodes; if rendered as a single "Arce / Tello" string, use `screen.getByText(/Arce \/ Tello/)`). Pick whichever matches the actual DOM and keep the test green.

- [ ] **Step 8: Run the full projection test suite (no regressions)**

Run: `npx vitest run src/lib/__tests__/projection-slug.test.ts src/lib/__tests__/projection-view.test.ts "src/app/[locale]/(app)/tournaments/[id]/__tests__/projection-url.test.ts" "src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx"`
Expected: ALL PASS.

- [ ] **Step 9: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx" "src/app/[locale]/(app)/tournaments/[id]/__tests__/ProjectionTab.slug-sync.test.tsx"
git commit -m "feat(projection): add slug-sync props to ProjectionTab for in-page URL deep-links"
```

---

## Task 3: Wire ProjectionTab in-page in the tournament page

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

No new unit test (this is wiring verified by build + manual browser pass in Task 4).

- [ ] **Step 1: Import ProjectionTab and the query builder**

Near the other tab imports (the file imports `DrawTab` around line 36 and `SlidingInkTabs` line 39). Add:

```ts
import ProjectionTab from './ProjectionTab'
import { buildProjectionQuery } from './projection-url'
```

- [ ] **Step 2: Add 'projection' to the initial-tab mapping**

Replace the `pageTab` initializer (current lines ~236-248):

```tsx
  const [pageTab, setPageTabState] = useState<'matches' | 'overview' | 'story' | 'draw' | 'projection'>(
    // Map the legacy `?tab=recap` URL param to the new 'story' tab so old
    // share links and bookmarks keep working.
    wantsMatchesAnimation
      ? 'overview'
      : paramTab === 'draw'
      ? 'draw'
      : paramTab === 'story' || paramTab === 'recap'
      ? 'story'
      : paramTab === 'matches'
      ? 'matches'
      : 'overview'
  )
```

with (adds the `projection` branch):

```tsx
  const [pageTab, setPageTabState] = useState<'matches' | 'overview' | 'story' | 'draw' | 'projection'>(
    // Map the legacy `?tab=recap` URL param to the new 'story' tab so old
    // share links and bookmarks keep working.
    wantsMatchesAnimation
      ? 'overview'
      : paramTab === 'projection'
      ? 'projection'
      : paramTab === 'draw'
      ? 'draw'
      : paramTab === 'story' || paramTab === 'recap'
      ? 'story'
      : paramTab === 'matches'
      ? 'matches'
      : 'overview'
  )
```

- [ ] **Step 3: Read the initial pair slug from the URL**

Immediately after the `pageTab` initializer block, add:

```tsx
  // Initial pair slug for in-page projection deep-links (?pair=<slug>).
  const initialProjectionPairSlug = searchParams.get('pair')
```

- [ ] **Step 4: Remove the legacy projection redirect effect**

Delete this entire effect (current lines ~273-279):

```tsx
  // Legacy ?tab=projection deep links → the dedicated projection route.
  useEffect(() => {
    if (paramTab !== 'projection') return
    markProjectionSeen()
    const cat = searchParams.get('category') === 'women' ? 'women' : 'men'
    router.replace(`/tournaments/${tournamentId}/projection?category=${cat}`)
  }, [paramTab, searchParams, router, tournamentId, markProjectionSeen])
```

(With it gone, `?tab=projection` now mounts the in-page tab via Step 2. Keep
`markProjectionSeen`/`projectionSeen` — still used by the badge + onChange.)

- [ ] **Step 5: Add a shallow URL writer for the selected pair**

Add a callback near `setPageTab` (after its declaration, ~line 256). It writes the
projection query shallowly (no scroll reset). `pathname` is already declared later
in the file (`const pathname = usePathname()` ~line 296) — MOVE that declaration up
to just before this callback if it is currently declared *after* this point, OR
reference it via a fresh `usePathname()` call. To avoid a duplicate-declaration
error, add this callback AFTER the existing `const pathname = usePathname()` line
(~296), not before it:

```tsx
  // Shallow-sync the in-page projection view into the URL so it is deep-linkable
  // without a route navigation (no scroll reset).
  const syncProjectionUrl = useCallback((pairSlug: string | null) => {
    router.replace(`${pathname}${buildProjectionQuery(genderFilter, pairSlug)}`, { scroll: false })
  }, [router, pathname, genderFilter])
```

- [ ] **Step 6: Change the tab onChange to a state flip**

Replace the `SlidingInkTabs` `onChange` (current lines ~1165-1172):

```tsx
          onChange={(key) => {
            if (key === 'projection') {
              markProjectionSeen()
              router.push(`/tournaments/${tournamentId}/projection?category=${genderFilter}`)
              return
            }
            setPageTab(key)
          }}
```

with:

```tsx
          onChange={(key) => {
            if (key === 'projection') {
              markProjectionSeen()
              setPageTab('projection')
              syncProjectionUrl(null)
              return
            }
            // Leaving projection: drop the ?tab/?pair params so the URL is clean.
            if (pageTab === 'projection' && paramTab === 'projection') {
              router.replace(pathname, { scroll: false })
            }
            setPageTab(key)
          }}
```

- [ ] **Step 7: Render the ProjectionTab panel**

After the Draw Tab block (current lines ~1354-1362, the `{pageTab === 'draw' && … <DrawTab … />}` block) and before the closing `</main>`, add:

```tsx
        {/* ── Projection Tab (in-page) ── */}
        {pageTab === 'projection' && activeTournamentObj && showProjectionTab && (
          <ProjectionTab
            tournamentId={tournamentId}
            matches={allMatches.filter(m => (m as any).category === genderFilter)}
            category={genderFilter}
            tournamentLevel={activeTournamentObj.level ?? null}
            roundSchedule={(activeTournamentObj as any).round_schedule ?? null}
            initialPairSlug={paramTab === 'projection' ? initialProjectionPairSlug : null}
            onPairSlugChange={syncProjectionUrl}
          />
        )}
```

- [ ] **Step 8: Typecheck + lint the page**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "tournaments/\[id\]/page\|ProjectionTab\|projection-url" | head`
Expected: no output (no type errors in the touched files).

Run: `node_modules/.bin/eslint "src/app/[locale]/(app)/tournaments/[id]/page.tsx" 2>&1 | grep -E "error" | grep -vE "no-explicit-any|Unexpected any" | head`
Expected: no NEW errors (pre-existing `any` warnings in this file are acceptable; the `(m as any)` casts mirror the existing DrawTab line).

- [ ] **Step 9: Build**

Run: `npm run build 2>&1 | tail -20`
Expected: build succeeds (`✓ Compiled` / no type errors). If the build flags an unused `markProjectionSeen` or `projectionSeen`, confirm they are still referenced by the badge label + onChange (they should be).

- [ ] **Step 10: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/page.tsx"
git commit -m "feat(projection): render Projection tab in-page with shallow URL deep-links"
```

---

## Task 4: Manual browser verification

**Files:** none (verification only).

- [ ] **Step 1: Start the worktree dev server**

The Claude preview tool is rooted at the main repo, and Next 16 Turbopack rejects a
symlinked `node_modules`, so start Next manually pinned to the worktree:

```bash
cat > run-dev.sh <<'EOF'
#!/bin/bash
cd "$(dirname "$0")" || exit 1
echo "next dev cwd: $(pwd)"
exec node node_modules/.bin/next dev -p 3007
EOF
for p in $(lsof -ti:3007 2>/dev/null); do kill -9 "$p" 2>/dev/null; done
nohup bash run-dev.sh > /tmp/wt-dev.log 2>&1 &
sleep 6 && head -4 /tmp/wt-dev.log && curl -s -o /dev/null -w "http=%{http_code}\n" http://localhost:3007/
```

Expected: log shows `next dev cwd: …/worktrees/main-latest`, `✓ Ready`, and `http=200` or `307`.

- [ ] **Step 2: Verify instant in-page switch + no navigation**

Use the Playwright MCP (load via ToolSearch): navigate to
`http://localhost:3007/es/tournaments/8d5e9a69-f2d9-473d-bc2e-42334e2e8096`, click the
`Proyección` tab, then assert with `browser_evaluate`:

```js
() => ({ url: location.pathname + location.search, scrollY: window.scrollY,
         hasCoverHero: !!document.querySelector('img[alt*="LUSITANIA" i]'),
         tabCount: document.querySelectorAll('[role="tab"]').length })
```

Expected: `url` stays on `/es/tournaments/<id>` (NOT `/projection`) with `?tab=projection&category=men`; `hasCoverHero: true` (hero persists); `tabCount: 5`.

- [ ] **Step 3: Verify single projection fetch (no triple fetch)**

After clicking the tab, call `browser_network_requests` filtered to
`tournament_projections`. Expected: exactly **one** `tournament_projections` GET for
`category=eq.men` (down from the previous 3). No `&_rsc=` navigation request to
`/projection`.

- [ ] **Step 4: Verify pair deep-link round-trips**

Click a pair row in the list. Assert (`browser_evaluate`) that `location.search`
now contains `&pair=<slug>` and `window.scrollY` did not jump to 0. Then
`browser_navigate` to that full URL fresh; assert the road view for that pair renders
on load (the pair's surnames are visible). Click the in-tab back control; assert
`?pair=` is removed from the URL.

- [ ] **Step 5: Verify leaving the tab clears params + SEO route still works**

Click `Resumen`; assert `location.search` no longer contains `tab=projection`/`pair=`.
Then `browser_navigate` directly to
`http://localhost:3007/es/tournaments/8d5e9a69-f2d9-473d-bc2e-42334e2e8096/projection?category=men`
and assert the server-rendered projection page still loads (title contains
"Camino al Título") — confirming the SEO route is untouched.

- [ ] **Step 6: Screenshot for the record**

`browser_take_screenshot` of the in-page projection tab. Confirm the cover hero is
present above the tab strip (unlike the old route header).

- [ ] **Step 7: Stop the dev server + clean scratch**

```bash
for p in $(lsof -ti:3007 2>/dev/null); do kill -9 "$p" 2>/dev/null; done
rm -f run-dev.sh
git status --short | grep -v "^??" | grep -v ".playwright-mcp" || true
```

Expected: no unexpected tracked changes beyond the committed files.

---

## Self-Review (completed during authoring)

- **Spec §1 (in-page render):** Task 3 Steps 2,6,7 (init mapping, onChange flip, panel render with real matches + genderFilter). ✓
- **Spec §2 (deep-link tab+category):** Task 3 Step 2 (init) + Step 5/6 (`syncProjectionUrl` via `buildProjectionQuery`, Task 1). ✓
- **Spec §2 (pair deep-link, slug, inside ProjectionTab):** Task 2 (props + slug index + resolve/emit). ✓
- **Spec §2 (clear ?pair on leaving):** Task 3 Step 6. ✓
- **Spec §3 (SEO route untouched, no redirect):** Task 3 Step 4 removes the redirect; no route files modified; Task 4 Step 5 verifies. ✓
- **Spec edge — async slug resolve, once-only:** Task 2 Step 5 (`slugResolvedRef`). ✓
- **Spec edge — unknown slug → list:** Task 2 Step 5 (`if (resolved)` guard; else stays list). ✓
- **Spec edge — gender switch clears pair:** `syncProjectionUrl` always rewrites with current `genderFilter`; the gender toggle re-renders ProjectionTab with the new `category`, and `onPairSlugChange(null)` fires when the new category's rows have no selected pair. (Acceptable per spec; not a separate task.)
- **Spec success — one fetch:** Task 4 Step 3 verifies.
- **Type consistency:** `buildProjectionQuery(category, pairSlug)` signature identical in Task 1 and Task 3; `initialPairSlug`/`onPairSlugChange` names identical in Task 2 and Task 3.
- **Placeholder scan:** none.
