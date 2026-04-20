# Padelgod — Live Data Validation Report

**Date:** 2026-04-20
**Status:** Validated against live tournament (Brussels P2, FIP-2026-1701, currently in qualifying rounds)
**Companion to:** `2026-04-20-padelgod-design.md`, `2026-04-20-padelgod-api-schema.md`

This document records what data is *actually* available from the upstream sources Padelgod will scrape, validated against a currently-live event. Use this as ground truth when implementing parsers — it overrides any guesses in the higher-level design docs.

---

## 1. Tournament code discovery

The `widget.matchscorerlive.com/ft` POST search endpoint accepts `(connector, year, query)` and returns tournament cards including the code. **This means we don't always need Playwright** — a free-text search by event name often returns the code directly.

**Connector codes (from widget root HTML):**
- `tol` = FIP (Padel)
- `min` = WTA, `val` = ATP, `itf` = ITF (Tennis — irrelevant)

**Discovery flow Padelgod uses:**
1. POST `/ft` with `(connector=tol, year=YYYY, query=<event name>)`
2. Parse response cards for `FIP-YYYY-NNNN` codes + `tournament-card-header-live` class for live status
3. **Fallback:** if search returns no match (rare), use Playwright on the padelfip.com event page to extract from the rendered iframe

**Confirmed:** `query=brussels` with `connector=tol` returns `FIP-2026-1701` in ~70ms as a single HTML card.

---

## 2. Complete widget endpoint inventory (Brussels P2 / FIP-2026-1701)

All endpoints are **public** — no PIN required, no Playwright required after the code is known.

| Method + path | Returns | Padelgod usage |
|---|---|---|
| `GET /screen/tournamentlive/{CODE}?t=tol` | All currently-live matches with full state | **Live polling** (6–8s) |
| `GET /screen/oopbyday/{CODE}/{day}?t=tol` | Order of play per day | OOP worker hourly |
| `GET /screen/resultsbyday/{CODE}/{day}?t=tol` | Completed match results per day | Results worker hourly |
| `GET /screen/draw/{CODE}/{drawType}/{round}?t=tol` | Bracket per draw type and round | Draw worker on entry-list publish |
| `GET /screen/entrylist/{CODE}/{ms\|ws}?t=tol` | Entry list per gender (`ms`=men's, `ws`=women's) | Entry-list worker pre-tournament |
| `POST /screen/getmatchstats?t=tol` body `(matchId, year, tournamentId, organization=FIP)` | 14-stat per-set + per-match | Match-stats worker |
| `GET /screen/livestatus/{CODE}/{matchId}/{n}?t=tol` | **PIN-protected — operator/scorer-only.** Padelgod does NOT use this. | — |
| `POST /ft` `(connector, year, query)` | Tournament search → code | Widget-ID discovery |

**Draw types:** `MD` (Men's Main Draw), `MQ` (Men's Qualifying), `WD` (Women's Main Draw), `WQ` (Women's Qualifying). The bracket page has a round paginator.

---

## 3. `tournamentlive` — what live data is actually exposed

Confirmed by parsing a real live match (`MQ012`: Sintes Villalonga / Santigosa Sastre vs Tison / Joris, Court CBC, Q2 Men):

### Per-match metadata (data attributes on the stats button)
- `data-id="MQ012"` — match ID
- `data-year="2026"`, `data-tid="1701"`, `data-org="FIP"` — together identify the match for the stats endpoint

### Match shell
- Court name: `<span class="tournament-name"><span>COURT CBC</span></span>`
- Round: `<div>Q2</div>` (free-text per FIP convention: Q1, Q2, R32, R16, QF, SF, F)
- Category: `<b>Men </b>` or `<b>Women </b>`
- Status class on header row: `scorebox-header-live` (vs `scorebox-header-completed`, `scorebox-header-scheduled`)

### Per-team rows (two `<tr>` per match)
Player block:
- Player names: `<span>M.</span><span>Sintes Villalonga</span>` (first initial + full surname)
- Country: `<img class="flags" src="/images/flags/ESP.jpg"/>` (ISO3 from filename)
- Seed (when present): `<small class="separator">(3)</small>`

