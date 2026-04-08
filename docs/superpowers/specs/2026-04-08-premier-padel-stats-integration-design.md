# Premier Padel Match Stats Integration — Design

**Status:** Awaiting review (overnight design session 2026-04-07 → morning of 2026-04-08)
**Date:** 2026-04-08
**Author:** Claude (autonomous research session)
**Related:** Phases 1-5 data-model cleanup, source-priority.ts, entity_external_ids sidecar

---

## TL;DR

Premier Padel exposes a **public, no-auth REST API** at `https://premierpadel.com/premierpadel/api/beforeauth/*` that returns **per-set service/return/points statistics** for every Premier Padel tour match (P1, P2, Major, Finals, FIP World) since late 2024. We can ingest this for free, store it in a sidecar table, and unlock the empty Stats tab on match detail plus career stat aggregates on player profiles — none of which `padelapi.org` provides today.

The integration is **two crons** (one weekly entity-discovery, one hourly stats-sync) plus **one new table** (`match_stats`) and **one UI tab** (Stats on match detail). No changes to existing matches schema.

**Recommendation:** Build this **post-launch** (after April 13). Launch tonight has nothing waiting on it, and the entity-mapping cron benefits from a few real Premier tournaments running through our system first so we can verify match-name resolution heuristics.

---

## Decisions made overnight (override anything in the morning)

Since you're asleep, I made these calls based on existing project conventions. Flag any that should change before we implement.

| # | Decision | Rationale | Reversible? |
|---|---|---|---|
| 1 | Use **`entity_external_ids` sidecar** for Premier IDs (not new hot columns on `tournaments`/`matches`) | Premier is a tertiary source; the hot column slots are already taken by padelapi + fip per the data-model doc. Adding a third hot column would force schema migrations on two tables for one feature. | Yes — promote later if Premier becomes a primary source for stats |
| 2 | Stats live in a new **`match_stats`** table (1:1 with `matches`), not as a JSONB column on `matches` | Three reasons: (1) JSONB blob would balloon the matches table by ~9KB/row × thousands; (2) easier to drop and re-sync if Premier changes their schema; (3) lets us add per-set rows later via composite key without further migration. | Yes — collapse later if we never need set-level rows |
| 3 | **Match-level stats only in v1**, not per-set rows | The "Match" section of `match_state` already aggregates everything we need to render side-by-side stat bars. Per-set drill-down is a phase 2. | Yes — add `set_number` later as nullable column |
| 4 | **Hourly sync cron** scoped to "matches finished in the last 7 days" | Premier publishes stats within minutes of a match finishing; weekly is too slow for the post-match recap window. Hourly with a 7-day window catches everything without polling stale matches. | Yes — bump to 30 min if we want fresher post-match recaps |
| 5 | Skip **live stats polling** for v1 | Their `live_match_api_call_time=15s` gives us the polling interval, but live stats add complexity (need a worker, not a cron) and our existing Pusher relay already handles point-by-point. Live stats sit on top of the same per-set numbers we'll have post-match. | Yes — add a `/api/cron/premier-live-stats` route that hits live matches every 60s |
| 6 | Match-name resolution uses the **token-subset matcher** already in `merge-tournament-duplicates.ts` (extract to `src/lib/source-matcher.ts`) | Already proven on the cross-source dedup; same noise tokens, same year-filter logic. Don't reinvent. | No — this IS the right primitive |
| 7 | **No backfill of old tournaments before launch.** Discovery cron only walks Premier tournaments where `accommodation_start_date >= 2026-01-01` initially. | Older tournaments have inconsistent `accommodation_start_date` values (many are blank), making automated matching unreliable. We can backfill manually post-launch via an ops endpoint. | Yes — drop the date filter to backfill all 75 |
| 8 | Stats are **read-only**: source-priority.ts gets `'match.stats': ['premierpadel']` and nothing else. No UPSERT contention. | Premier is the only source that has these stats. No conflict resolution needed. | Trivially reversible |
| 9 | **No new env vars.** Premier's beforeauth API is public; the existing `CRON_SECRET` protects the new admin endpoints. | Less surface area, fewer rotation headaches. | Trivial |

---

## What I verified tonight

**A. The endpoint works and the data is excellent.** Confirmed on Miami P1 SF (Stupaczuk/Yanguas vs Galán/Chingotto, match ID 6190) — the response includes:

- Match metadata: court, date, start_time, day-of-event, bracket position (`MD003`), draw type (`MD/MQ/WD/WQ`), round name, winner, status (`F`/`P`/`L`/`S`)
- Per-team metadata: player + partner names, country flag URLs, player headshot URLs
- Score: 5-set structure with `set1..set5`, `tie1..tie5` (tiebreak scores, `-1` if no breaker)
- **Stats grouped into 4 sections** (`Match`, `set 1`, `set 2`, `set 3`):
  - **service:** Aces, Double Faults, 1st Serve Pts Won, 2nd Serve Pts Won, Service Games Played
  - **return:** 1st Return Pts Won, 2nd Return Pts Won, Return Games Played
  - **total_points:** Total Points Won, Total Serve Points Won, Total Return Points Won, Longest Points Won Streak

Each stat has `won` / `played` / `percentage` for both teams plus `is_winner: "Yes"|"No"`. Exactly what you'd render as side-by-side comparison bars.

**Caveat:** Aces and double faults are **always 0 in the data I sampled.** Premier doesn't track these stats — only the broader categories. We should not expose ace/DF columns in the UI.

**B. The full endpoint catalogue.** Pulled every JS chunk from premierpadel.com and grepped for `beforeauth/*`. Confirmed 15 public endpoints:

| Endpoint | Body | Purpose | We need? |
|---|---|---|---|
| `gettournamentsmatchdetail` | `tournaments_match_id, lang` | **Full stats payload** | ✅ Core |
| `gettournamentsdropdown` | `lang` | **Tournament list (75 entries, names + dates)** | ✅ Discovery |
| `gettournamnetupcomingmatches` *(sic)* | `tournaments_id` | Match list per tournament | ✅ Mapping |
| `gettournamentslivematch` | `slug` | Currently-live matches | Phase 2 |
| `getlivematchdetail` | `tournaments_match_id, lang` | Live polling payload (15s) | Phase 2 |
| `getwheretowatch` | `lang` | Broadcaster index (15 rows + 257 country mappings) | Already integrated via `getwheretowatchinfo` |
| `getwheretowatchinfo` | (existing) | Per-tournament broadcasters | Already integrated |
| `getcontentpagedetail` | `slug, lang` | Static content | No |
| `getsponsorsfooter` | `lang` | Sponsor logos | No |
| `appsetting` | `lang` | Polling intervals, social links, current tour tier | Optional |
| `getlanguage` | `lang` | i18n strings | No |
| `getnewsletter` | (form) | Newsletter signup | No |
| `emailsubscription` | (form) | Email opt-in | No |
| `addvideoview` | `video_id, type` | Video view tracking | No |
| `login` | (auth) | Player portal login | No |

Brute-force probed common alternative names (`gettournamentmatches`, `gettournamentdraw`, `getrankings`, `getplayer` etc.) — all 404. The 15 above are the complete public surface.

