# Premier Padel Stats 2026 Backfill — Pre-Launch Design

**Status:** Awaiting spec review
**Date:** 2026-04-08
**Target:** Ship before launch on **2026-04-13** (NewGiza P2)
**Parent spec:** `docs/superpowers/specs/2026-04-08-premier-padel-stats-integration-design.md` (the broader post-launch integration)

---

## TL;DR

Backfill per-set service/return/points statistics from Premier Padel's public REST API for every finished 2026 match across the **Premier Tour** (p1, p2, major, finals) and **FIP Platinum/Gold** tiers — **41 tournaments, ~367 matches**. Ship a **Stats tab** on match detail that renders the data from day one, with nested per-set pill tabs and three grouped stat sections (Service / Return / Total). Ongoing hourly sync cron keeps NewGiza P2 and subsequent tournaments fresh. All of this lands before the April 13 launch.

Decisions locked in during brainstorming:

| # | Decision | Chosen |
|---|---|---|
| 1 | Scope | Premier Tour + FIP Platinum/Gold (~367 matches, 41 tournaments) |
| 2 | UI day one | Full Stats tab with real data + polished bars |
| 3 | Unresolved queue | Write to `match_stats_unresolved`; resolve via Supabase SQL |
| 4 | Ongoing sync | Hourly cron ships together with backfill |
| 5 | Stat rows shown | Full set: 5 service + 3 return + 4 total = 12 rows |
| 6 | Schema depth | Per-set rows from day one (composite PK `(match_id, set_number)`) |
| 7 | Execution style | Thin vertical slices, one demo-able artifact per day |
| 8 | Day-1 triggering | Manual curl against cron endpoints (no standalone script) |
| 9 | Observability | Health JSON in every cron response, no Sentry/alerts for v1 |

---

## Scope verification (from current DB state as of 2026-04-08)

| Tier | Tournaments (2026) | Matches | Finished |
|---|---|---|---|
| Premier Tour (p1/p2/major/finals) | 24 | 312 | **242** |
| FIP Platinum/Gold | 17 | 125 | **125** |
| **In scope total** | **41** | **437** | **~367** |
| FIP Silver/Bronze/other | 227 | 130 | 130 (NOT in scope) |

Finished-match count is the backfill target. Unfinished matches will be picked up by the hourly sync as they complete.

**Critical confirmation:** NEWGIZA P2 (launch tournament, `tournaments_id=285` on Premier, `id=730` in our DB, starts April 13) is already mapped cleanly by the token-subset matcher in the overnight dry run. Launch-day matches will be linked automatically.

---

## Architecture

```
          ┌───────────────────────────────────┐
          │   premierpadel.com/api/beforeauth │
          └────────────┬──────────────────────┘
                       │ POST multipart/form-data
    ┌──────────────────┴──────────────────────┐
    │                                         │
    ▼                                         ▼
┌───────────────────────┐        ┌──────────────────────┐
│ /api/cron/            │        │ /api/cron/           │
│ premier-discovery     │        │ premier-stats        │
│ (manual day 1, then   │        │ (manual day 1, then  │
│  weekly Mon 4am)      │        │  hourly at :13)      │
└────────────┬──────────┘        └──────────┬───────────┘
             │                              │
             ▼                              ▼
   ┌──────────────────────┐      ┌──────────────────────┐
   │ entity_external_ids  │◀─────│ match_stats          │
   │ (source=premierpadel)│      │ PK: (match_id,       │
   └──────────────────────┘      │      set_number)     │
                                 └──────────┬───────────┘
   ┌──────────────────────┐                 │
   │ match_stats_         │                 │
   │ unresolved           │                 │
   │ (manual queue)       │                 │
   └──────────────────────┘                 │
                                            ▼
                                 ┌──────────────────────┐
                                 │ /api/match-stats     │
                                 │ (cached 30s)         │
                                 └──────────┬───────────┘
                                            ▼
                                 ┌──────────────────────┐
                                 │ /match/[id]          │
                                 │   → Stats tab        │
                                 │   → <MatchStatsView> │
                                 └──────────────────────┘
```

