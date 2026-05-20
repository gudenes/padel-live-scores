# Admin Ops App — Plan 3a: Lift Players + Tournament Explorer Tabs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the two highest-traffic tabs from the embedded `/ops` route in the main app — **Players** and **Tournament Explorer** — into `apps/ops/` so operators can use them at `admin.padelnachos.com`. Plus the 9 API routes that back them.

**Architecture:** Strict **paste-and-adapt**. We copy each file verbatim and apply a small set of mechanical adaptations (auth check swap, DB client swap, fetch path rewrites). We do NOT refactor: inline styles stay, useState/useEffect stay, internal sub-tab routing stays. Phase 2 of the spec covers refactors (list→detail split for Tournament Explorer, typed-inbox for Needs Review) — out of scope here.

**Tech Stack:** Same as Plan 2. No new deps.

**Spec:** [`docs/superpowers/specs/2026-05-20-admin-ops-app-design.md`](../specs/2026-05-20-admin-ops-app-design.md) — Appendix A is the canonical per-tab lift inventory.

**Predecessor:** [`2026-05-20-admin-ops-foundation.md`](2026-05-20-admin-ops-foundation.md) (Plan 1) + [`2026-05-20-admin-ops-sidebar-and-today.md`](2026-05-20-admin-ops-sidebar-and-today.md) (Plan 2).

**Worktree:** `.claude/worktrees/admin-ops-app` on branch `feat/admin-ops-players-and-explorer`.

**Production status:** The admin app is already live at `admin.padelnachos.com`. Every merge to `main` triggers an auto-deploy. Keep changes additive — don't break existing routes.

---

## Adaptation rules (apply to EVERY file lift)

These 5 mechanical changes turn a main-app source file into an admin-app file. They apply uniformly across all routes and components in this plan.

### Rule 1 — Authentication swap (API routes only)

The main app's `/api/ops/*` routes use cookie-token auth via `checkOpsAuth(request)`. The admin app uses Auth.js v5 + the operator allow-list.

**Before** (main app pattern):
```ts
import { checkOpsAuth } from '@/lib/ops-auth'
export async function GET(request: Request) {
  const authResponse = checkOpsAuth(request)
  if (authResponse) return authResponse
  // ... handler logic
}
```

**After** (admin app pattern):
```ts
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  // ... handler logic (unchanged)
}
```

Note: `auth()` doesn't take a `Request` parameter — it reads cookies via `next/headers`. If the handler needs other parts of the request (URL search params, body), keep the `request: Request` parameter; just remove the `checkOpsAuth` line.

### Rule 2 — DB client swap (API routes only)

The main app's routes use a `getServiceClient()` helper that wraps `createClient` from `@supabase/supabase-js`. We use the same library with the same service key — just need to provide our own helper.

**Before:**
```ts
import { createClient } from '@supabase/supabase-js'
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
// ... later
const supabase = getServiceClient()
```

**After** (use the shared helper from Task 1):
```ts
import { serviceClient } from '@/lib/supabase'
// ... later
const supabase = serviceClient()
```

Delete the inline `getServiceClient` definition; everything else stays.

### Rule 3 — Fetch path rewrites (component files only)

Components in the main app call `/api/ops/<route>`. In the admin app, the route now lives at `/api/internal/<route>`.

**Before:**
```tsx
const res = await fetch('/api/ops/players?limit=50')
```

**After:**
```tsx
const res = await fetch('/api/internal/players?limit=50')
```

Search the file for `'/api/ops/` and rewrite each match to `'/api/internal/`. Some routes are shared across tabs (e.g. `duplicate-scan`) — Rule 3 applies wherever the component fetches it.

### Rule 4 — Import path adjustments

Most `@/lib/...` imports work without change because Plan 1 set up the same `@/` alias in `apps/ops/tsconfig.json`. Exceptions:

- `@/lib/ops-auth` → DELETE the import (replaced by Rule 1's `auth()` pattern)
- `@/lib/supabase` → KEEP if the file uses it; we add this helper in Task 1
- Imports from `@/components/<x>` need to land in `apps/ops/src/components/` — for now we put lifted components under `apps/ops/src/app/(app)/<route>/_components/` so they live next to the route that uses them (Next.js convention: underscore prefix excludes the dir from routing)

### Rule 5 — Path translation

| Main app path | Admin app path |
|---|---|
| `src/app/api/ops/<route>/route.ts` | `apps/ops/src/app/api/internal/<route>/route.ts` |
| `src/app/ops/<X>Tab.tsx` | `apps/ops/src/app/(app)/<slug>/page.tsx` (with content swap; see below) |
| `src/app/ops/<tab-name>/<sub>.tsx` | `apps/ops/src/app/(app)/<slug>/_components/<sub>.tsx` |
| `src/app/ops/<tab-name>/types.ts` | `apps/ops/src/app/(app)/<slug>/_components/types.ts` |

**Tab → page conversion:** The original tabs were React components rendered inside a TabRouter. They expect to live behind a `tab === 'players'` switch. To make them top-level pages, the `page.tsx` is a thin wrapper:

```tsx
// apps/ops/src/app/(app)/players/page.tsx
import { PlayersTab } from './_components/PlayersTab'

export const metadata = { title: 'Players · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function PlayersPage() {
  return <PlayersTab />
}
```

The actual `PlayersTab.tsx` content moves to `_components/PlayersTab.tsx` mostly unchanged.

---

## File structure (new files in this plan)

```
apps/ops/src/lib/
└── supabase.ts                                       (NEW — service client helper)

apps/ops/src/app/api/internal/
├── players/route.ts                                  (lifted from src/app/api/ops/players)
├── search-players/route.ts                           (lifted)
├── duplicate-scan/route.ts                           (lifted)
├── tournament-explorer/route.ts                      (lifted)
├── refresh-tournament/route.ts                       (lifted)
├── tournament-prize/route.ts                         (lifted)
├── schedule-review/route.ts                          (lifted)
├── tournament-draw/route.ts                          (lifted)
└── tournament-matches/route.ts                       (lifted)

apps/ops/src/app/(app)/players/
├── page.tsx                                          (REPLACE Plan 2 stub)
└── _components/
    ├── PlayersTab.tsx                                (lifted)
    ├── PlayersTable.tsx                              (lifted)
    ├── FilterChips.tsx                               (lifted)
    ├── BulkActionsBar.tsx                            (lifted)
    ├── PlayerDrawer.tsx                              (lifted)
    └── types.ts                                      (lifted)

apps/ops/src/app/(app)/tournament-explorer/
├── page.tsx                                          (REPLACE Plan 2 stub)
└── _components/
    ├── TournamentExplorerTab.tsx                     (lifted)
    ├── CalendarView.tsx                              (lifted)
    ├── ScheduleReviewPanel.tsx                       (lifted)
    ├── TournamentDrawSubtab.tsx                      (lifted)
    └── TournamentMatchesSubtab.tsx                   (lifted)
```

**Total: 22 new files** (1 helper + 9 routes + 11 components + 2 pages, of which 2 pages REPLACE existing stubs).

---

## Plan-level reminders

- **No refactor.** Inline styles stay. useState/useEffect stay. Internal sub-tab routing in TournamentExplorerTab stays.
- **No emojis** in copy, code, or commit messages (per CLAUDE.md preference).
- **Variation 2 design tokens** are already loaded; existing inline styles will work since they don't reference tokens directly. Future polish pass can token-ize.
- **Test as you go.** After each section, hit the dev server and verify the relevant page loads + interacts.
- **Commit per task.** One commit per task, descriptive message.

---

## Part 1 — Shared Supabase client helper

### Task 1: Add `apps/ops/src/lib/supabase.ts`

**Files:**
- Create: `apps/ops/src/lib/supabase.ts`

- [ ] **Step 1: Create the helper**

```ts
// apps/ops/src/lib/supabase.ts
// Service-role Supabase client for admin-app server routes that need to
// bypass RLS (most of the lifted /api/internal/* routes). Mirrors the
// pattern the main app uses in its /api/ops/* routes — same library,
// same service key, just centralized so we can swap or instrument later.

import { createClient } from '@supabase/supabase-js'

export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
```

- [ ] **Step 2: Type-check + smoke-build**

```bash
cd apps/ops && npx tsc --noEmit && npx next build 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/lib/supabase.ts
git commit -m "feat(ops): add serviceClient helper for lifted routes

Mirrors the main app's getServiceClient pattern. Used by every
/api/internal/* route that we port from /api/ops/* in Plan 3."
```

---

## Part 2 — Players lift (6 tasks)

### Task 2: Port `/api/internal/players`

**Files:**
- Source: `src/app/api/ops/players/route.ts` (in the main app — read-only reference)
- Create: `apps/ops/src/app/api/internal/players/route.ts`

- [ ] **Step 1: Inspect the source**

```bash
wc -l /Users/GuDenes/Projects/padel-live-scores/src/app/api/ops/players/route.ts
cat /Users/GuDenes/Projects/padel-live-scores/src/app/api/ops/players/route.ts
```

Note which HTTP methods are exported (`GET`, `PATCH`, `POST`, etc.) and what each does. Players route typically has GET (list/filter) and PATCH (edit).

- [ ] **Step 2: Create the destination directory + file**

```bash
mkdir -p apps/ops/src/app/api/internal/players
```

Copy the source content into `apps/ops/src/app/api/internal/players/route.ts`, then apply:

- **Rule 1:** Replace `checkOpsAuth(request)` with the `auth()` + operator-check pattern. Apply to EVERY exported handler (GET, PATCH, etc. — each needs its own auth check).
- **Rule 2:** Remove the inline `getServiceClient` function; import `serviceClient` from `@/lib/supabase`; replace `getServiceClient()` calls with `serviceClient()`.
- **Rule 4:** Remove the `@/lib/ops-auth` import.
- Keep all other imports, types, query logic verbatim.

- [ ] **Step 3: Type-check**

```bash
cd apps/ops && npx tsc --noEmit
```

Expected: clean. If there are type errors related to `Request` parameter or session types, see the troubleshooting note in Task 3.

- [ ] **Step 4: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -8
```

Expected: builds. `/api/internal/players` appears in the route table.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/api/internal/players/route.ts
git commit -m "feat(ops): port /api/internal/players route

Paste-and-adapt from src/app/api/ops/players. Adaptations: checkOpsAuth
swapped for auth() + isOperator check; getServiceClient replaced with
shared serviceClient() helper."
```

---

### Task 3: Port `/api/internal/search-players`

**Files:**
- Source: `src/app/api/ops/search-players/route.ts`
- Create: `apps/ops/src/app/api/internal/search-players/route.ts`

- [ ] **Step 1: Read source + create destination**

```bash
mkdir -p apps/ops/src/app/api/internal/search-players
cat /Users/GuDenes/Projects/padel-live-scores/src/app/api/ops/search-players/route.ts
```

Apply Rules 1, 2, 4 (same adaptations as Task 2). Search-players is typically smaller — just GET with `?q=` filter.

- [ ] **Step 2: Type-check + build**

```bash
cd apps/ops && npx tsc --noEmit && npx next build 2>&1 | tail -5
```

**Troubleshooting note:** If the original route signature is `export async function GET(request: Request)` and the handler uses `request.url` to parse search params, KEEP the `request: Request` parameter even after swapping auth. `auth()` doesn't need it but the handler does.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/search-players/route.ts
git commit -m "feat(ops): port /api/internal/search-players route"
```

---

### Task 4: Port `/api/internal/duplicate-scan`

**Files:**
- Source: `src/app/api/ops/duplicate-scan/route.ts`
- Create: `apps/ops/src/app/api/internal/duplicate-scan/route.ts`

- [ ] **Step 1: Read source + create destination**

```bash
mkdir -p apps/ops/src/app/api/internal/duplicate-scan
cat /Users/GuDenes/Projects/padel-live-scores/src/app/api/ops/duplicate-scan/route.ts
```

Apply Rules 1, 2, 4. This route is shared between Players (player duplicate detection) and the Tournament Dedup queue. In Plan 3a we lift it for Players use; the Needs Review tab (Plan 3b) will use the same route.

If the route imports helpers from `@/lib/` that don't exist in apps/ops yet (e.g. `@/lib/source-matcher` with `NOISE_TOKENS`), you have two choices:
- **Copy the helper** into `apps/ops/src/lib/source-matcher.ts` and import it the same way
- **Inline** the helper if it's small

Prefer "copy the helper" — same paste-and-adapt rule applied recursively.

- [ ] **Step 2: Type-check + build**

```bash
cd apps/ops && npx tsc --noEmit
```

If you see `Cannot find module '@/lib/source-matcher'`, that's the helper-copy issue — go back and lift the helper file too.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/duplicate-scan/route.ts apps/ops/src/lib/*.ts
git commit -m "feat(ops): port /api/internal/duplicate-scan route + helpers"
```

---

### Task 5: Lift Players component files

**Files:**
- Source: `src/app/ops/players/` (5 files: types.ts + 4 components)
- Source: `src/app/ops/PlayersTab.tsx` (the parent container)
- Create: `apps/ops/src/app/(app)/players/_components/` (6 files total)

This is the biggest file-count task. All 6 files paste over with adaptations.

- [ ] **Step 1: Create destination dir**

```bash
mkdir -p 'apps/ops/src/app/(app)/players/_components'
```

- [ ] **Step 2: Copy `types.ts` verbatim**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/players/types.ts \
   'apps/ops/src/app/(app)/players/_components/types.ts'
```

types.ts is just type defs — no adaptations needed.

- [ ] **Step 3: Lift `FilterChips.tsx` (73 lines, smallest)**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/players/FilterChips.tsx \
   'apps/ops/src/app/(app)/players/_components/FilterChips.tsx'
```

Open the destination file. Apply:
- **Rule 3:** Rewrite any `/api/ops/*` fetch paths to `/api/internal/*` (FilterChips is small so may have none — confirm)
- Imports of `./types` etc. stay the same since file structure mirrors

- [ ] **Step 4: Lift `PlayersTable.tsx` (375 lines)**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/players/PlayersTable.tsx \
   'apps/ops/src/app/(app)/players/_components/PlayersTable.tsx'
```

Apply Rule 3 to any `/api/ops/*` calls.

- [ ] **Step 5: Lift `BulkActionsBar.tsx` (298 lines)**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/players/BulkActionsBar.tsx \
   'apps/ops/src/app/(app)/players/_components/BulkActionsBar.tsx'
```

Apply Rule 3.

- [ ] **Step 6: Lift `PlayerDrawer.tsx` (1006 lines — biggest)**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/players/PlayerDrawer.tsx \
   'apps/ops/src/app/(app)/players/_components/PlayerDrawer.tsx'
```

This is the player edit/merge drawer. Apply Rule 3 — there will be several fetch calls (player update, fetch single, merge, etc.). Read each carefully and rewrite the path.

If you see additional imports for things like `@/lib/source-priority` or `@/lib/external-id-registry` that don't exist in apps/ops, lift those helpers too (same paste-and-adapt pattern, no functional change). Add to the commit.

- [ ] **Step 7: Lift `PlayersTab.tsx` (773 lines)**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/PlayersTab.tsx \
   'apps/ops/src/app/(app)/players/_components/PlayersTab.tsx'
```

This is the parent component that composes the 5 sub-components. Apply Rule 3 to fetches. Also:

- **Imports adjustment:** The original imports children from `./players/<x>` (e.g. `import { PlayersTable } from './players/PlayersTable'`). In the new location, they're co-located so the import becomes `./PlayersTable`. Update all 5 child imports.

- [ ] **Step 8: Type-check**

```bash
cd apps/ops && npx tsc --noEmit
```

Expected: clean. If there are missing-module errors, identify the missing helper and lift it (Step 6 note).

- [ ] **Step 9: Commit**

```bash
git add 'apps/ops/src/app/(app)/players/_components/'
git add apps/ops/src/lib/*.ts
git commit -m "feat(ops): lift Players components into apps/ops

Paste-and-adapt of src/app/ops/PlayersTab.tsx + src/app/ops/players/*
(types, FilterChips, PlayersTable, BulkActionsBar, PlayerDrawer).
Adaptations: fetch paths /api/ops/* → /api/internal/*; child component
imports updated for new co-located paths. Any required helpers from
src/lib/ that are not yet in apps/ops/src/lib/ are lifted too."
```

---

### Task 6: Replace Players stub page

**Files:**
- Modify: `apps/ops/src/app/(app)/players/page.tsx` (currently a Plan 2 stub)

- [ ] **Step 1: Replace contents**

```tsx
// apps/ops/src/app/(app)/players/page.tsx
import { PlayersTab } from './_components/PlayersTab'

export const metadata = { title: 'Players · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function PlayersPage() {
  return <PlayersTab />
}
```

This deletes the Plan 2 "Coming in Plan 3" `<PlanStub>` and renders the real tab.

- [ ] **Step 2: Smoke-build**

```bash
cd apps/ops && npx next build 2>&1 | tail -10
```

Expected: `/players` now appears as `ƒ Dynamic` (was `○ Static` for the stub).

- [ ] **Step 3: Commit**

```bash
git add 'apps/ops/src/app/(app)/players/page.tsx'
git commit -m "feat(ops): replace players stub with real PlayersTab"
```

---

### Task 7: Players visual smoke test

**No file changes** — verification only.

- [ ] **Step 1: Run dev server**

```bash
cd apps/ops && npm run dev
```

(If already running from Plan 2, no need to restart.)

- [ ] **Step 2: Open the Players page**

Visit `http://localhost:3004/players` — confirm:

- Page renders the real table (not the "Coming in Plan 3" stub)
- Player rows load from `/api/internal/players` (check Network tab — should see 200, not 401 or 404)
- Filter chips work
- Search input filters via `/api/internal/search-players`
- Clicking a row opens the PlayerDrawer with full player detail
- The drawer's edit/save actions hit `/api/internal/players` PATCH (or whatever the existing pattern is)

- [ ] **Step 3: Production smoke (optional but recommended)**

Once Tasks 2-6 are merged to main and Vercel auto-deploys, repeat at `https://admin.padelnachos.com/players`. Production traffic uses the same routes but with real Supabase data.

- [ ] **Step 4: Mark smoke complete (no commit — just a checkbox)**

If any issue, address it now before moving to Tournament Explorer. Common ones:
- 401 from `/api/internal/*` → check that the route's auth() call is right (Rule 1)
- 500 from `/api/internal/*` → check that `serviceClient()` is being called with env vars present
- "Cannot find module 'X'" at build time → a helper from `@/lib/` is missing; lift it

---

## Part 3 — Tournament Explorer lift (11 tasks)

The biggest tab in the system. 1,380 lines + 4 sub-files + 6 API routes. We port the routes first (in priority order — Tournament Explorer list is the most-hit), then the components.

### Task 8: Port `/api/internal/tournament-explorer`

**Files:**
- Source: `src/app/api/ops/tournament-explorer/route.ts`
- Create: `apps/ops/src/app/api/internal/tournament-explorer/route.ts`

This is the LIST endpoint — most-hit, simplest. Apply Rules 1, 2, 4.

- [ ] **Step 1: Inspect + copy + adapt**

```bash
wc -l /Users/GuDenes/Projects/padel-live-scores/src/app/api/ops/tournament-explorer/route.ts
mkdir -p apps/ops/src/app/api/internal/tournament-explorer
```

Copy `src/app/api/ops/tournament-explorer/route.ts` → destination, apply adaptations.

- [ ] **Step 2: Type-check + commit**

```bash
cd apps/ops && npx tsc --noEmit
git add apps/ops/src/app/api/internal/tournament-explorer/route.ts
git commit -m "feat(ops): port /api/internal/tournament-explorer route"
```

---

### Task 9: Port `/api/internal/refresh-tournament`

**Files:**
- Source: `src/app/api/ops/refresh-tournament/route.ts`
- Create: `apps/ops/src/app/api/internal/refresh-tournament/route.ts`

Per-tournament refresh — triggers a re-sync. Apply Rules 1, 2, 4.

- [ ] **Steps 1-2: Copy + adapt + commit (same pattern as Task 8)**

```bash
mkdir -p apps/ops/src/app/api/internal/refresh-tournament
# copy + adapt + tsc
git commit -m "feat(ops): port /api/internal/refresh-tournament route"
```

---

### Task 10: Port `/api/internal/tournament-prize`

**Files:**
- Source: `src/app/api/ops/tournament-prize/route.ts`
- Create: `apps/ops/src/app/api/internal/tournament-prize/route.ts`

Prize-money display + edit. Apply Rules 1, 2, 4.

- [ ] **Steps 1-2: Same as Task 8**

```bash
mkdir -p apps/ops/src/app/api/internal/tournament-prize
# copy + adapt + tsc
git commit -m "feat(ops): port /api/internal/tournament-prize route"
```

---

### Task 11: Port `/api/internal/schedule-review`

**Files:**
- Source: `src/app/api/ops/schedule-review/route.ts`
- Create: `apps/ops/src/app/api/internal/schedule-review/route.ts`

OOP-based schedule review. Has GET + POST (apply changes). Apply Rules 1, 2, 4 to BOTH methods.

- [ ] **Steps 1-2: Same as Task 8**

```bash
mkdir -p apps/ops/src/app/api/internal/schedule-review
# copy + adapt (remember: BOTH GET and POST need auth + serviceClient swaps) + tsc
git commit -m "feat(ops): port /api/internal/schedule-review route"
```

---

### Task 12: Port `/api/internal/tournament-draw`

**Files:**
- Source: `src/app/api/ops/tournament-draw/route.ts`
- Create: `apps/ops/src/app/api/internal/tournament-draw/route.ts`

Per-tournament draw view. Apply Rules 1, 2, 4.

- [ ] **Steps 1-2: Same as Task 8**

```bash
mkdir -p apps/ops/src/app/api/internal/tournament-draw
# copy + adapt + tsc
git commit -m "feat(ops): port /api/internal/tournament-draw route"
```

---

### Task 13: Port `/api/internal/tournament-matches`

**Files:**
- Source: `src/app/api/ops/tournament-matches/route.ts`
- Create: `apps/ops/src/app/api/internal/tournament-matches/route.ts`

Per-tournament matches list. Apply Rules 1, 2, 4.

- [ ] **Steps 1-2: Same as Task 8**

```bash
mkdir -p apps/ops/src/app/api/internal/tournament-matches
# copy + adapt + tsc
git commit -m "feat(ops): port /api/internal/tournament-matches route"
```

---

### Task 14: Lift `CalendarView.tsx` + `TournamentMatchesSubtab.tsx`

**Files:**
- Source: `src/app/ops/tournament/CalendarView.tsx` (494 lines)
- Source: `src/app/ops/tournament/TournamentMatchesSubtab.tsx` (782 lines)
- Create: `apps/ops/src/app/(app)/tournament-explorer/_components/CalendarView.tsx`
- Create: `apps/ops/src/app/(app)/tournament-explorer/_components/TournamentMatchesSubtab.tsx`

The Matches sub-tab is the largest. Calendar is medium.

- [ ] **Step 1: Create destination dir**

```bash
mkdir -p 'apps/ops/src/app/(app)/tournament-explorer/_components'
```

- [ ] **Step 2: Lift CalendarView**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/tournament/CalendarView.tsx \
   'apps/ops/src/app/(app)/tournament-explorer/_components/CalendarView.tsx'
```

Apply Rule 3 to fetch paths.

- [ ] **Step 3: Lift TournamentMatchesSubtab**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/tournament/TournamentMatchesSubtab.tsx \
   'apps/ops/src/app/(app)/tournament-explorer/_components/TournamentMatchesSubtab.tsx'
```

Apply Rule 3 to fetch paths. Lift any helpers from `@/lib/` that don't exist in apps/ops yet (same pattern as Task 5 step 6).

- [ ] **Step 4: Type-check + commit**

```bash
cd apps/ops && npx tsc --noEmit
git add 'apps/ops/src/app/(app)/tournament-explorer/_components/CalendarView.tsx'
git add 'apps/ops/src/app/(app)/tournament-explorer/_components/TournamentMatchesSubtab.tsx'
git add apps/ops/src/lib/*.ts  # if any helpers were lifted
git commit -m "feat(ops): lift CalendarView + TournamentMatchesSubtab"
```

---

### Task 15: Lift `ScheduleReviewPanel.tsx`

**Files:**
- Source: `src/app/ops/tournament/ScheduleReviewPanel.tsx` (769 lines)
- Create: `apps/ops/src/app/(app)/tournament-explorer/_components/ScheduleReviewPanel.tsx`

This is the operator's OOP-schedule application UI. Operationally critical. Apply Rule 3.

- [ ] **Step 1: Copy**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/tournament/ScheduleReviewPanel.tsx \
   'apps/ops/src/app/(app)/tournament-explorer/_components/ScheduleReviewPanel.tsx'
```

- [ ] **Step 2: Adapt fetch paths** — search for `/api/ops/schedule-review` and rewrite to `/api/internal/schedule-review`.

- [ ] **Step 3: Type-check + commit**

```bash
cd apps/ops && npx tsc --noEmit
git add 'apps/ops/src/app/(app)/tournament-explorer/_components/ScheduleReviewPanel.tsx'
git commit -m "feat(ops): lift ScheduleReviewPanel"
```

---

### Task 16: Lift `TournamentDrawSubtab.tsx`

**Files:**
- Source: `src/app/ops/tournament/TournamentDrawSubtab.tsx` (299 lines)
- Create: `apps/ops/src/app/(app)/tournament-explorer/_components/TournamentDrawSubtab.tsx`

Smallest of the sub-files. Apply Rule 3.

- [ ] **Steps 1-3: Same as Task 15**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/tournament/TournamentDrawSubtab.tsx \
   'apps/ops/src/app/(app)/tournament-explorer/_components/TournamentDrawSubtab.tsx'
# adapt + tsc
git commit -m "feat(ops): lift TournamentDrawSubtab"
```

---

### Task 17: Lift `TournamentExplorerTab.tsx` + replace stub page

**Files:**
- Source: `src/app/ops/TournamentExplorerTab.tsx` (1380 lines — the giant)
- Create: `apps/ops/src/app/(app)/tournament-explorer/_components/TournamentExplorerTab.tsx`
- Modify: `apps/ops/src/app/(app)/tournament-explorer/page.tsx` (currently the Plan 2 stub)

The parent component that composes the 4 sub-components.

- [ ] **Step 1: Lift the parent**

```bash
cp /Users/GuDenes/Projects/padel-live-scores/src/app/ops/TournamentExplorerTab.tsx \
   'apps/ops/src/app/(app)/tournament-explorer/_components/TournamentExplorerTab.tsx'
```

Adaptations:
- **Rule 3:** All `/api/ops/tournament-explorer`, `/api/ops/refresh-tournament`, `/api/ops/tournament-prize` calls → `/api/internal/*` equivalents
- **Sub-component imports:** Original imports from `./tournament/CalendarView`, `./tournament/ScheduleReviewPanel`, etc. → in the new location these are co-located, so the imports become `./CalendarView`, `./ScheduleReviewPanel`, etc.

- [ ] **Step 2: Replace the stub page**

```tsx
// apps/ops/src/app/(app)/tournament-explorer/page.tsx
import { TournamentExplorerTab } from './_components/TournamentExplorerTab'

export const metadata = { title: 'Tournament Explorer · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default function TournamentExplorerPage() {
  return <TournamentExplorerTab />
}
```

- [ ] **Step 3: Type-check + smoke-build**

```bash
cd apps/ops && npx tsc --noEmit && npx next build 2>&1 | tail -10
```

Expected: clean. `/tournament-explorer` now `ƒ Dynamic`.

- [ ] **Step 4: Commit**

```bash
git add 'apps/ops/src/app/(app)/tournament-explorer/_components/TournamentExplorerTab.tsx'
git add 'apps/ops/src/app/(app)/tournament-explorer/page.tsx'
git commit -m "feat(ops): lift TournamentExplorerTab + replace stub

The parent component composing CalendarView + TournamentMatchesSubtab +
ScheduleReviewPanel + TournamentDrawSubtab. Plan 3a complete for
Tournament Explorer."
```

---

### Task 18: Tournament Explorer visual smoke test

**No file changes** — verification only.

- [ ] **Step 1: Visit /tournament-explorer in dev**

```bash
cd apps/ops && npm run dev   # if not already running
```

Open `http://localhost:3004/tournament-explorer`.

- [ ] **Step 2: Verify each internal sub-tab works**

The tab has internal sub-tabs (Matches, Draw, Calendar, Schedule Review). Click each and confirm:

- **Tournament list** loads (Tournament Explorer landing)
- Click a tournament → detail panel opens
- **Matches sub-tab** lists matches, columns populated
- **Draw sub-tab** shows bracket data (if tournament has it)
- **Calendar sub-tab** renders the calendar grid
- **Schedule Review sub-tab** lists pending OOP-derived schedule changes (if any)
- The **"Refresh"** action in each sub-tab triggers the relevant `/api/internal/*` endpoint (check Network tab — 200 OK)
- The **prize money edit** in tournament detail saves via `/api/internal/tournament-prize`

If any sub-tab errors or shows missing data, the most likely cause is a fetch path that wasn't rewritten (Rule 3 missed). Open the browser DevTools Network tab and look for 404s on `/api/ops/*` — those are bugs.

- [ ] **Step 3: Production smoke (recommended)**

After merge + auto-deploy, repeat at `https://admin.padelnachos.com/tournament-explorer`.

- [ ] **Step 4: Mark smoke complete** (no commit)

---

## Part 4 — Wrap-up

### Task 19: README + full test run

**Files:**
- Modify: `apps/ops/README.md` — update Routes table to reflect the now-real pages

- [ ] **Step 1: Update `apps/ops/README.md`**

In the Routes section, find:

```
| `/tournament-explorer`, `/entry-lists`, `/needs-review`, `/simulator` | Tournament Ops tabs (stubs until Plan 3) |
| `/players`, `/brands`, `/streams` | Catalog tabs (stubs until Plan 3) |
```

Change to:

```
| `/players` | Player catalog (search, edit, merge, dedup) |
| `/tournament-explorer` | Per-tournament management (matches, draws, schedule review) |
| `/entry-lists`, `/needs-review`, `/simulator` | Tournament Ops tabs (stubs until Plan 3b) |
| `/brands`, `/streams` | Catalog tabs (stubs until Plan 3b) |
```

Also add the new `/api/internal/*` paths to the Routes table:

```
| `/api/internal/players` | GET list, PATCH edit |
| `/api/internal/search-players` | GET search |
| `/api/internal/duplicate-scan` | GET cluster detection |
| `/api/internal/tournament-explorer` | GET tournament list |
| `/api/internal/refresh-tournament` | POST trigger re-sync |
| `/api/internal/tournament-prize` | GET / POST prize money |
| `/api/internal/schedule-review` | GET / POST OOP schedule application |
| `/api/internal/tournament-draw` | GET tournament draw |
| `/api/internal/tournament-matches` | GET tournament matches |
```

- [ ] **Step 2: Run the full test suite**

```bash
cd apps/ops && npm test 2>&1 | tail -10
```

Expected: all existing tests still pass (no new tests in Plan 3a; we didn't add unit tests for the lifted routes since they're SQL-heavy and exercise via visual smoke).

- [ ] **Step 3: Smoke-build**

```bash
cd apps/ops && npm run build 2>&1 | tail -20
```

Expected: clean. Route table should show 30+ routes (Plan 1 + Plan 2 + Plan 3a additions).

- [ ] **Step 4: Commit**

```bash
git add apps/ops/README.md
git commit -m "docs(ops): README — Players + Tournament Explorer routes live

Plan 3a complete. /players + /tournament-explorer flipped from stub
to real lifted tabs. 9 /api/internal/* routes added (3 for Players,
6 for Tournament Explorer)."
```

---

## Verification checklist

After all 19 tasks land:

- [ ] `cd apps/ops && npm test` passes (no new tests but no regressions)
- [ ] `cd apps/ops && npm run build` builds cleanly
- [ ] `cd apps/ops && npm run lint` zero errors
- [ ] `/players` renders the real PlayersTab with rows, search, drawer
- [ ] `/tournament-explorer` renders the real tab with all 4 sub-tabs working
- [ ] All 9 new `/api/internal/*` routes return 200 (or 401 if signed out)
- [ ] No 404s on `/api/ops/*` from the admin app (check Network tab on each tab)
- [ ] Production deploy at `admin.padelnachos.com` works end-to-end for both pages

## What's intentionally NOT in this plan

- Plan 3b: the remaining 12 tabs (Brands, Streams, News, Highlights, Simulator, Entry Lists, Needs Review/dedup, 5 SYSTEM tabs)
- Phase 2: Tournament Explorer list→detail refactor with `/tournament-explorer/[id]` URL routing
- Phase 2: Typed Needs Review inbox
- Unit tests for the lifted routes — visual smoke is the verification (SQL ports are mechanical)
- Modernization of the lifted code — inline styles, useState-heavy patterns stay as-is per spec
