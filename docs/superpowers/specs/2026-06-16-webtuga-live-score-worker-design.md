# webtuga-live: FIP-tier live point-by-point from an ad-hoc tournament tracker

**Date:** 2026-06-16
**Status:** Design approved — ready for implementation plan
**Branch / worktree:** `feat/webtuga-live` (`.claude/worktrees/webtuga-live`)

## Problem

FIP-tier (Bronze/Silver/Gold/Platinum) matches get **no live point-by-point** in
PadelNachos today. The architecture assumes "live PBP is Premier-tier only"
(see `CLAUDE.md` → "Live match coverage scope"): Crionet exposes per-match score
endpoints only at Premier tier, so a FIP match can flip to `status='live'` and
show a coarse current-set score, but sets never tick in real time and the
momentum chart is empty.

The **FIP Platinum Lusitania Portugal Master Padel 2026** tournament
(`tournaments.id = 8d5e9a69-f2d9-473d-bc2e-42334e2e8096`, `level='fip_platinum'`)
is served by a **bespoke third-party live tracker** at
`https://portugalmasterpadel.win.webtuga.net/`. Unlike the FIP site's own
"Live Score" tab — which merely proxies the same Crionet `oopbyday` /
`resultsbyday` widgets padelgod already ingests — this tracker exposes a rich,
clean JSON API with genuine live point-level state we capture nothing of today.

## What webtuga exposes

Two unauthenticated JSON endpoints (no HTML/nonce/PDF parsing):

- **`GET /api/public/results-feed`** — every match for the event in one call
  (live + scheduled + finished), each with court, scheduled time, round,
  category, status, and current summary score:
  ```json
  {"id":3,"court":"Court 2","round":"Qualifiers","category":"Femininos",
   "status":"Live","teamA":"V. Arteaga / B. Gomez","teamB":"M. Garin / M. Fernandes",
   "setsA":0,"setsB":0,"gamesA":0,"gamesB":5,"pointsA":"15","pointsB":"40",
   "setsHistoryA":"","setsHistoryB":"","live":true,"finished":false,
   "updatedAt":"2026-06-16T09:36:41"}
  ```
- **`GET /api/public/matches/{id}`** — full live state per match, richer than
  even Premier/Crionet gives us:
  - `state.serverTeam` / `serverPlayer` / `receiverPlayer` — who is serving
  - `displayPointsA/B` (`"15"`/`"40"`/`"Ad"`), `rawPointsA/B`, `isTieBreak`,
    `scoringMode` (`"StarPoint"` = golden point)
  - `setsHistoryA/B` (completed-set games, e.g. `"6"`/`"2"`), live `gamesA/B`,
    `setsA/B`
  - match clock (`currentMatchSeconds`, `isPointInProgress`, point timers),
    `newBallsTarget`, `medicalTimeout*`, `importantPoint`
  - per-slot full player names + ISO-2 countries

`updatedAt` advances every few seconds during play.

**Host note:** `webtuga.net` is **not** `padelfip.com`. The known
"FIP blocks Railway egress" problem (see memory `fip-blocks-railway-egress`)
almost certainly does not apply; to be confirmed with a one-off Railway curl.

## Why this is tractable (verified facts)

1. **The matches already exist in our DB.** The FIP draw pipeline already
   populated **100 matches** for this event (Q1 → F, both genders) with resolved
   player FKs. The worker **updates** existing rows; it does **not** create
   matches.
2. **Resolution is clean.** A naive surname-overlap matcher (≥2 shared surname
   tokens, best of both pair orientations, scoped to the tournament + category)
   resolved **16/16 live + upcoming webtuga matches, 0 ambiguous, 0 unresolved**
   — despite webtuga's own first-name inconsistencies (it lists Vega Cano as
   "Inés Caño", Maria Arteaga as "V. Arteaga"). Pair context makes resolution
   robust.
3. **The point-logging machinery already exists.** `padelgod/src/lib/live-state.ts`
   (`diffLiveState`, `LiveMatchState`, `LiveSetEntry`, `PointState`) and
   `padelgod/src/lib/point-reconstruction.ts` (`applyDiff`) already take a
   per-tick live-state diff and idempotently write `sets`, `games`, and
   `match_points`. We reuse them wholesale; the only new logic is a pure adapter
   that maps the webtuga payload into a `LiveMatchState`.

## Goals

- Capture genuine live point-by-point for this FIP-tier event and write it into
  the canonical tables (`matches`, `sets`, `games`, `match_points`) so the
  existing UI machinery (live scoreboard, momentum chart) can render it.
