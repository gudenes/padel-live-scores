# Padelgod FIP rankings migration — design

**Date:** 2026-05-18
**Status:** approved, ready for plan
**Related:** [`player_ranking_snapshots` table](../../../supabase/migrations) · [ranking history capture plan](2026-05-10-ranking-history-capture.md)

## Problem

FIP player rankings are currently written to Supabase by two parallel paths, neither of which has worked correctly on Monday 2026-05-18:

1. **Vercel cron** at [`/api/cron/sync-fip-rankings`](../../../src/app/api/cron/sync-fip-rankings/route.ts) — four split invocations at 07:00/07:05/07:10/07:15 UTC (official ×2 genders, race ×2 genders). The two `official` splits **silently 504** at Vercel's 120s `maxDuration` ceiling on the per-player resolver loop. The splitter fix that landed earlier this year has regressed — likely from accumulated resolver overhead. This morning's scheduled official runs wrote **zero** snapshot rows; only `race` succeeded (131 men, 127 women at 07:10/07:15).

2. **Padelgod worker** [`player-rankings.ts`](../../../padelgod/src/workers/player-rankings.ts) — daily 07:00 UTC, intended on 2026-05-11 (commit `c33615da`) to take over from Vercel. It scrapes `padelfip.com/ranking/?gender=*` and parses with cheerio against `table.ranking-table > tbody > tr`. **FIP redesigned that page** (now redirects to `/fip-rankings/?gender=*` with new `table.table__ranking` markup, and only the top 20 rows are server-rendered). The selectors no longer match anything. The worker reports `scrape_jobs.status='success'` because the HTTP fetch returns 200 — but it has written exactly **zero** rows to `player_ranking_snapshots` since the day it shipped.

The result on 2026-05-18 morning: the public men's + women's official top-500 rankings were stale until an ad-hoc trigger at 12:48 UTC managed to push 511 men + 496 women rows through (despite still receiving 504 to the caller — the function kept writing past the response cutoff).

### Why "FIP hasn't published yet" is mostly red herring

The framing — "we tried this morning, nothing was updated because the site wasn't yet updated" — is incorrect. By 07:10 UTC the FIP WP API already returned the new week's data (race did write successfully). The morning's official splits failed for a Vercel-timeout reason, not a FIP-availability reason. This design solves the timeout root cause; "smart publish detection" is a side effect of running more often on the day FIP refreshes.

## Decision

Padelgod becomes the sole automated writer of FIP rankings. Vercel's cron is deleted in the same PR. Padelgod's worker is rewritten to call the FIP **WP JSON API** (the same endpoint Vercel uses), not the HTML page. Schedule changes from daily 07:00 to "every 30 min Monday 06:00–12:00 UTC + daily 07:00 Tue–Sat."

## Scope

**In:**

1. Rewrite [`padelgod/src/workers/player-rankings.ts`](../../../padelgod/src/workers/player-rankings.ts) to call FIP WP JSON endpoints (`/wp-json/fip/v1/ranking/load-more/` and `/wp-json/fip/v1/player/search?search_type=race`).
2. Cover **all four pairs**: official-men, official-women, race-men, race-women — each as a separate `runScrapeJob` phase inside one worker invocation.
3. Resolve players via **fip_id-keyed upsert** (mirror of [`fip-entry-list-populator.ts:200-280`](../../../padelgod/src/workers/fip-entry-list-populator.ts)). No fuzzy resolver port — the WP API returns `player_id` for every row.
4. Capture full field parity with current Vercel path: `ranking`, `points`, `ranking_move`, `fip_id`, `name`, `country`, `category`, `profile_url`, plus `player_ranking_snapshots` rows tagged `source='padelgod-fip'`.
5. Avatar rehosting — mirror [`src/lib/avatar-rehost.ts`](../../../src/lib/avatar-rehost.ts) into `padelgod/src/lib/avatar-rehost.ts`; collect `(playerId, thumbnail)` pairs from all four phases via a deduping `Map<string, string>`; flush post-loop in 20-wide `Promise.all` batches.
6. Race-dropout handling — players previously in race who are not written this run get `race_ranking/points/move` NULLed, chunked at 200 per UPDATE.
7. New schedule registered in [`padelgod/src/scheduler.ts`](../../../padelgod/src/scheduler.ts):
   - `'0,30 6-12 * * 1'` (every 30 min Monday 06:00–12:00 UTC — 13 runs)
   - `'0 7 * * 2-6'` (daily 07:00 Tue–Sat — 5 runs)