**Server indicator (the field padelapi.org doesn't expose):**
```html
<img src='/images/ballg.png' class='ballg'/>
```
Present inside the team row that is currently serving. **Absent on the non-serving team.** This is the canonical way to know who's serving — purely a presence-of-image flag.

**Live score columns (per row):**
- `<td class="points"><div>15</div></td>` — current point in current game (15, 30, 40, A for advantage, GP for golden point, TB-3 for tiebreak point)
- `<td class="set set-lost">0</td>` — set 1 games (the `set-lost` class = team is behind in the set)
- `<td class="set">1</td>` — set 1 games for opposing team (no `set-lost` = leading or tied)
- `<td class="set set-lost ">-</td>` — set not yet played (dash placeholder)

**Match summary row:**
- Duration: `<span>00:03</span>` (HH:MM since match start)
- Status text: `Live match` / `Completed` / `Suspended`
- Stats button: `<a class="open" data-toggle="modal" data-id="..." data-year="..." data-tid="..." data-org="...">MATCH STATS</a>`

---

## 4. The point-by-point reconstruction problem

**Critical finding:** the widget does NOT expose a list of all points played in a match. It exposes only the **current state**:
- Current points in the current game (e.g., `15-30`)
- Current set scores (e.g., `1-0`)
- Current server (via `ballg.png` presence)

**Implication:** Padelgod's live-poller must **reconstruct point-by-point history from continuous polling** — this is the same approach padelapi.org uses internally before re-broadcasting via Pusher.

### Reconstruction algorithm (per active match)

```
state_prev = null
loop every 6-8 seconds:
  state_now = parse(GET /screen/tournamentlive/{CODE}?t=tol)
  if state_prev is not null and state_now != state_prev:
    diff = compute_diff(state_prev, state_now)
    for point_event in diff.points_won:
      INSERT match_points (match_id, set_number, game_number, point_number,
                           server_player_id, winner_pair, score_after, ...)
    if diff.game_changed:
      UPDATE games SET server_player_id = state_now.server, winner_pair = ...
    if diff.set_changed:
      UPDATE sets SET set_score = state_now.set_score, is_current = ...
    if diff.server_changed:
      UPDATE matches SET serving_player_id = state_now.server
  state_prev = state_now
```

### Failure modes (must be designed around)

| Failure | Mitigation |
|---|---|
| Two points happen between polls (rare but real near deuce / breaks) | Adaptive polling: drop to 3–4s when game score is `40-x`, `x-40`, `deuce`, or `advantage` |
| Poll misses a server change (e.g., golden point and game ends in same window) | When set games change, infer alternation rule (server flips); reconcile against next poll |
| Network blip causes missed poll | Exponential backoff retry within the poll window; gap is capped by next poll |
| Match goes from `live` → `completed` between polls | Always do one final fetch of `/screen/getmatchstats` after status flips to capture final aggregates |

### Aggregate validation

Once the match completes, Padelgod fetches `/screen/getmatchstats` and **cross-checks** the reconstructed point counts against the official totals (Total points won, etc.). If divergence > 5%, flag the match for human review in `padelgod.unresolved_matches` (new sidecar table — small, only flagged matches land here).

---

## 5. `getmatchstats` — what stats are exposed

POST `/screen/getmatchstats?t=tol` with body:
```
matchId=MQ012&year=2026&tournamentId=1701&organization=FIP
```

Returns HTML with **two tabs** (`Match` and `Set 1`, plus `Set 2`, `Set 3` once those sets exist) and **14 stat dimensions** per tab:

**Top-line:**
- Total points won (%)
- Break points converted (%)
- Longest streak (count)

**Serve:**
- Aces (count)
- Double faults (count)
- Won on 1st serve (%)
- Won on 2nd serve (%)
- Service games (count)

**Return:**
- Won on 1st return (%)
- Won on 2nd return (%)
- Return games (count)

**Total points:**
- Total points (count)
- Total won on serve (count)
- Total won on return (count)

**Schema mapping:** existing `match_stats` table already has 34 columns matching this exact taxonomy — Padelgod populates it from this endpoint instead of from padelapi.org's stats endpoint. Same shape, alternative source, no schema change needed.

---

## 6. WordPress API — what's actually useful

### `/wp-json/wp/v2/events`
- ✅ id, slug, link, title.rendered, content.rendered, date_gmt, **modified_gmt** (incremental sync key!)
- ✅ Taxonomies: `country` (term IDs), `event-year`, `gender` (men=37, women=36), `category-event`
- ❌ **`acf` field is empty across every event tested** — no rich tournament metadata via WP API. Dates, location, format, prize money come from the rendered event page or the widget.

**Use `modified_gmt` for incremental polling:**
```
GET /wp-json/wp/v2/events?modified_after=<last_sync_iso>&per_page=100
```
Saves ~95% of API calls vs full daily resync.

### `/wp-json/wp/v2/player`
- ✅ Same shape: id, slug, link, modified_gmt, country, gender, player_category
- The detail comes from `/player/<slug>/` HTML page (see §7).

### Other available types
- `federation` — national federations (FFP, FEP, etc.). Out of V1 scope.
- `sponsor` — sponsor entities (Cupra, Qatar Airways, etc.). Out of V1 scope.
- `course`, `documentation`, `gallery`, `post` — content types, irrelevant for stats pipeline.

---

## 7. Player profile pages — equipment + JSON-LD

The `/player/<slug>/` HTML page exposes (validated against `gabriel-elia-curcio-2`):

- **`fip_id` like `P217132`** — extractable via regex on the page (in JSON-LD or data attribute)
- **JSON-LD `Person` schema** with: birthPlace, height, affiliation, sameAs URLs
- **Ranking numbers** — current ranking + race ranking
- **"RACKET and BALL" section** — current racket brand + model (feeds existing `padel_rackets` + `player_equipment` tables)
- **Tournaments Breakdown** — match history per tournament
- **Other players** — related players (potentially useful for partner inference)

**Padelgod adds a `player-profile` worker** to scrape these on-demand (when a player is first encountered) and weekly (to refresh equipment/ranking changes).

---

## 8. Widget code lifecycle

Codes are **reused / become inactive after tournament ends**. Probed test code `FIP-2026-4401` (a previous Brussels-area event) returned "No schedule available" / "No results found" — same endpoint shape, no data.

**Padelgod handles this by:**
- Storing `last_validated_at` and `is_active` on `padelgod.widget_id_cache`
- Marking codes inactive when the widget returns the "No results / No schedule" template
- Re-validating live codes daily during the tournament window

---

## 9. What we do NOT get from the widget (and how we cope)

| Not exposed | Workaround |
|---|---|
| Per-point history (only current state) | Reconstruct from polling + diff (§4) |
| Per-point server attribution for past games | Accept NULL for retroactive — see design §4.1 |
| Player FIP IDs in the widget HTML (only short names) | Per-tournament dictionary built from entry-list scrape (design §5) |
| Tournament prize money, broadcasters | Not on FIP widget; comes from Premier `beforeauth` API (separate cron) |
| Match start/end timestamps with second precision | Widget gives "duration since start" — Padelgod records `started_at = now() - duration` on first observation |
| Currently-paused / suspended state granularity | `Live match` text covers active; `Suspended` and `Completed` cover the rest |

---

## 10. Implications for the design doc

These items are absorbed back into `2026-04-20-padelgod-design.md`:

1. **§2 worker table** — replace placeholder URLs with the validated endpoint set above
2. **§3 (new worker)** — add `player-profile` worker for equipment + JSON-LD enrichment (weekly + on-demand)
3. **§4.2** — add `padelgod.widget_id_cache.last_validated_at TIMESTAMPTZ`, `is_active BOOLEAN DEFAULT true`
4. **§4.2** — add `padelgod.unresolved_matches` table for stats divergence flags
5. **§5 (new section)** — formalize the **point-by-point reconstruction algorithm** with adaptive polling rules
6. **§3.6** — adaptive polling cadence: 6–8s default, drop to 3–4s when game score is in deuce/advantage/golden-point territory or any team has a set point
7. **§10 open questions** — add `federation` and `sponsor` post types (not V1, but on the radar)

---

## 11. Summary

The FIP/Crionet widget exposes everything Padelgod needs for live scoring **including the server indicator** (`ballg.png` presence) and per-set match stats — both of which padelapi.org currently strips. The only gap is point-by-point history, which Padelgod reconstructs via continuous polling with adaptive cadence around critical game states. Widget-ID discovery via the `/ft` search endpoint reduces our Playwright dependency to a fallback role rather than the primary path.
