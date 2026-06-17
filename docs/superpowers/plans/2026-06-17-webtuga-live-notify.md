# Webtuga live-notify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fire the existing on-court push (`notifyLiveTransition`) when the webtuga worker flips a match `scheduled → live`, for every webtuga match regardless of round.

**Architecture:** A single-file behavioral change in `padelgod/src/workers/webtuga-live-fetcher.ts`. `flipStatusToLive` already does a guarded `UPDATE … WHERE status='scheduled'`; we make it report whether a row was actually flipped (via `.select('id')`) and, on a true flip, fire-and-forget `notifyLiveTransition(matchId, deps.notify)`. The guard guarantees the push fires exactly once per match. Reuses the `deps.notify: NotifyDeps | undefined` already present on the `SchedulerDeps` the worker receives — no plumbing, no new flag.

**Tech Stack:** TypeScript, Node, Vitest. Padelgod Railway worker.

**Spec:** `docs/superpowers/specs/2026-06-17-webtuga-live-notify-design.md`

---

## File Structure

- `padelgod/src/workers/webtuga-live-fetcher.ts` — MODIFY. `flipStatusToLive` returns `boolean`; the per-row write block fires notify on a true flip; header comment updated.
- `padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts` — MODIFY. Mock the notify module; update the supabase mock so the flip's `.select('id')` resolves; add notify-firing tests.

No other files change. No env/flag/schema changes.

---

## Reference: current code

`flipStatusToLive` (current, `webtuga-live-fetcher.ts` ~lines 111–118):

```ts
/** Guarded scheduled→live flip. Never regresses live/finished/retired/walkover. */
async function flipStatusToLive(supabase: SupabaseClient, matchId: string): Promise<void> {
  await supabase
    .from('matches')
    .update({ status: 'live' })
    .eq('id', matchId)
    .eq('status', 'scheduled');
}
```

Call site (current, inside the per-row `try` block ~lines 188–191):

```ts
        await applyDiff(supabase, entry.matchId, prev, curr, diff, rp);
        await flipStatusToLive(supabase, entry.matchId);
        await writeLastState(supabase, t.tournamentId, rowItem.id, entry.orientation, curr);
        res.applied++;
```

`notifyLiveTransition` signature (from `padelgod/src/lib/notify.ts`):

```ts
export function notifyLiveTransition(matchId: string, deps: NotifyDeps): void
```

It is fire-and-forget (returns immediately, never throws) and is itself a silent no-op when `deps.baseUrl`/`deps.cronSecret` are missing. `deps` here is the worker's `deps.notify` (already typed `NotifyDeps | undefined` on `SchedulerDeps`).

---

## Task 1: Make `flipStatusToLive` report the flip and fire notify

**Files:**
- Modify: `padelgod/src/workers/webtuga-live-fetcher.ts`
- Test: `padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts`

- [ ] **Step 1: Add the notify module mock + flip-aware supabase mock to the test file**

At the TOP of `padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts`, directly under the existing `applyDiff` hoisted mock block (after line 7), add a hoisted spy for the notify module:

```ts
const notifyLiveTransition = vi.hoisted(() => vi.fn());
vi.mock('../../lib/notify.js', () => ({ notifyLiveTransition }));
```

Then REPLACE the existing `makeSupabase` function (lines 31–46) with a version that accepts an optional `flipped` flag and whose `update().eq().eq().select('id')` chain resolves to affected rows:

```ts
function makeSupabase(opts: { flipped?: boolean } = {}) {
  const flipped = opts.flipped ?? true;
  // .update(...).eq('id',..).eq('status','scheduled').select('id') → affected rows
  const statusUpdate = vi.fn(() => ({
    eq: () => ({
      eq: () => ({
        select: async () => ({
          data: flipped ? [{ id: 'uuid-garcia' }] : [],
          error: null,
        }),
      }),
    }),
  }));
  const supabase: any = {
    from: vi.fn((table: string) => {
      if (table === 'matches') {
        return {
          select: () => ({ eq: () => ({ then: (r: any) => r({ data: [CANDIDATE], error: null }) }) }),
          update: statusUpdate,
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _statusUpdate: statusUpdate,
  };
  return supabase;
}
```

Add a `notify` stub constant near the `logger` constant (after line 58):

```ts
const notify = { baseUrl: 'https://x', cronSecret: 'y', logger } as any;
```

In the existing `beforeEach` (lines 61–65), add a reset for the notify spy — change the block to:

```ts
  beforeEach(() => {
    applyDiff.mockReset();
    applyDiff.mockResolvedValue(undefined);
    notifyLiveTransition.mockReset();
    vi.restoreAllMocks();
  });
```

- [ ] **Step 2: Write the failing test — fires notify once on a real flip**

Add this test inside the `describe('runWebtugaLiveFetcher', …)` block, after the existing first-tick test:

```ts
  it('fires notifyLiveTransition once on a genuine scheduled→live flip', async () => {
    baseSpies();
    const supabase = makeSupabase({ flipped: true });

    await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger, notify },
      { dryRun: false },
    );

    expect(notifyLiveTransition).toHaveBeenCalledTimes(1);
    expect(notifyLiveTransition).toHaveBeenCalledWith('uuid-garcia', notify);
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/workers/webtuga-live-fetcher.test.ts -t "fires notifyLiveTransition"`
Expected: FAIL — `notifyLiveTransition` called 0 times (the worker doesn't call it yet).

- [ ] **Step 4: Implement — return the flip result and fire notify**

In `padelgod/src/workers/webtuga-live-fetcher.ts`, REPLACE `flipStatusToLive` (lines 111–118) with:

```ts
/**
 * Guarded scheduled→live flip. Never regresses live/finished/retired/walkover.
 * Returns true only when this call actually transitioned the row (the
 * `.eq('status','scheduled')` guard returns rows on the first such tick only),
 * so the caller can fire the on-court push exactly once per match.
 */
async function flipStatusToLive(supabase: SupabaseClient, matchId: string): Promise<boolean> {
  const { data } = await supabase
    .from('matches')
    .update({ status: 'live' })
    .eq('id', matchId)
    .eq('status', 'scheduled')
    .select('id');
  return (data?.length ?? 0) > 0;
}
```

Add the import for `notifyLiveTransition` near the other lib imports (after line 26, `import { webtugaToLiveState } …`):

```ts
import { notifyLiveTransition } from '../lib/notify.js';
```

In the per-row `try` block, REPLACE the line `await flipStatusToLive(supabase, entry.matchId);` (line 189) with:

```ts
        const flipped = await flipStatusToLive(supabase, entry.matchId);
        if (flipped && deps.notify) {
          // Reuse the same on-court push the Premier live-poller fires.
          // Fire-and-forget: returns immediately, never throws.
          notifyLiveTransition(entry.matchId, deps.notify);
        }
```

(`deps` is already destructured at the top of `runWebtugaLiveFetcher`; reference `deps.notify` directly — note `const { supabase, httpClient, logger } = deps;` does not include `notify`, so use `deps.notify`.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/workers/webtuga-live-fetcher.test.ts -t "fires notifyLiveTransition"`
Expected: PASS.

- [ ] **Step 6: Update the worker header comment**

In `padelgod/src/workers/webtuga-live-fetcher.ts`, the file header block (lines 1–19) ends with `* died mid-row last tick) ... never double-counts.` — but it also contains the line (line 15) `* canonical mode default) so Crionet's fip-results-writer keeps owning the` and the sentence `No live-notify in v1.`

Find the sentence `No live-notify in v1.` in the header and REPLACE it with:

```
 * On a genuine scheduled→live flip it fires the existing on-court push
 * (notifyLiveTransition) — the same one the Premier live-poller sends.
```

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/workers/webtuga-live-fetcher.ts padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts
git commit -m "feat(webtuga): fire on-court push on scheduled→live flip"
```

---

## Task 2: Guard tests — no double-fire, dry-run, missing deps, no-flip

**Files:**
- Test: `padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts`

- [ ] **Step 1: Write the guard tests**

Add these four tests inside the `describe('runWebtugaLiveFetcher', …)` block, after the Task 1 test:

```ts
  it('does NOT fire notify when the row did not flip (already live/finished)', async () => {
    baseSpies();
    const supabase = makeSupabase({ flipped: false });

    await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger, notify },
      { dryRun: false },
    );

    expect(notifyLiveTransition).not.toHaveBeenCalled();
  });

  it('does NOT fire notify in dryRun mode', async () => {
    baseSpies();
    const supabase = makeSupabase({ flipped: true });

    await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger, notify },
      { dryRun: true },
    );

    expect(notifyLiveTransition).not.toHaveBeenCalled();
  });

  it('does NOT fire notify when deps.notify is undefined, and does not throw', async () => {
    baseSpies();
    const supabase = makeSupabase({ flipped: true });

    const res = await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger },
      { dryRun: false },
    );

    expect(notifyLiveTransition).not.toHaveBeenCalled();
    expect(res.errors).toBe(0);
    expect(res.applied).toBe(1);
  });
```

(Note: the "fires once" guarantee on subsequent ticks is the same code path as the `flipped: false` case — once a match is `live`, the guarded UPDATE returns no rows, exactly what `makeSupabase({ flipped: false })` models. No separate two-tick test is needed because the worker is stateless per tick.)

- [ ] **Step 2: Run the full worker test file**

Run: `cd padelgod && npx vitest run src/__tests__/workers/webtuga-live-fetcher.test.ts`
Expected: PASS — all tests (3 pre-existing + 1 from Task 1 + 3 new) green.

- [ ] **Step 3: Run the full padelgod test suite + typecheck**

Run: `cd padelgod && npx vitest run && npx tsc --noEmit`
Expected: full suite PASS, no type errors. (`tsc` confirms `flipStatusToLive`'s new `Promise<boolean>` return and the `deps.notify` reference typecheck against `SchedulerDeps`.)

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts
git commit -m "test(webtuga): guard cases for on-court notify (no-flip, dryRun, no-deps)"
```

---

## Self-Review

- **Spec coverage:**
  - "fire on genuine scheduled→live edge, exactly once" → Task 1 (Step 4 guarded `.select('id')` + `flipped` check) + Task 2 (no-flip test).
  - "all rounds, both triggers, single unconditional notify" → Task 1 fires on every flip with no round/trigger branch (recipient fan-out is `/api/push/notify`'s existing job).
  - "reuse existing gating, no new flag" → `if (flipped && deps.notify)` + notify's env no-op; no flag added.
  - "dry-run never notifies" → Task 2 dryRun test.
  - "no throw when notify unconfigured" → Task 2 missing-deps test.
  - "update header comment (was 'No live-notify in v1')" → Task 1 Step 6.
- **Placeholder scan:** none — all test and impl code shown inline.
- **Type consistency:** `flipStatusToLive` returns `Promise<boolean>` (Task 1 Step 4) and is consumed as `const flipped = await flipStatusToLive(...)`. `notifyLiveTransition(matchId: string, deps: NotifyDeps)` called as `notifyLiveTransition(entry.matchId, deps.notify)` with `deps.notify` truthy-guarded. Mock `_statusUpdate` chain (`.eq().eq().select()`) matches the impl call order.
