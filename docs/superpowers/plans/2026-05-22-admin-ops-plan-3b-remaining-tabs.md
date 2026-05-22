# Admin Ops App — Plan 3b: Lift Remaining 12 Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the remaining 12 ops tabs into `apps/ops/` to reach full feature parity with the embedded `/ops` route in the main app. After this lands, the only thing left on the migration story is the cutover (deleting `src/app/ops/`).

**Architecture:** Strict **paste-and-adapt** — same 4 mechanical rules as Plan 3a (auth swap, DB client swap, fetch path rewrites, import adjustments). No refactor. Inline styles stay. useState/useEffect stay.

**Spec:** [`docs/superpowers/specs/2026-05-20-admin-ops-app-design.md`](../specs/2026-05-20-admin-ops-app-design.md)

**Predecessor:** Plans 1 + 2 + 3a all shipped. The admin app is live at `admin.padelnachos.com` with 10 routes plus 19 `/api/internal/*` endpoints already ported.

**Worktree:** `.claude/worktrees/admin-ops-app` on branch `feat/admin-ops-plan-3b`.

---

## What's in scope (12 tabs)

### Tournament Ops (3 remaining)
- **Simulator** — `SimulatorTab.tsx` (830 LOC) + 4 sub-routes
- **Entry Lists (standalone)** — `PadelgodEntryListTab.tsx` (995 LOC) — routes already ported in 3a hotfix
- **Needs Review** — `TournamentDedupTab.tsx` (311 LOC) + 1 route

### Catalogs (2 remaining)
- **Brands & Equipment** — `BrandsTab.tsx` (901 LOC) — routes already ported in 3a hotfix
- **Streams** — `FipStreamsTab.tsx` (165 LOC) + 4 sub-routes

### Content (2)
- **News** — `NewsTab.tsx` (342 LOC) + 1 route
- **Highlights** — `HighlightPickerTab.tsx` (248 LOC) + 1 route

### System (5)
- **Integration Health** — extract from `OpsClient.tsx` inline (~L748)
- **Data Quality** — extract from `OpsClient.tsx` inline (~L888)
- **Padelgod Health** — `PadelgodHealthTab.tsx` (377 LOC) + 1 route
- **Shadow Mode** — `PadelgodShadowTab.tsx` (477 LOC) + 5 sub-routes
- **Architecture** — `ArchitectureTab.tsx` (572 LOC) — pure SVG, no API

**Totals:** 12 tabs · ~5,200 LOC of components · 17 routes to port (+ a shared status feed for the two extracted system tabs).

---

## Adaptation rules (same as Plan 3a — apply to every file)

These 4 mechanical rules transform main-app source into admin-app source. See Plan 3a's plan doc for the full version; here's the summary.

1. **Auth swap** (API routes): `checkOpsAuth(request)` → `auth() + session.user.isOperator` returning 401 if not operator
2. **DB client swap** (API routes): inline `getServiceClient()` / `createClient(...)` → `serviceClient()` from `@/lib/supabase`
3. **Fetch path rewrites** (components): `'/api/ops/<x>'` → `'/api/internal/<x>'`
4. **Import cleanup**: drop `@/lib/ops-auth`; lift any missing `@/lib/<x>` helpers verbatim into `apps/ops/src/lib/`

**Path translation:**
- API: `src/app/api/ops/<route>/route.ts` → `apps/ops/src/app/api/internal/<route>/route.ts`
- Tab: `src/app/ops/<X>Tab.tsx` → `apps/ops/src/app/(app)/<slug>/_components/<X>Tab.tsx` (plus thin `page.tsx` wrapper)

---

## File structure (new files in this plan)

