# PadelGodAPI Internal Depth — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pipeline page + three worker detail pages under `/padelgodapi` to prove a reusable documentation template for the remaining 10 workers and ~5 pipelines.

**Architecture:** Additive to the existing `/padelgodapi` MVP. New pages live under `src/app/padelgodapi/pipelines/live-scoring/` and `src/app/padelgodapi/workers/<name>/`. Nav is extended in `_lib/navigation.ts`: a new `Pipelines` section feeds the sidebar, and a secondary `WORKER_DETAIL_ORDER` array drives pager links for worker detail pages (which are intentionally not in the sidebar to avoid bloat).

**Tech Stack:** Next.js 16.2 App Router (RSC), React 19, Tailwind CSS 4, TypeScript 5. All pages are server-rendered. No new dependencies. Reuses existing `PageHeader`, `Prose`, `Callout`, `PrevNextLinks` components.

**Spec:** `docs/superpowers/specs/2026-04-22-padelgodapi-internal-depth-wave1-design.md`

**Branch:** Continue on `worktree-padelgodapi-docs`. Same PR.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/app/padelgodapi/_lib/navigation.ts` | Modify | Add `Pipelines` section to sidebar; add `WORKER_DETAIL_ORDER` array; extend `getAdjacent` to fall back to it |
| `src/app/padelgodapi/pipelines/live-scoring/page.tsx` | Create | Live-scoring pipeline walkthrough |
| `src/app/padelgodapi/workers/live-poller-manager/page.tsx` | Create | Worker detail page |
| `src/app/padelgodapi/workers/shadow-diff-live/page.tsx` | Create | Worker detail page |
| `src/app/padelgodapi/workers/static-reconciler/page.tsx` | Create | Worker detail page |
| `src/app/padelgodapi/workers/page.tsx` | Modify | Wrap the three workers' `name` cells in `<Link>` to their detail pages |

## Content source-of-truth

For every worker page, the author MUST re-read the source before writing. The handoff's worker table is accurate as of 2026-04-22 but the code is authoritative.

- Worker source: `padelgod/src/workers/<name>.ts`
- Worker test: `padelgod/src/__tests__/workers/<name>.test.ts` (or equivalent)
- Scheduler cron: `padelgod/src/scheduler.ts`
- Shared libraries: `padelgod/src/lib/*` (e.g. `live-poller-loop.ts` for the manager page)

---

## Task 1: Extend navigation with Pipelines group and worker-detail order

**Files:**
- Modify: `src/app/padelgodapi/_lib/navigation.ts`

**Why this goes first:** Every new page below uses `<PrevNextLinks>`. If navigation isn't updated first, the pager on new pages will render `null`. Doing nav first means every subsequent task lands with a working pager.

- [ ] **Step 1: Read the current file**

Run: `cat src/app/padelgodapi/_lib/navigation.ts`

Confirm the current structure matches what this plan edits. If it has diverged, stop and re-read the spec.

- [ ] **Step 2: Replace the file with the extended version**

```ts
// src/app/padelgodapi/_lib/navigation.ts
// Single source of truth for the docs sidebar structure.
// Reorder / rename freely — the sidebar + prev/next links all read from here.

export interface NavItem {
  label: string
  href: string
  /** When true, renders as a muted "Coming soon" label + disabled link */
  comingSoon?: boolean
}

export interface NavSection {
  title: string
  items: NavItem[]
}

export const DOCS_NAVIGATION: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Introduction', href: '/padelgodapi/introduction' },
      { label: 'Coverage', href: '/padelgodapi/coverage' },
      { label: 'Roadmap', href: '/padelgodapi/roadmap' },
    ],
  },
  {
    title: 'How it works',
    items: [
      { label: 'Architecture', href: '/padelgodapi/architecture' },
      { label: 'Workers', href: '/padelgodapi/workers' },
      { label: 'Data model', href: '/padelgodapi/data-model' },
    ],
  },
  {
    title: 'Pipelines',
    items: [
      { label: 'Live scoring', href: '/padelgodapi/pipelines/live-scoring' },
    ],
  },
  {
    title: 'Developer API',
    items: [
      { label: 'Getting started', href: '/padelgodapi/getting-started', comingSoon: true },
      { label: 'Authentication', href: '/padelgodapi/authentication', comingSoon: true },
      { label: 'Endpoints', href: '/padelgodapi/endpoints', comingSoon: true },
      { label: 'Rate limits', href: '/padelgodapi/rate-limits', comingSoon: true },
      { label: 'Error codes', href: '/padelgodapi/error-codes', comingSoon: true },
    ],
  },
]

/**
 * Flat, ordered list of real (non-comingSoon) items — used for prev/next
 * navigation at the bottom of the main content pages.
 */
export const FLAT_NAVIGATION: NavItem[] = DOCS_NAVIGATION.flatMap(s =>
  s.items.filter(i => !i.comingSoon)
)

/**
 * Worker detail pages live under `/padelgodapi/workers/<name>` but are
 * intentionally NOT in the sidebar (the nav would bloat once all 13 exist).
 * This array drives `PrevNextLinks` for those pages in pipeline reading
 * order (poller → diff → reconciler). Add new worker pages here as waves
 * ship.
 */
export const WORKER_DETAIL_ORDER: NavItem[] = [
  { label: 'live-poller-manager', href: '/padelgodapi/workers/live-poller-manager' },
  { label: 'shadow-diff-live', href: '/padelgodapi/workers/shadow-diff-live' },
  { label: 'static-reconciler', href: '/padelgodapi/workers/static-reconciler' },
]

/**
 * Return the prev/next items for a given href. Tries `FLAT_NAVIGATION` first,
 * then falls back to `WORKER_DETAIL_ORDER`. Returns `{ prev: null, next: null }`
 * if the href is in neither list.
 */