**C. ID range and density.** Premier's `tournaments_match_id` is a dense, sequential integer:
- Lower bound: matches 1-99 are mostly empty (data didn't exist yet)
- Real production starts around match ID **~150** (early 2024 data, no per-set stats)
- **Stats data starts at match ID ~1000** (Mar del Plata P1, late 2024)
- Current upper bound: **6193** (a "DEMO" tournament `tid=312`); real production tops out at **~6190** (Miami P1 final, March 2026)
- Tournament IDs (`tournaments_id`) go up to **312**, NewGiza P2 is **285**, currently 75 tournaments listed in the dropdown

**D. Stat coverage by era.** Sampled across the range:

| Match ID range | Tournament era | Has stats? | Sets in payload |
|---|---|---|---|
| 100-500 | 2024 (Brussels P2, Asunción P2) | ❌ No `match_state` data | 0 |
| 1000+ | Mar del Plata P1 (late 2024) onwards | ✅ Full | 2-3 |
| 5920-6190 | Gijón P2, Miami P1 (early 2026) | ✅ Full | 2-3 |

So the **usable data window is roughly 5,000 matches** (mid-2024 → present).

**E. Cross-source matching dry run.** Built a token-subset matcher and tested it against our DB without touching production:

- 74 Premier tournaments to match (excluding the dummy "All" entry)
- 147 padelapi-sourced tournaments in our DB
- **46/74 matched on the first pass** with year + token-subset only

The 28 unmatched fall into two buckets:

1. **Missing date on Premier side** (~22 cases): older tournaments have empty `accommodation_start_date`, so the year filter returns no candidates. Fix: fall back to "single-candidate token match without year constraint." Risk of false positives is low because our DB only has ~150 tournaments total.
2. **Wrong source** (~6 cases): `EUROPE P2`, `FIP SILVER SAINT MARTIN ISLAND` etc. exist in our `source='fip'` rows, not `source='padelapi'`. Fix: search both sources.

Projected match rate after both fixes: **65-70/74**, with the residual being legitimate edge cases (typos, sponsor name changes) that an ops dashboard should surface for manual linking.

**Critical confirmation:** **NEWGIZA P2** (your launch tournament) **was successfully matched** on the first pass with NO fallback heuristics needed:
```
Premier 285/NEWGIZA P2  →  our 730/Newgiza P2 2026
```

So launch-day stats will work even with the v1 matcher.

---

## Architecture

```
                      ┌──────────────────────────┐
                      │ premierpadel.com         │
                      │ /api/beforeauth/*        │
                      └────────────┬─────────────┘
                                   │
                ┌──────────────────┼─────────────────┐
                │                  │                 │
                ▼                  ▼                 ▼
   ┌────────────────────┐ ┌────────────────┐ ┌────────────────┐
   │ /api/cron/         │ │ /api/cron/     │ │ /api/admin/    │
   │ premier-discovery  │ │ premier-stats  │ │ premier-link   │
   │ (weekly Mon 4am)   │ │ (hourly)       │ │ (manual ops)   │
   └─────────┬──────────┘ └────────┬───────┘ └────────┬───────┘
             │                     │                  │
             ▼                     ▼                  ▼
   ┌─────────────────┐  ┌────────────────────┐  ┌────────────┐
   │ entity_external │  │ match_stats        │  │ ops UI     │
   │ _ids            │  │ (1:1 with matches) │  │ "Link/     │
   │ (premier maps)  │  │                    │  │  Override" │
   └─────────────────┘  └─────────┬──────────┘  └────────────┘
                                  │
                                  ▼
                     ┌────────────────────────────┐
                     │ /match/[id] → Stats tab    │
                     │ /player/[id] → career      │
                     │   aggregates (post-launch) │
                     └────────────────────────────┘
```

### Data flow per cron run

**Discovery cron (`premier-discovery`, weekly)**

1. `POST gettournamentsdropdown` → 75 Premier tournaments
2. For each Premier tournament:
   a. Look up existing mapping in `entity_external_ids` (`source='premierpadel'`, `entity_type='tournament'`). Skip if already linked.
   b. Run token-subset matcher against `tournaments` rows (both `padelapi` and `fip` sources) within ±90 days of Premier's `accommodation_start_date`
   c. If a unique match is found, INSERT into `entity_external_ids`
   d. If 0 or 2+ candidates, log to `match_stats_unresolved` table for ops review
3. For each newly-linked tournament, fetch its match list:
   a. `POST gettournamnetupcomingmatches` with `tournaments_id` → list of `tournaments_match_id`s
   b. For each Premier match, run player-name matching against the corresponding `matches` rows in our DB (filter by tournament + round)
   c. Match-level resolution uses the four player **last names** in the response — this is uniquely identifying within a single round of a single tournament
   d. INSERT successful matches into `entity_external_ids` with `entity_type='match'`
4. Returns `{ tournaments_linked, matches_linked, unresolved_count }`

**Stats sync cron (`premier-stats`, hourly)**

1. SELECT every match from `matches` where `status='finished'` AND `finished_at >= now() - 7 days` AND has a Premier mapping in `entity_external_ids` AND no row in `match_stats` (or `match_stats.computed_at < finished_at`)
2. For each match:
   a. `POST gettournamentsmatchdetail` with the Premier `tournaments_match_id`
   b. Extract the "Match" section's three categories (service/return/total_points)
   c. UPSERT into `match_stats` with all stat fields + `computed_at = now()`
3. Throttle: cap at 100 matches per run with a `LIMIT 100` order by `finished_at DESC` so freshest matches always sync first
4. Return `{ synced, errored, skipped }`

**Manual link endpoint (`/api/admin/premier-link`)**

POST `{ matchId: uuid, premierMatchId: int }` — lets the ops dashboard force-create a mapping when the cron's auto-resolution fails or picks the wrong row.

---

## Schema

### New table: `match_stats`

```sql
CREATE TABLE match_stats (
  match_id            UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,

  -- Service stats (per-team)
  team1_first_serve_won    INT,
  team1_first_serve_played INT,
  team1_second_serve_won   INT,
  team1_second_serve_played INT,
  team1_service_games      INT,

  team2_first_serve_won    INT,
  team2_first_serve_played INT,
  team2_second_serve_won   INT,
  team2_second_serve_played INT,
  team2_service_games      INT,

  -- Return stats (per-team)
  team1_first_return_won    INT,
  team1_first_return_played INT,
  team1_second_return_won   INT,
  team1_second_return_played INT,
  team1_return_games        INT,

  team2_first_return_won    INT,
  team2_first_return_played INT,
  team2_second_return_won   INT,
  team2_second_return_played INT,
  team2_return_games        INT,

  -- Total points
  team1_total_points_won  INT,
  team1_total_points_played INT,
  team1_serve_points_won  INT,
  team1_serve_points_played INT,
  team1_return_points_won INT,
  team1_return_points_played INT,
  team1_longest_streak    INT,

  team2_total_points_won  INT,
  team2_total_points_played INT,
  team2_serve_points_won  INT,
  team2_serve_points_played INT,
  team2_return_points_won INT,
  team2_return_points_played INT,
  team2_longest_streak    INT,

  -- Provenance
  source             TEXT NOT NULL DEFAULT 'premierpadel',
  source_match_id   TEXT NOT NULL,           -- Premier's tournaments_match_id, kept for debugging
  raw_payload        JSONB,                   -- Full response, stored for debugging + future re-parse
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_stats_computed_at ON match_stats (computed_at DESC);
CREATE INDEX idx_match_stats_source_match_id ON match_stats (source, source_match_id);
```

**Why columnar (not JSONB blob):**
- Direct SQL aggregates for player career stats (`SELECT SUM(team1_first_serve_won) FROM match_stats JOIN matches ON ... WHERE pair1_player1_id = ?`)
- Type safety from Postgres
- ~32 INT columns × 4 bytes = ~128 bytes per row, vs ~9KB JSONB. Over 5,000 historical matches: 640KB columns vs 45MB JSONB.

**Why `raw_payload` is also stored:**
- ~9KB per row × 5K matches = ~45MB total (cheap)
- Lets us re-parse if Premier adds fields later, without re-fetching from their API
- Useful for debugging unexpected NULLs

### Optional auxiliary table: `match_stats_unresolved`

```sql
CREATE TABLE match_stats_unresolved (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source             TEXT NOT NULL,
  source_id          TEXT NOT NULL,           -- premier tournaments_id or tournaments_match_id
  source_kind        TEXT NOT NULL,           -- 'tournament' | 'match'
  source_payload     JSONB,                   -- the unmatched item from their API
  candidate_count    INT NOT NULL,
  reason             TEXT,                    -- 'no_candidate' | 'multiple_candidates' | 'date_missing'
  resolved_at        TIMESTAMPTZ,
  resolved_match_id  UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_kind, source_id)
);
```

This is the queue the ops dashboard reads from to surface "tournaments/matches that need manual linking."

### `entity_external_ids` usage

**No schema change.** We just start writing rows with `source='premierpadel'`:

```sql
-- Tournament mapping
INSERT INTO entity_external_ids
  (entity_type, entity_id, source, external_id, metadata)
VALUES
  ('tournament', '7fa8bba7-988e-4da2-9faa-4fac36cd7918', 'premierpadel', '285',
   '{"name":"NEWGIZA P2","accommodation_start_date":"2026-04-10"}');

-- Match mapping
INSERT INTO entity_external_ids
  (entity_type, entity_id, source, external_id, metadata)
VALUES
  ('match', 'b029ed6b-...', 'premierpadel', '6190',
   '{"draw_type":"MD","round_name":"Men SF","matchId":"MD003"}');
```

The existing `findEntityBySourceId` helper in `src/lib/external-id-registry.ts` already handles this with zero changes.

### `source-priority.ts` additions

```ts
// Add to FIELD_PRIORITIES
'match.stats': ['premierpadel'],
```

That's it. No conflicts because no other source provides stats.

---

## API client (`src/lib/premier-api.ts`)

A thin wrapper, ~100 LOC, that exposes:

```ts
export interface PremierTournamentSummary {
  tournaments_id: number
  full_name: string
  accommodation_start_date: string
  accommodation_end_date: string
  is_live: 'Yes' | 'No'
  is_recent_tournament: 'Yes' | 'No'
}

export interface PremierMatchDetail {
  match_score: { /* ...all the keys we sampled... */ }
  match_state: PremierMatchStateSection[]
}

export interface PremierMatchStateSection {
  title: string  // 'Match' | 'set 1' | 'set 2' | ...
  service: PremierStatRow[]
  return: PremierStatRow[]
  total_points?: PremierStatRow[]  // only on 'Match' section
}

export interface PremierStatRow {
  title: string
  team_1: { title: string; won: string|number; played: string|number; percentage: string|number; is_winner: 'Yes'|'No' }
  team_2: { /* same */ }
}

// Methods
export async function fetchTournamentDropdown(lang = 'en'): Promise<PremierTournamentSummary[]>
export async function fetchUpcomingMatches(tournamentsId: number): Promise<PremierMatchSummary[]>
export async function fetchMatchDetail(matchId: number, lang = 'en'): Promise<PremierMatchDetail | null>
export async function fetchLiveMatch(slug: string): Promise<unknown[]>  // phase 2
```

**Implementation details:**
- All requests use `multipart/form-data` (matches their site exactly)
- 10-second timeout per request, 3 retries with exponential backoff (250ms, 1s, 4s)
- 200ms throttle between requests in the same cron run (250 reqs over 50s for a typical sync)
- Returns `null` on `data: []` (empty result), throws on transport errors
- No API key, no auth header needed

---

## Stats parser (`src/lib/premier-stats-parser.ts`)

Pure function from raw payload → flat row for `match_stats`:

```ts
export function parseMatchStatsPayload(payload: PremierMatchDetail): MatchStatsRow | null {
  const matchSection = payload.match_state.find(s => s.title === 'Match')
  if (!matchSection) return null

  const findStat = (cat: 'service' | 'return' | 'total_points', title: string) =>
    matchSection[cat]?.find(s => s.title === title)

  const num = (v: unknown): number | null => {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(v)
    return Number.isNaN(n) ? null : n
  }

  return {
    team1_first_serve_won:    num(findStat('service','First Serve Points Won')?.team_1.won),
    team1_first_serve_played: num(findStat('service','First Serve Points Won')?.team_1.played),
    // ...etc for all 32 columns
    raw_payload: payload,
  }
}
```

Unit tested with a frozen payload sample (committed to `__fixtures__/premier-match-6190.json`).

---

## Match-level entity resolution

The hard part. Tournament resolution is easy (75 candidates against 150 of ours, year-filtered). Match resolution needs a different strategy because Premier's match list is per-tournament with bracket positions, not global IDs.

**Algorithm for linking a Premier match to one of our matches:**

1. Look up the tournament mapping (must exist before we get here)
2. Pull all our matches for that tournament
3. For each Premier match:
   a. Extract the four last names: `team1_player_name`, `team1_partner_name`, `team2_player_name`, `team2_partner_player_name`
   b. Filter our candidates by `round` (Premier's `round_name` like "Men SF" → `round='SF'` and `category='men'` after a small mapping table)
   c. For each candidate, compute the **set similarity** between `{premier_lastnames}` and `{our_player_lastnames}` (where ours come from `players.name` via `lastName()` helper)
   d. Pick the candidate with the highest score; require ≥3/4 last-name matches to commit the link
4. If no candidate scores ≥3, write to `match_stats_unresolved` with reason `'no_player_match'`

**Why last names work:** Premier exposes only last names in their API. Padelapi gives us full names. The `lastName()` helper already extracts the last token. For doubles, the four last names of a single match within a single round are essentially unique.

**Edge cases:**
- Walkover / bye matches: `is_bye='Yes'` on Premier side. Skip linking (no stats).
- Postponed matches with no players assigned yet: Premier returns placeholder names. Skip; will resolve next cron run.
- Diacritics: Premier uses `Núñez`, padelapi uses `Nunez`. Strip diacritics before comparing (existing `normalize('NFD')` pattern from source-matcher).

---

## UI changes

### Match detail Stats tab (`src/app/match/[id]/page.tsx`)

The Stats tab currently exists but is empty. Replace placeholder with:

```tsx
{statsTab && (
  <MatchStatsView matchId={match.id} pair1Names={...} pair2Names={...} />
)}
```

`<MatchStatsView>` (new component, ~150 LOC):

- Fetches `/api/match-stats?matchId=<uuid>` (new GET endpoint, 30s edge cache)
- Renders stat rows as side-by-side bars with the existing chunky / clip-path styling:

```
┌─────────────────────────────────────────────┐
│  64%                              52%       │
│  ████████░░░░    1st Serve %    █████░░░░░░ │
│  37/58                          35/67       │
└─────────────────────────────────────────────┘
```

- Groups: Service (5 rows), Return (3 rows), Total (4 rows)
- Empty state: "Stats not yet available — checked back after the match finishes"
- Loading: skeleton bars

### Player profile career stats (post-launch phase 2)

Once we have ~100 finished matches with stats, add a "Career Stats" card to the player Overview tab:

- Career 1st serve % (sum of `team*_first_serve_won` / `played` across all matches the player was in)
- Career return % (same for return)
- Best surface / best partner combos (joined to `players` and `tournaments`)

This is also when the materialized snapshot from `2026-04-07-player-stats-materialization-design.md` becomes useful — the career stat aggregates would live on `player_stats_snapshot` rather than recomputed live.

---

## Vercel cron schedule additions

Add to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/premier-discovery",
      "schedule": "0 4 * * 1"
    },
    {
      "path": "/api/cron/premier-stats",
      "schedule": "13 * * * *"
    }
  ]
}
```

- Discovery: Mon 4am UTC (after the existing weekly full sync at the same time)
- Stats: hourly at :13 (off-peak minute)

---

## Phasing

**Phase 1 — Foundation (post-launch week 1)**
- [ ] DB migration: `match_stats`, `match_stats_unresolved`
- [ ] `src/lib/premier-api.ts` client
- [ ] `src/lib/premier-stats-parser.ts` + unit tests with frozen fixture
- [ ] `src/lib/source-matcher.ts` (extract from existing dedup script)
- [ ] `/api/cron/premier-discovery` route
- [ ] `/api/cron/premier-stats` route
- [ ] `/api/admin/premier-link` route + ops UI hook
- [ ] Manually run discovery, link NEWGIZA P2 + 1-2 finished tournaments end-to-end
- [ ] Verify `match_stats` rows populated for ~50 sample matches
- **Exit criteria:** at least one finished Premier tournament has stats for >90% of its matches in our DB

**Phase 2 — UI exposure (post-launch week 2)**
- [ ] `/api/match-stats` GET endpoint (with caching)
- [ ] `<MatchStatsView>` component
- [ ] Wire into existing Stats tab on `/match/[id]`
- [ ] Empty state, loading state, stat bar styling
- **Exit criteria:** users see stats on any finished Premier match, blank-but-graceful on FIP / non-Premier matches

**Phase 3 — Backfill (post-launch week 3)**
- [ ] Drop the date filter on discovery cron
- [ ] Run a one-time backfill against all 5,000 historical Premier matches (~10 minutes at 200ms throttle = 1000s = 17 minutes)
- [ ] Ops dashboard tab: list `match_stats_unresolved` with "Link to..." dropdown
- **Exit criteria:** all Premier-tier matches in our DB from late-2024 onwards have stats

**Phase 4 — Player aggregates (post-launch week 4+)**
- [ ] Ties in to `player_stats_snapshot` design from 2026-04-07
- [ ] Career stats tab on player profiles
- [ ] Head-to-head stats overlay on player comparison view
- **Exit criteria:** Tapia's profile shows "62% career 1st serve, 47% return"

**Phase 5 — Live stats (someday)**
- [ ] `/api/cron/premier-live-stats` route polling `getlivematchdetail` every 60s for matches in `live` status
- [ ] Push live stat updates through the existing realtime channel
- [ ] Live indicator + "stats updating..." pulse on the Stats tab

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Premier changes their endpoint shape | `raw_payload` JSONB + parser is pure → re-run parser without re-fetch |
| Premier rate-limits us | 200ms throttle + 100 match cap per cron = ~500 reqs/hour worst case (well under any reasonable rate limit) |
| Premier puts the API behind auth | Phase 2+ becomes unavailable. Phase 1 already-collected data still works. |
| Auto-matching links the wrong rows | Manual override endpoint + unresolved queue + `match_stats.source_match_id` audit field |
| Stats schema changes (new sport metric) | Add columns; ALTER TABLE is fast on PG with no defaults |
| 9KB raw_payload × 100K matches = ~900MB | Drop `raw_payload` after a year of stability via a cleanup migration |
| Premier match resolution fails for FIP-tier events | Premier does cover some FIP events (`FIP World Cup Pairs` was in the dropdown). Falls through the same matcher with `source='fip'` candidates. |

---

## What this does NOT do

- **Does not change anything in the launch path.** None of these files exist yet, no cron is wired up, no DB migration ships before April 13.
- **Does not touch padelapi.org.** Existing pipeline keeps working unchanged.
- **Does not modify `matches`, `sets`, `games`, or `players` tables.** Pure additive: one new table, optionally one queue table, no FK changes.
- **Does not change the relay service.** Relay still drives live point-by-point; Premier stats are post-match enrichment.
- **Does not add a new auth dependency.** Premier's beforeauth API is public.

---

## Open questions for you (decide in the morning)

1. **Should we track `live_match_url` per tournament** so the WhereToWatch card can link directly to Premier's live page (currently it points to the generic `/wheretowatch`)? Would need 1 extra column on `tournaments` or use the metadata JSONB on `entity_external_ids`.

2. **Per-set drill-down — phase 1 or phase 2?** I planned phase 2, but if you want set-by-set stat tabs in the UI from day one, the schema needs to change to `match_stats(match_id, set_number)` composite PK. Let me know which tradeoff you prefer.

3. **Backfill priority post-launch.** Should we backfill ALL 5,000 historical Premier matches in week 3, or just the last 12 months? Tradeoff is 45MB raw_payload + 30 minutes of cron time vs. having the full Tapia/Galán/Stupaczuk stat history forever.

4. **Manual override UX in ops dashboard.** The `match_stats_unresolved` queue needs a UI. Quick "list of cards with two dropdowns and a Link button" or richer "side-by-side detail compare with auto-suggested top 3"? I'll lean toward the simpler version unless you say otherwise.

5. **Do you want a "Premier verified" badge** on match cards that have stats from this pipeline, similar to the LIVE indicator? Nice-to-have, not required.

---

## File inventory (to be created during implementation)

```
src/lib/
  premier-api.ts                          [new, ~120 LOC]
  premier-stats-parser.ts                 [new, ~80 LOC]
  source-matcher.ts                       [new, extracted from merge-tournament-duplicates.ts]
  __fixtures__/premier-match-6190.json    [new, frozen sample for tests]
  __tests__/premier-stats-parser.test.ts  [new, 8-10 cases]