8. Fail-loud guardrails (Section 4 below).
9. Delete Vercel cron entries + cron route file (Section 5 below).
10. Replacement unit + scheduler tests.

**Out:**

- Porting the full 5-tier `PlayerResolver` to padelgod. The WP rankings API returns canonical FIP ids, making fuzzy/alias resolution unnecessary for this worker.
- Touching the on-demand admin route at [`/api/admin/sync-fip-rankings`](../../../src/app/api/admin/sync-fip-rankings/route.ts). It stays callable as an operator escape hatch; its snapshots get re-tagged from `'vercel-fip'` to `'vercel-fip-manual'` to distinguish from automated runs (historical `'vercel-fip'` rows remain as-is).
- Backfilling missing weeks. The existing append-only snapshot table holds whatever both paths wrote; gaps from this morning's failure are already partially patched by the 12:48 ad-hoc trigger. No history rewrite.
- Wiring Sentry Crons (`Sentry.cron.MongoCron.instrumentCron`) — out-of-scope follow-up noted in [`padelgod/src/lib/sentry.ts`](../../../padelgod/src/lib/sentry.ts). We use explicit `Sentry.captureException` instead.
- Fixing the duplicate-`ranking=1` player rows I noticed during investigation (two distinct `player_id`s both at rank 1 with identical points) — separate issue, not introduced or exacerbated by this change.

## Worker design

### Public contract

```ts
// padelgod/src/workers/player-rankings.ts

export interface PlayerRankingsDeps {
  supabase: SupabaseClient
  httpClient: AxiosInstance
}

export interface PlayerRankingsResult {
  official: {
    men:   { fetched: number; updated: number; created: number; rankingDate: string | null }
    women: { fetched: number; updated: number; created: number; rankingDate: string | null }
  }
  race: {
    men:   { fetched: number; updated: number; created: number; dropoutsCleared: number }
    women: { fetched: number; updated: number; created: number; dropoutsCleared: number }
  }
  avatars: { rehosted: number; skipped: number; failed: number }
  snapshotsWritten: number
}

export async function runPlayerRankings(deps: PlayerRankingsDeps): Promise<PlayerRankingsResult>
```

Matches the scheduler's `(deps) => Promise<unknown>` signature; the typed return is for tests and logs.

### Phases

Four sequential phases inside one worker invocation. Each phase wraps its FIP fetch + parse in its own `runScrapeJob` call so the ops dashboard sees four distinct `scrape_jobs` rows per tick:

| # | Phase | scrape_job `target_url` | What it writes |
|---|---|---|---|
| 1 | official-men | `.../ranking/load-more/?gender=male&year=Y&week=W` | `players` upsert + `player_ranking_snapshots` |
| 2 | official-women | same, `gender=female` | same |
| 3 | race-men | `.../player/search?search_type=race&gender=male` | `players` upsert + `player_ranking_snapshots` + NULL race-dropouts |
| 4 | race-women | same, `gender=female` | same |

Avatar rehost runs after all four phases, against the deduped Map populated during phases 1–4.

### Fetch logic

**Official:**

```
for w = currentWeek downto currentWeek - 3:
  page through .../ranking/load-more/?gender={g}&limit=500&offset=O&year=Y&week=w&...
    until total reached top (default 1000, FIP returns ~500 max) or short response
  if rows > 0: return { players, rankingDate: mondayOf(w) }
return { players: [], rankingDate: null }
```

Mirrors [Vercel `fetchOfficialRankings`](../../../src/app/api/admin/sync-fip-rankings/route.ts) line 144 onward. Fall-back loop covers the case where FIP hasn't published the current week yet — returns the most recent populated week. If all 3 fallback weeks return 0, that's a real outage and the zero-row guard fires (Section 4).

**Race:**

```
page through .../player/search?search_type=race&gender={g}&limit=500&offset=O&...
trim at first row whose race_rank < maxSoFar / 2 (when maxSoFar >= 30)
```