**Files created:**

| File | Purpose | LOC |
|---|---|---|
| `src/lib/premier-api.ts` | Thin REST client (fetch, retry, throttle) | ~120 |
| `src/lib/premier-stats-parser.ts` | Pure `PremierMatchDetail → MatchStatsRow[]` | ~100 |
| `src/lib/source-matcher.ts` | Token-subset matcher (extracted from merge script) | ~80 |
| `src/app/api/cron/premier-discovery/route.ts` | Tournament + match linking | ~200 |
| `src/app/api/cron/premier-stats/route.ts` | Hourly stats sync | ~100 |
| `src/app/api/match-stats/route.ts` | GET endpoint for UI | ~40 |
| `src/components/MatchStatsView.tsx` | Stats tab container | ~180 |
| `src/components/MatchStatsBar.tsx` | Reusable stat row | ~60 |
| `src/components/MatchStatsSetTabs.tsx` | Pill tab row | ~50 |
| `src/lib/__fixtures__/premier-match-6190.json` | Frozen 3-set fixture | — |
| `src/lib/__fixtures__/premier-match-2set.json` | Frozen 2-set fixture | — |
| `src/lib/__fixtures__/premier-match-retired.json` | Synthesized retired-match fixture | — |
| `src/lib/__tests__/premier-stats-parser.test.ts` | Parser unit tests | ~150 |
| `src/lib/__tests__/source-matcher.test.ts` | Matcher unit tests | ~120 |
| `supabase/migrations/20260409_match_stats.sql` | Schema | ~80 |
| `supabase/migrations/20260409_match_stats_unresolved.sql` | Queue schema | ~30 |

**Files modified:**

| File | Change |
|---|---|
| `src/app/match/[id]/page.tsx` | Replace stats tab placeholder with `<MatchStatsView>` |
| `src/lib/source-priority.ts` | Add `'match.stats': ['premierpadel']` |
| `vercel.json` | Add discovery (weekly) + stats (hourly) cron entries |
| `scripts/merge-tournament-duplicates.ts` | Import helpers from new `source-matcher.ts` |
| `CLAUDE.md` | Document `premierpadel` as a tertiary source |

**Total:** ~16 new files, ~5 modifications, ~1300 LOC including tests.

---

## Schema

### `match_stats`

Composite primary key `(match_id, set_number)`. `set_number = 0` holds the full-match aggregate; `set_number = 1..5` holds individual set stats.