export function getAdjacent(currentHref: string): {
  prev: NavItem | null
  next: NavItem | null
} {
  const mainIdx = FLAT_NAVIGATION.findIndex(i => i.href === currentHref)
  if (mainIdx !== -1) {
    return {
      prev: mainIdx > 0 ? FLAT_NAVIGATION[mainIdx - 1]! : null,
      next: mainIdx < FLAT_NAVIGATION.length - 1 ? FLAT_NAVIGATION[mainIdx + 1]! : null,
    }
  }
  const workerIdx = WORKER_DETAIL_ORDER.findIndex(i => i.href === currentHref)
  if (workerIdx !== -1) {
    return {
      prev: workerIdx > 0 ? WORKER_DETAIL_ORDER[workerIdx - 1]! : null,
      next: workerIdx < WORKER_DETAIL_ORDER.length - 1 ? WORKER_DETAIL_ORDER[workerIdx + 1]! : null,
    }
  }
  return { prev: null, next: null }
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: No errors in `src/app/padelgodapi/_lib/navigation.ts`. (Unrelated pre-existing errors elsewhere in the repo are OK — only fail the step if the new file has errors.)

- [ ] **Step 4: Verify the dev build doesn't crash**

Run: `npm run build 2>&1 | tail -40`
Expected: Build completes. The sidebar will now render a `Pipelines` group with a single item whose target route doesn't exist yet — Next.js should still build (the sidebar is a client component that doesn't fetch the target).

If build fails on a missing `/padelgodapi/pipelines/live-scoring` route, that's fine for this task (it's created in Task 5). Proceed to commit.

- [ ] **Step 5: Commit**

```bash
git add src/app/padelgodapi/_lib/navigation.ts
git commit -m "$(cat <<'EOF'
docs(padelgodapi): add Pipelines nav group + worker detail pager order

Extends the sidebar with a Pipelines section (Live scoring) and adds
WORKER_DETAIL_ORDER so worker detail pages can use PrevNextLinks without
being in the main sidebar.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Worker detail page — live-poller-manager

**Files:**
- Create: `src/app/padelgodapi/workers/live-poller-manager/page.tsx`
- Source-of-truth: `padelgod/src/workers/live-poller-manager.ts`, `padelgod/src/scheduler.ts`, `padelgod/src/lib/live-poller-loop.ts`

- [ ] **Step 1: Verify the route 404s today**

Run (assuming dev server is up, else `npm run dev` in another terminal):
```
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3002/padelgodapi/workers/live-poller-manager
```
Expected: `404`.

- [ ] **Step 2: Re-read the worker source**

```bash
cat padelgod/src/workers/live-poller-manager.ts
grep -n "live-poller-manager\|poller-manager" padelgod/src/scheduler.ts
```

Confirm the facts the page will state:
- Cadence: `*/1 * * * *` (every minute, per scheduler.ts line ~180)
- Reads: `padelgod_tournaments_for_live_polling` RPC + `padelgod_tournaments_for_shadow_polling` RPC
- Writes (indirectly via the loops it starts): `padelgod.shadow_match_points`, `padelgod.shadow_sets` for shadow loops; canonical tables for canonical loops
- Module-level state: `activePollers: Map<string, LivePollerLoop>` persists across ticks on the same process
- Conflict rule: canonical wins if a tournament appears in both RPCs

- [ ] **Step 3: Create the page**

Create `src/app/padelgodapi/workers/live-poller-manager/page.tsx`:

```tsx
// src/app/padelgodapi/workers/live-poller-manager/page.tsx
import type { Metadata } from 'next'
import { PageHeader } from '../../_components/PageHeader'
import { Prose } from '../../_components/Prose'
import { Callout } from '../../_components/Callout'
import { PrevNextLinks } from '../../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'live-poller-manager' }

export default function LivePollerManagerPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Workers"
        title="live-poller-manager"
        description="Lifecycle manager for in-process live-score pollers. Starts and stops one LivePollerLoop per active tournament, reconciling against two RPCs every minute."
      />
      <Prose>
        <Callout variant="note" title="Schedule">
          <code>*/1 * * * *</code> — every minute. Registered in{' '}
          <code>padelgod/src/scheduler.ts</code>.
        </Callout>

        <h2>What it does</h2>
        <p>
          Each minute the manager asks the database which tournaments need a live poller right now.
          For every tournament in the answer it ensures a <code>LivePollerLoop</code> is running;
          for every loop whose tournament dropped out of the answer, it stops the loop. The loops
          themselves do the 3–6-second Crionet polling — the manager only handles
          start/stop/mode-transition.
        </p>

        <h2>Inputs</h2>
        <ul>
          <li>
            RPC <code>padelgod_tournaments_for_live_polling()</code> — tournaments where padelgod
            owns the live feed. Loops run in <code>canonical</code> mode.
          </li>
          <li>
            RPC <code>padelgod_tournaments_for_shadow_polling()</code> — tournaments where padelapi
            still owns the feed and we shadow-poll for parity. Loops run in <code>shadow</code>{' '}
            mode.
          </li>
        </ul>
        <p>
          Both RPCs return rows of <code>{'{ tournament_id, tournament_name, widget_id }'}</code>.
          They execute in parallel; if either fails the tick aborts without touching state.
        </p>

        <h2>Outputs</h2>
        <p>The manager itself doesn&apos;t write to tables. The loops it starts do:</p>
        <ul>
          <li>
            <strong>Canonical loops</strong> — write to <code>public.matches</code>,{' '}
            <code>public.sets</code>, <code>public.games</code> directly.
          </li>
          <li>
            <strong>Shadow loops</strong> — write to <code>padelgod.shadow_sets</code>,{' '}
            <code>padelgod.shadow_match_points</code>, and also dual-write into{' '}
            <code>public.*</code> via the shadow bridge.
          </li>
        </ul>

        <h2>Algorithm</h2>
        <ol>
          <li>Fetch both RPCs in parallel.</li>
          <li>
            Build a <code>desired</code> map of <code>tournament_id → {'{ widget_id, mode, name }'}</code>
            . Insert shadow rows first, then canonical rows — canonical wins on conflict.
          </li>
          <li>
            For each desired tournament: if no loop exists, start one. If a loop exists with the
            wrong mode (shadow→canonical cutover), stop it and start fresh. If a loop exists with
            the matching mode, no-op.
          </li>
          <li>
            For each existing loop whose tournament is NOT in the desired map, stop it and remove
            it.
          </li>
          <li>
            Return <code>{'{ active, started, stopped }'}</code>.
          </li>
        </ol>

        <h2>Edge cases &amp; invariants</h2>
        <ul>
          <li>
            <strong>Module-scope state.</strong> The active-pollers map lives at module scope so it
            persists across ticks within the same Node process. A process restart means the next
            tick treats every active tournament as new (<code>started = N, stopped = 0</code>).
          </li>
          <li>
            <strong>Start failures don&apos;t register.</strong> If <code>loop.start()</code> throws,
            the tournament is logged and <em>not</em> added to the map — the next tick retries. This
            avoids zombie entries.
          </li>
          <li>
            <strong>Stop failures remove anyway.</strong> If <code>loop.stop()</code> throws, the
            loop is still removed from the map. Leaving a stale entry would permanently block a
            future restart.
          </li>
          <li>
            <strong>Conflict resolution.</strong> A tournament in both RPCs (should not happen given
            the RPC filters, but defensive) picks <code>canonical</code> mode.
          </li>
        </ul>

        <h2>Observability</h2>
        <p>
          Every tick logs at <code>info</code>: <code>started</code> and <code>stopped</code>{' '}
          counts, plus per-loop <code>tournamentId</code>, <code>widgetId</code>, and{' '}
          <code>mode</code>. Start failures log at <code>warn</code>.
        </p>
        <p>
          The manager writes one row to <code>padelgod.scrape_jobs</code> per tick via the
          scheduler wrapper — filter by <code>worker = 'live-poller-manager'</code> to see the
          recent history.
        </p>

        <h2>Debug recipes</h2>
        <p>Did the manager tick in the last 5 minutes?</p>
        <pre>
          <code>{`SELECT started_at, completed_at, status, (payload->>'active')::int AS active
FROM padelgod.scrape_jobs
WHERE worker = 'live-poller-manager'
ORDER BY started_at DESC
LIMIT 5;`}</code>
        </pre>

        <p>Which tournaments should have a canonical poller right now?</p>
        <pre>
          <code>{`SELECT * FROM padelgod_tournaments_for_live_polling();`}</code>
        </pre>

        <p>Which tournaments should have a shadow poller right now?</p>
        <pre>
          <code>{`SELECT * FROM padelgod_tournaments_for_shadow_polling();`}</code>
        </pre>

        <h2>Source</h2>
        <ul>
          <li>
            Worker: <code>padelgod/src/workers/live-poller-manager.ts</code>
          </li>
          <li>
            Loop: <code>padelgod/src/lib/live-poller-loop.ts</code>
          </li>
          <li>
            Tests: <code>padelgod/src/__tests__/workers/live-poller-manager.test.ts</code>
          </li>
          <li>
            Scheduler registration: <code>padelgod/src/scheduler.ts</code>
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/workers/live-poller-manager" />
    </article>
  )
}
```

- [ ] **Step 4: Verify the route now serves the page**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3002/padelgodapi/workers/live-poller-manager`
Expected: `200`.