Series-boundary trim — FIP concatenates multiple race series in one response (Premier-circuit race followed by what looks like a sub-tier with reset rank numbering). Mirrors [Vercel race-fetch:212-220](../../../src/app/api/admin/sync-fip-rankings/route.ts).

### Resolve + write

For each phase, after fetch:

```
build byFipId: Map<string, RankingRow>           // strip legacy 'fip-' prefix
const existing = SELECT id, fip_id, name, country, category, ranking, points, ranking_move,
                        race_ranking, race_points, race_move, profile_url
                 FROM players WHERE fip_id IN (Array.from(byFipId.keys()))
const existingByFipId = Map<fip_id, row>

for [fipId, row] of byFipId:
  if existingByFipId.has(fipId):
    // UPDATE diffed: always overwrite ranking/points/ranking_move (or race_*)
    //                NULL-skip name/country/category (FIP is source-of-truth
    //                but profile worker enriches further; don't blank fields)
    // last_updated_by = 'padelgod', updated_at = now
  else:
    // INSERT { fip_id, external_id: fipId, name, category, country,
    //          ranking|race_ranking, points|race_points, ranking_move|race_move,
    //          profile_url, last_updated_by: 'padelgod', updated_at: now,
    //          profile_attempt_at: '1970-01-01T00:00:00Z' }
    // The epoch-zero profile_attempt_at pushes new players to the front
    // of the player-profile worker's queue, matching the convention used
    // in fip-entry-list-populator.ts (the queue uses NULLS FIRST ordering).

  // Collect for snapshot pass
  resolved.push({ playerId, fipRow: row })
  if row.thumbnail:
    avatarMap.set(playerId, row.thumbnail)        // dedupe across phases

UPSERT player_ranking_snapshots from resolved
  conflict (player_id, type, year, week) → overwrite
  source = 'padelgod-fip'
```

For race phases only, after the above:

```
const previouslyRanked = SELECT id FROM players
                         WHERE category = {db_gender} AND race_ranking IS NOT NULL
const dropouts = previouslyRanked - writtenIds
for chunk of 200 in dropouts:
  UPDATE players SET race_ranking = NULL, race_points = NULL, race_move = NULL
  WHERE id IN chunk
```

### Avatar rehost (phase 5)

```
for chunk of 20 in avatarMap.entries():
  await Promise.all(chunk.map([playerId, thumbnail] =>
    rehostAvatarToSupabase(supabase, playerId, thumbnail)
  ))
```

`rehostAvatarToSupabase` short-circuits when a player already has a Supabase-hosted avatar (steady-state cost: 1 SELECT per player, no network download). The mirrored helper file in `padelgod/src/lib/avatar-rehost.ts` carries a "must stay in sync with src/lib/avatar-rehost.ts" header comment (same convention as `db-paginate.ts`, `fip-player-search.ts`).

## Schedule

In [`padelgod/src/scheduler.ts`](../../../padelgod/src/scheduler.ts), replace the single `'0 7 * * *'` entry with two:

```ts
if (flags.enablePlayerRankings) {
  entries.push({
    name: 'player-rankings',
    cron: '0,30 6-12 * * 1',        // Monday 06:00–12:00 UTC every 30 min — 13 runs
    run: getWorkerRunner('player-rankings')!,
  })
  entries.push({
    name: 'player-rankings',
    cron: '0 7 * * 2-6',            // Tue–Sat 07:00 UTC — 5 runs
    run: getWorkerRunner('player-rankings')!,
  })
}
```

**Cadence rationale:**

- FIP has historically published Mondays in the 07:00–11:00 UTC band. Polling every 30 min means the new ranking is on padelnachos.com within ≤30 min of FIP flipping it.
- Idempotent UPSERTs make re-runs free — no harm if data hasn't refreshed yet.
- Tue–Sat daily run keeps player profile data fresh (avatar drift, profile enrichment queue churn) and recovers from any single failed Monday run on the next morning.
- No Sunday run — FIP doesn't update on Sundays.

Total: 18 worker runs/week vs. today's 7.

**Scheduler test note:** the existing assertion that `player-rankings` appears in the registered schedule needs to accept it appearing **twice** when the flag is on.

## Fail-loud guardrails