```sql
CREATE TABLE public.match_stats (
  match_id    UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number  SMALLINT NOT NULL,
  PRIMARY KEY (match_id, set_number),

  -- Service stats (per team)
  team1_first_serve_won       INT,
  team1_first_serve_played    INT,
  team1_second_serve_won      INT,
  team1_second_serve_played   INT,
  team1_service_games         INT,
  team2_first_serve_won       INT,
  team2_first_serve_played    INT,
  team2_second_serve_won      INT,
  team2_second_serve_played   INT,
  team2_service_games         INT,

  -- Return stats (per team)
  team1_first_return_won      INT,
  team1_first_return_played   INT,
  team1_second_return_won     INT,
  team1_second_return_played  INT,
  team1_return_games          INT,
  team2_first_return_won      INT,
  team2_first_return_played   INT,
  team2_second_return_won     INT,
  team2_second_return_played  INT,
  team2_return_games          INT,

  -- Total points (ONLY populated on set_number = 0)
  team1_total_points_won      INT,
  team1_total_points_played   INT,
  team1_serve_points_won      INT,
  team1_serve_points_played   INT,
  team1_return_points_won     INT,
  team1_return_points_played  INT,
  team1_longest_streak        INT,
  team2_total_points_won      INT,
  team2_total_points_played   INT,
  team2_serve_points_won      INT,
  team2_serve_points_played   INT,
  team2_return_points_won     INT,
  team2_return_points_played  INT,
  team2_longest_streak        INT,

  -- Provenance
  source            TEXT NOT NULL DEFAULT 'premierpadel',
  source_match_id   TEXT NOT NULL,
  raw_payload       JSONB,    -- stored ONLY on set_number = 0 row
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_stats_computed_at ON match_stats (computed_at DESC);
CREATE INDEX idx_match_stats_source_match_id ON match_stats (source, source_match_id);

ALTER TABLE match_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read match_stats"
  ON match_stats FOR SELECT USING (true);

CREATE POLICY "Service role full access to match_stats"
  ON match_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

**Rationale for the aggregate-in-same-table pattern:**
- Single query returns aggregate + all sets: `SELECT * FROM match_stats WHERE match_id = ? ORDER BY set_number`
- No schema split, no JOIN, no second RLS policy
- Total points fields are NULL on per-set rows — clear semantics, trivial storage cost
- `raw_payload` stored once per match (on `set_number = 0`) saves ~36KB × 367 = ~13 MB

**Row count estimate:** 367 matches × avg 3 rows (1 aggregate + 2 sets) ≈ **1100 rows**. Trivial.

### `match_stats_unresolved`

```sql
CREATE TABLE public.match_stats_unresolved (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source             TEXT NOT NULL,
  source_kind        TEXT NOT NULL CHECK (source_kind IN ('tournament', 'match')),
  source_id          TEXT NOT NULL,
  source_payload     JSONB,
  candidate_count    INT NOT NULL DEFAULT 0,
  reason             TEXT,  -- 'no_candidate' | 'multiple_candidates' | 'no_player_match'
  resolved_at        TIMESTAMPTZ,
  resolved_match_id  UUID REFERENCES matches(id) ON DELETE SET NULL,
  resolved_tournament_id UUID REFERENCES tournaments(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_kind, source_id)
);

CREATE INDEX idx_match_stats_unresolved_pending
  ON match_stats_unresolved (source, source_kind) WHERE resolved_at IS NULL;

ALTER TABLE match_stats_unresolved ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to match_stats_unresolved"
  ON match_stats_unresolved FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
```

### Ops workflow for the unresolved queue

Queries the user runs directly in the Supabase SQL editor:

```sql
-- List what needs resolving
SELECT source_kind, source_id, reason, candidate_count,
       source_payload->>'full_name' AS premier_name,
       source_payload->>'accommodation_start_date' AS starts_at
FROM match_stats_unresolved
WHERE resolved_at IS NULL
ORDER BY source_kind, candidate_count DESC;

-- Manual tournament link
INSERT INTO entity_external_ids (entity_type, entity_id, source, external_id)
VALUES ('tournament', '<our-tournament-uuid>', 'premierpadel', '<premier-tournaments_id>');

UPDATE match_stats_unresolved
SET resolved_at = now(), resolved_tournament_id = '<our-tournament-uuid>'
WHERE source = 'premierpadel' AND source_kind = 'tournament' AND source_id = '<premier-tournaments_id>';

-- Manual match link
INSERT INTO entity_external_ids (entity_type, entity_id, source, external_id)
VALUES ('match', '<our-match-uuid>', 'premierpadel', '<premier-tournaments_match_id>');