Also visually confirm in the browser:
- `eyebrow` = "Workers"
- Prev/Next pager at the bottom: prev is nothing (first entry), next is "shadow-diff-live"
- Sidebar does NOT contain this page (worker details are outside the sidebar by design)

- [ ] **Step 5: Build check**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/padelgodapi/workers/live-poller-manager/page.tsx
git commit -m "$(cat <<'EOF'
docs(padelgodapi): worker detail page for live-poller-manager

Covers the two-RPC reconciliation loop, mode transitions (shadow→canonical),
module-scope active-pollers map, and debug SQL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Worker detail page — shadow-diff-live

**Files:**
- Create: `src/app/padelgodapi/workers/shadow-diff-live/page.tsx`
- Source-of-truth: `padelgod/src/workers/shadow-diff-live.ts`, `padelgod/src/scheduler.ts`

- [ ] **Step 1: Verify the route 404s today**

```
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3002/padelgodapi/workers/shadow-diff-live
```
Expected: `404`.

- [ ] **Step 2: Re-read the worker source**

```bash
cat padelgod/src/workers/shadow-diff-live.ts
```

Confirm the facts:
- Cadence: `*/1 * * * *` (every minute)
- Reads: `tournaments` where `shadow_enabled = true`, then `matches` with status in `['live', 'ended']` scoped to those tournaments, then the current `public.sets` row vs `padelgod.shadow_sets` row for each match's highest-numbered set
- Writes: one row per match per tick into `padelgod.shadow_diff` with `diff_kind = 'live_latency'` and `latency_delta_ms = shadow_ts - canonical_ts`
- Skips: matches where either side has no current-set row (nothing to compare)

- [ ] **Step 3: Create the page**

Create `src/app/padelgodapi/workers/shadow-diff-live/page.tsx`:

```tsx
// src/app/padelgodapi/workers/shadow-diff-live/page.tsx
import type { Metadata } from 'next'
import { PageHeader } from '../../_components/PageHeader'
import { Prose } from '../../_components/Prose'
import { Callout } from '../../_components/Callout'
import { PrevNextLinks } from '../../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'shadow-diff-live' }

export default function ShadowDiffLivePage() {
  return (
    <article>
      <PageHeader
        eyebrow="Workers"
        title="shadow-diff-live"
        description="Per-minute latency snapshot for live matches — measures how fresh the padelgod shadow pipeline is vs. the canonical (padelapi) path."
      />
      <Prose>
        <Callout variant="note" title="Schedule">
          <code>*/1 * * * *</code> — every minute. Registered in{' '}
          <code>padelgod/src/scheduler.ts</code>.
        </Callout>

        <h2>What it does</h2>
        <p>
          For every live (or recently ended) match inside a shadow-enrolled tournament, compares the
          highest-numbered set&apos;s <code>updated_at</code> on <code>public.sets</code> (the
          relay-written canonical path) vs <code>padelgod.shadow_sets</code> (the padelgod shadow
          path). Writes one row per match per tick to <code>padelgod.shadow_diff</code>.
        </p>
        <p>
          This is the signal the team watches when answering &quot;is the shadow path keeping up
          with production?&quot;. Positive <code>latency_delta_ms</code> means padelgod is slower
          than the canonical path; negative means ahead.
        </p>

        <h2>Inputs</h2>
        <ul>
          <li>
            <code>public.tournaments</code> — rows where <code>shadow_enabled = true</code>.
          </li>
          <li>
            <code>public.matches</code> — rows with <code>status IN (&apos;live&apos;, &apos;ended&apos;)</code>{' '}
            and <code>tournament_id</code> in the shadow-enabled list.
          </li>
          <li>
            <code>public.sets</code> — the current set row for each candidate match (highest{' '}
            <code>set_number</code>, most recent <code>updated_at</code>).
          </li>
          <li>
            <code>padelgod.shadow_sets</code> — the shadow path&apos;s equivalent row for the same
            (match, set_number).
          </li>
        </ul>

        <h2>Outputs</h2>
        <ul>
          <li>
            <code>padelgod.shadow_diff</code> — one row per (match, tick) with{' '}
            <code>diff_kind = &apos;live_latency&apos;</code> and{' '}
            <code>latency_delta_ms = shadow_updated_at - canonical_updated_at</code> (ms).
          </li>
        </ul>
        <p>
          There is no uniqueness constraint on <code>live_latency</code> diffs — rows accumulate
          over time so you can chart the latency trend per match.
        </p>

        <h2>Algorithm</h2>
        <ol>
          <li>
            Read shadow-enrolled tournament IDs. If the list is empty, return early with{' '}
            <code>{'{ rowsWritten: 0, matchesConsidered: 0 }'}</code>.
          </li>
          <li>
            Read candidate matches: <code>status IN (&apos;live&apos;, &apos;ended&apos;)</code>{' '}
            scoped to those tournaments.
          </li>
          <li>
            For each match, fetch the highest-numbered set from <code>public.sets</code> and from{' '}
            <code>padelgod.shadow_sets</code>.
          </li>
          <li>
            If either side has no row, skip the match silently. Otherwise, compute the delta and
            insert one row into <code>padelgod.shadow_diff</code>.
          </li>
          <li>
            Return <code>{'{ rowsWritten, matchesConsidered }'}</code>.
          </li>
        </ol>

        <h2>Edge cases &amp; invariants</h2>
        <ul>
          <li>
            <strong>Per-match isolation.</strong> A thrown error on one match is logged at{' '}
            <code>warn</code> and the loop continues with the next match.
          </li>
          <li>
            <strong>No uniqueness.</strong> Rows accumulate — this is a time-series, not a
            snapshot.
          </li>
          <li>
            <strong>Finished matches.</strong> Only <code>live</code> and <code>ended</code>{' '}
            statuses are considered; <code>finished</code> is handled by{' '}
            <code>shadow-diff-finalizer</code>.
          </li>
        </ul>

        <h2>Observability</h2>
        <p>
          Each tick logs <code>rowsWritten</code> and <code>matchesConsidered</code> at{' '}
          <code>info</code>. Per-match failures log at <code>warn</code> with{' '}
          <code>matchId</code> and error message.
        </p>

        <h2>Debug recipes</h2>
        <p>Latest latency per live match, sorted worst first:</p>
        <pre>
          <code>{`SELECT
  m.id AS match_id,
  t.name AS tournament,
  sd.latency_delta_ms,
  sd.recorded_at
FROM padelgod.shadow_diff sd
JOIN public.matches m ON m.id = sd.match_id
JOIN public.tournaments t ON t.id = m.tournament_id
WHERE sd.diff_kind = 'live_latency'
  AND sd.recorded_at > now() - interval '10 minutes'
ORDER BY sd.latency_delta_ms DESC NULLS LAST
LIMIT 20;`}</code>
        </pre>

        <p>Is the worker actually running?</p>
        <pre>
          <code>{`SELECT started_at, completed_at, status, payload
FROM padelgod.scrape_jobs
WHERE worker = 'shadow-diff-live'
ORDER BY started_at DESC
LIMIT 5;`}</code>
        </pre>

        <p>Rolling 1-hour P50/P95 latency:</p>
        <pre>
          <code>{`SELECT
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY latency_delta_ms) AS p50_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_delta_ms) AS p95_ms,
  count(*) AS samples
FROM padelgod.shadow_diff
WHERE diff_kind = 'live_latency'
  AND recorded_at > now() - interval '1 hour';`}</code>
        </pre>

        <h2>Source</h2>
        <ul>
          <li>
            Worker: <code>padelgod/src/workers/shadow-diff-live.ts</code>
          </li>
          <li>
            Tests: <code>padelgod/src/__tests__/workers/shadow-diff-live.test.ts</code>
          </li>
          <li>
            Scheduler registration: <code>padelgod/src/scheduler.ts</code>
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/workers/shadow-diff-live" />
    </article>
  )
}
```

- [ ] **Step 4: Verify the route now serves the page**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3002/padelgodapi/workers/shadow-diff-live`
Expected: `200`.

Browser check: pager shows prev = "live-poller-manager", next = "static-reconciler".

- [ ] **Step 5: Build check**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/padelgodapi/workers/shadow-diff-live/page.tsx
git commit -m "$(cat <<'EOF'
docs(padelgodapi): worker detail page for shadow-diff-live

Covers per-minute latency snapshotting for live/ended matches, the
shadow_diff time-series shape, and P50/P95 debug queries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Worker detail page — static-reconciler

**Files:**
- Create: `src/app/padelgodapi/workers/static-reconciler/page.tsx`
- Source-of-truth: `padelgod/src/workers/static-reconciler.ts`, `padelgod/src/lib/match-identifier.ts`, `padelgod/src/lib/tournament-dictionary.ts`, `padelgod/src/scheduler.ts`

- [ ] **Step 1: Verify the route 404s today**

```
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3002/padelgodapi/workers/static-reconciler
```
Expected: `404`.

- [ ] **Step 2: Re-read the worker source**

```bash
cat padelgod/src/workers/static-reconciler.ts | head -200
```

Confirm the facts:
- Cadence: `5,35 * * * *` (twice hourly at :05 and :35)
- Snapshot lookback: `SNAPSHOT_LOOKBACK_DAYS = 14`
- Phases, in order:
  1. `reconcileEntryLists` — `padelgod.entry_list_snapshots` → `public.players` (upsert)
  2. `reconcileDraws` — `padelgod.draw_snapshots` → `public.matches` + `public.tournament_draws`; unresolved rows → `padelgod.reconcile_unresolved`
  3. `reconcileOop` — `padelgod.oop_snapshots` → `public.matches` (schedule times, courts, court order, court_position on snapshots)
  4. `reconcileResults` — `padelgod.results_snapshots` → `public.matches` (finished_at, status), `public.sets` (set scores)
- Result counters: `tournamentsProcessed`, `playersUpserted/Skipped`, `drawMatchesWritten/drawTeamsWritten/drawsUnresolved`, `oopMatchesUpdated/oopUnresolved`, `resultsMatchesUpdated/setsWritten/resultsUnresolved`
- Player resolution: uses `buildTournamentDictionary` + `resolveShortName` in `padelgod/src/lib/tournament-dictionary.ts`
- Match resolution: uses `findOrCreateMatch` in `padelgod/src/lib/match-identifier.ts`
- Phases share cutoff window but failures don't roll back earlier phases

- [ ] **Step 3: Create the page**

Create `src/app/padelgodapi/workers/static-reconciler/page.tsx`:

```tsx
// src/app/padelgodapi/workers/static-reconciler/page.tsx
import type { Metadata } from 'next'
import { PageHeader } from '../../_components/PageHeader'
import { Prose } from '../../_components/Prose'
import { Callout } from '../../_components/Callout'
import { PrevNextLinks } from '../../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'static-reconciler' }

