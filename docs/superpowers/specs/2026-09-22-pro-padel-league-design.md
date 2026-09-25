# Pro Padel League (PPL) coverage

**Date:** 2026-09-22
**Status:** Approved, not implemented
**Branch:** `feat/ppl-league`

## Problem

PadelNachos covers the individual circuit (FIP / Premier Padel) and hand-curated exhibitions (`managed_events`). It has no model for a **franchise league**: teams that persist across a season, draft rosters, and meet in team-vs-team ties.

The [Pro Padel League](https://propadelleague.com/) is the largest such league — 10 North American franchises, two divisions, five events a year, with players who also compete on the FIP/Premier circuit.

The strategic case is player history. If a PPL match lands in `matches` with real player FKs, then a player's PadelNachos profile becomes the only place on the internet that holds **every professional match they played**, circuit and league alike. No other data source stitches the two together.

## What PPL actually is

### Structure

- **10 franchises**, shared across both divisions: DC Matrix, Florida Goats, Houston Volts, Las Vegas Smash, Los Angeles Beat, Mexico Waves, Miami Padel Club, New York Atlantics, San Diego Stingrays, Toronto Polar Bears.
- **Two divisions**, `ppl` and `ppl-ii`, running in parallel at the same event weekend in separate venues.
  - **PPL** — the top division. ~4 active players per franchise (2 men, 2 women) plus alternates. 24 matches per event.
  - **PPL II** — a *development pathway* for North American talent, launched February 2026. Each of the 10 clubs drafts and operates **one** PPL II pairing (5 clubs men's, 5 clubs women's). 12 matches per event. Drafted players get team contracts; the inaugural season carries US$350k in guaranteed compensation and prize money. The top two men's and top two women's pairings qualify as Wildcard Entrants in The City's Cup, facing the PPL's 7th and 8th seeds.
- **A tie** = two franchises meeting, producing **one men's match and one women's match**. Grouped upstream by `sessionNumber`.
- **Event shape**: Day 1–3 Group Stage, Day 4 Podium (Championship + 3rd Place).
- **Standings** are kept three ways — overall, men's, women's — per division.

### 2026 season state (as of 2026-09-22)

| Event | Dates | PPL | PPL II | Status |
|---|---|---|---|---|
| New York | 9–12 Jul | 24 | 12 | complete |
| Los Angeles | 13–16 Aug | 24 | 12 | complete |
| Playa del Carmen | 24–27 Sep | — | — | imminent |
| Guadalajara | 19–22 Nov | — | — | future |
| Miami | 3–6 Dec | — | — | future |

**72 matches** are available to backfill. 2025 events are listed on their site but have no detail pages (404) — the current season is the full extent of what can be captured.

## Data source

`propadelleague.com` is a Next.js Pages Router app backed by Firestore (`pro-padel-league` / `prod-ppl`). Two distinct layers:

### Static — plain `fetch`, no browser

`/_next/data/<buildId>/tournament/<slug>.json` returns a `broadcastContext` containing:

- `teamsById` — name, city, brand color (`#0187d1`), five logo variants, social URLs, `mensPlayerIds` / `womensPlayerIds`
- `playerRowsById` — slug, `firstName`, `lastName`, `displayName`, `sex`, `leagueId`, `status`, headshots
- `matchRows` — `hometeam`/`awayteam` docIds, `date`, `stage`, `game_type` (male/female), `sessionNumber`
- `teamRankById` — overall / mens / womens rank
- `leagueRowsById` — `ppl` → "PPL", `ppl-ii` → "PPL II"

`buildId` changes on every deploy of their site. **Read it from `window.__NEXT_DATA__.buildId` (or the same field in the served HTML). Never hardcode it.**

### Dynamic — requires a headless browser

Scores and statistics are **not** in the SSG payload. They are fetched from Firestore at runtime and only exist in the rendered DOM at `/tournament/<slug>/match/<match-id>/`.

The Firestore REST API returns `403 PERMISSION_DENIED` unauthenticated. **We do not attempt to authenticate against it or circumvent their security rules.** We read the public rendered page, which is what any visitor sees.

The DOM uses stable semantic BEM classes (`match-h2h-board__stat-row`, `match-detail-scoreboard`, `cc-bcast-players`, `match-h2h-board__set-pill`) — selector-based extraction, not positional.

### What a match page yields

- Four player names with nationality and profile links (`/player/<slug>/`)
- Set-by-set scores (3rd set is a super tiebreak to 10)
- Match duration, seeds, placement, status, replay URL
- Head-to-head stats: % points won, % serves won, break points converted, **% golden points won**, **% long rallies won**
- Serve & shots, overall and **per set**: 1st serve in, aces, double faults, 2nd serve won
- **Winners by shot type: smash, bandeja, volley, víbora, groundstroke, lob, other** — richer than Crionet
- Unforced / forced errors
- All of the above **also broken down per individual player**

Group Stage matches carry the same depth as Podium matches. There is no coverage gap within an event.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | PPL gets a **dedicated section**, and its matches are **first-class `matches` rows** | The section gives the league its own identity; the matches rows are what make player history work for free |
| 2 | PPL matches appear in player history and the Season tab, but are **excluded from win rate, W-L record, titles, Elo, predictions, and prize money** | Different format (super tiebreak, team league) — mixing it into circuit metrics would corrupt them |
| 3 | PPL **and** PPL II both ship in v1 | PPL II is where the differentiator is strongest: those players exist in no other database |
| 4 | PPL players get `players.tier = 'pro'` | `tier` selects which profile renders, not level of play. These players have real matches with stats and need the pro profile. Absence of FIP ranking is `ranking IS NULL`, not a tier |
| 5 | **No BottomNav entry.** Reached from the home carousel and the Tournaments tab | It is a circuit among circuits, not a fifth primary surface |
| 6 | The event view **forks `EventDetail.tsx` (576 lines)**, not `tournaments/[id]/page.tsx` (2633 lines) | The tournament page is welded to draws, brackets, projections and entry lists — none of which PPL has |
| 7 | A **new two-sided `league_ties` table**, rather than reusing the one-sided `team_fixtures` | See below |

### Why `league_ties` and not `team_fixtures`

`team_fixtures` (from the SNP amateur work) hangs a tie off a single `team_season_id` and stores the opponent as free-text `opponent_name`. That is correct for SNP, where only one club is tracked.

In PPL both sides are our own teams. A one-sided model would require **writing every tie twice**, once per franchise, and reconciling scores between the two copies. `team_fixtures` / `team_fixture_slots` stay untouched and continue serving SNP only.

Two honest models beat one generic model that serves neither well.

## Data model

### Reused, with additions

```
teams                      10 rows, source='ppl'
  slug, name, city, country, crest_url,
  badge_label, short_name, cover_image_url
  + brand_color            NEW — PPL publishes a per-franchise hex
  source='ppl', external_id='miami-padel-club'

team_seasons               20 rows (10 franchises × 2 divisions)
  team_id → teams
  + league                 NEW — 'ppl' | 'ppl-ii'
  + season_year            NEW — 2026
  label                    '2026 PPL' / '2026 PPL II'
  ranking, ties_played, ties_won,
  points_for, points_against          already exist — this IS the standings table

team_memberships           the roster, per season
  team_season_id, player_id
  games_played, wins, losses          already exist
  is_captain, roster_rank
```

`league` and `season_year` are real columns rather than being encoded in `label`, so queries do not degrade into `LIKE '%PPL II%'`.

### New

```
league_ties
  id
  tournament_id → tournaments
  session_number
  stage                    'Group Stage' | 'Championship' | '3rd Place'
  home_team_season_id → team_seasons
  away_team_season_id → team_seasons
  scheduled_at
  UNIQUE (tournament_id, session_number, stage)

matches
  + tie_id → league_ties   NEW, nullable
```

`matches.category` (`'men'` / `'women'`) already distinguishes the two matches within a tie.

### Events

The four 2026 events become `tournaments` rows with `source='ppl'` and `level='ppl'` / `level='ppl_ii'`.

**No schema change is required** — `tournaments.level` is plain nullable `text` with no CHECK or enum.

`level` is the single discriminator for the whole feature: it drives the exclusions in Decision 2 *and* identifies the section. One concept, one field.

### Statistics

`match_stats` is keyed `(match_id, set_number)` with `set_number = 0` as the aggregate, and already carries `source` and `raw_payload`. PPL stats map onto it with `source='ppl'`.

Two things do not fit and go into `raw_payload` in v1:

- **Winners by shot type** and **% golden points won** have no columns.
- **Per-player statistics** have no dimension — `match_stats` has no player axis.

We do not create `match_stats_players` before a screen consumes it. `raw_payload` guarantees the data is not lost in the meantime. If the shot-type breakdown ships in the UI (it is planned — see *UI surfaces*), promote it to real columns at that point, because a rendered stat must be queryable.

## Ingestion

Follows the established padelgod two-phase pattern (`oop-fetcher` → `fip-oop-writer`, `results-fetcher` → `fip-results-writer`).

### `ppl-fetcher`

- Plain `fetch` for the static JSON (teams, rosters, fixtures, ranks).
- Playwright **only** for match pages, where scores and stats live.
- Writes raw snapshots.

### `ppl-writer`

- Snapshot → `tournaments`, `league_ties`, `matches`, `sets`, `match_stats`, `teams`, `team_seasons`, `team_memberships`.

Separating the phases means a scrape that fails midway never half-writes production, and the raw capture stays replayable when the parser is wrong.

### Snapshot retention is part of the migration, not a follow-up

The padelgod snapshot archive is already the single largest Supabase cost driver — roughly 20GB, ~99% of the database, against 255MB for the entire public schema. Adding another unbounded snapshot table would repeat that mistake.

**The retention policy ships in the same migration that creates the snapshot table.**

### Scheduling is gated, not continuous

PPL is five 4-day events per year. A worker polling every 5 minutes year-round would be ~99% waste.

The worker first checks whether a PPL event is inside an active window; outside it, it returns immediately without an HTTP call. Same shape as `match-stats-fetcher`'s `fetchPremierTournamentIds()` pre-HTTP gate.

### Player resolution happens once

The PPL slug (`agustin-tapia`, `letizia-manquillo`) is a stable natural key.

1. Resolve once against `players`.
2. Register in `entity_external_ids` with `source='ppl'`.
3. Every subsequent run is a direct lookup — no fuzzy matching.

Resolution **must** use `firstName` / `lastName` from the roster JSON, never the uppercase DOM text. The DOM renders nicknames inline (`ALEJANDRO "ALEX" RUIZ`), which would create duplicate player rows.

PPL II will produce a meaningful number of genuinely new players with no FIP presence. That is expected and is the point — they get created with `tier='pro'` and `ranking IS NULL`.

### Idempotency

PPL match ids (`los-angeles-2026-d3-m2-womens`) are stable natural keys. Reprocessing does not duplicate.

### Backfill

The 72 existing matches are a **one-shot script**, not a worker. ~72 page loads, ~5 minutes.

### Pre-flight check

FIP already blocks Railway egress (two separate mechanisms). Firebase/Google is unlikely to, but **verify Railway can reach `propadelleague.com` before writing any worker code.** It is a two-minute test that de-risks the whole pipeline.

## UI surfaces

All under `src/app/[locale]/(app)/ppl/`, inheriting the group layout's BottomNav and 72px bottom padding.

### `/ppl` — league hub

Modelled on `rankings/page.tsx` (836 lines).

- Two filter axes: **division** (PPL / PPL II) × **scope** (Overall / Men's / Women's). Both are required — a franchise can be 1st in men's and 8th in women's.
- Standings table from `team_seasons`.
- Event list.

### `/ppl/event/[slug]` — event

Forked from `EventDetail.tsx`.

- Day tabs via `SlidingInkTabs`.
- **A tie renders as one card containing both matches**, with the franchise named once and a gender pill per match. This is the visual expression of `league_ties`; a one-sided model would force the view to reconcile two rows to draw one card.

### `/ppl/team/[slug]` — franchise

Reuses `TeamPageShell`'s layout (hero, tabs, three-up totals strip) with widened props. Roster reuses `TeamRoster`.

`TeamFixtures.tsx` renders structurally the right thing (a tie decomposed into courts) but only from one team's perspective. Fork it for the neutral two-sided event layout; drop its `exact` / `ambiguousPairing` machinery, which is an SNP data-quality artifact.

### `/match/[id]` — match detail

Existing route. The stats tab gains a PPL variant. `MatchStatsBar` is fully generic (a row is six values) and reusable as-is; `MatchStatsView` is welded to `MatchStatsRow` column names, so either map PPL stats into that shape and use the `preloaded` seam, or wrap `MatchStatsBar` in a thin PPL container.

The shot-type breakdown (smash / volley / víbora / bandeja) is the differentiating panel — no other source we ingest produces it.

### Player profile

PPL matches flow through the profile's **own** `MatchRow` / `TeamRow` (`player/[id]/page.tsx:1512`), not the shared `MatchCard`. `MatchRow` calls `resolveMatchRoles()` to put the viewed player's pair on top, which is the entire point of that component and which `MatchCard` cannot do.

Needs: a context label prop where `match.round` currently sits, and `TournamentGroup` accepting a PPL event as a group header.

**A PPL row carries an explicit note that it does not count toward ranking, Elo or prize money.** The `PPL` chip alone is not honest enough — a user seeing a win in the history would reasonably assume it counted.

## Enforcing the exclusion

Decision 2 is not free. The audit found that several consumers read `matches` with no level filter at all, and several others fall through to a *wrong but plausible* default.

### Must be fixed — PPL currently leaks in

| Location | Problem |
|---|---|
| `padelgod/src/lib/elo-model.ts:23` | `kFactor(level)` falls through to `return 18` — heavier than `fip_bronze` |
| `padelgod/src/workers/model-prediction-snapshot.ts:311` | Training corpus reads **all** finished matches, every tier. `isInScopeTier` at `:293` gates prediction *output*, not *input* — PPL would move real Elo ratings |
| `padelgod/src/workers/tournament-projection-snapshot.ts:288` | Same unfiltered training read |
| `padelgod/src/workers/live-odds-updater.ts:27` | No level gate whatsoever. Relevant when live stats ship |
| `src/lib/derive-titles.ts:43` | Any `round === 'F'` win counts as a career title. A PPL final would render a trophy |
| `player/[id]/page.tsx:353` | The single career-matches query feeds every derived stat. Needs a genuine split into `officialMatches` (stats) and `allMatches` (history), not a query filter |
| `SeasonTab.tsx:162-195` | Season W-L bars and win rate must exclude; `deriveSeasonTournaments` must include |
| `src/lib/tournament-labels.ts:5` | `levelLabel` falls through to the raw string — would render literal `"ppl"` |
| `src/lib/match-quality.ts:129` | `tierWeight` falls through to `?? 0.70`, equal to `fip_silver` — a PPL match could win a highlight slot |
| `player/[id]/page.tsx:1939` | `LEVEL_TO_CIRCUIT` falls through to `'Other'`, polluting that bucket |

### Already safe — allow-lists that default to deny

`tierFromLevel` (earnings), `isMainCircuit` (pair health), `isPremierLevel` (PBP / Score Recap / Live Feed), the home rails, and the Tournaments tab all use allow-lists and correctly exclude PPL without modification.

**One of these carries disproportionate weight.** The `money_leaderboard` RPC does not join `tournaments`, so it *cannot* filter by level. The only thing keeping PPL out of prize money and the money leaderboard is `tierFromLevel`'s `default: return null`.

**Add a regression test pinning `tierFromLevel('ppl', 'men') === null`.** That single assertion protects the whole money surface.

### Required additions

- `levelLabel`: `ppl` → `"PPL"`, `ppl_ii` → `"PPL II"`
- `TIER_PILL` / `TIER_GRADIENT`: entries for both levels
- `levelTierWeight`: an explicit weight instead of the `?? 50` fallback

## Design-system work

The app has four duplications that PPL would otherwise make worse. In each case the fix is to **extract what already exists**, not to invent a component.

| Gap | Current state | Action |
|---|---|---|
| Men/women chunky pill toggle | Inline at `rankings/page.tsx:649`, plus near-identical copies in `FeedTabs` and `PicksTabs`. Never extracted | Extract. PPL needs it in two new places — it would otherwise be the fourth copy |
| Standings/leaderboard row | `PlayerRow` and `MoneyRow` in `rankings/page.tsx` are ~95% duplicated (same shell, rank column, avatar, tabular value) | Extract a shared row shell; export `RankBadge` / `DeltaChip` |
| Level pill | No `<LevelPill>` exists — an inline `<span>` with `levelLabel()` + `TIER_PILL[level]` repeated in seven files | At minimum add the `ppl` keys; extracting the component is the better fix |
| Category colors | `MEN_BLUE` / `WOMEN_PURPLE` redeclared in four files; canonical copy at `match/[id]/lib/constants.ts:12` | Consolidate on the canonical export |

### Reused as-is, no changes

`MatchCard` (add an optional court label prop), `SlidingInkTabs`, `SwipeTabView`, `MatchStatsBar`, `useInViewOnce`, `MatchesPageHeader`, the `maxWidth: 500` centered shell recipe.

### Visual conventions to honor

- Comparison bars use `PAIR1_COLOR = '#FF6B2B'` (orange) and `PAIR2_COLOR = '#FFD166'` (yellow) — not the accent blue.
- Pills use chanfered `clipPath` (`CHUNKY.button`), not `border-radius`.
- Horizontal page padding is 16px; row padding `12px 16px`.

## Out of scope for v1

- **Live scores and live stats.** PPL's own site has a `cc-live-match` component, so live data exists upstream. Deferred deliberately — v1 is historical. Note that `live-odds-updater.ts` must be gated *before* live PPL matches ever appear, or they will silently acquire cold-start Elo odds.
- **2025 season backfill.** Their site has no detail pages for it.
- **`match_stats_players`.** Per-player stats live in `raw_payload` until a screen consumes them.
- **The City's Cup finals format**, including PPL II wildcard qualification. Model it when the December event approaches.

## Suggested phasing

This spec is too large for one implementation plan. Four phases, each independently shippable and verifiable:

**Phase 1 — Foundations and exclusion.** Migrations (`brand_color`, `team_seasons.league` / `season_year`, `league_ties`, `matches.tie_id`), `levelLabel` / `TIER_PILL` / `levelTierWeight` entries, and **every gate from *Enforcing the exclusion***, including the `tierFromLevel('ppl') === null` test. Nothing user-visible ships, but production becomes safe to ingest into. This phase must land first — ingesting before the gates exist would corrupt Elo on the next worker run.

**Phase 2 — Ingestion and backfill.** Railway egress pre-flight, `ppl-fetcher` / `ppl-writer`, snapshot table with retention, player resolution via `entity_external_ids`, one-shot backfill of the 72 matches. Verifiable entirely through the database, with no UI.

**Phase 3 — Design-system extractions.** The four extractions from *Design-system work*. Independent of PPL, refactor-only, existing surfaces must not change visually.

**Phase 4 — UI surfaces.** Hub, event, franchise, match stats variant, player-profile integration.

Phases 2 and 3 can run in parallel once Phase 1 lands. Phase 4 depends on both.

## Risks

| Risk | Mitigation |
|---|---|
| Railway egress blocked, as FIP already does | Verify connectivity before writing worker code |
| Their DOM changes and the parser breaks | Selector-based extraction on semantic BEM classes; snapshot archive makes reparsing possible without refetching |
| `buildId` changes on their every deploy | Read from `__NEXT_DATA__.buildId` at runtime |
| Player conflation onto same-surname circuit players | Resolve from roster JSON fields, register in `entity_external_ids`, never fuzzy-match DOM text |
| Snapshot archive inflating Supabase cost | Retention policy in the creating migration |
| PPL leaking into Elo before the gates land | The exclusion work is not optional follow-up — it ships with ingestion |

## Open question deferred to implementation

Whether the pro player profile renders correctly for a player with `ranking IS NULL`, no FIP country, and no stored `win_rate` — the shape every new PPL II player will have. Likely already handled (a fresh qualifier hits the same case), but **verify before ingesting, not after.**
