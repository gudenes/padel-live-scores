# Data Readiness — bulk refresh with live progress

**Date:** 2026-06-03
**Status:** Approved (design)
**App:** `apps/ops/` — Data Readiness view (`/system/data-readiness`)
**Builds on:** the per-tournament Refresh button + `/api/internal/refresh-tournament` + `/api/internal/tournament-readiness?id=`.

## Goal

Let an operator select multiple tournaments in the Data Readiness list and refresh them all in one action, with live per-row and aggregate progress — instead of clicking Refresh one row at a time.

## Approach (chosen: A — client-side orchestration, reuse single endpoint)

The browser runs a **concurrency-limited (3) queue** over the selected tournaments, calling the **existing** `POST /api/internal/refresh-tournament` once per tournament and then `GET /api/internal/tournament-readiness?id=<id>` to re-check and update that row in place — identical to the single Refresh button, just orchestrated over N with a pool.

Rejected: **B** a server batch endpoint (one request looping server-side dies on the Vercel function timeout at N×~30s and gives no incremental progress); **C** a job-queue + polling (needs a job table + worker + polling — overkill for an ops tool, YAGNI).

Why A: no new backend; each request is still one tournament so the per-call timeout is unchanged; progress is naturally incremental; one tournament failing doesn't halt the rest.

## UX

- **Selection:** a checkbox on each list row (click does **not** toggle the row's expand — `stopPropagation`). Selection lives in `ReadinessView` as `selectedIds: Set<string>`.
- **Bulk bar** (appears when `selectedIds.size > 0`): shows `N selected`, a **Refresh N** button, and **Clear**.
- **During a run** the bar becomes a progress strip: a bar + counter, e.g. `12 / 20 · ✓8 added · ◦3 no data · ✗1 error · 9 left`, plus a **Stop** button (cooperative: in-flight refreshes finish, no new ones start).
- **Per-row progress:** each selected row's Refresh cell shows its own live status using the existing labels — `Refreshing… → ✓ +N matches / ✓ no new data / error` — and its verdict/dots update as it completes.
- **Large-batch guard:** if the selection exceeds 50, confirm before starting (avoids hammering padelgod/Crionet).
- **Scope:** list view only (matches the single button); no calendar bulk-select in v1.

## Components & decomposition

- **`refreshAndRecheck(tournamentId): Promise<{ row?: ReadinessRow; outcome: 'added' | 'no-data' | 'error'; message?: string }>`** — extract the single button's "POST refresh → GET ?id= → classify outcome" core into one shared module (`_components/refresh-tournament-client.ts`). Both the single `RefreshRowButton` and the bulk orchestrator call it. Outcome classification reuses the existing stepResults summing (`+N matches` vs `no new data`). DRY: single source of truth for refresh behavior.
- **`runWithConcurrency<T>(items, limit, worker): Promise<void>`** — a tiny pure pool helper (start `limit` workers, each pulls the next item until the queue drains; supports a `shouldStop()` check for cooperative Stop). Unit-tested.
- **`BulkRefreshBar`** — the selection/progress bar component; owns run state (idle / running / stopped), the live tally, and the Stop flag. Receives `selectedIds` + the rows + an `onRowUpdate` callback (same one the single button uses).
- **`ReadinessList`** — add the per-row checkbox (lift selection state to `ReadinessView`). No select-all/preset affordances in v1 — plain per-row multi-select only.
- **`ReadinessView`** — owns `selectedIds`, renders `BulkRefreshBar`, threads `onRowUpdate` (already exists).

## Behavior details

- **Concurrency = 3**, fixed (not user-configurable in v1).
- **Outcome tally** increments as each finishes: added (matches inserted), no-data (ran, 0 new), error (refresh or re-check failed). Errors are non-fatal — the row shows the error inline; the run continues.
- **Stop** sets a flag the pool checks before starting each next item; in-flight requests are not aborted (cooperative). After Stop, the bar shows final tallies + how many were skipped.
- **Already-running guard:** skip any tournament already mid-refresh; padelgod also rejects concurrent same-tournament refreshes with `IN_FLIGHT` (treated as a soft skip, not an error).
- **Selection persistence:** selection clears when a run completes (or on explicit Clear); filters changing don't auto-clear selection but hidden-row selections are simply not shown.

## Testing

- Unit: `runWithConcurrency` (respects the limit; drains all; honors `shouldStop`); the outcome classifier from stepResults (`added` / `no-data`).
- Manual: select a few tournaments (incl. one Broken/divergent and one out-of-scope), Refresh N, watch the per-row + aggregate progress, confirm rows update and Stop works.

## Non-goals

- No calendar-view bulk select.
- No server-side batch job / persistence (a run is tied to the open page; navigating away cancels it — acceptable for an operator tool).
- No configurable concurrency or scheduling.

## Acceptance

- Checkboxes select rows; the bulk bar shows count + Refresh N.
- Refresh N runs ≤3 concurrently; each row shows live status and updates its verdict/dots on completion; the bar shows an aggregate tally and a working Stop.
- A tournament error doesn't halt the batch.
- Single Refresh button and bulk use the same shared `refreshAndRecheck` core.
- Unit tests for the pool + outcome classifier pass; ops build passes.