- Be **operationally onboardable**: add a future webtuga-backed tournament with
  one DB row, no deploy.
- **Cooperate** with the existing Crionet pipeline that owns these matches'
  authoritative final scores — no write races.

## Non-goals (v1)

- **No frontend changes.** Backend-only ingestion. We audit whether the
  match-detail UI renders the data as-is or is FIP-tier-gated and document the
  finding; any gate relaxation is a fast-follow plan.
- **No automated discovery** of webtuga-backed tournaments. The base URL is
  bespoke per event and supplied by an operator (one DB row).
- **No webtuga-only extras surfaced** (server indicator, match clock,
  golden-point badge). The richer `/matches/{id}` fields beyond score + server +
  status are not persisted in v1.
- **webtuga never finishes a match** (see Lifecycle below).
- **No `webtuga_unresolved` table.** Unresolved matches are logged + counted only
  (YAGNI; resolution is 16/16 today).

## Architecture

A single padelgod cron worker, **`webtuga-live-fetcher`**, flag-gated
(`enableWebtugaLive`, default OFF) with a dry-run mode (`webtugaLiveDryRun`),
scheduled every ~15s (the scheduler already supports sub-minute crons — see
`live-odds-updater` at `*/20 * * * * *`).

### Per-tick flow

1. **Discover targets.** Query `entity_external_ids` for
   `(entity_type='tournament', source='webtuga_live')`; `external_id` holds the
   tracker base URL (e.g. `https://portugalmasterpadel.win.webtuga.net`). Filter
   to tournaments inside their active window (`starts_at`/`ends_at`). For v1
   there is exactly one such row (Lusitania).
2. **Fetch.** One `GET {base}/api/public/results-feed` returns all courts. For
   each match with `status='Live'`, `GET {base}/api/public/matches/{id}` for
   server / raw-point detail. (~1 + N_live HTTP calls per tick; N_live ≤ court
   count.)
3. **Resolve → match UUID.**
   - First, O(1) cache lookup: `entity_external_ids
     (entity_type='match', source='webtuga', external_id=<webtuga match id>)`
     → `entity_id`.
   - On miss, run the surname-overlap matcher against the tournament's matches
     (filtered by mapped category) and, on a unique hit, **write the cache row**
     so every later tick is O(1).
   - On no/ambiguous match: skip + increment a counter, log once. No row
     creation.
4. **Adapt + write.** Build a `LiveMatchState` from the webtuga payload (see
   adapter below). Load the prior `LiveMatchState` (reconstructed from current DB
   rows, exactly as the Premier live-poller does) and run
   `diffLiveState(prev, curr)` → `applyDiff(...)`, which idempotently upserts
   `sets`/`games` and inserts new `match_points`. Separately flip
   `matches.status` `scheduled → live` on first live sighting (`applyDiff`
   deliberately does not write `matches.status`).

### The adapter (only genuinely new logic)

Pure, unit-tested `webtugaToLiveState(feedRow, matchDetail, matchId, resolvedPlayers)
→ LiveMatchState`:

| `LiveMatchState` field | webtuga source |
|---|---|
| `matchId` | resolved UUID |
| `matchWidgetId` | webtuga match `id` (string) |
| `team1Sets` / `team2Sets` | `setsHistoryA/B` (completed sets) + current `gamesA/B`, each as `LiveSetEntry{games, tiebreak}`; `tiebreak` from `isTieBreak` + raw points |
| `pointState` | `displayPointsA/B` (`"15"/"40"/"Ad"`), tiebreak points when `isTieBreak` |
| `servingTeam` | `serverTeam "A"/"B"` → `1`/`2` (null if absent) |
| `status` | webtuga `status` → `live` / `scheduled` (never `finished`) |

webtuga team A/B map to our pair1/pair2 **as determined by the resolver's chosen
orientation** (the resolver records which orientation matched; the adapter honors
it so games/points land on the correct pair).

### Provenance & contention

- `sets` / `games` written with `score_source='live'` — the **lowest** priority
  in the `api > inferred > live` hierarchy — so when Crionet's
  `fip-results-writer` lands the authoritative final it cleanly overwrites.
- **webtuga never finishes a match.** The existing `fip-results-writer` keeps
  owning the `→ finished` flip; its terminal-status guard already accepts a
  current status of `'live'` (it flips from `{scheduled, on_court, live}`), so
  the two cooperate without races.
- `match_points` for these FIP matches have no other writer — no contention.
- Point-log fidelity is **best-effort**: 15s polling can miss a fast point.
  `applyDiff` is idempotent and the momentum chart tolerates gaps. The worker
  logs a counter when a completed game's reconstructed point count looks short.