export default function StaticReconcilerPage() {
  return (
    <article>
      <PageHeader
        eyebrow="Workers"
        title="static-reconciler"
        description="Consumes entry-list, draw, OOP, and results snapshots and materializes them into public.players, public.matches, public.sets, and public.tournament_draws."
      />
      <Prose>
        <Callout variant="note" title="Schedule">
          <code>5,35 * * * *</code> — twice hourly at :05 and :35. Deliberately staggered five
          minutes after the fetchers so fresh snapshots land first.
        </Callout>

        <h2>What it does</h2>
        <p>
          The reconciler is the bridge between raw snapshot tables and the canonical{' '}
          <code>public.*</code> schema the rest of the app reads. Fetchers drop immutable snapshots
          into <code>padelgod.*_snapshots</code>; the reconciler picks them up, resolves player and
          match identities, and writes normalized rows that application queries hit.
        </p>
        <p>
          This is also the worker that heals <code>finished_at</code>, <code>started_at</code>, and{' '}
          <code>duration</code> end-to-end — padelgod owns those fields today.
        </p>

        <h2>Inputs</h2>
        <ul>
          <li>
            <code>padelgod.entry_list_snapshots</code> — entry-list rows from the last 14 days.
          </li>
          <li>
            <code>padelgod.draw_snapshots</code> — draw rows (MD/WD/MQ/WQ).
          </li>
          <li>
            <code>padelgod.oop_snapshots</code> — per-day Order of Play (schedule, court, court
            position).
          </li>
          <li>
            <code>padelgod.results_snapshots</code> — completed-match results.
          </li>
          <li>
            <code>public.players</code> — existing player rows, used to resolve short names and
            deduplicate upserts.
          </li>
        </ul>

        <h2>Outputs</h2>
        <ul>
          <li>
            <code>public.players</code> — upserts by <code>fip_id</code>, with a normalized name
            trigger backing alias lookups.
          </li>
          <li>
            <code>public.matches</code> — upserts via <code>findOrCreateMatch</code>{' '}
            (widget_match_id → fallback identifiers). Writes{' '}
            <code>scheduled_at, started_at, finished_at, duration, court, court_order, status,
            winner_pair</code>.
          </li>
          <li>
            <code>public.sets</code> — writes set scores from results snapshots.
          </li>
          <li>
            <code>public.tournament_draws</code> — bracket rows per tournament + category.
          </li>
          <li>
            <code>padelgod.reconcile_unresolved</code> — one row per snapshot row the reconciler
            couldn&apos;t resolve to a canonical entity (missing player, unknown tournament, etc).
          </li>
        </ul>

        <h2>Algorithm</h2>
        <ol>
          <li>
            <strong>Phase 1 — entry-list.</strong> Read snapshots from the last 14 days per
            tournament. For each <code>(tournament, category, fip_id)</code> tuple, upsert a
            player row. Track <code>playersUpserted</code> and <code>playersSkipped</code>.
          </li>
          <li>
            <strong>Phase 2 — draw.</strong> Build a tournament dictionary from phase 1&apos;s
            players (including <code>partner_fip_id</code> for pair-based disambiguation). For each
            draw snapshot, resolve each short name via{' '}
            <code>resolveShortName</code>, then call <code>findOrCreateMatch</code> to get a
            canonical <code>public.matches</code> row. Write the draw row to{' '}
            <code>public.tournament_draws</code>. Unresolved rows go to the queue.
          </li>
          <li>
            <strong>Phase 3 — OOP.</strong> For each oop_snapshot row, match to an existing{' '}
            <code>public.matches</code> row via <code>findOrCreateMatch</code>, then update{' '}
            <code>scheduled_at, court, court_order, court_position</code>.
          </li>
          <li>
            <strong>Phase 4 — results.</strong> For each results_snapshot row, resolve to a match
            row and write <code>finished_at, duration, status, winner_pair</code> plus per-set
            rows into <code>public.sets</code>.
          </li>
          <li>
            Return per-phase counters.
          </li>
        </ol>

        <h2>Edge cases &amp; invariants</h2>
        <ul>
          <li>
            <strong>Independent phases.</strong> A failure in phase 3 does not roll back phases 1
            or 2. Each phase commits incrementally.
          </li>
          <li>
            <strong>Unresolved queue is idempotent.</strong> Re-running the reconciler reuses the
            same queue rows — once the underlying data becomes resolvable (e.g. a new player
            appears in entry_list_snapshots), the next tick clears the queue entry.
          </li>
          <li>
            <strong>Source priority.</strong> Padelgod is not the primary owner of{' '}
            <code>player.name</code> or <code>player.ranking</code> — those belong to padelapi and
            fip_official respectively. The reconciler&apos;s upserts respect{' '}
            <code>filterUpdateByPriority</code> boundaries; it only clobbers fields it owns.
          </li>
          <li>
            <strong>14-day lookback.</strong> Snapshots older than 14 days are ignored. Tournaments
            that finished before that window are not re-reconciled.
          </li>
        </ul>

        <h2>Observability</h2>
        <p>
          Each tick returns and logs a rich counter object: <code>tournamentsProcessed</code>,{' '}
          <code>playersUpserted</code>, <code>playersSkipped</code>,{' '}
          <code>drawMatchesWritten</code>, <code>drawTeamsWritten</code>,{' '}
          <code>drawsUnresolved</code>, <code>oopMatchesUpdated</code>,{' '}
          <code>oopUnresolved</code>, <code>resultsMatchesUpdated</code>,{' '}
          <code>setsWritten</code>, <code>resultsUnresolved</code>.
        </p>

        <h2>Debug recipes</h2>
        <p>What did the last reconciler run write?</p>
        <pre>
          <code>{`SELECT started_at, completed_at, status, payload
FROM padelgod.scrape_jobs
WHERE worker = 'static-reconciler'
ORDER BY started_at DESC
LIMIT 5;`}</code>
        </pre>

        <p>Unresolved rows by phase, newest first:</p>
        <pre>
          <code>{`SELECT phase, count(*) AS n, max(created_at) AS last_seen
FROM padelgod.reconcile_unresolved
WHERE resolved_at IS NULL
GROUP BY phase
ORDER BY last_seen DESC;`}</code>
        </pre>

        <p>Why did a specific match not pick up a <code>finished_at</code>?</p>
        <pre>
          <code>{`-- Replace the widget_match_id with the real one.
SELECT
  rs.source_payload->>'home' AS home,
  rs.source_payload->>'away' AS away,
  rs.source_payload->>'score' AS score,
  rs.captured_at
FROM padelgod.results_snapshots rs
WHERE rs.widget_match_id = '<widget_match_id>'
ORDER BY rs.captured_at DESC
LIMIT 3;`}</code>
        </pre>

        <h2>Source</h2>
        <ul>
          <li>
            Worker: <code>padelgod/src/workers/static-reconciler.ts</code>
          </li>
          <li>
            Player resolution: <code>padelgod/src/lib/tournament-dictionary.ts</code>
          </li>
          <li>
            Match resolution: <code>padelgod/src/lib/match-identifier.ts</code>
          </li>
          <li>
            Tests: <code>padelgod/src/__tests__/workers/static-reconciler.test.ts</code>
          </li>
          <li>
            Scheduler registration: <code>padelgod/src/scheduler.ts</code>
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/workers/static-reconciler" />
    </article>
  )
}
```

- [ ] **Step 4: Verify the route now serves the page**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3002/padelgodapi/workers/static-reconciler`
Expected: `200`.

