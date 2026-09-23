# padeldev live point-by-point — design

**Date:** 2026-09-23
**Status:** approved, v1 scoped to a single event
**Branch:** `feat/padeldev-live-pbp`

## Problem

On 2026-09-23 the FIP event page for **FIP Platinum Lyon 2026** gained a `Live Score`
tab backed by a **new vendor** — not Crionet. Lyon is a FIP-tier event, and our
live point-by-point pipeline covers Crionet only, so the match detail page shows a
LIVE pill with no point data behind it.

This is worse than a gap. `isPremierLevel` in [`src/lib/tournament-labels.ts`](../../../src/lib/tournament-labels.ts)
already lists `fip_platinum`, so `isPresenceOnlyLive` returns **false** for Lyon —
the UI actively promises point-by-point for this tier and currently has none to show.
The in-code comment asserting *"Premier Padel + fip_platinum get PBP via Crionet"*
is false for this event.

### Evidence

Crionet's `screen/tournamentlive/FIP-2026-3915` — the exact endpoint
[`live-poller-loop.ts:478`](../../../padelgod/src/lib/live-poller-loop.ts) polls — returned
`"No live matches at this time"` on every sample across a 90-second window while
three matches were in progress. `oopbyday` showed the same matches as `- - -`.
The new vendor showed live games, points, and a set clock throughout.

An earlier spec —
[`2026-06-16-webtuga-live-score-worker-design.md`](2026-06-16-webtuga-live-score-worker-design.md) —
states the FIP Live Score tab *"merely proxies the same Crionet oopbyday / resultsbyday
widgets padelgod already ingests"*. That was true when written; it is **no longer true**.
Correcting that claim is part of this work.

## Scope

**Coverage is one event.** A sweep of all 500 recently-created FIP events found the
widget on **Lyon only**; of the 534 remaining (older) events, zero are 2026/2027 slugs.
This is a single-event pilot, almost certainly the French organiser's own product
(`advertising` points at `padeldev.com/en/padel-stats-ai/`, courts are
`Piste centrale` / `ALL-IN 1`).

So v1 is deliberately narrow:

**In scope**
- Live score + point-by-point for tournaments explicitly seeded by an operator.
- `servingTeam` (the feed carries it; webtuga did not).

**Out of scope — deferred, not dropped**
- The per-set `stats` block → `match_stats`. The taxonomies don't align: padeldev
  measures shot outcomes (winners, unforced errors, double faults, break points),
  our 34 columns measure serve/return splits. ~30 of our columns would stay NULL and
  7 of padeldev's 9 categories have no column. Needs a schema migration + `MatchStatsView`
  work — its own piece, and it does not need a live event to build.
- Auto-discovery of the tournament key (see "Discovery" below).
- `points.point[]` — present in the payload, semantics undecoded, unused by the vendor's
  own tournament widget. Not consumed.
- Any UI change. `isPremierLevel` already admits `fip_platinum`, so the existing surfaces
  render this the moment data lands.

## Data source

Widget: `https://ws.padeldev.com/live/fip/tournament.html?key=<uuid>&completed=0`
Data: `https://zyc2xjpbhtmjin7bdqk77ryojq0rwonh.lambda-url.eu-west-3.on.aws/?id=<id>.json`

Unauthenticated, no referer check, `cache-control: no-store`, ~130 ms, no throttling
observed across rapid sequential requests. AWS Lambda on `padeldev.com` — **not**
`padelfip.com`, so the residential-proxy path in
[`http-client.ts`](../../../padelgod/src/lib/http-client.ts) does **not** apply and no
proxy bandwidth is consumed.

### Tournament feed — `?id=<uuid>.json`

```
tournament: { name, timezone, startdatetime, enddatetime,
              "<YYYYMMDD>": { "<court>": [ match, … ] } }
```

Each match carries `url` (the per-match feed), `category` (`"Women - Round of 32"`,
`"Men Q1"`), `scheduled`, four `playername*`/`nationality*`, `isfinished`,
`winningteam`, `retiredteam`, and a `score` string.

