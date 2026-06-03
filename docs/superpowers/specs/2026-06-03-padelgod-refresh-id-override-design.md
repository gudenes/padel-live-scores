# padelgod — on-demand refresh honors targeted tournament ids

**Date:** 2026-06-03
**Status:** Approved (design)
**Repo area:** `padelgod/` (Railway service) + `supabase/migrations/`
**Related:** the Data Readiness view's per-tournament Refresh button (Vercel ops). This fixes the padelgod side so that refresh can actually fetch out-of-window tournaments.

## Problem

The on-demand refresh (`padelgod POST /admin/refresh-tournament`) builds `onlyTournamentIds = { thisTournament }` and passes it to each worker. But every static worker selects its tournament set from one of two RPCs —
`padelgod_active_tournaments_for_static_workers` and `padelgod_active_tournaments_with_slug` —
which hard-filter to a **±7-day window** around `NOW()`:

```sql
t.starts_at IS NULL
OR (t.starts_at <= NOW() + INTERVAL '7 days'
    AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days')
```

Workers call the RPC first, then post-filter the result by `onlyTournamentIds`. So for a tournament outside the window (e.g. **FIP Silver Australian Padel Open**, finished Jan 14–18, refreshed in June), the RPC returns 0 rows, the post-filter has nothing to keep, and every step is a no-op — even though the tournament has an active Crionet widget. The `onlyTournamentIds` allowlist can't help because it runs *downstream* of the windowed RPC.

Evidence: investigation report in this session; RPC at `supabase/migrations/20260420000014_padelgod_active_tournaments_views.sql:32-36` and `20260424000003_padelgod_active_tournaments_with_slug.sql`; per-worker pattern e.g. `padelgod/src/workers/draw-fetcher.ts:118-130`.

## Goal

When an operator refreshes a specific tournament, the targeted workers must select **that tournament by id, bypassing the ±7-day window**, so its data can be fetched/populated regardless of age. Scheduled/automatic worker runs keep their existing windowed behavior unchanged.

## Approach (chosen: A — RPC id-override param)

Add an optional `p_only_ids uuid[] DEFAULT NULL` parameter to **both** RPCs. The WHERE clause becomes:

```sql
WHERE (
  (p_only_ids IS NOT NULL AND t.id = ANY(p_only_ids))   -- targeted: bypass the window
  OR (p_only_ids IS NULL AND (<existing ±7-day window predicate>))  -- scheduled: unchanged
)
```

- The `INNER JOIN padelgod.widget_id_cache c ON c.tournament_id = t.id AND c.is_active = true` is **kept** — a tournament still needs a resolved active widget to be fetchable (FIP-2026-0225 has one). A targeted id with no active widget legitimately returns 0 rows.
- `LIMIT 50` and `ORDER BY` are kept (a targeted refresh passes ≤ a handful of ids).
- Default `NULL` → existing no-arg callers behave exactly as today (full backward compatibility).

Rejected: **B** (per-worker by-id query) duplicates the RPC join/shape across ~6 workers; **C** (separate by-ids RPC) means two parallel RPCs to keep in sync.

## Changes

### 1. Migration
`supabase/migrations/<ts>_padelgod_active_tournaments_id_override.sql` — `CREATE OR REPLACE` both functions with the new `p_only_ids uuid[] DEFAULT NULL` param and OR-bypass WHERE. Re-assert existence (matching the existing migrations' `DO $$ ASSERT … $$` style). Applied to the shared Supabase DB via the repo's `pg`-script workflow.

### 2. padelgod workers — forward the ids only on the refresh path
A small shared helper (e.g. `padelgod/src/lib/active-tournament-args.ts`):

```ts
export function activeTournamentArgs(onlyTournamentIds?: Set<string>) {
  return onlyTournamentIds && onlyTournamentIds.size > 0
    ? { p_only_ids: Array.from(onlyTournamentIds) }
    : {}
}
```

At each **refresh-chain** call site that already accepts `onlyTournamentIds`, pass `activeTournamentArgs(deps.onlyTournamentIds)` as the RPC args. The existing post-`.filter(onlyTournamentIds)` stays as a harmless guard (no-op once the RPC already scoped).

Call sites to update (those the refresh chain runs with `onlyTournamentIds` — confirm against `padelgod/src/api/refresh-tournament.ts` during planning): `entry-list-fetcher`, `draw-fetcher`, `fip-draw-fetcher`, `fip-draw-populator`, `results-fetcher`, `oop-fetcher`, and the FIP writers invoked in the chain (`fip-results-writer`, `fip-oop-writer`, `fip-draw-results-writer`) — each only if it accepts `onlyTournamentIds`.

Scheduled-only call sites (e.g. `fip-winner-propagator`, `fip-draw-reconciler`, `fip-draw-linker`) are **not** changed — they call with no ids → `p_only_ids` NULL → windowed.

### 3. No scheduled-cadence change
The window still governs all automatic runs.

## Testing

Per-worker Vitest (mock `supabase.rpc`): assert the RPC is called **with** `{ p_only_ids: [...] }` when `onlyTournamentIds` is set, and **without** it (or `{}`) when it isn't. (The SQL bypass itself is verified by the self-revealing rollout below; SQL functions aren't unit-tested in this repo.)

## Rollout & verification (self-revealing)

1. Apply the migration to the DB.
2. Deploy padelgod to Railway.
3. From the Data Readiness view, click **Refresh** on FIP-2026-0225 (Australian Padel Open):
   - If Crionet still serves it → snapshots + matches populate; the row flips from Broken toward OK; the button shows `✓ +N matches`.
   - If Crionet purged the old event → the button shows `✓ no new data` (the honest label already shipped), proving the limit is Crionet retention, not the worker scope.

No separate Crionet pre-check is needed — the refresh itself reveals data availability.

## Non-goals

- No change to scheduled worker windows or cadence.
- No bulk/date-range backfill tool (per-tournament refresh only).
- Does not guarantee data exists upstream for very old events (Crionet retention is out of our control).

## Acceptance

- Both RPCs accept `p_only_ids`; with it set they return the matching tournaments regardless of date window (still requiring an active widget); with it null they behave exactly as before.
- Refresh-chain workers pass the ids through; scheduled workers don't.
- Refreshing an out-of-window tournament with an active widget causes the fetchers to actually process it (no longer `tournamentsConsidered: 0`).
- Worker unit tests pass; padelgod build passes.