Browser check: pager shows prev = "shadow-diff-live", next = null (last in WORKER_DETAIL_ORDER).

- [ ] **Step 5: Build check**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/padelgodapi/workers/static-reconciler/page.tsx
git commit -m "$(cat <<'EOF'
docs(padelgodapi): worker detail page for static-reconciler

Covers the four phases (entry-list → draw → oop → results), the 14-day
lookback, the unresolved queue, and source-priority guardrails.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Pipeline page — live-scoring

**Files:**
- Create: `src/app/padelgodapi/pipelines/live-scoring/page.tsx`
- Source-of-truth: the three worker pages (Tasks 2–4), plus `padelgod/src/lib/live-poller-loop.ts` for the loop mechanics

- [ ] **Step 1: Verify the route 404s today**

```
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3002/padelgodapi/pipelines/live-scoring
```
Expected: `404`.

- [ ] **Step 2: Create the page**

Create `src/app/padelgodapi/pipelines/live-scoring/page.tsx`:

```tsx
// src/app/padelgodapi/pipelines/live-scoring/page.tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '../../_components/PageHeader'
import { Prose } from '../../_components/Prose'
import { Callout } from '../../_components/Callout'
import { PrevNextLinks } from '../../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'Live scoring pipeline' }

export default function LiveScoringPipelinePage() {
  return (
    <article>
      <PageHeader
        eyebrow="Pipelines"
        title="Live scoring"
        description="How a live match flows through padelgod — from Crionet polling to public.matches, plus the parity-validation loop that runs alongside it."
      />
      <Prose>
        <h2>What this chain produces</h2>
        <p>
          A live match with accurate per-set scores, <code>finished_at</code>, and a resolved
          winner in <code>public.matches</code> / <code>public.sets</code> within roughly two
          minutes of the real-world finish. Alongside, a time-series of{' '}
          <code>latency_delta_ms</code> rows in <code>padelgod.shadow_diff</code> so we can watch
          how fresh the shadow path is compared to canonical.
        </p>

        <h2>Flow</h2>
        <pre>
          <code>{`     scheduler (every minute)
            │
            ▼
   ┌──────────────────────┐      tournaments RPCs
   │ live-poller-manager  │──────┐
   └──────────┬───────────┘      ▼
              │        padelgod_tournaments_for_live_polling
              │        padelgod_tournaments_for_shadow_polling
              ▼
   per-tournament  LivePollerLoop  (3–6s Crionet polling)
              │
       ┌──────┴──────────────────────┐
       │                             │
   shadow mode                 canonical mode
       │                             │
       ▼                             ▼
 padelgod.shadow_sets         public.sets / public.games
 padelgod.shadow_match_points public.matches
       │                             │
       │ dual-write bridge           │ (direct)
       └──────────────┬──────────────┘
                      │
                      ▼
            public.sets / public.matches
                      │
                      ▼
   ┌───────────────────────────────┐
   │ shadow-diff-live (every min)  │─→ padelgod.shadow_diff (live_latency)
   └───────────────────────────────┘

  ───── match finishes ─────
                      │
                      ▼
   ┌───────────────────────────────┐
   │ static-reconciler (:05, :35)  │─→ finishes finished_at,
   │ phase 4: results              │   duration, winner_pair, sets
   └───────────────────────────────┘`}</code>
        </pre>

        <h2>Step-by-step walkthrough</h2>

        <h3>1. live-poller-manager starts a loop</h3>
        <p>
          Every minute the manager asks two RPCs which tournaments need a poller. Each qualifying
          tournament gets a <code>LivePollerLoop</code> — shadow or canonical mode depending on
          which RPC it came from. Canonical wins if a tournament shows up in both.
        </p>
        <p>
          <strong>State after this step:</strong> one <code>LivePollerLoop</code> per active
          tournament in the process-level <code>activePollers</code> map. Nothing in the DB yet.
        </p>
        <p>
          Detail: <Link href="/padelgodapi/workers/live-poller-manager">live-poller-manager</Link>.
        </p>

        <h3>2. Each loop polls Crionet and writes</h3>
        <p>
          The loop hits Crionet every 3–6 seconds (adaptive — slower when nothing is changing,
          faster during a rally). On each poll it diffs the new payload against the last known
          state and writes deltas.
        </p>
        <ul>
          <li>
            <strong>Shadow mode</strong> writes to <code>padelgod.shadow_sets</code> and{' '}
            <code>padelgod.shadow_match_points</code>. A separate dual-write bridge also populates{' '}
            <code>public.matches</code>, <code>public.sets</code>, and <code>public.games</code>{' '}
            (with <code>points[]</code> arrays for point-by-point UI).
          </li>
          <li>
            <strong>Canonical mode</strong> writes directly to <code>public.*</code>, bypassing
            the shadow tables. This is the end state once a tournament&apos;s{' '}
            <code>live_source</code> is flipped to <code>padelgod</code>.
          </li>
        </ul>
        <p>
          <strong>State after this step:</strong> <code>public.sets</code> rows update in ~real
          time.
        </p>

        <h3>3. shadow-diff-live records the freshness delta</h3>
        <p>
          Every minute the diff worker reads both <code>public.sets</code> and{' '}
          <code>padelgod.shadow_sets</code> for each live match in a shadow-enrolled tournament
          and writes <code>shadow_updated_at - canonical_updated_at</code> (ms) into{' '}
          <code>padelgod.shadow_diff</code>. Positive = padelgod slower, negative = padelgod
          ahead.
        </p>
        <p>
          <strong>State after this step:</strong> a row per live match in the{' '}
          <code>live_latency</code> time-series, used by dashboards to quantify parity.
        </p>
        <p>
          Detail: <Link href="/padelgodapi/workers/shadow-diff-live">shadow-diff-live</Link>.
        </p>

        <h3>4. Match finishes — static-reconciler closes the row</h3>
        <p>
          When the match finishes, Crionet eventually surfaces it in its results endpoint, which{' '}
          <code>results-fetcher</code> (:55) captures into{' '}
          <code>padelgod.results_snapshots</code>. Five minutes later, at :05 or :35, the
          reconciler&apos;s results phase picks up the snapshot, resolves the widget_match_id to
          the canonical <code>public.matches</code> row, and writes{' '}
          <code>finished_at, duration, status, winner_pair</code> plus per-set rows.
        </p>
        <p>
          <strong>State after this step:</strong> <code>public.matches</code> row is fully
          closed. <code>shadow-diff-finalizer</code> (:10, :40) then records any residual divergence
          between shadow and canonical at final state.
        </p>
        <p>
          Detail: <Link href="/padelgodapi/workers/static-reconciler">static-reconciler</Link>.
        </p>

        <h2>Failure modes</h2>

        <Callout variant="warning" title="Symptom: live match score isn't updating">
          <p>
            <strong>Likely cause:</strong> the <code>LivePollerLoop</code> for the tournament
            stopped or never started.
          </p>
          <p>
            <strong>Check:</strong>
          </p>
          <ol>
            <li>
              <code>SELECT * FROM padelgod_tournaments_for_live_polling();</code> — is the
              tournament listed?
            </li>
            <li>
              <code>SELECT * FROM padelgod_tournaments_for_shadow_polling();</code> — same check.
            </li>
            <li>
              <code>padelgod.scrape_jobs</code> filtered by{' '}
              <code>worker = &apos;live-poller-manager&apos;</code> — did the last tick log
              started/stopped counts?
            </li>
          </ol>
          <p>
            <strong>Recovery:</strong> if the RPC returns no row, the tournament isn&apos;t
            eligible — check <code>widget_id</code>, <code>live_source</code>, and{' '}
            <code>shadow_enabled</code> columns on <code>public.tournaments</code>. If it is
            eligible but no loop started, wait one tick; persistent start failures log at{' '}
            <code>warn</code> with the error reason.
          </p>
        </Callout>

        <Callout variant="warning" title="Symptom: shadow_diff.latency_delta_ms is climbing">
          <p>
            <strong>Likely cause:</strong> either the relay is down (canonical path stalled →
            negative delta, padelgod ahead) or the <code>LivePollerLoop</code> is stuck (positive
            delta, padelgod behind).
          </p>
          <p>
            <strong>Check:</strong>
          </p>
          <ol>
            <li>
              Compare <code>public.sets.updated_at</code> to <code>now()</code> for a live match.
              Stale = relay down.
            </li>
            <li>
              Compare <code>padelgod.shadow_sets.updated_at</code> to <code>now()</code>. Stale =
              loop stuck.
            </li>
          </ol>
        </Callout>

        <Callout variant="warning" title="Symptom: match finished in real life but finished_at is null">
          <p>
            <strong>Likely cause:</strong> results-fetcher hasn&apos;t captured the result yet, or
            the reconciler couldn&apos;t resolve the widget_match_id.
          </p>
          <p>
            <strong>Check:</strong>
          </p>
          <ol>
            <li>
              <code>SELECT * FROM padelgod.results_snapshots WHERE widget_match_id = &apos;...&apos;</code>{' '}
              — is the snapshot there?
            </li>
            <li>
              <code>SELECT * FROM padelgod.reconcile_unresolved WHERE phase = &apos;results&apos;</code>{' '}
              — did the reconciler log an unresolved row?
            </li>
          </ol>
          <p>
            <strong>Recovery:</strong> if the snapshot is missing, wait for the next :55 fetcher
            tick or trigger it manually via <code>POST /admin/run-worker</code>. If the reconciler
            couldn&apos;t resolve, the queue row&apos;s <code>reason</code> field explains why.
          </p>
        </Callout>

        <Callout variant="warning" title="Symptom: widget_id missing for a tournament">
          <p>
            <strong>Likely cause:</strong> <code>widget-code-lookup</code> (runs at :15) couldn&apos;t
            map <code>tournaments.id</code> to a <code>FIP-YYYY-NNNN</code> code. Known gap for
            Premier-branded tournaments whose Crionet entry-list returns &quot;coming soon&quot;.
          </p>
          <p>
            <strong>Check:</strong>{' '}
            <code>SELECT * FROM padelgod.widget_id_cache WHERE tournament_id = &apos;...&apos;</code>
            .
          </p>
          <p>
            <strong>Recovery:</strong> seed the cache manually, or wait for the fallback fix
            described in the padelgod Premier-gap memory note.
          </p>
        </Callout>

        <h2>Related</h2>
        <ul>
          <li>
            <Link href="/padelgodapi/workers/live-poller-manager">Worker: live-poller-manager</Link>
          </li>
          <li>
            <Link href="/padelgodapi/workers/shadow-diff-live">Worker: shadow-diff-live</Link>
          </li>
          <li>
            <Link href="/padelgodapi/workers/static-reconciler">Worker: static-reconciler</Link>
          </li>
          <li>
            <Link href="/padelgodapi/data-model">Data model reference</Link>
          </li>
        </ul>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/pipelines/live-scoring" />
    </article>
  )
}
```

