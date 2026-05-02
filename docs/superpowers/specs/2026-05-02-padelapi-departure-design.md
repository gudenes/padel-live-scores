# Padelapi Departure — Padelgod owns the full match pipeline

**Status:** Design  
**Date:** 2026-05-02  
**Trigger:** Asuncion P2 (Premier) opens 2026-05-03 with two qualifier days before main draw — natural soak window for shifting Premier off padelapi.

## Goal

Stop ingesting match data from padelapi.org. After this change, padelgod owns match creation, OOP, results, and live scoring for every tier (Premier, FIP Bronze/Silver/Promises/Beyond/Platinum). Premier stats keep coming from premierpadel.com via the existing Vercel cron — that path is independent of padelapi.org and stays untouched.

## Why now

Three things came together:

1. Padelgod's `fip-draw-populator` chain is already producing canonical match rows for Bronze/Silver/Promises today. The denylist on `FIP_DRAW_POPULATOR_EXCLUDE_LEVELS` is the only block preventing it from owning Premier too.
2. Asuncion P2 starts tomorrow with two qualifier days before main draw — the natural risk-bounded window to soak the Premier path.
3. None of the FIP-tier tournaments below Premier have live point-by-point feeds from padelapi.org or anywhere else; the `live_source='padelapi'` flag on 62 active tournaments is cosmetic. `/api/cron/scores` is already running for nobody.

## End state

```
                 padelgod.draw_snapshots
                  ▲           ▲
       FIP event  │           │  Crionet
       page scrape│           │  widget scrape
                  │           │
        fip-draw-fetcher  draw-fetcher
                       (every 2h :20)
                              │
                              ▼
                     fip-draw-populator (no level filter)
                              │
                              ▼
                       public.matches
                              ▲
                              │
        ┌─────────────────────┴─────────────────────┐
        │                     │                     │
   live-poller-loop      fip-oop-writer       fip-results-writer
   (Premier live          (court/round         (final scores
    scoring; Bronze/       updates from         from Crionet
    Silver loops          OOP snapshots)        results widget)
    no-op gracefully)
```

Padelapi.org is no longer in the picture for match data. The Vercel project keeps these crons (none touch padelapi.org):
- `/api/cron/premier-stats` — premierpadel.com beforeauth API → `match_stats`
- `/api/cron/premier-discovery` — premierpadel.com → tournament/match linkage
- `/api/cron/sync-articles`, `/api/cron/sync-highlights`, `/api/cron/sync-fip-rankings`, `/api/cron/fip-streams-discover`, `/api/cron/social-drafts`, `/api/cron/oop-monitor`

## Implementation deltas

### 1. Remove the populator denylist (Railway)
Delete the `FIP_DRAW_POPULATOR_EXCLUDE_LEVELS` env var on the padelgod Railway service. Empty-string also works but deletion is cleaner — the populator already treats unset as "no level filtering" (see `excludeLevels?: Set<string>` default in `padelgod/src/workers/fip-draw-populator.ts`).

Effect: at the next `:47` populator run, Premier tournaments with rows in `padelgod.draw_snapshots` get matches inserted with `widget_id_composite`.

### 2. Bulk flip `live_source` for active tournaments
```sql
UPDATE tournaments
SET live_source = 'padelgod'
WHERE live_source = 'padelapi'
  AND COALESCE(ends_at, starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '7 days';
```
Floor of `NOW() - 7 days` skips tournaments that already finished a week ago — no point flipping cosmetic flags on long-finished events. Future-dated rows have no upper bound; any tournament-discovery row we already created for events months away gets flipped now and benefits the auto-flip default in step 3.

### 3. Auto-flip on tournament INSERT
In `padelgod/src/workers/tournament-discovery.ts`, set `live_source: 'padelgod'` on the INSERT path only. Never on UPDATE — never silently flip an in-flight tournament.

### 4. Retire Vercel padelapi crons
Remove from `vercel.json`:
- `/api/cron/scores` (`*/2 * * * *`)
- `/api/cron/sync` (hourly + weekly entries)

Route files stay in the repo for fast rollback.

### 5. Stop the Pusher relay (Railway)
`relay/index.js` subscribes to padelapi.org's Pusher channels. With nobody on `live_source='padelapi'`, it has no work. Stop the Railway service via the dashboard. Keep the code in the repo for ~30 days as a rollback option.

