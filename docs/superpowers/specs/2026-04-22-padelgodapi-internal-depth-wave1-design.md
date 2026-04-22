# PadelGodAPI docs — Internal depth, wave 1

_Date: 2026-04-22_
_Branch: `worktree-padelgodapi-docs`_
_Status: design approved, pending implementation plan_

## Context

`/padelgodapi` Phase 1 MVP shipped 7 content pages + 5 placeholder pages. The
primary audience today is internal: the operator who needs to understand and
maintain the padelgod pipeline. The site currently has a single `Workers`
table that lists all 13 workers but no detail per worker, and no end-to-end
walkthrough of how workers chain into pipelines.

This spec defines **wave 1** of the internal-depth expansion. Its explicit
goal is to prove a documentation template before replicating it across the
remaining 10 workers and ~5 pipelines.

## Goals

1. A reader debugging live-match issues can land on one pipeline page and
   understand the full data flow from Crionet poll to `public.matches` row.
2. Three representative worker pages exist at full depth, covering the most
   complex workers in the chain.
3. The template proven in wave 1 can be replicated mechanically in later
   waves. If something is wrong with the template (too long, missing
   sections, wrong frame), we catch it now, not after 10 more pages.

## Non-goals

- Remaining 10 worker pages (entry-list, draw, OOP, results, stats, rankings,
  discovery, widget-lookup, player-profile, shadow-diff-finalizer)
- Remaining ~5 pipeline pages (entry-list → draw → OOP, stats, rankings,
  discovery)
- Live landing stats, architecture diagram upgrade, public-API stubs
- MDX migration or any other tooling change

## Scope

### Pages added

| Path | Purpose |
|---|---|
| `/padelgodapi/pipelines/live-scoring` | End-to-end walkthrough of the live-scoring chain |
| `/padelgodapi/workers/live-poller-manager` | Per-worker detail |
| `/padelgodapi/workers/static-reconciler` | Per-worker detail |
| `/padelgodapi/workers/shadow-diff-live` | Per-worker detail |

### Pages edited

- `/padelgodapi/workers` (index) — each row in the worker table gains a link
  to the worker detail page if one exists. Rows for workers without a detail
  page yet stay as plain text.
- `_lib/navigation.ts` — adds the `Pipelines` group and a secondary
  `workerDetailOrder` array driving `PrevNextLinks` for worker detail pages.

### Stretch (only if the core four pages land cleanly)

- `/padelgodapi/debugging` — a one-page index mapping common failure symptoms
  to the queries / logs / dashboards that diagnose them. Links out to
  pipeline + worker pages. If this isn't written in wave 1, it's a follow-up.

## Information architecture

### Sidebar groups after wave 1

```
Overview
  Introduction
  Coverage
  Architecture
  Roadmap
Pipelines                      ← new group
  Live scoring                 ← new page
Reference
  Workers                      ← existing index, now with row links
  Data model                   ← unchanged
Developer API (soon)
  Getting started, Auth, Endpoints, Rate limits, Errors
```

Worker detail pages are intentionally NOT in the sidebar — that would bloat
the nav once all 13 exist. They're discoverable via:

1. The `Workers` index table (each worker name becomes a link)
2. The pipeline page's step-by-step walkthrough
3. Cross-links from related worker pages

Worker detail pages still get `PrevNextLinks` pagination, driven by a
secondary order array in `navigation.ts`. The pager follows pipeline reading
order (live-poller-manager → shadow-diff-live → static-reconciler).

## Templates

### Worker page template (~400–600 words)

Each worker page has these sections, in this order:

1. **One-liner** — what it does in a sentence, at the top of the page under
   the `PageHeader`.
2. **Schedule** — cadence, cron expression if any, minute-slot within the
   hour. Rendered as a small callout at the top.
3. **Inputs** — upstream triggers (scheduler tick, prior worker, external
   webhook), tables/rows read, external APIs called.
4. **Outputs** — tables/rows written (both `padelgod.*` shadow and
   `public.*` via dual-write), events emitted.
5. **Algorithm** — numbered list, actual flow not pseudocode theatre. If the
   algorithm has a branch point, document it as sub-steps.
6. **Edge cases & invariants** — what it skips, what it refuses to
   overwrite, idempotency notes, guards against stale data.