- [ ] **Step 3: Verify the route now serves the page**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3002/padelgodapi/pipelines/live-scoring`
Expected: `200`.

Browser check:
- Sidebar highlights `Pipelines > Live scoring` as active
- Inline worker links navigate to Task 2/3/4 pages
- Pager shows prev = "Data model" (last item in "How it works"), next = first item in "Developer API" (comingSoon items are filtered out, so `next` may be `null`)

- [ ] **Step 4: Build check**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds with one new route listed at `/padelgodapi/pipelines/live-scoring`.

- [ ] **Step 5: Commit**

```bash
git add src/app/padelgodapi/pipelines/live-scoring/page.tsx
git commit -m "$(cat <<'EOF'
docs(padelgodapi): live-scoring pipeline walkthrough

End-to-end: live-poller-manager → LivePollerLoop (shadow/canonical) →
shadow-diff-live time-series → static-reconciler closes finished_at. Four
failure-mode callouts with diagnostic SQL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Link worker index rows to their detail pages

**Files:**
- Modify: `src/app/padelgodapi/workers/page.tsx`

**Why this is last:** Links land only when the targets exist. Doing this task last avoids a dead-link window.

- [ ] **Step 1: Read the current file**

Run: `cat src/app/padelgodapi/workers/page.tsx`