### Match feed — `?id=<6-char>.json`

Relevant keys: `idmatch`, `isfinished`, `winningteam`, `retiredteam`, `court`,
`lastupdate`, and:

```json
"score": { "teamserving": 2, "playerserving": 4, "winningteam": 0,
           "retiredteam": 0, "value": "30-40 1/0 3/6 0/0 0/0", "starpoint": 0 }
```

### Score string grammar

```
"<points> <current-set games> <set1> <set2> <set3>"
  "30-40"   "1/0"              "3/6"  "0/0"  "0/0"
```

- Slot 1 is the **current** set's games. A set's slot (2–4) fills only once that set
  **completes**, so the current set is never double-counted.
- `0/0` in slots 2–4 means "not played" — a completed set can never be 0–0.
- Tiebreak detail is **not** encoded (`6/7`, not `6/7(5)`), same limitation as webtuga.

## Architecture

Mirrors the merged webtuga subsystem file-for-file, reusing `diffLiveState` and
`applyDiff` unchanged.

| File | Responsibility |
|---|---|
| `padelgod/src/lib/padeldev-types.ts` | Response shapes |
| `padelgod/src/lib/padeldev-client.ts` | Two unauthenticated GETs |
| `padelgod/src/lib/padeldev-score.ts` | **Pure** score-string parser |
| `padelgod/src/lib/padeldev-adapter.ts` | Match feed → `LiveMatchState` |
| `padelgod/src/lib/padeldev-resolve.ts` | padeldev match → our match UUID |
| `padelgod/src/lib/padeldev-cache.ts` | `entity_external_ids` helpers |
| `padelgod/src/workers/padeldev-live-fetcher.ts` | The tick |

### Per tick, per seeded tournament

1. Fetch the tournament feed.
2. Select matches that are **unfinished** with a non-sentinel score.
3. Fetch each per-match feed; **skip when `lastupdate` is unchanged**.
4. Resolve → our match (cache, else surname matcher).
5. Adapt → `LiveMatchState`; `diffLiveState`; `applyDiff`.
6. Guarded `scheduled → live` flip; fire the existing on-court push once.
7. Persist `lastState` in the cache row.

### Discovery — deliberately manual

The key is **not** in the event-page HTML. It is lazy-loaded via a nonce-protected
WordPress AJAX call (`action=livescore_tab_load`, `security=<nonce>`, `post_id=<id>`),
and the nonce is reusable across post_ids. That chain works, but it runs against
`padelfip.com` — the domain behind the metered residential proxy — to serve a
**one-event** feature.

So v1 seeds the key by hand, exactly as webtuga does:

```
entity_external_ids(entity_type='tournament', source='padeldev_live',
                    entity_id=<tournament uuid>, external_id='<key uuid>')
```

Adding a second tournament is an INSERT, not a code change. If the widget ever spreads,
automating discovery becomes worthwhile; today it is not.

### Resolution

Reuses the webtuga strategy: **surname tokens + category only**, no court.

This matters — the court names genuinely disagree between sources
(`Piste 2` vs our Crionet-sourced `PISTE 2 AUVERGNE RHONES ALPES`), so involving court
would add a failure mode for no gain. Category maps by prefix:
`"Women - Round of 32"` → `women`, `"Men Q1"` → `men`.

Names need the same tolerance webtuga's matcher already provides:
- abbreviated (`"S. Merah"`) — surname tokens of length ≥ 3, initials dropped;
- truncated (`"M. Delgado"` vs our `"M. Delgado Medina"`);
- **pair order differs between feeds**, so both orientations are scored and a tie on
  a both-valid orientation is treated as ambiguous rather than guessed.

The resolver **fails closed**: unresolved and ambiguous are counted and logged, never
attached to a best guess.

## Data contract

- Writes `sets` / `games` / `match_points` with `score_source='live'` — the lowest
  priority — so `fip-results-writer` keeps owning the authoritative final.