UPDATE match_stats_unresolved
SET resolved_at = now(), resolved_match_id = '<our-match-uuid>'
WHERE source = 'premierpadel' AND source_kind = 'match' AND source_id = '<premier-tournaments_match_id>';
```

No ops UI ships for launch. Post-launch phase 2 adds a `PremierLinkTab` to `/ops`.

---

## Cron endpoints

### `/api/cron/premier-discovery`

**Purpose:** links Premier tournaments and matches to our DB via `entity_external_ids`.

**Trigger:** day 1 manual curl, then weekly Mon 4am UTC via Vercel.

**Auth:** `Authorization: Bearer $CRON_SECRET`

**Algorithm:**

```
1. POST gettournamentsdropdown → 75 Premier tournaments (minus tid=28 "All")
2. Filter: tournaments where accommodation_start_date IS NULL OR starts_at >= '2026-01-01'
3. Pre-fetch ALL our tournaments (source='padelapi' OR 'fip', level IN (p1,p2,major,finals,fip_platinum,fip_gold))
4. For each Premier tournament:
   a. Skip if mapping already exists in entity_external_ids (source=premierpadel, entity_type=tournament)
   b. Token-subset match against our candidates (with year filter when possible)
   c. Single candidate → INSERT mapping
   d. 0 or 2+ candidates → UPSERT into match_stats_unresolved (reason='no_candidate' or 'multiple_candidates')
5. For each linked tournament:
   a. POST gettournamnetupcomingmatches with tournaments_id → Premier's match list
   b. Pull our matches for that tournament (with player name joins)
   c. For each Premier match:
      - Skip if already mapped
      - Skip if is_bye='Yes'
      - Map Premier's round_name ('Men SF') → our category ('men') + round ('SF')
      - Filter our candidates by (tournament_id, category, round)
      - Score each by last-name overlap (4 Premier names vs 4 ours, diacritic-normalized)
      - If top score >= 3/4 → INSERT mapping
      - Else → UPSERT into match_stats_unresolved (reason='no_player_match')
6. Return { elapsed_ms, tournaments: { linked, already, unresolved }, matches: { linked, already, unresolved, skipped_byes } }
```

**Expected duration:** ~2 minutes (1 dropdown call + 41 upcoming-match-list calls + retries), well under Vercel limits.

**Idempotent:** safe to re-run. Existing mappings are skipped, unresolved rows are upserted.

### `/api/cron/premier-stats`

**Purpose:** fetch stats for matches that are finished, Premier-mapped, and not yet synced (or out of date).

**Trigger:** day 1 manual curl with `?limit=500`, then hourly at :13 via Vercel (with default `limit=100`).

**Query params:** `limit` (default 100, capped at 500 for safety)

**Algorithm:**

```
1. SELECT m.id, eei.external_id AS premier_match_id
   FROM matches m
   JOIN entity_external_ids eei
     ON eei.entity_type = 'match'
     AND eei.entity_id = m.id
     AND eei.source = 'premierpadel'
   LEFT JOIN match_stats ms
     ON ms.match_id = m.id AND ms.set_number = 0
   WHERE m.status = 'finished'
     AND m.finished_at >= now() - interval '7 days'
     AND (ms.match_id IS NULL OR ms.computed_at < m.finished_at)
   ORDER BY m.finished_at DESC
   LIMIT {limit}
2. For each row:
   a. POST gettournamentsmatchdetail with premier_match_id (200ms throttle)
   b. Parse into MatchStatsRow[] (1 aggregate + N sets)
   c. UPSERT all rows into match_stats with onConflict='match_id,set_number'
