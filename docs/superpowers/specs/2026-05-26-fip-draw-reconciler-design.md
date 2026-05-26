# fip-draw-reconciler — design

**Date:** 2026-05-26
**Status:** approved, ready for plan

## Problem

When a tournament's draw changes after the populator has already INSERTed `public.matches` rows — typical case: a team withdraws and FIP rewrites that quadrant of the bracket, reassigning seeds and BYE slots — our `public.matches` table stays pinned to the *original* mapping. The `fip-draw-populator` UPDATE branch is a deliberate NULL-only gap-filler ([padelgod/src/workers/fip-draw-populator.ts:999-1022](../../../padelgod/src/workers/fip-draw-populator.ts:999)) on the assumption that team assignments are immutable post-INSERT. That assumption breaks every time FIP edits the draw mid-tournament.

The 2026-05-26 Albania incident exposed two flavours of the bug on a single tournament:

- **MD020** (R32): originally Garrido/Bergamini vs Hernandez/Collado. After withdrawals, FIP rebuilt the slot as Barahona/Alfonso (seed 9) vs Hernandez/Collado. Our row kept Garrido/Bergamini as `pair1` — a phantom match that Crionet's OOP correctly marked `finished` (because the *real* match at that widget already played) while our app advertised it as upcoming on Court 2 16:00.
- **MD011** (R16): originally a Leal/Guerrero walkover bye. Leal/Guerrero withdrew; FIP reassigned the slot as a Garrido/Bergamini walkover bye. Our row kept `pair2 = Leal/Guerrero, status='scheduled'` — the bracket display showed an extinct team advancing.

Both were fixed by hand (one-off scripts in `scripts/fix-md020-pair1.ts` and `scripts/fix-md011-bye.ts`). This spec covers the recurring fix: a worker that detects draw drift and applies it automatically with appropriate safety gates.

This is not a populator change — the populator's NULL-only fill is correct for its own purpose (gap-fill on first INSERT). The reconciler is a separate, more aggressive pass that runs *after* the populator and is allowed to overwrite resolved fields when the latest draw_snapshot disagrees with the existing row.

## Decision

New padelgod worker **`fip-draw-reconciler`** registered in [padelgod/src/scheduler.ts](../../../padelgod/src/scheduler.ts), running hourly at :50 (the populator runs in the :00–:35 window; the :50 slot leaves 15+ min slack). It iterates active tournaments via the standard `padelgod_active_tournaments_with_slug` RPC, loads each tournament's widget id from `widget_id_cache`, compares the latest `fip_event_page` `draw_snapshot` per widget against the existing `public.matches` row, and applies a full-sync UPDATE when it finds drift — gated by a small set of immutability checks that protect any row showing evidence that play has happened.

## Scope

**In:**

1. New worker module [`padelgod/src/workers/fip-draw-reconciler.ts`](../../../padelgod/src/workers/fip-draw-reconciler.ts).
2. New shared module [`padelgod/src/lib/draw-resolver.ts`](../../../padelgod/src/lib/draw-resolver.ts) — extracts the populator's existing player-resolution helpers (`loadPlayersByFipId` + name-fallback resolution) so the reconciler and the populator share one canonical resolution path. Populator is refactored to import from there; behaviour preserved.
3. Pure-function patch builder `computeReconciliationPatch(draw, existing, resolved)` co-located in the worker file — unit-testable in isolation, analogous to `buildOopPatch` in [fip-oop-writer.ts:401](../../../padelgod/src/workers/fip-oop-writer.ts:401).
4. Pair-orientation matching — try both `(pair1↔T1, pair2↔T2)` and the swap; pick the orientation that maximises slot agreement to avoid false drift when Crionet swaps T1/T2 between captures.
5. BYE transition handler — when the latest draw shows `status=walkover` with one team-side empty, set the bye-recipient on one pair, clear the opposite pair, set `status='walkover'` and `winner_pair` to the bye side.
6. Scheduler entry in [padelgod/src/scheduler.ts](../../../padelgod/src/scheduler.ts) at the `:50` slot, after `fip-draw-populator` and `fip-event-page-enricher`.
7. Unit tests for `computeReconciliationPatch` covering team swap, BYE transition, pair-orientation swap, both-teams walkover, round-label canonicalisation, and each safety-gate skip.
8. `onlyTournamentIds?: Set<string>` parameter on `runFipDrawReconciler` (matching the existing `fip-oop-writer` / `fip-results-writer` shape), so future ops endpoints can trigger a single tournament's reconciliation on demand without touching this spec.
9. `dryRun: boolean` deps flag (no default — caller must pass; matches existing writer convention) that logs proposed updates instead of writing.

**Out:**

