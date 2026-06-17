# Webtuga live-notify — fire the on-court push on the webtuga `scheduled → live` flip

**Date:** 2026-06-17
**Status:** Approved (design)
**Branch:** `feat/webtuga-live-notify` (worktree `.claude/worktrees/webtuga-notify`, off `origin/main`)
**Related:** [`2026-06-16-webtuga-live-score-worker-design.md`](2026-06-16-webtuga-live-score-worker-design.md) (v1, which deliberately shipped with no live-notify)

## Problem

The `webtuga-live-fetcher` worker (shipped PR #558, live for FIP Platinum Lusitania
Portugal Master Padel 2026) ingests genuine live point-by-point for an event that
PadelNachos otherwise captures nothing of, and flips `matches.status`
`scheduled → live`. But v1 **does not** fire the existing on-court push
(`notifyLiveTransition`) — the spec suppressed it deliberately, to avoid being the
first thing to introduce live pushes for an event whose qualifying rounds also flow
through webtuga.

Consequence today: a Lusitania match goes live, the scoreboard updates on
padelnachos.com, but **no fan gets the "X is on court" push** — even fans who
explicitly follow one of the four players or bookmarked the match. For these
FIP-tier matches no other writer fires the push either (the Premier live-poller
doesn't cover them; the Vercel crons are paused behind `PADELAPI_PAUSED`). The push
is simply missing.

## Goal

Make the webtuga worker fire the **existing** on-court push on the genuine
`scheduled → live` transition, for **every** webtuga match regardless of round
(qualifying included). Reuse the existing notification path end to end — no new
notification category, no `/api/push/notify` changes, no UI work.

## Decisions (from brainstorming)

- **Coverage: all rounds, both triggers.** Following a player is an explicit
  opt-in, so the push fires regardless of round (qualifying included). Match
  bookmarks are likewise an explicit opt-in, so they fire for all rounds too. The
  rule is therefore a single unconditional notify on the genuine edge — no
  round filter, no per-trigger branching.
- **Reuse the existing gating process — no dedicated flag.** Gate exactly like the
  Premier live-poller: fire whenever the worker is enabled, it is not a dry run, a
  real flip happened, and the notify env is configured. We explicitly chose **not**
  to add a `ENABLE_WEBTUGA_LIVE_NOTIFY` kill-switch — the worker's existing
  `enableWebtugaLive` + `webtugaLiveDryRun` flags plus `notifyLiveTransition`'s
  env-presence no-op are the controls.

## Non-goals

- No changes to `/api/push/notify`, notification categories, icons, or recipient
  resolution. The endpoint already auto-detects the on-court event from
  `match.status='live'` and fans out to followers + bookmarkers.
- No new "specific PBP event" notifications (set won, break, match point, etc.).
  This spec is **only** the on-court (`scheduled → live`) push. Richer PBP-event
  pushes are a possible later project, out of scope here.
- No frontend changes.
- No new flag or env var.

## Architecture

Single-file behavioral change in `padelgod/src/workers/webtuga-live-fetcher.ts`,
reusing `notifyLiveTransition` from `padelgod/src/lib/notify.ts` and the
`deps.notify: NotifyDeps | undefined` already present on `SchedulerDeps` (the same
object the worker already receives — no plumbing needed).

### Fire-once correctness

The worker runs every ~15s and calls `flipStatusToLive` every tick, but the push
must fire **exactly once** per match — on the real `scheduled → live` edge. This
falls out of the existing guarded update:

1. `flipStatusToLive` changes from `Promise<void>` to `Promise<boolean>`:
   ```ts
   async function flipStatusToLive(supabase, matchId): Promise<boolean> {
     const { data } = await supabase
       .from('matches')
       .update({ status: 'live' })
       .eq('id', matchId)
       .eq('status', 'scheduled')
       .select('id');           // returns affected rows
     return (data?.length ?? 0) > 0;
   }
   ```
2. The `.eq('status','scheduled')` guard means a row is returned **only** on the
   first tick that actually transitions the match. Every later tick (status already
   `live`) returns `[]` → `false` → no push. A match `fip-results-writer` already
   moved to `finished` also returns `[]` → no spurious push, no regression.
3. In the per-row write block, capture the boolean and, when `true`, fire:
   ```ts
   const flipped = await flipStatusToLive(supabase, entry.matchId);
   if (flipped && deps.notify) {
     notifyLiveTransition(entry.matchId, deps.notify); // fire-and-forget
   }
   ```
   `notifyLiveTransition` is synchronous-return / fire-and-forget — it dispatches
   the POST and never blocks or throws, so the tick is unaffected. It is already a
   silent no-op when `NOTIFY_BASE_URL`/`CRON_SECRET` are missing.

This is the identical prevStatus-edge pattern the live-poller and Vercel crons use,
so cross-writer dedup behavior is unchanged from production.

### Gating (reusing today's process)

`notifyLiveTransition` is reached only when **all** hold:

| Guard | Mechanism |
|---|---|
| Worker enabled | `enableWebtugaLive` (already gates the whole worker run) |
| Not a dry run | `opts.dryRun` short-circuits with `continue` **before** the write block, so notify is never reached |
| Real transition | `flipped === true` (the `.select()` rows-returned check) |
| Notify configured | `deps.notify` defined **and** `notifyLiveTransition`'s own no-op when `baseUrl`/`cronSecret` env missing |

### Idempotency / restart safety

Stateless-cron restart cases:
- Flip commits, then the process dies before notify dispatches → next tick sees
  `live`, returns `false`, no push. A rare **missed** push (acceptable — better than
  a double).
- Flip commits, notify dispatches, then crash → fine, no double (the flip returns
  rows only once).

No new double-send risk versus today's live-poller path.

## Testing

Pure unit tests in `padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts`
(existing style: injected `fetch`/`supabase`, no network), asserting against a
mock/spy `notify`:

1. **Fires once on the edge** — a match flipping `scheduled → live` calls notify
   exactly once.
2. **No double on subsequent ticks** — a second tick with the match already `live`
   in DB does not call notify.
3. **No flip → no notify** — a match already `live`/`finished` in DB never notifies.
4. **Dry-run → no notify** — `opts.dryRun=true` never calls notify.
5. **No notify deps → no throw** — `deps.notify` undefined: worker completes, no
   error.

Manual verification on Railway (worker already deployed + enabled for Lusitania):
deploy this change, then on the next live Lusitania match confirm `/admin/notify-stats`
increments and a test follow receives the on-court push.

## Files touched

- `padelgod/src/workers/webtuga-live-fetcher.ts` — `flipStatusToLive` returns
  `boolean`; fire `notifyLiveTransition` on a true flip. Update the worker's
  header comment (currently says "No live-notify in v1").
- `padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts` — new notify tests.

## Rollout

No env/flag changes. Merge → deploy padelgod to Railway. The worker is already
enabled (`ENABLE_WEBTUGA_LIVE=true`, `WEBTUGA_LIVE_DRY_RUN=false`) and Railway
already has `NOTIFY_BASE_URL`/`CRON_SECRET` (the live-poller uses them), so pushes
begin on the next live Lusitania match automatically. Rollback = revert the commit
and redeploy (or set `ENABLE_WEBTUGA_LIVE=false` to disable the whole worker).