7. **Observability** — how to tell if the worker ran recently, which
   `computed_at` / `last_seen_at` / `updated_at` columns to query, log
   patterns to grep for.
8. **Debug recipes** — 2–3 concrete SQL queries answering: "did this worker
   run in the last hour?", "what did it touch?", "why didn't it pick up
   tournament X?". Queries live in fenced code blocks ready to paste.
9. **Source** — file path (`padelgod/src/workers/<name>.ts`) and test file
   path. Include a short note on the main types/functions exported.

### Pipeline page template (~600–900 words)

1. **What this chain produces** — user-visible outcome in one paragraph.
2. **Flow diagram** — ASCII box diagram showing worker handoffs with table
   names on the edges. Inline in the page, no new component needed. When
   wave 1 lands this can be replaced with a proper SVG in a later pass.
3. **Step-by-step walkthrough** — for each worker in the chain, a
   sub-section covering: what this worker adds to the state, what's in the
   DB after it completes, what the next worker depends on.
4. **Failure modes** — 3–5 real scenarios with symptom, cause, and recovery
   procedure. Examples: "worker crashes mid-match", "Crionet returns stale
   data", "widget_id missing for a tournament", "shadow-diff flags a
   divergence".
5. **Related** — links to the worker detail pages and relevant data-model
   entries.

### Reused components

Both templates reuse existing components — no new components added:

- `<PageHeader>` for title + eyebrow + description
- `<Prose>` wrapper for body content
- `<Callout>` for tips, warnings, and notes
- `<PrevNextLinks>` for pager

## File layout

```
src/app/padelgodapi/
  _lib/
    navigation.ts                    ← edit: add Pipelines group, workerDetailOrder
  pipelines/
    live-scoring/
      page.tsx                       ← new
  workers/
    page.tsx                         ← edit: table rows link to detail pages
    live-poller-manager/page.tsx     ← new
    static-reconciler/page.tsx       ← new
    shadow-diff-live/page.tsx        ← new
```

No changes to `src/proxy.ts`, `layout.tsx`, or `_components/`. Everything is
additive.

## Content sourcing

To keep pages accurate, each worker page's content is grounded in:

- The worker's source file at `padelgod/src/workers/<name>.ts`
- The worker's test file at `padelgod/src/__tests__/workers/<name>.test.ts`
- The scheduler config at `padelgod/src/scheduler.ts`
- Recent commits touching the worker (surface in the handoff/history note
  only if a recent change affects semantics)

Before writing each page, the author re-reads the current source rather than
relying on the summary table from the handoff. The Workers index table in
the handoff is correct as of 2026-04-22 but the source is authoritative.

## Verification

Wave 1 is verified by:

1. `npm run build` must succeed on the docs worktree (catches broken
   imports, bad metadata, type errors).
2. Manual click-through of all four new pages at `localhost:3000`:
   - Sidebar shows the new `Pipelines` group with `Live scoring`
   - Workers index table rows link correctly to the three detail pages
   - `PrevNextLinks` works on every new page
   - Mobile responsiveness matches existing pages
3. Keyboard navigation through the new pages — no keyboard traps, sidebar
   links all reachable.
4. Each worker page's debug SQL queries are executable — we paste them into
   the Supabase SQL editor and confirm they return a sensible result on the
   current DB.

## Implementation posture

- Same branch: `worktree-padelgodapi-docs`. Additive commits.
- Same PR as Phase 1 MVP (still open).
- Expected commit shape: one commit per page plus one commit for the nav
  update and workers-index link edit. The debug-index stretch page, if
  included, gets its own commit.

## Open questions

None blocking. Decisions captured above:

- Sidebar: worker detail pages excluded to avoid nav bloat
- Pager: secondary order array in `navigation.ts`
- Diagram: ASCII for wave 1, upgrade to SVG later
- Template length: 400–600 words per worker, 600–900 per pipeline

## After wave 1

Decision point after wave 1 ships:

- If the template feels right → write waves 2–5 as one plan each (pipeline +
  its workers), in reading order: entry-list, draw/OOP, stats, rankings,
  discovery.
- If the template is off → iterate on it in a small follow-up before
  fanning out.
- `/padelgodapi/debugging` index remains a stretch / follow-up depending on
  how wave 1 lands.