- An ops dashboard button to trigger reconciliation on demand. The `onlyTournamentIds` hook is in place; the UI surface is a separate concern.
- Reconciling fields the populator never owns (court, court_order, scheduled_at, schedule_label) — those belong to `fip-oop-writer`.
- Reconciling `winner_pair` for non-BYE walkovers. Real walkovers are the results-writer's domain.
- A reconciler for `oop_snapshot`-source rows. Only `fip_event_page` snapshots are authoritative for team identity; the OOP fallback is too noisy.
- Modifying or relaxing the populator's NULL-only fill rule. The populator's contract stays exactly as today.
- Backfill of pre-existing drift on inactive tournaments. The worker only operates on active tournaments; old drift would need a one-shot script if anyone cares.

## Architecture

```
                    every :50
            ┌────────────────────────────┐
            │  fip-draw-reconciler       │
            │  (new worker)              │
            └────────────────────────────┘
                       │
                       ▼
       padelgod_active_tournaments_with_slug
                       │
                       ▼
       per tournament:
         ┌─────────────────────────────────────┐
         │ load widget_id from widget_id_cache │
         │ load latest fip_event_page          │
         │   draw_snapshots per widget         │
         │ load public.matches for tournament  │
         │ load sets-existence per match_id    │
         └─────────────────────────────────────┘
                       │
                       ▼
       per (widget, existing match) pair:
         ┌─────────────────────────────────────┐
         │  safety gates                       │
         │  → skip if terminal/live/has-sets   │
         │  resolve draw player UUIDs          │
         │  pick best pair orientation         │
         │  computeReconciliationPatch(...)    │
         │  if patch non-empty → UPDATE        │
         └─────────────────────────────────────┘
```

Reconciler holds no state. Every run reads ground truth and computes a fresh patch. No checkpoint table, no `last_reconciled_at` column — staleness is acceptable for an hourly worker, and the patch is always idempotent (a re-run on a non-drifted row produces an empty patch and writes nothing).

## Safety gates

A row is **skipped without inspection** when ANY of:

- `matches.status` ∈ {`finished`, `retired`} — match results are sacred; let nothing un-do a recorded result.
- `matches.status` = `live` — the match is on court right now; don't rewrite teams during play.
- A row exists in `sets` for `matches.id` — proves play happened, regardless of `status`. Catches the edge case where `status` got reset but score data lingers.

Eligible statuses include: `scheduled`, `walkover`, `bye`, `ended`, anything else. A `walkover` row is still inspected so the MD011 pattern (walkover already set, but on the wrong team) can be corrected.

**Slot-level skip:** within an otherwise-eligible row, if the draw_snapshot has a name in a given slot but resolution fails (no player with that fip_id or name → null UUID), leave the existing FK alone. Don't degrade a resolved row to thin.

## Drift detection

For each eligible widget:

1. **Resolve the four draw player slots → UUIDs.** Uses the shared `draw-resolver` module (extracted from the populator). Each slot resolves independently. Result is a `{p1p1, p1p2, p2p1, p2p2}` of `string | null`.

2. **Pair-orientation matching.** Compute slot agreement for both orientations:

   - Direct: `(db.pair1_player1_id, db.pair1_player2_id)` against `(resolved.p1p1, resolved.p1p2)`, plus the equivalent pair2 check.
   - Swapped: `(db.pair1_*)` against `(resolved.p2*)`, plus the inverse.

   Pick the orientation with more matching slots. Tie → direct. This avoids false drift when Crionet flips T1/T2 between captures.

3. **BYE detection.** Draw row is a BYE when `draw.status === 'walkover'` AND exactly one of `(team1_player1_name||team1_player2_name)`, `(team2_player1_name||team2_player2_name)` is empty. The non-empty team is the bye recipient.

4. **Patch computation.** Build a minimal patch object covering only fields with confirmed drift. The patch builder is pure (`computeReconciliationPatch`) and takes `(draw, existing, resolved, orientation, byeInfo)` → `Record<string, unknown> | null`.

## Patch construction

### Non-BYE rows

For each of the 4 player slots (using the chosen orientation):