3. Return { elapsed_ms, synced, errored, skipped, candidates }
```

**One deviation for day-1 backfill:** a `?full_backfill=true` query param loosens the `finished_at >= now() - 7 days` filter to `finished_at >= '2026-01-01'`. This runs once to drain the 2026 backlog, then never again.

**Expected duration:**
- Day 1 backfill: ~15 min for 367 matches (200ms throttle + ~100ms per fetch)
- Normal hourly runs: 5-20 seconds (0-5 candidates)
- During NewGiza P2: 10-30 seconds/hour

### Observability

Every cron response returns a JSON report. Example discovery response:

```json
{
  "ok": true,
  "elapsed_ms": 118420,
  "tournaments": {
    "linked": 38,
    "already": 0,
    "unresolved": 3
  },
  "matches": {
    "linked": 351,
    "already": 0,
    "unresolved": 14,
    "skipped_byes": 8
  },
  "by_reason": {
    "no_candidate": 2,
    "multiple_candidates": 1,
    "no_player_match": 14
  }
}
```

No Sentry, no alerts. The user eyeballs the response after each manual curl.

---

## Parser (`src/lib/premier-stats-parser.ts`)

Pure function that converts a Premier API response into an array of `MatchStatsRow`s — one per section in `match_state`.

```ts
export interface MatchStatsRow {
  set_number: number
  team1_first_serve_won: number | null
  team1_first_serve_played: number | null
  team1_second_serve_won: number | null
  team1_second_serve_played: number | null
  team1_service_games: number | null
  team2_first_serve_won: number | null
  team2_first_serve_played: number | null
  team2_second_serve_won: number | null
  team2_second_serve_played: number | null
  team2_service_games: number | null
  team1_first_return_won: number | null
  team1_first_return_played: number | null
  team1_second_return_won: number | null
  team1_second_return_played: number | null
  team1_return_games: number | null
  team2_first_return_won: number | null
  team2_first_return_played: number | null
  team2_second_return_won: number | null
  team2_second_return_played: number | null
  team2_return_games: number | null
  // Total points (null on per-set rows)
  team1_total_points_won: number | null
  team1_total_points_played: number | null
  team1_serve_points_won: number | null
  team1_serve_points_played: number | null
  team1_return_points_won: number | null
  team1_return_points_played: number | null
  team1_longest_streak: number | null
  team2_total_points_won: number | null
  team2_total_points_played: number | null
  team2_serve_points_won: number | null
  team2_serve_points_played: number | null
  team2_return_points_won: number | null
  team2_return_points_played: number | null
  team2_longest_streak: number | null
}

export function parseMatchStatsPayload(payload: PremierMatchDetail): MatchStatsRow[] | null {
  const sections = payload?.match_state
  if (!Array.isArray(sections) || sections.length === 0) return null

  return sections
    .map(section => {
      const setNumber = section.title === 'Match'
        ? 0
        : parseInt(section.title.replace(/^set\s+/, ''), 10)
      if (!Number.isFinite(setNumber)) return null

      // ...populate all 34 stat columns from section.service, section.return, section.total_points
      return { set_number: setNumber, ...stats } as MatchStatsRow
    })
    .filter((r): r is MatchStatsRow => r !== null)
}
```

**Why pure:** enables deterministic unit tests with frozen fixtures, re-parsing of stored `raw_payload` without re-fetching from Premier, and zero database coupling.

---

## UI

### Component tree

```
<MatchStatsView matchId>                // container, fetches /api/match-stats
  ├─ loading state (skeleton bars)
  ├─ empty state (no mapping / pending sync / upcoming match)
  └─ success state:
     <MatchStatsSetTabs>                 // pill row: Match / Set 1 / Set 2 / Set 3
       <MatchStatsSection title="Service">
         <MatchStatsBar label="1st Serve %" kind="percentage" ... />
         <MatchStatsBar label="2nd Serve %" kind="percentage" ... />
         <MatchStatsBar label="Service Games" kind="count" ... />
       <MatchStatsSection title="Return">
         <MatchStatsBar label="1st Return %" kind="percentage" ... />
         <MatchStatsBar label="2nd Return %" kind="percentage" ... />
         <MatchStatsBar label="Return Games" kind="count" ... />
       <MatchStatsSection title="Total Points">   // HIDDEN on per-set tabs
         <MatchStatsBar label="Total Points Won" kind="percentage" ... />
         <MatchStatsBar label="Serve Points Won" kind="percentage" ... />
         <MatchStatsBar label="Return Points Won" kind="percentage" ... />
         <MatchStatsBar label="Longest Streak" kind="count" ... />
```

### Data fetch + state management

Single GET on mount:

```ts
GET /api/match-stats?matchId=<uuid>