```
apps/ops/src/app/api/internal/
├── news/route.ts
├── highlight-picker/route.ts
├── simulator/
│   ├── tournaments/route.ts
│   ├── create-tournament/route.ts
│   ├── purge/route.ts
│   └── score/route.ts
├── fip-streams/
│   ├── active/route.ts
│   ├── unresolved/route.ts
│   └── resolve/route.ts
├── seed-entry-list/route.ts
├── tournament-dedup/route.ts
├── padelgod-health/route.ts
├── padelgod-shadow/
│   ├── enroll/route.ts
│   ├── enrollments/route.ts
│   ├── divergences/route.ts
│   ├── health/route.ts
│   └── live/route.ts
└── ops-status/route.ts                              (NEW — shared feed for Integration Health + Data Quality, ported from src/app/ops/api/status)

apps/ops/src/app/(app)/
├── simulator/
│   ├── page.tsx                                     (REPLACE Plan 2 stub)
│   └── _components/SimulatorTab.tsx
├── entry-lists/
│   ├── page.tsx                                     (REPLACE Plan 2 stub)
│   └── _components/PadelgodEntryListTab.tsx
├── needs-review/
│   ├── page.tsx                                     (REPLACE Plan 2 stub)
│   └── _components/TournamentDedupTab.tsx
├── brands/
│   ├── page.tsx                                     (REPLACE Plan 2 stub)
│   └── _components/BrandsTab.tsx
├── streams/
│   ├── page.tsx                                     (REPLACE Plan 2 stub)
│   └── _components/FipStreamsTab.tsx
├── news/
│   ├── page.tsx                                     (REPLACE Plan 2 stub)
│   └── _components/NewsTab.tsx
├── highlights/
│   ├── page.tsx                                     (REPLACE Plan 2 stub)
│   └── _components/HighlightPickerTab.tsx
└── system/
    ├── architecture/
    │   ├── page.tsx                                 (REPLACE Plan 2 stub)
    │   └── _components/ArchitectureTab.tsx
    ├── padelgod-health/
    │   ├── page.tsx                                 (REPLACE Plan 2 stub)
    │   └── _components/PadelgodHealthTab.tsx
    ├── shadow-mode/
    │   ├── page.tsx                                 (REPLACE Plan 2 stub)
    │   └── _components/PadelgodShadowTab.tsx
    ├── integration-health/
    │   ├── page.tsx                                 (REPLACE Plan 2 stub)
    │   └── _components/IntegrationHealth.tsx        (NEW — extracted from OpsClient.tsx)
    └── data-quality/
        ├── page.tsx                                 (REPLACE Plan 2 stub)
        └── _components/DataQuality.tsx              (NEW — extracted from OpsClient.tsx)
```

---

## Order: easiest → hardest

Tasks ordered by complexity (and by user-visible value where possible):

1. **Block A — Quick wins** (no API: Architecture; tiny tabs: News, Highlights)
2. **Block B — Already-routed** (Brands, Entry Lists standalone — routes done in 3a)
3. **Block C — Multi-route lifts** (Streams, Simulator, Padelgod Health, Shadow Mode, Needs Review)
4. **Block D — System extracts** (Integration Health, Data Quality — pull out of OpsClient.tsx)
5. **Block E — Wrap-up** (README + tests)

---

## Block A — Quick wins (4 tasks)

### Task 1: Lift `ArchitectureTab` (pure SVG, no routes)

**Files:**
- Copy: `src/app/ops/ArchitectureTab.tsx` → `apps/ops/src/app/(app)/system/architecture/_components/ArchitectureTab.tsx`
- Replace: `apps/ops/src/app/(app)/system/architecture/page.tsx` (currently a Plan 2 stub)

- [ ] **Step 1: Copy + adapt**

```bash
mkdir -p '/Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/admin-ops-app/apps/ops/src/app/(app)/system/architecture/_components'
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/ArchitectureTab.tsx \
   '/Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/admin-ops-app/apps/ops/src/app/(app)/system/architecture/_components/ArchitectureTab.tsx'
```

ArchitectureTab has no fetches and no `@/lib/<x>` imports beyond what's already lifted — verbatim copy.

- [ ] **Step 2: Replace the page stub**

```tsx
// apps/ops/src/app/(app)/system/architecture/page.tsx
import ArchitectureTab from './_components/ArchitectureTab'
// NOTE: check whether the source uses default or named export — adjust import accordingly.

export const metadata = { title: 'Architecture · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function ArchitecturePage() {
  return <ArchitectureTab />
}
```

