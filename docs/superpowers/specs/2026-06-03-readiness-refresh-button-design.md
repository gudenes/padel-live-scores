# Data Readiness — per-tournament refresh button

**Date:** 2026-06-03
**Status:** Approved (design)
**Builds on:** `2026-06-03-tournament-data-readiness-design.md` (same branch, not yet merged)

## Goal

Let an operator trigger an on-demand padelgod fetch for a single tournament from the Data Readiness list, then see that row's verdict/dimensions update — a "kick the fetch for this one tournament and confirm it fills the gap" loop, exactly for the FIP-Ijuí-style "scraped, not populated" cases.

## Behavior

A compact **Refresh** button at the right of each list row (list view only in v1; calendar bars are too tight):

1. Click (stops row-expand propagation) → POST `/api/internal/refresh-tournament { tournamentId }` — the **existing** endpoint that forwards to padelgod's `/admin/refresh-tournament`, triggering its ingestion workers and returning `{ data: { ok, stepResults } }`.
2. On completion → re-check that one tournament via `GET /api/internal/tournament-readiness?id=<uuid>` and replace the row in place, so verdict + dimension dots update live.
3. Outcome surfaced compactly: `Refreshing…` while running; the row visibly updates on success; the error message inline on failure (e.g. padelgod unreachable, or `PADELGOD_REFRESH_URL`/`PADELGOD_ADMIN_TOKEN` unset).

## Changes

- **API:** extend `apps/ops/src/app/api/internal/tournament-readiness/route.ts` with an optional `?id=<uuid>`. When present, the base tournaments query is narrowed to that single id (still within the in-scope tier/2026 constraints — it's a row already shown). Returns the same `{ rows: [...] }` shape with one row. Keeps the re-check cheap (one tournament, not all ~287).
- **Component:** new `RefreshRowButton` in `apps/ops/src/app/(app)/system/data-readiness/_components/` — owns its running/error state, POSTs the refresh, then GETs the scoped readiness and calls `onRefreshed(updatedRow)`.
- **Wiring:** `ReadinessView` owns `rows`; passes `onRowUpdate(row)` down through `ReadinessList` to `RefreshRowButton`. No new global state.

## Non-goals

- No true non-writing dry-run (chosen behavior is a real refresh + re-check; padelgod has no dry-run mode).
- Calendar view unchanged (list only for v1).
- No bulk "refresh all" (per-row only).

## Acceptance

- Each list row has a Refresh button; clicking it triggers the padelgod refresh and, on completion, updates that row's verdict/dots without a full page reload.
- Errors surface inline on the row; other rows are unaffected.
- `?id=` returns exactly the one tournament's readiness row.