→ {
  stats: [
    { set_number: 0, ...aggregate columns },
    { set_number: 1, ...set-1 columns, total_* = null },
    { set_number: 2, ... },
  ] | null,
  status: 'ok' | 'no_mapping' | 'pending_sync' | 'upcoming'
}
```

Local state: `const [activeSet, setActiveSet] = useState(0)`. Switching sets is a pure rerender — no additional network calls.

**Pill tab disabled logic:** if the stats array doesn't contain a row for a given set_number, the pill for that set is rendered disabled (greyed). For a 2-set match, Set 3 is greyed out.

**Hidden Total Points section:** when `activeSet !== 0`, the Total Points section is not rendered at all (skipped entirely in JSX). Per-set total points are all null so showing empty bars would look broken.

### Empty states

| Status | Copy | Icon |
|---|---|---|
| `no_mapping` | "Stats not available for this match" | 📊-ghost |
| `pending_sync` | "Stats coming soon — sync runs hourly" | ⏳ |
| `upcoming` | "Match hasn't started yet" | ⏰ |
| Network error | "Couldn't load stats. Try again." | ⚠️ + retry button |

The `status` field is determined by the API endpoint based on a join:

```ts
if (matchRow.status === 'scheduled') return 'upcoming'
if (!premierMapping) return 'no_mapping'
if (!statsRow) return 'pending_sync'
return 'ok'
```

### `<MatchStatsBar>` props

```tsx
interface Props {
  label: string
  t1Value: number | null   // numerator or absolute count
  t1Total: number | null   // denominator (null for kind='count')
  t2Value: number | null
  t2Total: number | null
  kind: 'percentage' | 'count'
  t1IsWinner?: boolean     // future: winner-green tint (deferred polish)
  t2IsWinner?: boolean
}
```

Percentage variant:
- Big percentage number (`t1Value/t1Total * 100`) on each side
- Bar fills inward from each side proportional to the percentage
- Small fraction (`37/58`) underneath the percentage
- Neutral slate colors for v1 (winner-green deferred)

Count variant:
- Just the number on each side
- No bar, no fraction
- Dash (`—`) displayed when value is null

### Integration

`src/app/match/[id]/page.tsx` currently has a Stats tab with a placeholder. Single-line change:

```tsx
{tab === 'stats' && <MatchStatsView matchId={match.id} />}
```

No restructuring of the parent match page. The tab remains visible on all matches (FIP Silver/Bronze, simulated, etc.) — the empty state inside handles the "not available" cases.

---

## Edge cases

### Entity resolution

| Case | Handling |
|---|---|
| Premier tournament with no candidate | `match_stats_unresolved` reason `no_candidate` |
| Premier tournament with 2+ candidates | `match_stats_unresolved` reason `multiple_candidates` |
| Premier match in linked tournament, 1-2 name overlap | `match_stats_unresolved` reason `no_player_match` |
| Bye/walkover (`is_bye='Yes'`) | Skipped entirely, no unresolved entry |
| Our match has NULL player IDs | Falls through to `no_player_match` |
| Diacritics mismatch (`Núñez` vs `Nunez`) | Handled by NFD normalization in matcher |
| Tournament exists under both padelapi + fip source | Both candidates considered; if both match, flagged as `multiple_candidates` |

### Data quality

| Case | Handling |
|---|---|
| Premier returns `status: 1, data: []` | Logged, skipped, no error |
| Empty `match_state` array | Parser returns null, row skipped, retried next cron |
| Stats as empty strings | Coerced to null, UI shows dash |
| Only 'Match' section (no per-set) | Single row written with `set_number = 0`, UI hides set pills |
| All-zeros set 3 (retired match) | Row still written, UI shows "Retired" badge on set pill |
| Premier updates stats after initial sync | Detected by `computed_at < matches.updated_at` check (post-launch enhancement) |

### Runtime/transport

| Case | Handling |
|---|---|
| Premier API 5xx or timeout | 3 retries with `250ms → 1s → 4s` backoff, then skip |
| Premier rate limits (429) | Same retry policy |
| Supabase service key wrong in prod | Cron response returns `synced=0, candidates=N`, eyeballable |
| Overlapping cron runs | Upsert is idempotent on composite key |
| Vercel function timeout | 100-match limit keeps runs under 60s (Pro tier) |
| Network partition mid-batch | Stateless recovery next run |

### UI

| Case | Handling |
|---|---|
| Live match, partial stats | Post-launch — v1 shows whatever's in DB |
| Upcoming match (`status='scheduled'`) | `upcoming` empty state |
| Finished but sync not yet run | `pending_sync` empty state, page-visit-level polling (2min × 3 tries) |
| Deep link `/match/[id]?tab=stats` | No SSR concerns, client-side fetch handles loading |
| Partial stats (only Match row) | Set pills hidden entirely |

---

## Testing strategy

### 1. Parser unit tests (`src/lib/__tests__/premier-stats-parser.test.ts`)

Frozen fixtures + Vitest. ~10 cases:

```
- returns null when match_state is missing or empty
- parses 3-set match into 4 rows (Match + set 1-3)
- parses 2-set match into 3 rows
- stores raw_payload only on set_number=0
- coerces empty strings to null
- extracts Miami P1 SF Stupaczuk/Yanguas spot check (hard-coded expected values)
- handles missing total_points section on per-set rows
- handles all-zeros set 3 (retired match)
- parses set number from "set 1" / "set 2" titles correctly
- filters out malformed sections
```

### 2. Source matcher unit tests (`src/lib/__tests__/source-matcher.test.ts`)

~12 cases covering `tokenize`, `isTokenSubset`, `resolveTournamentCandidate`:

```
- strips years from names
- strips diacritics
- filters noise tokens (premier, padel, tour, etc.)
- matches "Brussels P2" inside "Lotto Brussels Premier Padel P2 Presented By Belfius"
- matches "Newgiza P2 2026" against "NEWGIZA P2"
- rejects same-country different-tier (Riyadh P1 vs Riyadh P2)
- rejects different years
- picks single candidate when unambiguous
- returns null when multiple candidates match
- returns null when no candidates match
```

### 3. Cron integration smoke (manual)

Documented curls + expected responses. Run after each deploy:

```bash
# Discovery health check
curl -s -H "Authorization: Bearer $CRON_SECRET" \
     https://padelnachos.com/api/cron/premier-discovery | jq .