### 6. `PADELAPI_PAUSED` env var (deferred cleanup)
Becomes vestigial. Route guards in `src/lib/padelapi-pause.ts` and the four cron routes can stay; the env var setting just stops mattering. Removed in a later cleanup pass.

## Out of scope

Targeted improvements that surface during this work but aren't required to ship the cutover. Track separately if they need fixing:

- Removing `padelapi_id` hot columns from `matches`, `tournaments`, `players` — still useful for historical FK lookups; long-term cleanup, not blocked on anything.
- Removing `entity_external_ids[source=padelapi]` rows — same.
- Backfilling historical `live_source` on long-finished tournaments — purely cosmetic, no functional effect.
- Renaming `live_source` to something more accurate (e.g. `data_owner`) — only if we touch enough call sites for it to matter.

## Risks and verification

### Pre-deploy gates

1. **Crionet draw scrape works for Premier.** Trigger `draw-fetcher` for Asuncion (or wait for the `:20` slot) and confirm `padelgod.draw_snapshots` has rows for `tournament_id = 5027936c-9fd5-4309-83e7-44ee4620a207`. Zero rows means the Crionet draw parser doesn't handle Premier brackets — stop and fix the parser before continuing.
2. **Populator dry-run.** Run `fip-draw-populator` with `dryRun=true` against Asuncion only. The log should show N proposed inserts with `widget_id_composite` set. No actual writes.
3. **Live-poller no-op on no-live-score tiers.** Pick one Bronze tournament. After flipping `live_source='padelgod'`, watch its `LivePollerLoop` for one cycle. The loop runs in canonical mode now (writes to `public.matches`), not shadow mode. Confirm it gracefully no-ops on tiers without point data — no garbage writes.

### Deploy order (smallest blast radius first)
1. Remove env var on Railway. Asuncion populator unblocks; matches start appearing.
2. Asuncion `live_source='padelgod'` already flipped (done 2026-05-02 evening).
3. Retire `/api/cron/scores` and `/api/cron/sync` from `vercel.json` (small Vercel deploy).
4. Stop Railway relay service via dashboard.
5. Bulk flip remaining 61 tournaments after watching ~1–2h of Asuncion populator + poller.
6. Tournament-discovery auto-flip on INSERT (Railway deploy).

### Rollback paths

| Failure | Revert | Time |
|---|---|---|
| Populator creates duplicate rows for Asuncion | Re-flip Asuncion `live_source='padelapi'`; restore `FIP_DRAW_POPULATOR_EXCLUDE_LEVELS` env on Railway. | ~3 min |
| Live-poller writes bad data on Bronze/Silver after bulk flip | Reverse the bulk SQL on non-Premier rows; restore `/api/cron/scores` in `vercel.json`. | ~5 min |
| Premier match scoring stops mid-tournament | Revert Asuncion only; restart Railway relay. | ~5 min |

### Soak monitoring (first 48h)
- `padelgod.scrape_jobs` for Asuncion: steady draw/oop/results fetches, `status='success'`.
- `public.matches` for Asuncion: row count grows as draws populate; `widget_id_composite` non-null on every row.
- `match_stats` for Asuncion: rows appear after each Premier match completes via `premier-stats` cron.
- `padelgod.match_stats_unresolved`: no new rows for Asuncion.
- `scripts/dedup-pattern-b-multi-pipeline.mjs --dry-run`: no new duplicate clusters.

### Known sharp edges

`findPadelapiTwin` in `padelgod/src/lib/match-identifier.ts` has a code path that resolves matches via `padelapi_id`. Premier matches created by the populator won't have `padelapi_id` set. Worth a grep during implementation to confirm the live-poller doesn't depend on `padelapi_id` for the canonical path.

`/api/matches/[id]/live` and similar public-app routes may query by `padelapi_id`. Quick scan needed during implementation. Most reads are by UUID `id`, but worth confirming.

## What this design does not solve

- The longer-term question of whether to keep `live_source` as a flag at all, or whether to make every tournament padelgod-owned implicitly. Defer.
- The longer-term question of how to reduce the population in `entity_external_ids` for historical padelapi rows. Defer.
- Any UI changes for displaying Premier matches. Tomorrow's matches will render through the same components as today's; only the row provenance changes.