## Configuration

- **Onboarding a tournament** = insert one `entity_external_ids` row:
  `(entity_type='tournament', entity_id=<tournament uuid>, source='webtuga_live',
  external_id='https://portugalmasterpadel.win.webtuga.net')`. No deploy.
- **Env** (`padelgod/src/lib/env.ts` + `.env.example`):
  `ENABLE_WEBTUGA_LIVE` (default false), `WEBTUGA_LIVE_DRY_RUN` (default true).
- **No migration required.** Reuses `matches`, `sets`, `games`, `match_points`,
  and the `entity_external_ids` sidecar. Two new `source` values are introduced
  (`webtuga_live` for the tournament base-URL row, `webtuga` for the per-match id
  cache) — both are plain data, no schema change.

## Scheduler wiring

Per the established padelgod pattern (`padelgod/src/scheduler.ts`):
add `webtuga-live-fetcher` to the `WorkerName` union, `ALL_WORKERS`, the
`getWorkerRunner()` switch, the `SchedulerFlags` interface, and a `buildSchedule()`
entry gated on `flags.enableWebtugaLive` at `*/15 * * * * *` (threading
`webtugaLiveDryRun`). Admin-trigger default `dryRun: true`.

## Files (anticipated)

| File | Change |
|---|---|
| `padelgod/src/workers/webtuga-live-fetcher.ts` | New worker (discover → fetch → resolve → adapt → applyDiff → status flip) |
| `padelgod/src/lib/webtuga-adapter.ts` | New pure adapter: webtuga payload → `LiveMatchState` |
| `padelgod/src/lib/webtuga-resolve.ts` | New pure resolver: surname-overlap pair match + orientation, scoped to a tournament's matches |
| `padelgod/src/lib/live-state.ts` | Reused (`diffLiveState`, types) — no change expected |
| `padelgod/src/lib/point-reconstruction.ts` | Reused (`applyDiff`) — no change expected |
| `padelgod/src/lib/match-identifier.ts` | Referenced for the `entity_external_ids` cache pattern |
| `padelgod/src/scheduler.ts` | Register worker + cron entry + flags |
| `padelgod/src/lib/env.ts`, `.env.example` | New env flags |
| `padelgod/src/__tests__/lib/webtuga-adapter.test.ts` | Adapter unit tests (sample payloads → expected `LiveMatchState`) |
| `padelgod/src/__tests__/lib/webtuga-resolve.test.ts` | Resolver unit tests (incl. the first-name-mismatch cases) |
| `padelgod/src/__tests__/workers/webtuga-live-fetcher.test.ts` | Worker test: mocked HTTP + Supabase → asserts applyDiff calls, status flip, cache write, idempotency on repeat ticks |

## Testing strategy

- **Adapter** — pure unit tests from captured webtuga payloads (the live + a
  finished sample), asserting the produced `LiveMatchState` (sets history, current
  game, point state, serving team, status, orientation).
- **Resolver** — unit tests including the known first-name-mismatch rows
  (Cano/Caño, Arteaga V./M.) and an ambiguity guard; plus a live-DB sanity check
  (already green: 16/16, 0 ambiguous).
- **Worker** — mocked HTTP client + Supabase: verifies discovery query,
  resolution + cache write on first sight, O(1) lookup on second tick, `applyDiff`
  invocation, `scheduled→live` flip, and idempotency (a repeated identical tick
  writes no new `match_points`).
- **Manual** — Railway dry-run against live Lusitania data + an egress curl; then
  a flagged-on canary run with DB inspection of `sets`/`games`/`match_points`.

## Risks & mitigations

- **Ad-hoc / ephemeral source.** The tracker is bespoke and may vanish after the
  event. Mitigated by flag-gating + DB-row config: the worker self-disables when
  the tournament leaves its active window, and a vanished host just produces
  logged fetch failures.
- **Best-effort point log.** 15s cadence misses fast points. Accepted for a v1
  FIP momentum chart; idempotent writes + a short-game counter make gaps visible.
- **Policy widening.** Introduces FIP-tier live data against the documented
  "Premier-only live" stance. v1 only lands the data; the UI gate audit + any
  relaxation is a deliberate follow-up so the policy change is decided
  separately.
- **Resolver drift on other events.** 16/16 is measured on Lusitania only. The
  resolver is pure + unit-tested and fails safe (skip + counter), so a future
  event with worse name data degrades gracefully rather than mis-assigning.