# Expected: tournaments_linked + unresolved = 41
# Expected: matches_linked + unresolved ≈ 367

# Stats backfill (day 1 only)
curl -s -H "Authorization: Bearer $CRON_SECRET" \
     "https://padelnachos.com/api/cron/premier-stats?limit=500&full_backfill=true" | jq .
# Expected: synced > 300

# Stats incremental (ongoing)
curl -s -H "Authorization: Bearer $CRON_SECRET" \
     https://padelnachos.com/api/cron/premier-stats | jq .
# Expected after backfill: synced=0 (nothing new)

# DB sanity
SELECT count(*) FROM match_stats;
SELECT count(DISTINCT match_id) FROM match_stats;
SELECT count(*) FROM match_stats WHERE set_number = 0;
```

### 4. UI manual QA (day 4)

Checklist:

```
[ ] Miami P1 SF on desktop → all 12 stats render
[ ] Same URL on mobile viewport → no overflow, readable
[ ] Pill tabs switch between Match / Set 1 / Set 2 / Set 3
[ ] Total Points section hidden on per-set tabs
[ ] FIP Silver match → "not available" empty state
[ ] Upcoming NewGiza match → "hasn't started" empty state
[ ] Retired match → set 3 pill shows "Retired" badge
[ ] Tab deep link /match/[id]?tab=stats works from cold load
[ ] Dark mode renders if applicable
```

### Not tested (explicit non-goals)

- E2E browser tests
- Snapshot tests
- Cron scheduling (Vercel handles it)
- Load tests
- RLS policy tests (pattern proven on other tables)

---

## Day-by-day execution (Option C)

| Day | Deliverable | Exit criteria |
|---|---|---|
| **Wed Apr 8** | Migrations + Premier API client + parser + unit tests + manual backfill for Miami P1 SF only | 1 match has stats rows in Supabase; parser tests green |
| **Thu Apr 9** | Discovery cron + source matcher + unresolved queue writer. Manually trigger once | 38+ tournaments linked, 350+ matches linked, <20 unresolved |
| **Fri Apr 10** | Stats sync cron + full backfill run + `/api/match-stats` endpoint | `SELECT count(*) FROM match_stats WHERE set_number = 0` ≈ 360 |
| **Sat Apr 11** | Stats tab UI: `MatchStatsView` + `MatchStatsBar` + pill tabs + empty states | 10 real matches tapped through on mobile, stats render cleanly |
| **Sun Apr 12** | Buffer day: edge cases, polish, production deploy, Vercel cron wiring | All smoke checks pass, `vercel.json` updated |
| **Mon Apr 13** | Launch day. NewGiza P2 starts. Hourly cron picks up new finished matches automatically | Users see live stats on finished NewGiza matches within 1 hour |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Premier changes endpoint shape mid-week | Low | `raw_payload` stored, parser is pure → re-run without re-fetch |
| Player name resolution fails for >20% of matches | Medium | Manual SQL queue review is fast, ~5 min per tournament |
| Supabase migration blocked by user not in dashboard | Medium | Coordinate explicitly — user must apply migrations before day 2 starts |
| Vercel function timeout on backfill run | Low | `?limit=500` is the hard cap; 100ms retry budget keeps us under 60s; worst case split into multiple calls |
| Stats tab UI design eats more than one day | Medium | Sunday is a buffer day; ugly-but-working stats acceptable |
| FIP Platinum/Gold matches don't match cleanly | Medium | Fallback to manual SQL, same queue workflow |
| Wrong-source contamination | Low | `source_priority` locks `match.stats` to `premierpadel` only |
| Bandwidth cost of raw_payload JSONB (~13 MB) | Low | Stored once per match, ~36KB each. Supabase free tier well under limit |

---

## Out of scope (explicit non-goals)

- **Live stats polling during matches.** Covered in parent spec post-launch. v1 is post-match only.
- **Point-by-point history.** Premier doesn't expose this; our existing padelapi.org Pusher relay already handles point-by-point.
- **Aces and Double Faults counts.** Premier always returns 0 for these; not displayed in UI.
- **Career stat aggregates on player profiles.** Phase 2+, ties into `player_stats_snapshot` design from 2026-04-07.
- **Ops dashboard link tab.** Manual SQL for v1; UI is phase 2.
- **FIP Silver/Bronze tiers.** Not covered by Premier API.
- **2025 and earlier matches.** 2026-only scope.
- **Historical set tiebreak scores (`tie1..tie5`).** Captured in raw_payload but not surfaced in UI or normalized columns for v1.

---

## Verification checklist (before merging to main)

- [ ] `npm run build` clean
- [ ] `npx vitest run src/lib/__tests__/premier-stats-parser.test.ts` green
- [ ] `npx vitest run src/lib/__tests__/source-matcher.test.ts` green
- [ ] Discovery cron returns tournaments_linked >= 35
- [ ] Stats cron returns synced >= 300 on initial backfill run
- [ ] `SELECT count(*) FROM match_stats WHERE set_number = 0` >= 300
- [ ] Stats tab renders on 10 test URLs (spans Men/Women, 2-set and 3-set, across 4 tournaments)
- [ ] Empty state visible on a FIP Silver match
- [ ] `vercel.json` updated with both cron entries
- [ ] `source-priority.ts` updated
- [ ] CLAUDE.md documents `premierpadel` source

---

**End of design.** Ready for implementation plan once the user approves this spec.