- **Never** sets `status='finished'`. `winningteam` / `retiredteam` are read but not acted on.
- Flips `scheduled → live` under an `.eq('status','scheduled')` guard so the on-court
  push fires exactly once.

## Improvements over the webtuga adapter

1. **Serving team is real.** The feed carries `teamserving`, so `servingTeam` is populated
   rather than `null`. This also populates `server_player_id`, which is what the planned
   `hasLivePointByPoint(sets)` UI predicate keys on.
2. **No tiebreak freeze.** webtuga's v1 throws on tiebreak point labels and freezes the
   scoreboard at 6–6. Here `insideTiebreak` is inferred from the current-set games being
   `6/6` and passed to `parsePointState`, so tiebreaks track live.
## Vendor dialect — learned from captured live traffic

Two assumptions in the first draft were wrong, and **only replaying real captured
traffic caught them**. Both would have shipped as silent corruption.

1. **Advantage is a bare `A`, not `AD`.** The feed emits `A-40` / `40-A`.
   `parsePointState` only accepts `AD`, so every advantage point would have thrown,
   the worker would have dropped the row, and the scoreboard would visibly freeze at
   deuce until the game ended. Normalised in `padeldev-adapter.ts` — deliberately
   *not* in `live-state.ts`, which the Crionet live-poller shares.

2. **`score.starpoint` is a deuce counter, not a golden-point flag.** Observed:

   ```
   40-40  starpoint=1      first deuce
   A-40   starpoint=1
   40-40  starpoint=2      back to deuce
   40-A   starpoint=2
   40-40  starpoint=3      third deuce
   ```

   The first draft mapped `starpoint=1` to golden point, which would have relabelled
   **every deuce and advantage** in every match. The field is now ignored outright.
   This event uses traditional advantage scoring.

These are locked in by `padeldev-live-capture.test.ts`, which replays **406 distinct
captured states** (~90 minutes of play, deduped on match + score + starpoint + server).
Lyon is finite — once it ends this traffic cannot be re-captured, so those fixtures are
the durable record of how the feed behaves.

### Known gaps in the capture

- **No tiebreak was observed.** No set reached 6-6 during the sample, so the
  `insideTiebreak` inference is *reasoned, not verified*. If tiebreak point labels
  aren't plain integers, that path throws and the row is skipped for the duration of
  the tiebreak — the same failure webtuga's v1 has. A test asserts the gap still
  exists, so it fails loudly if a future capture covers it.
- **No finished transition was captured** mid-sample; finished handling is covered by
  the separate `finished_*.json` fixtures instead.
- Six full payloads (`live_*.json`, `finished_*.json`) retain the `points` and `stats`
  blocks, which the slim capture strips. They are the seed for the deferred stats work.

## Failure modes

| Risk | Mitigation |
|---|---|
| Unresolvable / ambiguous names | Fail closed; counters + warn logs. Never guess. |
| Malformed score string | Parser throws; per-match try/catch isolates it to one row per tick. |
| Vendor disappears after Lyon | Self-disabling discovery — only tournaments inside their window (+1 day grace) are polled. |
| Replay after mid-tick crash | `applyDiff`'s `UNIQUE(game_id, point_number)` makes it idempotent. |
| `starpoint` means something else | Treated as an enhancement; a wrong read degrades to a normal point, not a throw. |

## Configuration

- `enablePadeldevLive` — default **OFF**
- `padeldevLiveDryRun` — default **TRUE**

Dry-run resolves and reports without writing, so resolution can be proven against the
live event before any write is enabled.

## Verification

Lyon runs until **27 Sept**. The live window is the scarce resource — it is the only
thing here that cannot be rebuilt later from captured fixtures.

1. Unit tests over payloads captured live on 2026-09-23 (including real point/game
   transitions and a server change).
2. Dry-run against the live event: expect resolved ≈ live-seen, ambiguous 0.
3. Enable writes; confirm `sets`/`games`/`match_points` land and the match page renders
   point-by-point.