Locate the table body (currently `{WORKERS.map(w => ...)}`). The `name` cell renders `<div className="font-mono ...">{w.name}</div>`.

- [ ] **Step 2: Add a `detailHref` column to the row shape and wrap with Link when present**

In `src/app/padelgodapi/workers/page.tsx`:

Replace the `import` block at the top with:

```tsx
import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeader } from '../_components/PageHeader'
import { Prose } from '../_components/Prose'
import { PrevNextLinks } from '../_components/PrevNextLinks'
import { Callout } from '../_components/Callout'
```

Replace the `WORKERS` type annotation with the detailHref-aware version:

```tsx
const WORKERS: Array<{
  name: string
  cron: string
  cadence: string
  purpose: string
  reads: string
  writes: string
  detailHref?: string
}> = [
```

Then add `detailHref` to the three rows whose detail pages exist. Leave the other 10 rows untouched. For example:

```tsx
  {
    name: 'live-poller-manager',
    cron: '*/1 * * * *',
    cadence: 'Every minute',
    purpose: 'Lifecycle manager for in-process live-score pollers. Starts one LivePollerLoop per shadow-enabled tournament with active matches; stops it when the tournament ends.',
    reads: 'public.tournaments',
    writes: 'padelgod.shadow_match_points, padelgod.shadow_sets',
    detailHref: '/padelgodapi/workers/live-poller-manager',
  },
```

Do the same for `static-reconciler` (`detailHref: '/padelgodapi/workers/static-reconciler'`) and `shadow-diff-live` (`detailHref: '/padelgodapi/workers/shadow-diff-live'`).

Replace the name-cell JSX so it renders a `<Link>` when `detailHref` is set:

```tsx
                  <td className="border-b border-[var(--border-base)] px-3 py-3 align-top">
                    {w.detailHref ? (
                      <Link
                        href={w.detailHref}
                        className="font-mono text-xs font-semibold text-[var(--color-accent)] hover:underline"
                      >
                        {w.name}
                      </Link>
                    ) : (
                      <div className="font-mono text-xs font-semibold text-[var(--text-primary)]">
                        {w.name}
                      </div>
                    )}
                    <div className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">
                      {w.cron}
                    </div>
                  </td>
```

- [ ] **Step 3: Verify**

```bash
curl -sS http://localhost:3002/padelgodapi/workers | grep -c 'href="/padelgodapi/workers/'
```
Expected: `3` (or higher — each of the three detail links appears once).

Visually in the browser: the three linked worker names render in accent color; the other ten remain plain.

- [ ] **Step 4: Build check**

Run: `npm run build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/padelgodapi/workers/page.tsx
git commit -m "$(cat <<'EOF'
docs(padelgodapi): link worker index rows to their detail pages

live-poller-manager, shadow-diff-live, and static-reconciler now link from
the workers table. Other workers remain plain text until their detail
pages ship.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Wave 1 verification

After Task 6 lands, run this end-to-end sanity check.

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Build succeeds with all six new/edited routes.

- [ ] **Step 2: Click-through checklist**

Visit `http://localhost:3002/padelgodapi`, then click through:

- Sidebar `Pipelines > Live scoring` → renders, inline links to each worker work
- From a worker page, pager Prev/Next cycles through the three in order: live-poller-manager → shadow-diff-live → static-reconciler
- From the `Workers` index, the three linked names open their detail pages
- Unrelated existing pages (Introduction, Coverage, Architecture, Data model, Roadmap) still render and their pagers still work

- [ ] **Step 3: Accessibility smoke test**

Tab through each new page using only the keyboard. No keyboard traps. All sidebar entries are reachable.

- [ ] **Step 4: Debug SQL smoke test**

Paste each of the SQL blocks on the worker pages into the Supabase SQL editor. Each should return a result (possibly empty, but no syntax errors). If any block errors, fix it inline and amend the relevant commit.

---

## Out of scope (follow-up waves)

- Remaining 10 worker detail pages (entry-list-fetcher, draw-fetcher, oop-fetcher, results-fetcher, match-stats-fetcher, player-rankings, tournament-discovery, widget-code-lookup, player-profile, shadow-diff-finalizer)
- Other pipeline pages (entry-list → draw → OOP, stats, rankings, discovery)
- `/padelgodapi/debugging` index (stretch; deferred)
- Live landing stats, architecture SVG upgrade, public-API stubs

After wave 1 ships and you feel the shape of the template, we decide whether to replicate as-is or adjust before fanning out.