The current padelgod worker has produced zero rows for a week without anyone noticing. The whole point of this section is to make that impossible.

**(a) Zero-row guard per phase.** Inside each `runScrapeJob` callback, after parse:

```ts
if (parsed.length === 0) {
  throw new Error(`PARSED_ZERO_ROWS: ${phase} from ${targetUrl}`)
}
```

`runScrapeJob`'s catch path marks the `scrape_jobs` row `status='failed'` with `error_message` populated. Operator sees a red row in the ops dashboard within minutes.

**Exception:** the official path's 3-week fallback loop. Zero rows for the current week is normal (FIP hasn't published yet); the guard only fires after all 3 fallback weeks also returned zero.

**(b) Snapshot floor.** After all four phases, if `snapshotsWritten === 0`, throw `NO_SNAPSHOTS_WRITTEN`. Catches the case where every phase parsed rows but every upsert silently failed.

**(c) Explicit Sentry capture at the throw site.** The scheduler at [`scheduler.ts:577-579`](../../../padelgod/src/scheduler.ts) swallows worker exceptions into a pino log line and does not auto-report. So:

```ts
try {
  // phase work
} catch (err) {
  Sentry.captureException(err, {
    tags: { worker: 'player-rankings', phase: 'official-men' /* or whichever */ },
  })
  throw err
}
```

This way a zero-row failure surfaces both as a red `scrape_jobs` row (ops dashboard) and a Sentry issue (immediate alerting if wired).

**(d) Structured info logs with row counts.** After each fetch:

```ts
logger.info(
  { phase: 'official-men', fetched: parsed.length, rankingDate, year, week },
  `phase ${phase} fetched ${parsed.length} rows`,
)
```

Doesn't throw, but makes "we got 5 rows" visible in Railway logs without grepping.

## Cutover

**Files deleted in this PR:**