- [ ] **Step 3: Type-check + build + commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/admin-ops-app/apps/ops && npx tsc --noEmit && npx next build 2>&1 | tail -8
cd /Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/admin-ops-app
git add 'apps/ops/src/app/(app)/system/architecture/'
git commit -m "feat(ops): lift ArchitectureTab — Plan 3b Task 1"
```

---

### Task 2: Port `/api/internal/news` + lift `NewsTab`

**Files:**
- Port: `src/app/api/ops/news/route.ts` → `apps/ops/src/app/api/internal/news/route.ts`
- Lift: `src/app/ops/NewsTab.tsx` → `apps/ops/src/app/(app)/news/_components/NewsTab.tsx`
- Replace: `apps/ops/src/app/(app)/news/page.tsx`

- [ ] **Step 1: Port the route** — apply rules 1, 2, 4 (auth swap, serviceClient, drop ops-auth import). Lift helpers if missing.

```bash
mkdir -p /Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/admin-ops-app/apps/ops/src/app/api/internal/news
# Copy source, apply adaptations
```

- [ ] **Step 2: Lift the tab** — apply Rule 3 (fetch paths). `/api/ops/news` → `/api/internal/news`.

```bash
mkdir -p '/Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/admin-ops-app/apps/ops/src/app/(app)/news/_components'
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/NewsTab.tsx \
   '/Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/admin-ops-app/apps/ops/src/app/(app)/news/_components/NewsTab.tsx'
# Rewrite fetch paths
```

- [ ] **Step 3: Replace page stub** — same pattern as Task 1.

- [ ] **Step 4: tsc + build + commit**

```bash
git add 'apps/ops/src/app/(app)/news/' apps/ops/src/app/api/internal/news/
git commit -m "feat(ops): lift NewsTab + port news route — Plan 3b Task 2"
```

---

### Task 3: Port `/api/internal/highlight-picker` + lift `HighlightPickerTab`

Same pattern as Task 2.

**Files:**
- Port: `src/app/api/ops/highlight-picker/route.ts` → `apps/ops/src/app/api/internal/highlight-picker/route.ts`
- Lift: `src/app/ops/HighlightPickerTab.tsx` → `apps/ops/src/app/(app)/highlights/_components/HighlightPickerTab.tsx`
- Replace: `apps/ops/src/app/(app)/highlights/page.tsx`

- [ ] **Steps 1-4: Same shape as Task 2** — apply rules, port + lift + replace + commit.

```bash
git commit -m "feat(ops): lift HighlightPickerTab + port highlight-picker route — Plan 3b Task 3"
```

---

## Block B — Already-routed tabs (2 tasks)

### Task 4: Lift `BrandsTab` (routes already ported in 3a hotfix)

The 5 equipment routes (`brands`, `rackets`, `player-equipment`, `upload-equipment-image`, `extract-racket`) are all in place from the Plan 3a equipment hotfix. Just lift the tab UI.

**Files:**
- Lift: `src/app/ops/BrandsTab.tsx` (901 LOC) → `apps/ops/src/app/(app)/brands/_components/BrandsTab.tsx`
- Replace: `apps/ops/src/app/(app)/brands/page.tsx`

- [ ] **Step 1: Lift the tab** with Rule 3 (fetch path rewrites). Expect ~8-12 fetch sites to update.

- [ ] **Step 2: Replace page stub**

- [ ] **Step 3: tsc + build + commit**

```bash
git commit -m "feat(ops): lift BrandsTab — Plan 3b Task 4 (routes from 3a hotfix)"
```

---

### Task 5: Lift `PadelgodEntryListTab` standalone (routes already ported in 3a hotfix)

The 4 entry-list routes are in place from the Plan 3a entry-list hotfix. PadelgodEntryListTab was lifted as a sub-component of TournamentExplorerTab in Plan 3a Task 17; here we add a standalone top-level page that wraps the same component (operators can also reach it directly via the Entry Lists nav item).

**Files:**
- Reuse: existing `apps/ops/src/app/(app)/tournament-explorer/_components/PadelgodEntryListTab.tsx`
- Replace: `apps/ops/src/app/(app)/entry-lists/page.tsx`

- [ ] **Step 1: Replace the page stub** with an import that reuses the already-lifted component:

```tsx
// apps/ops/src/app/(app)/entry-lists/page.tsx
import PadelgodEntryListTab from '@/app/(app)/tournament-explorer/_components/PadelgodEntryListTab'