- If `resolved[slot] !== null` and `resolved[slot] !== existing[slot_fk]` → overwrite `pair*_player*_id`. Also blank `pair*_player*_name` and `pair*_player*_country` for that slot (they're display fallbacks for thin rows; once the FK is set, the join repopulates display data on read).
- If `resolved[slot] === null` and `existing[slot_fk] !== null` → **leave it alone** (slot-level skip).
- If `resolved[slot] === null` and `existing[slot_fk] === null` → no-op.

For seeds (per pair, using the chosen orientation):

- If `draw.team*_seed !== existing.pair*_seed` → overwrite (including `null ⇄ value`).

For round:

- Canonicalise both `draw.round_label` and `existing.round` to short form (R32/R16/QF/SF/F/Q1/Q2/Q3) via `normalizeRoundShort` — same helper as `fip-oop-writer`.
- If canonical forms differ → overwrite `round` (with the verbose draw label) and `round_canonical`.

For status:

- If `draw.status === 'walkover'` and `existing.status === 'scheduled'` → set `status = 'walkover'`.
- Otherwise leave `status` alone.
- `winner_pair` is **not** set in the non-BYE path. Real walkovers (both teams named, one withdrew) come with a results-writer-owned `winner_pair`; we wait for that source rather than guessing.

### BYE rows

Special path. Target state:

- Bye-recipient team → one pair (preserve which side: if bye-recipient was in T2 in the draw, place in pair2; mirror for T1). This keeps orientation stable when one bracket line consists of multiple bye-then-real-match transitions.
- Opposite pair → cleared (player FKs, names, countries, seed all set to null).
- `status = 'walkover'`.
- `winner_pair = <bye side>` (1 or 2 depending on which pair holds the recipient).
- `pair*_seed` on the bye side copied from `draw.team*_seed`.

If `existing` already matches this target state, the patch is empty (no-op).

## Observability

Result shape exported from `runFipDrawReconciler`:

```ts
export interface FipDrawReconcilerResult {
  tournamentsProcessed: number
  matchesConsidered: number
  matchesSkippedTerminal: number   // finished / retired
  matchesSkippedLive: number
  matchesSkippedHasSets: number
  matchesSkippedNoDraw: number     // no fip_event_page snapshot for the widget
  matchesUnchanged: number         // inspected, no drift
  matchesUpdated: number
  byeTransitionsApplied: number    // subset of matchesUpdated
  dryRun: boolean
}
```

Per-update: `logger.info({ matchId, widget, diff }, 'fip-draw-reconciler: UPDATE')`. The `diff` object lists changed fields with `{ from, to }` for each. Auditable from Railway logs.

Per-skip-with-reason: `logger.debug` only — keep the INFO stream readable.

## Testing

Unit tests for `computeReconciliationPatch` in [`padelgod/src/workers/__tests__/fip-draw-reconciler.test.ts`](../../../padelgod/src/workers/__tests__/fip-draw-reconciler.test.ts):

- **MD020 case** — team swap on pair1, seed change 5→9. Expect patch on pair1_player1_id / pair1_player2_id / pair1_seed; pair2 untouched.
- **MD011 case** — pair2 swap + status flip + winner_pair set + seed change. Expect BYE-transition patch.
- **Pair-orientation swap** — DB has (Smith, Jones) as pair1 and (Brown, Lee) as pair2; draw has them in reverse. Expect no patch (orientation chosen handles the swap).
- **Both-teams walkover** — DB scheduled, draw walkover with both teams named. Expect status flip only; no winner_pair.
- **Round-label canonicalisation** — DB has `Round of 16`, draw has `R16`. Expect no patch (canonical forms match).
- **Round-label drift** — DB has `R32`, draw has `R16`. Expect round + round_canonical patch.
- **Slot-level skip on unresolved name** — DB has resolved pair1_player1_id, draw has a name for that slot but resolver returns null. Expect that slot left alone.
- **Safety gate: terminal status** — `existing.status='finished'`. Patch is null regardless of drift.
- **Safety gate: live status** — `existing.status='live'`. Patch is null.
- **No-drift idempotency** — eligible row already matches draw. Patch is null.

The "has-sets" safety gate is enforced at the worker level (the worker pre-loads a `Set<matchId>` of match ids with any `sets` rows and skips those before calling the patch builder), not inside the pure function. No test for it — the worker iterates a list filtered before patch calls, so the patch builder never sees ineligible rows. Same project pattern as `fip-oop-writer` (purity-at-the-edge, gating in the iterator).

Integration tests against a real Supabase test DB are out of scope; the project's pattern is pure-function unit tests for `*-writer` workers, and the reconciler follows that pattern.

## Migration / rollout

1. Ship the worker with `dryRun: true` in the scheduler for one run cycle (one hour).
2. Inspect Railway logs for the proposed UPDATE diffs. Confirm no surprises on live tournaments.
3. Flip to `dryRun: false` and let it run.
4. Watch the next-week tournament cycle for any unintended overwrites; revert by reverting the scheduler entry if needed (worker remains in code but inert).

No DB migration needed.

## Out-of-scope follow-ups (deferred)

- Ops UI button to trigger reconciliation per tournament.
- Backfill of pre-existing drift on already-finished tournaments.
- Reconciliation of `oop_snapshot`-source rows where no `fip_event_page` exists (smaller draws / amateur tiers).
- Telemetry alert when reconciler updates exceed a threshold per tournament (e.g. >10 corrections might indicate a populator bug needing investigation).