- [`src/app/api/cron/sync-fip-rankings/route.ts`](../../../src/app/api/cron/sync-fip-rankings/route.ts) — entire cron wrapper
- 4 entries in [`vercel.json`](../../../vercel.json) under `sync-fip-rankings?type=...&gender=...`
- [`padelgod/src/parsers/fip-rankings.ts`](../../../padelgod/src/parsers/fip-rankings.ts) — broken cheerio parser (selectors don't match new page; replaced by inline WP JSON deserialization)
- [`padelgod/src/__tests__/parsers/fip-rankings.test.ts`](../../../padelgod/src/__tests__/parsers/fip-rankings.test.ts) — its subject is gone
- `FIP_RANKINGS_VERSION` constant from [`parser-versions.ts`](../../../padelgod/src/lib/parser-versions.ts), replaced by `FIP_RANKINGS_VERSION = 'wp-json-v1'`

**Files added in this PR:**

- `padelgod/src/lib/avatar-rehost.ts` (mirror of Next.js side)
- `docs/superpowers/specs/2026-05-18-padelgod-rankings-migration-design.md` (this doc)
- `docs/superpowers/plans/2026-05-18-padelgod-rankings-migration.md` (next step)

**Files modified:**

- [`padelgod/src/workers/player-rankings.ts`](../../../padelgod/src/workers/player-rankings.ts) — full rewrite
- [`padelgod/src/__tests__/workers/player-rankings.test.ts`](../../../padelgod/src/__tests__/workers/player-rankings.test.ts) — full rewrite against the new contract
- [`padelgod/src/__tests__/scheduler.test.ts`](../../../padelgod/src/__tests__/scheduler.test.ts) — accept `player-rankings` appearing twice
- [`padelgod/src/scheduler.ts`](../../../padelgod/src/scheduler.ts) — two schedule entries instead of one
- [`src/app/api/admin/sync-fip-rankings/route.ts`](../../../src/app/api/admin/sync-fip-rankings/route.ts) — snapshot source tag changes from `'vercel-fip'` to `'vercel-fip-manual'` (one constant, two-line diff)

**Deploy order:**

1. Padelgod deploys first (Railway auto-deploy on `main`). New schedule starts firing within minutes.
2. Vercel deploys second (Vercel auto-deploy on `main`). Old cron entries vanish.
3. **Brief overlap window** between (1) and (2) — Mondays 07:00 UTC specifically. Both sources UPSERT to the same conflict key; last write wins. Acceptable.

**Rollback:**

- **Fast:** `ENABLE_PLAYER_RANKINGS=false` in padelgod's Railway env. Padelgod stops; admin route still works for manual once-a-day pulls.
- **Slow:** restore deleted Vercel cron entries to `vercel.json` and redeploy.

## Testing

### Unit tests — `padelgod/src/__tests__/workers/player-rankings.test.ts`

Mock `httpClient` + `supabase`, drive each scenario through `runPlayerRankings`:

| Scenario | Asserts |
|---|---|
| Happy path — all 4 phases populated | 4 `scrape_jobs` rows with correct `target_url`s; existing fip_ids → UPDATE; new fip_ids → INSERT; snapshots UPSERTed with `source='padelgod-fip'`; avatar Map deduped across phases |
| Official current week empty, week-1 has data | 3-week fallback fires; `rankingDate` is `mondayOf(currentWeek - 1)`; no throw |
| Official all 3 fallback weeks empty | Throws `PARSED_ZERO_ROWS`; `Sentry.captureException` called with `{ worker: 'player-rankings', phase: 'official-men' }` |
| Race response with series boundary | Trim fires at first row where `race_rank * 2 < maxSoFar` and `maxSoFar >= 30`; rows beyond boundary dropped |
| Race dropouts | Player previously in race with non-null `race_ranking`, not in this run → race fields NULLed; chunked at 200 |
| Existing fip_id, no rank change | UPDATE skipped via no-change diff; snapshot still upserted (snapshots are historical record, must write every run) |
| Existing fip_id, rank changed | UPDATE writes `ranking`, `points`, `ranking_move`; `last_updated_by='padelgod'`; `updated_at` set |
| Unknown fip_id | INSERT new player row with all FIP-provided fields, `profile_attempt_at` sentinel set |
| Snapshot upsert collision | Re-running same week → row updated in place, not duplicated |
| Avatar collected once per playerId | Same `player_id` in official + race phases → `rehostAvatarToSupabase` called once |
| Sentinel `PARSED_ZERO_ROWS` in race | Race endpoint returns 0 → throws + Sentry tagged with phase |

### Scheduler test — `padelgod/src/__tests__/scheduler.test.ts`

- Assert `player-rankings` appears **twice** in `buildSchedule(flags)` when `enablePlayerRankings: true`, with the expected cron expressions.
- Assert it appears **zero times** when the flag is off.

### Parser version

Bump to `FIP_RANKINGS_VERSION = 'wp-json-v1'`. Written to `scrape_jobs.parser_version` so future FIP-side API changes are correlatable in logs.

### Manual verification (PR description checklist)

- [ ] Local: invoke `runPlayerRankings` directly (e.g. via `npm run worker -- player-rankings` if there's a runner, otherwise a tiny scratch script) — confirm 4 `scrape_jobs.success` rows, `padelgod-fip` snapshots for current week, no Sentry issues
- [ ] Compare row counts: `padelgod-fip` for week W vs. `vercel-fip` for week W-1 — should be within ±5 %
- [ ] Spot-check a player who was in race last week but dropped this week → `race_ranking IS NULL`
- [ ] Spot-check a player new this week (not in DB previously) → row INSERTed with `fip_id`, `last_updated_by='padelgod'`, `profile_attempt_at = '1970-01-01T00:00:00Z'`
- [ ] `vercel.json` diff shows 4 removed cron entries; Vercel preview deploy's cron list reflects the deletions

### Intentionally not tested

- `avatar-rehost.ts` behaviour — already covered by Next.js suite; mirror is byte-identical
- WP API response-shape stability — out of our control; surfaces as `PARSED_ZERO_ROWS` + Sentry in prod if FIP changes the contract

## Open questions

None. All design choices were locked during the 2026-05-18 brainstorm session:

- Architecture: Padelgod owns rankings end-to-end (immediate cutover, no dual-write window)
- Admin route: stays as `vercel-fip-manual` fallback
- Resolver: fip_id-keyed upsert (no fuzzy resolver port)
- Schedule: Mon `'0,30 6-12 * * 1'` + Tue–Sat `'0 7 * * 2-6'`
- Test file: full rewrite, don't migrate HTML-scraper test cases