export const metadata = { title: 'Entry Lists · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function EntryListsPage() {
  return <PadelgodEntryListTab />
}
```

- [ ] **Step 2: Verify the component is fine standalone** — open `tournament-explorer/_components/PadelgodEntryListTab.tsx` and confirm it doesn't require parent props that would break a top-level usage. If it does, copy the file to `entry-lists/_components/PadelgodEntryListTab.tsx` and decouple instead.

- [ ] **Step 3: tsc + build + commit**

```bash
git commit -m "feat(ops): lift Entry Lists standalone — Plan 3b Task 5"
```

---

## Block C — Multi-route lifts (5 tasks)

### Task 6: Port 4 Simulator sub-routes + lift `SimulatorTab`

**Sub-routes to port:**
- `simulator/tournaments` (GET list, POST create variant?)
- `simulator/create-tournament` (POST)
- `simulator/purge` (POST)
- `simulator/score` (POST advance, POST/DELETE undo?)

**Files:**
- Port: `src/app/api/ops/simulator/<each>/route.ts` → `apps/ops/src/app/api/internal/simulator/<each>/route.ts`
- Lift: `src/app/ops/SimulatorTab.tsx` (830 LOC) → `apps/ops/src/app/(app)/simulator/_components/SimulatorTab.tsx`
- Replace: `apps/ops/src/app/(app)/simulator/page.tsx`

- [ ] **Step 1: Port each sub-route** — apply rules 1, 2, 4. Lift helpers if missing.

```bash
for r in tournaments create-tournament purge score; do
  mkdir -p /Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/admin-ops-app/apps/ops/src/app/api/internal/simulator/$r
  # copy + adapt