src/app/api/
  cron/premier-discovery/route.ts         [new, ~150 LOC]
  cron/premier-stats/route.ts             [new, ~100 LOC]
  admin/premier-link/route.ts             [new, ~60 LOC]
  match-stats/route.ts                    [new, ~40 LOC GET]

src/app/match/[id]/
  page.tsx                                [modify, swap stats tab placeholder]

src/components/
  MatchStatsView.tsx                      [new, ~150 LOC]
  MatchStatsBar.tsx                       [new, ~50 LOC reusable bar]

src/app/ops/
  PremierLinkTab.tsx                      [new, manual override UI]

supabase/migrations/
  YYYYMMDD_match_stats.sql                [new]
  YYYYMMDD_match_stats_unresolved.sql     [new]

vercel.json                               [modify, +2 cron entries]
src/lib/source-priority.ts                [modify, +1 line]
CLAUDE.md                                 [modify, document Premier source]
```

Total: ~12 new files, ~5 modifications, ~900 LOC including tests.

---

## Verification checklist (before merging)

- [ ] `npm run build` clean
- [ ] `npx vitest run src/lib/__tests__/premier-stats-parser.test.ts` green
- [ ] Manual trigger of `/api/cron/premier-discovery` returns >0 tournaments linked
- [ ] Manual trigger of `/api/cron/premier-stats` populates >50 rows
- [ ] Stats tab on a known finished match (`/match/<id>` for one of the test entries) renders bars
- [ ] Empty state graceful on a non-Premier match
- [ ] `match_stats_unresolved` has a reasonable count (<20% of total)
- [ ] `EXPLAIN ANALYZE` on the player career-stats query is <50ms

---

**End of design.** See you in the morning. ☕