done
```

- [ ] **Step 2: Lift the tab** with Rule 3. Expect ~8 fetch sites to update.

- [ ] **Step 3: Replace page stub**

- [ ] **Step 4: tsc + build + commit**

```bash
git commit -m "feat(ops): lift SimulatorTab + 4 simulator sub-routes — Plan 3b Task 6"
```

---

### Task 7: Port 4 Streams routes + lift `FipStreamsTab`

**Routes to port:**
- `fip-streams/active`
- `fip-streams/unresolved`
- `fip-streams/resolve`
- `seed-entry-list`

**Files:**
- Port each route into `apps/ops/src/app/api/internal/<path>/route.ts`
- Lift: `src/app/ops/FipStreamsTab.tsx` (165 LOC) → `apps/ops/src/app/(app)/streams/_components/FipStreamsTab.tsx`
- Replace: `apps/ops/src/app/(app)/streams/page.tsx`

- [ ] **Steps 1-4: Same pattern as Task 6**

```bash
git commit -m "feat(ops): lift FipStreamsTab + 4 streams routes — Plan 3b Task 7"
```

---

### Task 8: Port `tournament-dedup` route + lift `TournamentDedupTab` → `/needs-review`

**Files:**
- Port: `src/app/api/ops/tournament-dedup/route.ts` (433 LOC) → `apps/ops/src/app/api/internal/tournament-dedup/route.ts`
- Lift: `src/app/ops/TournamentDedupTab.tsx` (311 LOC) → `apps/ops/src/app/(app)/needs-review/_components/TournamentDedupTab.tsx`
- Replace: `apps/ops/src/app/(app)/needs-review/page.tsx`

The route uses Claude API (for AI-assisted dedup). `@anthropic-ai/sdk` is already in `apps/ops/package.json` from Plan 3a's duplicate-scan port.

- [ ] **Step 1-3: Port + lift + replace** — apply rules 1, 2, 4 to the route; Rule 3 to the tab.

- [ ] **Step 4: Update the needs-review counts endpoint** (Plan 2 helper) to query the same logic if needed. The existing `getNeedsReviewCounts` returns a heuristic count — once the real dedup logic is ported here, swap the helper's SQL to query the actual cluster source.

- [ ] **Step 5: tsc + build + commit**

```bash
git commit -m "feat(ops): lift TournamentDedupTab → /needs-review + port dedup route — Plan 3b Task 8"
```

---

### Task 9: Port `padelgod-health` route + lift `PadelgodHealthTab`

**Files:**
- Port: `src/app/api/ops/padelgod-health/route.ts` (283 LOC) → `apps/ops/src/app/api/internal/padelgod-health/route.ts`
- Lift: `src/app/ops/PadelgodHealthTab.tsx` (377 LOC) → `apps/ops/src/app/(app)/system/padelgod-health/_components/PadelgodHealthTab.tsx`
- Replace: `apps/ops/src/app/(app)/system/padelgod-health/page.tsx`

- [ ] **Steps 1-4: Standard port + lift + replace + commit**

```bash
git commit -m "feat(ops): lift PadelgodHealthTab + port route — Plan 3b Task 9"
```

---

### Task 10: Port 5 Shadow Mode routes + lift `PadelgodShadowTab`

**Routes to port:**
- `padelgod-shadow/enroll`
- `padelgod-shadow/enrollments`
- `padelgod-shadow/divergences`
- `padelgod-shadow/health`
- `padelgod-shadow/live`

**Files:**
- Port each route into `apps/ops/src/app/api/internal/padelgod-shadow/<each>/route.ts`
- Lift: `src/app/ops/PadelgodShadowTab.tsx` (477 LOC) → `apps/ops/src/app/(app)/system/shadow-mode/_components/PadelgodShadowTab.tsx`
- Replace: `apps/ops/src/app/(app)/system/shadow-mode/page.tsx`

- [ ] **Steps 1-4: Port 5 routes + lift tab + replace + commit**

```bash
git commit -m "feat(ops): lift PadelgodShadowTab + 5 shadow routes — Plan 3b Task 10"
```

---

## Block D — System extracts (3 tasks)

The Integration Health and Data Quality tabs live INLINE in `src/app/ops/OpsClient.tsx` (1,242 lines). They were never decomposed in the original code — we need to extract them as we lift. They both consume data from `/ops/api/status` in the main app.

### Task 11: Port `ops-status` data feed → `/api/internal/ops-status`

**Files:**
- Port: `src/app/ops/api/status/route.ts` (282 LOC) → `apps/ops/src/app/api/internal/ops-status/route.ts`

The original path is `/ops/api/status` (under the `/ops` page's nested api folder). In our admin app we put it at `/api/internal/ops-status` to match the convention.

- [ ] **Step 1: Inspect source**

```bash
wc -l /Users/GuDenes/Projects/padel-live-scores/src/app/ops/api/status/route.ts
cat /Users/GuDenes/Projects/padel-live-scores/src/app/ops/api/status/route.ts
```

- [ ] **Step 2: Port** — apply rules 1, 2, 4. Lift helpers if missing.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(ops): port /api/internal/ops-status feed — Plan 3b Task 11"
```

---

### Task 12: Extract Integration Health into a standalone component

The original Integration Health UI is inline JSX in `src/app/ops/OpsClient.tsx` around line 748. It renders a grid of cron health tiles + relay status.

**Files:**
- Create: `apps/ops/src/app/(app)/system/integration-health/_components/IntegrationHealth.tsx`
- Replace: `apps/ops/src/app/(app)/system/integration-health/page.tsx`

- [ ] **Step 1: Inspect the inline block**

```bash
sed -n '740,900p' /Users/GuDenes/Projects/padel-live-scores/src/app/ops/OpsClient.tsx
```

Find the `{tab === 'health' && <>...</>}` block. The relevant content lives between that opener and the next `{tab === ...` block.

- [ ] **Step 2: Extract to a client component**

Copy the JSX into a new component file. It depends on `data` (a `DashboardData` object) which originally comes from polling `/ops/api/status`. In the new world it polls `/api/internal/ops-status`. The component should:

1. Be a `'use client'` component (it polls)
2. Manage its own state for the data + last-fetched timestamp
3. Use `useEffect` to fetch + poll every 30s
4. Render the same JSX as the original

Use the structure:

```tsx
// apps/ops/src/app/(app)/system/integration-health/_components/IntegrationHealth.tsx
'use client'

import { useEffect, useState } from 'react'

interface DashboardData {
  // same shape as OpsClient's DashboardData type — copy from there
  // (cron_stats, relay, freshness, etc.)
}

export function IntegrationHealth() {
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function pull() {
      const res = await fetch('/api/internal/ops-status', { cache: 'no-store' })
      if (!res.ok) return
      const json = await res.json() as DashboardData
      if (!cancelled) setData(json)
    }
    pull()
    const id = setInterval(pull, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!data) return <div style={{ padding: 32 }}>Loading…</div>

  return (
    // <-- copy the JSX from OpsClient.tsx's {tab === 'health' && <>...</>} block here
  )
}
```

Note: helper functions used inside the JSX (`timeAgo`, `formatDuration`, the `TILES` constant, the `Stat` component) need to be lifted too — either copy into the new file or extract to a `_components/helpers.ts` if Data Quality (Task 13) needs the same helpers.

- [ ] **Step 3: Replace the page stub**

```tsx
// apps/ops/src/app/(app)/system/integration-health/page.tsx
import { IntegrationHealth } from './_components/IntegrationHealth'

export const metadata = { title: 'Integration Health · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function IntegrationHealthPage() {
  return <IntegrationHealth />
}
```

- [ ] **Step 4: tsc + build + commit**

```bash
git commit -m "feat(ops): extract Integration Health from OpsClient — Plan 3b Task 12"
```

---

### Task 13: Extract Data Quality into a standalone component

Same pattern as Task 12 — extract from `OpsClient.tsx` around line 888 (`{tab === 'data' && <>...</>}` block).

**Files:**
- Create: `apps/ops/src/app/(app)/system/data-quality/_components/DataQuality.tsx`
- Replace: `apps/ops/src/app/(app)/system/data-quality/page.tsx`

- [ ] **Steps 1-4: Same as Task 12** — inspect, extract, replace page, commit.

If Task 12 extracted shared helpers into a `helpers.ts` file (lifted to a parent `_components/` folder or `apps/ops/src/lib/ops-helpers.ts`), reuse them here.

```bash
git commit -m "feat(ops): extract Data Quality from OpsClient — Plan 3b Task 13"
```

---

## Block E — Wrap-up (1 task)

### Task 14: README + full test run

**Files:**
- Modify: `apps/ops/README.md`

- [ ] **Step 1: Update README's Routes table** to reflect ALL pages now being real (no remaining stubs)

- [ ] **Step 2: Add a "Phase 1 status" line** noting Plan 3b complete + feature parity reached

- [ ] **Step 3: Run full test suite + smoke-build**

```bash
cd apps/ops && npm test 2>&1 | tail -5
cd apps/ops && npm run build 2>&1 | tail -25
```

Expected: all tests pass (27 from prior plans), build clean, ~30+ routes registered.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs(ops): README — Plan 3b complete, feature parity with /ops"
```

---

## Verification checklist

After all 14 tasks land:

- [ ] All 12 stub pages from Plan 2 now render real tabs
- [ ] No "Coming in Plan 3" copy anywhere in the admin app
- [ ] All 17 new `/api/internal/*` routes return 200/401 correctly
- [ ] Test suite passes
- [ ] Build clean, ~30+ routes registered
- [ ] Production deploy (`admin.padelnachos.com`) smoke-tests cleanly across all tabs

## What's NOT in this plan

- Cutover: deleting the embedded `src/app/ops/*` route in the main app (separate PR after this stabilizes)
- Phase 2 refactors (Tournament Explorer list/detail split, typed Needs Review inbox, Recent Activity feed, Data Health bars on Today, ⌘K search, notification bell)
- Pre-existing 91% win-rate bug fix
- Cookie-domain change on main app (indefinitely deferred per Plan 1 errata)
