# Padelgod Plan 4: Live Pipeline + Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Padelgod the live source of truth for tournaments where `tournaments.live_source='padelgod'`. The live poller reads `widget.matchscorerlive.com/screen/tournamentlive/{CODE}` every 6–8s (3–4s adaptive near critical points), reconstructs point-by-point from successive state diffs, and writes directly to canonical `matches/sets/games/match_points`. Plus the static reconciler that takes Plan 3's snapshot tables and merges them into canonical tournament_draws/matches.

**Architecture:** Two parallel pipelines that share the same player-resolution lib (Plan 3's `tournament-dictionary`):

1. **Static reconciler** (cron, every 5 min) — reads latest `padelgod.{entry_list,draw,oop,results}_snapshots` and writes to canonical `players/tournament_draws/matches/sets`. Resolves widget short names to canonical player UUIDs via the per-tournament dictionary built from entry lists.

2. **Live poller** (long-running per-tournament loop) — for each tournament with `live_source='padelgod'`, polls the tournamentlive endpoint at adaptive cadence. Diffs successive states to detect new points. Writes to canonical `matches.serving_player_id`, `sets.{pair1_games,pair2_games}`, `games.{game_score,server_player_id}`, `match_points` (one row per detected point).

The live poller is NOT a cron — it's a long-running set of `setInterval`s registered at boot, one per active tournament. Tournament cutover is gated by `tournaments.live_source='padelgod'` (default `'padelapi'`). For V1 you flip individual tournaments manually via SQL or admin endpoint to test before broader rollout.

**Tech stack:** No new deps. Reuses everything from Plans 1–3.

**Companion specs:**
- `docs/superpowers/specs/2026-04-20-padelgod-design.md` — §3.6 (concurrency), §4.3 (point-by-point reconstruction), §6 (migration phasing)
- `docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md` — §3 (tournamentlive HTML structure), §4 (point reconstruction algorithm), §5 (match stats)
- `docs/superpowers/plans/2026-04-20-padelgod-03-static-match-data.md` — what's already in place (snapshot tables, tournament-dictionary lib)

**Prerequisites (already shipped):**
- Padelgod service deployed to Railway with 8 workers + admin endpoint
- All snapshot tables exist (entry_list/draw/oop/results) in `padelgod` schema
- `tournament-dictionary` lib exists at `padelgod/src/lib/tournament-dictionary.ts`
- Schema additions: `match_points`, `games.server_player_id`, `games.is_tiebreak`, `tournaments.live_source`, `tournaments.uses_golden_point`, `match_points.is_golden_point`
- All 5 Plan 1 follow-up fixes applied (migration 015)

**Prerequisites (NOT yet shipped — must land before Task 16 cutover):**
- **Relay `live_source` gate** (see Task 0 below): `relay/index.js` currently subscribes to all padelapi tournaments unconditionally. Without the gate, flipping any tournament to `live_source='padelgod'` causes BOTH the relay AND the Padelgod poller to write to the same rows, corrupting data. Task 0 adds a filter so the relay only subscribes where `live_source='padelapi'` AND unsubscribes when a tournament flips to `'padelgod'`.

---

## File Structure

**New files in `padelgod/`:**
```
padelgod/
├── src/
│   ├── lib/
│   │   ├── match-identifier.ts            # Resolve widget match_id → canonical match UUID (create if missing)
│   │   ├── live-state.ts                  # In-memory per-match state diff helpers
│   │   ├── point-reconstruction.ts        # Diff state, infer points, detect tiebreak/golden
│   │   └── live-poller-loop.ts            # Per-tournament long-running poll loop with adaptive cadence
│   ├── parsers/
│   │   ├── crionet-tournamentlive.ts      # Parse tournamentlive HTML → live match states
│   │   └── crionet-match-stats.ts         # Parse /screen/getmatchstats POST response
│   ├── workers/
│   │   ├── live-poller-manager.ts         # Manages live-poller loops based on tournaments.live_source
│   │   ├── match-stats-fetcher.ts         # POST /screen/getmatchstats for finished matches; writes to match_stats
│   │   └── static-reconciler.ts           # Merge snapshots into canonical tables
│   └── __tests__/  (matching subfolders)
└── (existing unchanged)

supabase/migrations/
├── 20260420000016_padelgod_live_state_helpers.sql        # RPC: tournaments_for_live_polling()
└── 20260420000017_padelgod_match_widget_id_index.sql     # Index matches by (tournament_id + source widget id)
```

**Modified files:**
- `padelgod/src/lib/parser-versions.ts` — add 2 new constants
- `padelgod/src/scheduler.ts` — register `static-reconciler` + `match-stats-fetcher` workers
- `padelgod/src/index.ts` — start live-poller-manager alongside scheduler

---

## Conventions

**Same as Plans 1–3.** Parsers are pure (HTML → typed object). Workers compose `httpClient + supabase + parser + runScrapeJob`. Live-poller engine lives outside the cron scheduler — it's a long-running set of intervals managed in-process.

**Reconciler vs live poller:**
- **Reconciler** = batch, idempotent, runs every 5 min. Consumes static snapshots. Owns: creating/updating tournament_draws + matches base records + sets (from results).
- **Live poller** = continuous, per-tournament. Owns: matches.status during live, matches.serving_player_id, sets.is_current, games (current game state), match_points (per-point detail).

The reconciler creates the match row; the live poller updates it during play. They never write the same column at the same time.

**Match identification:**

The widget assigns each match a string ID like `"MQ012"` (men's qualifying #12) or `"MD007"` (men's draw #7). The Padelgod canonical `matches` table needs to track this. We'll store it via the existing `entity_external_ids` sidecar with `(entity_type='match', source='crionet_widget', external_id='FIP-2026-1701:MQ012')` — composite key `tournament-widget-code:match-widget-id` to disambiguate across tournaments.

**Player resolution:**

The reconciler builds a per-tournament dictionary at start of each run, calling `buildTournamentDictionary(latestEntryListSnapshots)`. For each match needing resolution, calls `resolveShortName(dict, name, partnerHint?)`. Unresolved → write to `padelgod.unresolved_players` queue.

**Live polling adaptive cadence:**

Default 6s per poll. Drops to:
- **3s** when ANY active match has game score in deuce/advantage/golden-point territory
- **2s** in the final game of the deciding set when either pair has match point
- **1s** when match is on match-point or set-point

Implementation: each per-tournament loop tracks the highest-criticality state across all its currently-live matches and adjusts its `setInterval` accordingly.

---

### Task 0: Relay `live_source` gate (cutover prerequisite)

**Files:**
- Modify: `relay/index.js`

Without this change, the cutover mechanism is unsafe — both the relay and the Padelgod poller would write to the same match row the moment a tournament's `live_source` flips. This must land and be deployed to Railway BEFORE flipping any tournament in Task 16.

Changes:
1. **Filter subscription candidates by `live_source`** — wherever the relay builds its list of tournaments/matches to watch, JOIN to `tournaments` and filter `WHERE tournaments.live_source = 'padelapi'` (default). Any tournament flagged `'padelgod'` becomes invisible to the relay.
2. **Add a periodic reconciliation loop** (every 60s): re-query the live list. For any currently-subscribed channel whose tournament is no longer in the list (because someone flipped `live_source`), call `unsubscribeChannel(channelName)` and remove it from `activeChannels` + `channelMatchIds`.
3. **Log the transition**: `console.log('[Relay] Unsubscribing — tournament flipped to padelgod:', tournamentName)` so cutover is auditable in Railway logs.

Safety note: the gate MUST be on `tournaments.live_source`, NOT on `matches.live_source` (that column doesn't exist). Individual matches inherit the flag from their tournament.

Verification (manual, before Task 16):
1. Deploy relay with the gate.
2. Pick any padelapi tournament (NOT yet flipped), confirm relay still subscribes + writes scores for it.
3. Flip one test tournament `UPDATE tournaments SET live_source='padelgod' WHERE id=...`.
4. Within 60s, Railway relay logs should show the unsubscribe log line. `activeChannels` should no longer include that tournament's matches.
5. Flip back to `'padelapi'`. Within 60s, relay should re-subscribe.

Commit: `feat(relay): gate subscriptions by tournaments.live_source (Padelgod cutover prep)`

---

### Task 1: Migration — RPC for tournaments needing live polling + match widget id index

**Files:**
- Create: `supabase/migrations/20260420000016_padelgod_live_state_helpers.sql`
- Create: `supabase/migrations/20260420000017_padelgod_match_widget_id_index.sql`

```sql
-- 016
CREATE OR REPLACE FUNCTION public.padelgod_tournaments_for_live_polling()
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  widget_id TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ
) AS $$
  SELECT t.id, t.name, c.widget_id, t.starts_at, t.ends_at
  FROM public.tournaments t
  INNER JOIN padelgod.widget_id_cache c
    ON c.tournament_id = t.id AND c.is_active = true
  WHERE t.live_source = 'padelgod'
    AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '1 day'
    AND COALESCE(t.starts_at, NOW() - INTERVAL '7 days') <= NOW() + INTERVAL '1 day'
  ORDER BY t.starts_at ASC NULLS LAST;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='padelgod_tournaments_for_live_polling'
  ), 'function missing';
END $$;
```

```sql
-- 017
-- Speed up "find the canonical match for this widget match id" lookups.
-- entity_external_ids already has UNIQUE(source, entity_type, external_id), so the
-- raw lookup is fast. We additionally want a partial index for crionet_widget specifically.
CREATE INDEX IF NOT EXISTS idx_entity_external_ids_crionet_widget
  ON public.entity_external_ids(external_id)
  WHERE entity_type = 'match' AND source = 'crionet_widget';

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='idx_entity_external_ids_crionet_widget'),
    'index missing';
END $$;
```

Commit: `feat(db): add Plan 4 live pipeline helpers (RPC + index)`

---

### Task 2: Parser version constants

Add to `padelgod/src/lib/parser-versions.ts`:
```typescript
export const CRIONET_TOURNAMENTLIVE_VERSION = 'crionet-tournamentlive-1.0.0';
export const CRIONET_MATCH_STATS_VERSION = 'crionet-match-stats-1.0.0';
```
Commit: `feat(padelgod): add Plan 4 parser version constants`

---

### Task 3: Crionet tournamentlive parser

**Files:**
- Create: `padelgod/src/parsers/crionet-tournamentlive.ts`
- Create: `padelgod/src/__tests__/parsers/crionet-tournamentlive.test.ts`

The parser extracts ALL live match states from one tournamentlive page. Each match has:
- `matchWidgetId` (e.g., `"MQ012"`)
- `court`, `roundLabel`, `category`
- `team1` / `team2`: player names + country + currentPointDisplay (e.g., `"15"`, `"30"`, `"AD"`, `"GP"`) + games per set
- `servingTeam`: 1 or 2 (from `<img class="ballg">` presence)
- `durationMinutes` (from `"00:03"` text)
- `status` (`'live'` for active matches; can also see `'finished'` headers)

HTML reference (from live data validation §3 + the actual production sample):
```html
<tr class="scorebox-header-live">
  <th><span class="tournament-name"><span>COURT CBC</span></span></th>
  <th><div class="round-name"><small><b>Men </b><div>Q2</div></small></div></th>
</tr>
<!-- Team 1 row -->
<tr class="scorebox-sep-bottom">
  <td class="team">
    <div class="d-flex justify-content-between align-items-center ml-2">
      <div><div class="player-names"><div class="double">
        <div class="d-flex align-items-center">
          <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
          <div class="ml-2 line-thin"><span>M.</span><span>Sintes Villalonga</span></div>
        </div>
        <div class="d-flex align-items-center">
          <div><img class="flags" src="/images/flags/ESP.jpg"/></div>
          <div class="ml-2 line-thin"><span>D.</span><span>Santigosa Sastre</span><small class="separator">(3)</small></div>
        </div>
      </div></div></div>
      <div></div>
    </div>
  </td>
  <td class="points"><div>15</div></td>
  <td class="set set-lost">0</td>
  <td class="set set-lost ">-</td>
  <td class="set set-lost ">-</td>
</tr>
<!-- Team 2 row -->
<tr>
  <td class="team" style="width:50%">
    <div class="d-flex justify-content-between align-items-center ml-2">
      <div><div class="player-names"><div class="double">
        ... (same player block structure as team 1)
      </div></div></div>
      <div><img src='/images/ballg.png' class='ballg'/></div>
    </div>
  </td>
  <td class="points"><div>0</div></td>
  <td class="set ">1</td>
  <td class="set set-lost ">-</td>
  <td class="set set-lost ">-</td>
</tr>
<!-- Match summary -->
<tr class="summary">
  <td colspan="8">
    <div class="live-status-summary d-flex justify-content-between align-items-center">
      <div>
        <span>&#128337;</span><span>00:03</span><span class="ml-4">Live match</span>
      </div>
      <a class="open" data-toggle="modal" data-target="#modalStats"
         data-id="MQ012" data-year="2026" data-tid="1701" data-org="FIP">MATCH STATS</a>
    </div>
  </td>
</tr>
```

Key signals:
- **Server indicator**: presence of `<img ... class='ballg'/>` inside the team row's outer div → that team is serving
- **Current points**: `<td class="points"><div>15</div></td>` — string like `"15"`, `"30"`, `"40"`, `"AD"`, `"GP"`
- **Set games**: `<td class="set">N</td>` — multiple cells, one per set; `-` for unplayed
- **Tiebreak in set cell**: `<td class="set">7<sup>3</sup></td>` (loser's tiebreak points)
- **Match duration**: `<span>00:03</span>` (HH:MM since start)
- **data-id attribute on STATS button**: the widget match id like `"MQ012"`
- **Header class** distinguishes live (`scorebox-header-live`) from finished (`scorebox-header-completed`)

The parser returns `ParsedLiveTournament` containing array of `ParsedLiveMatch` objects — one per match table on the page (live matches only; can ignore completed for V1 since results-fetcher already handles those).

Output shape:
```typescript
export interface ParsedLiveMatch {
  matchWidgetId: string;        // "MQ012"
  court: string;
  roundLabel: string;
  category: 'men' | 'women';
  team1: ParsedLiveTeam;
  team2: ParsedLiveTeam;
  servingTeam: 1 | 2 | null;
  durationMinutes: number | null;
  status: 'live' | 'finished';
}

export interface ParsedLiveTeam {
  player1Name: string;          // "M. Sintes Villalonga"
  player2Name: string;
  player1Country: string | null;
  player2Country: string | null;
  player1Seed: number | null;
  player2Seed: number | null;
  currentPoints: string;        // "15", "30", "AD", "GP"
  setGames: Array<string | null>; // ["0", "-", "-"] or ["1", "6", "4"]
  setTiebreaks: Array<number | null>; // [null, 3, null] for 7-6(3) in set 2
}
```

Tests:
1. Parses one live match block with players, points, set games, server indicator
2. Parses set with tiebreak (`7<sup>3</sup>` → tiebreak=3)
3. Returns empty array for a tournamentlive page with no live matches
4. Detects servingTeam=2 when ballg.png is in team 2 row only

Commit: `feat(padelgod): add Crionet tournamentlive parser`

---

### Task 4: Match identifier lib

**Files:**
- Create: `padelgod/src/lib/match-identifier.ts`
- Create: `padelgod/src/__tests__/lib/match-identifier.test.ts`

Resolves a widget match id to a canonical `matches.id` UUID. Creates a new match record if none exists.

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MatchIdentifierInput {
  tournamentId: string;
  tournamentWidgetId: string;     // e.g. "FIP-2026-1701"
  matchWidgetId: string;          // e.g. "MQ012"
  category: 'men' | 'women';
  roundLabel: string;
  court?: string | null;
  pair1PlayerIds?: [string | null, string | null];
  pair2PlayerIds?: [string | null, string | null];
}

export interface MatchIdentifierResult {
  matchId: string;
  created: boolean;
}

export async function findOrCreateMatch(
  supabase: SupabaseClient,
  input: MatchIdentifierInput
): Promise<MatchIdentifierResult>;
```

Logic:
1. Compute composite external_id: `${tournamentWidgetId}:${matchWidgetId}` e.g. `"FIP-2026-1701:MQ012"`
2. **Widget-id lookup**: query `entity_external_ids` for `(entity_type='match', source='crionet_widget', external_id=composite)` → if found, return that match_id
3. **Pair-based fallback** (critical — prevents duplicate matches when draw-reconciler created the row before widget id was known): if widget-id lookup misses AND `pair1PlayerIds` + `pair2PlayerIds` are both provided with all 4 UUIDs non-null, query `matches` for a row matching `(tournament_id, category, round, {pair1,pair2} player id set)`. Pair match must be unordered — team1 in widget may be pair2 in DB. If exactly one candidate found: link it by INSERTing into `entity_external_ids` and return its id. If multiple candidates found: log warning, prefer the one without an existing crionet_widget mapping, else fall through to create.
4. If still not found, INSERT into `matches` with available fields, then INSERT into `entity_external_ids` linking the new match to the widget id
5. **Concurrency guard**: wrap the INSERT in `ON CONFLICT (source, entity_type, external_id) DO NOTHING` on `entity_external_ids`; if the insert returns no row, re-run step 2 to fetch the winner of the race
6. Return `{ matchId, created: true|false, linkedExisting: true|false }` — `linkedExisting` is true when pair-based fallback matched a row created by draw-reconciler

Tests:
1. Returns existing match id when entity_external_ids has it
2. Creates new match + entity_external_ids row when not found
3. **Pair-based fallback links existing draw-only match** — seed a matches row + tournament_draws row with no widget id; call `findOrCreateMatch` with widget id + same pair UUIDs → returns existing match id with `linkedExisting: true` (NOT a new row)
4. **Pair-based fallback handles reversed team order** — DB has pair1={A,B}, pair2={C,D}; widget provides team1={C,D}, team2={A,B} → matches the same row
5. **Pair-based fallback skipped when any player UUID is null** — falls through to INSERT (can't safely match on partial pairs)
6. Handles concurrent create gracefully (second caller gets existing id, not error)

Commit: `feat(padelgod): add match-identifier lib (find or create canonical match)`

---

### Task 5: Static reconciler — entry list → players

**Files:**
- Create: `padelgod/src/workers/static-reconciler.ts`
- Create: `padelgod/src/__tests__/workers/static-reconciler.test.ts`

Phased reconciler — start with just entry-list reconciliation in this task, expand in next 2 tasks.

For each tournament with recent entry list snapshots:
1. Read latest entry_list_snapshots
2. For each row with non-null `fip_id`:
   - Find canonical player by `fip_id` (hot-column lookup)
   - If found: ensure name + country + category match (UPDATE if not, with `last_updated_by='padelgod'`)
   - If not found: INSERT new player with `fip_id`, `name`, `country`, `category`, `source='fip'`
3. For rows without `fip_id`: skip (can't safely create thin records — defer to manual ops)

Don't write to entity_external_ids for FIP players (fip_id is a hot column).

Tests cover: existing player updated, new player inserted, NULL fip_id skipped, duplicate fip_id in same snapshot deduplicated.

Commit: `feat(padelgod): add static-reconciler (entry list → players, V1)`

---

### Task 6: Static reconciler — draw → tournament_draws + matches

Extend `static-reconciler.ts` to also process draw snapshots:

For each tournament's latest draw snapshots:
1. Build per-tournament dictionary from latest entry list (using `tournament-dictionary.ts` from Plan 3)
2. For each draw_snapshot row:
   - Resolve `team1_player1_name`, `team1_player2_name`, `team2_player1_name`, `team2_player2_name` via dictionary
   - If all 4 resolved (or marked unresolved): proceed
   - Use `findOrCreateMatch` for the match record (round + position-derived widget id, OR a generated id)
   - UPSERT into existing `tournament_draws` table (already has unique constraint on `tournament_id, category, draw_position`)
3. Unresolved players → write to `padelgod.unresolved_players`

Note: draw doesn't have a widget match id (only OOP/results do). For matches that exist only in draws, we use the canonical `matches.id` UUID without a crionet_widget external_id mapping. When the OOP/results reconciler later sees the same match with a widget id, Task 4's **pair-based fallback** in `findOrCreateMatch` matches the existing row on `(tournament_id, category, round, pair player UUIDs)` and links it by inserting the widget id mapping — rather than creating a duplicate match.

Tests cover: full resolution → draws written, partial resolution → unresolved queue + draws skipped, dedup against existing tournament_draws rows.

Commit: `feat(padelgod): static-reconciler — draw → tournament_draws + matches`

---

### Task 7: Static reconciler — OOP + results → matches/sets

Final extension of `static-reconciler.ts`:

For each tournament's latest oop_snapshots:
1. Build dictionary
2. For each row: resolve players, `findOrCreateMatch` (using `match_widget_id` as the widget id for entity_external_ids link)
3. UPDATE `matches.scheduled_at` (parsed from `scheduled_label`), `matches.court`, `matches.round`

For each tournament's latest results_snapshots:
1. Same dictionary + resolution
2. `findOrCreateMatch` (using `match_widget_id`)
3. UPDATE matches with: `status='finished'`, `winner_pair=winnerTeam`
4. INSERT/UPDATE sets table with `set_score`, `pair1_games`, `pair2_games` (parsed from `set_scores` text like `"7-6(3) 4-6"`)
   - Per set: detect tiebreak from `(N)` notation, set `games.is_tiebreak=true` and tiebreak point counts

Tests cover: schedule-only updates from OOP, completion from results with tiebreak parsing, idempotent re-runs.

Commit: `feat(padelgod): static-reconciler — OOP + results → matches + sets`

---

### Task 8: Wire static-reconciler into scheduler

Update `padelgod/src/scheduler.ts` to register the new worker:

```typescript
if (flags.enableStaticReconciler) {
  entries.push({
    name: 'static-reconciler',
    cron: '5,35 * * * *',  // twice an hour at :05 and :35
    run: (deps) => runStaticReconciler(deps),
  });
}
```

Add `ENABLE_STATIC_RECONCILER` to env loader. Add scheduler test for the new worker.

Commit: `feat(padelgod): wire static-reconciler into scheduler`

---

### Task 9: Match stats parser

**File:** `padelgod/src/parsers/crionet-match-stats.ts` + test.

Parses the HTML response from `POST /screen/getmatchstats`. Per the live data validation report §5, the response has 14 stat dimensions × 2 tabs (Match + per-set). Each dimension is a row with team1 value + label + team2 value.

Output:
```typescript
export interface ParsedMatchStats {
  perSet: Array<{
    setNumber: number;             // 0 = match aggregate, 1+ = per set
    team1: MatchStatsRow;
    team2: MatchStatsRow;
  }>;
}

export interface MatchStatsRow {
  totalPointsWonPct: number | null;
  breakPointsConvertedPct: number | null;
  longestStreak: number | null;
  aces: number | null;
  doubleFaults: number | null;
  wonOn1stServePct: number | null;
  wonOn2ndServePct: number | null;
  serviceGames: number | null;
  wonOn1stReturnPct: number | null;
  wonOn2ndReturnPct: number | null;
  returnGames: number | null;
  totalPoints: number | null;
  totalWonOnServe: number | null;
  totalWonOnReturn: number | null;
}
```

Tests cover: full match aggregate parse, per-set parse, missing fields → null.

Commit: `feat(padelgod): add Crionet match stats parser`

---

### Task 10: Match stats fetcher worker

**File:** `padelgod/src/workers/match-stats-fetcher.ts` + test.

For each finished match without match_stats rows yet:
1. POST `/screen/getmatchstats?t=tol` with body `(matchId, year, tournamentId, organization=FIP)`
2. Parse response with `parseCrionetMatchStats`
3. INSERT/UPSERT to existing `match_stats` table (composite PK: `match_id + set_number`, where 0 = match aggregate)

Wire into scheduler at `25 * * * *` (hourly at :25).

Commit: `feat(padelgod): add match-stats-fetcher worker`

---

### Task 11: Live state diff lib

**File:** `padelgod/src/lib/live-state.ts` + test.

In-memory representation of one match's state at one poll, plus a diff function.

**Point state must NOT be a raw string.** Naive string diff (e.g. `AD → 40` → "team1's string shrunk, so team2 won") gets break-back-to-deuce wrong. Use an explicit lattice so the comparator can reason about whether a transition is valid without a point, or requires exactly one point, or implies a game ended.

```typescript
// Canonical point labels. In a standard game: 0 < 15 < 30 < 40 < AD.
// DEUCE is a distinct state (both at 40, rally ongoing before AD is assigned).
// GP = golden point (deuce-decider when tournaments.uses_golden_point=true; replaces AD entirely).
// TIEBREAK_N = numeric tiebreak score (inside a tiebreak game, points are integers).
export type PointState =
  | { kind: 'regular'; team1: 0 | 15 | 30 | 40; team2: 0 | 15 | 30 | 40 }
  | { kind: 'deuce' }                                       // both at 40, no AD yet
  | { kind: 'advantage'; side: 1 | 2 }                      // AD to side
  | { kind: 'golden_point' }                                // GP label (tournament uses golden point)
  | { kind: 'tiebreak'; team1: number; team2: number };     // inside a tiebreak game

export interface LiveMatchState {
  matchWidgetId: string;
  matchId: string;                    // canonical UUID (resolved via match-identifier)
  pointState: PointState;
  team1Sets: Array<{ games: number; tiebreak: number | null } | null>;
  team2Sets: Array<{ games: number; tiebreak: number | null } | null>;
  servingTeam: 1 | 2 | null;
  status: 'scheduled' | 'live' | 'finished';
}

// Pure parse from the two raw strings the widget gives us per team ("15" / "30" / "40" / "AD" / "GP"
// on regular games, numeric strings like "5" / "6" inside tiebreaks). Called by the tournamentlive
// parser before constructing LiveMatchState.
//
// Parser contract (important — the comparator depends on this):
//   - Both raw values "40"                    → { kind: 'deuce' }                     (NEVER regular {40,40})
//   - One raw "AD", other "40"                → { kind: 'advantage', side }
//   - Either raw "GP"                         → { kind: 'golden_point' }
//   - insideTiebreak=true                     → { kind: 'tiebreak', ... }
//   - Otherwise                               → { kind: 'regular', team1, team2 }
export function parsePointState(
  team1Raw: string,
  team2Raw: string,
  insideTiebreak: boolean,
): PointState;

export interface LiveStateDiff {
  pointsAdded: Array<{ winnerTeam: 1 | 2 }>;
  gameChanged: boolean;               // a game just ended (team's game count in current set went up)
  setChanged: boolean;
  serverChanged: boolean;
  statusChanged: boolean;
  suspectedMissedPoints: boolean;     // true when we can't explain the transition with a single point
}

export function diffLiveState(prev: LiveMatchState | null, curr: LiveMatchState): LiveStateDiff;
```

Comparator logic (per-state, authoritative table):

| prev → curr                          | Result                                   |
|---|---|
| `regular a → regular b` with exactly one team's numeric score incremented one step (0→15, 15→30, 30→40) | 1 point to that team |
| `regular {30,40}` or `regular {40,30}` → `deuce` | 1 point to the side that went 30→40 |
| `deuce → advantage{side}`            | 1 point to `side` |
| `advantage{side} → deuce`            | 1 point to the OTHER side (break back) |
| `advantage{side} → regular {0,0}` with current-set games++ for `side` | 1 point to `side`, game ended |
| `advantage{other} → regular {0,0}` with current-set games++ for `side` | suspectedMissedPoints=true (AD flipped + game won in ≤1 poll). Emit 1 game-ending point to `side`, logger.warn |
| `deuce → regular {0,0}` with games++ for one side | 1 point to game winner (the final deuce point was immediately game-winning — no AD recorded between polls); suspectedMissedPoints=true |
| `deuce → golden_point` **or** `golden_point → deuce` | no new point (label-only transition — widget is reshuffling between the two deuce-equivalent labels) |
| `golden_point → regular {0,0}` with games++ for one side | 1 point to game winner |
| `tiebreak {a,b} → tiebreak {a',b'}` with `a'+b' === a+b+1` | 1 point to whichever side went up |
| `tiebreak {a,b} → tiebreak {a',b'}` with `a'+b' > a+b+1` | suspectedMissedPoints=true, emit 1 point to the net-gainer |
| `tiebreak → regular {0,0}` with set change + set tiebreak digit recorded | 1 point (tiebreak winner), setChanged=true |
| Status transition `live → finished` alone | statusChanged=true, no pointsAdded (final game-ending point should already have been captured by a prior diff — if not, suspectedMissedPoints=true) |
| Anything else                        | `suspectedMissedPoints=true`, emit 0 match_points, log `{matchId, prev, curr}` |

Key invariants:
- Never emit more than 1 `pointsAdded` entry per diff (one poll = at most one point credited). When multiple points happened between polls, we record `suspectedMissedPoints` and let match-stats reconciliation at match-end cover aggregate.
- `gameChanged` is derived from set-games counters, NOT from point state going to `{0,0}`. Start-of-set also reads `{0,0}` but isn't a game change.
- When `suspectedMissedPoints` fires, emit a structured log (`logger.warn({ matchId, prev, curr }, 'missed points suspected')`) so Plan 5 can build an operator review queue.

Tests cover (at minimum — parser and comparator are the highest-risk pure code in the plan):
1. `regular {15,0} → regular {30,0}` → 1 point to team1
2. `regular {40,40} → deuce` → 0 points (label-only transition)
3. `deuce → advantage{1}` → 1 point to team1
4. `advantage{1} → deuce` → 1 point to team2 (break back)
5. `advantage{1} → regular {0,0}` with set games going `3 → 4` for team1 → 1 point to team1 + gameChanged=true
6. `advantage{1} → regular {0,0}` with games going `3 → 4` for team2 → suspectedMissedPoints=true, 1 game-ending point to team2
7. `deuce → golden_point` → 0 points
8. `golden_point → regular {0,0}` with games bump → 1 point to the game winner
9. Tiebreak: `(5,4) → (5,5)` → 1 point to team2
10. Tiebreak-to-set-end: `(6,4) → regular {0,0}` with set 3 games going `6 → 7` for team1, set 3 tiebreak=4 recorded → setChanged=true
11. `regular {30,15} → regular {15,30}` → suspectedMissedPoints (impossible single-point transition)
12. Server flip between polls → serverChanged=true
13. `parsePointState("40","40", false)` → `{kind:'deuce'}` (parser collapses both-40 to deuce — this is the contract the comparator table depends on)
14. `parsePointState("AD","40", false)` → `{kind:'advantage', side:1}`
15. `parsePointState("GP","40", false)` → `{kind:'golden_point'}`
16. `parsePointState("5","3", true)` → `{kind:'tiebreak', team1:5, team2:3}`

Commit: `feat(padelgod): add live-state diff lib`

---

### Task 12: Point reconstruction lib

**File:** `padelgod/src/lib/point-reconstruction.ts` + test.

Takes a sequence of `LiveStateDiff` objects and writes:
- One `match_points` row per detected point (with `server_player_id` from current state)
- UPDATE `games.game_score` to match current state
- UPDATE `games.server_player_id` on game change
- UPDATE `sets.is_current` flags

Functions:
```typescript
export async function applyDiff(
  supabase: SupabaseClient,
  matchId: string,
  prev: LiveMatchState | null,
  curr: LiveMatchState,
  resolvedPlayers: ResolvedPlayers,
): Promise<void>;
```

`ResolvedPlayers` carries the 4 player UUIDs for the match (resolved via tournament-dictionary at startup).

Tests cover: writes match_points row on point detected, updates server_player_id, marks correct set is_current.

Commit: `feat(padelgod): add point-reconstruction lib`

---

### Task 13: Live poller loop

**File:** `padelgod/src/lib/live-poller-loop.ts` + test.

Per-tournament polling loop. Holds in-memory state per match and runs adaptive cadence.

```typescript
export interface LivePollerLoopOptions {
  tournamentId: string;
  widgetId: string;
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
}

export class LivePollerLoop {
  constructor(opts: LivePollerLoopOptions);
  async start(): Promise<void>;        // begin polling
  async stop(): Promise<void>;         // clean shutdown (clears interval)
  isRunning(): boolean;
}
```

Each tick:
1. GET `/screen/tournamentlive/{widgetId}?t=tol` via runScrapeJob
2. Parse with `parseCrionetTournamentLive`
3. For each live match:
   - Resolve match canonical id via match-identifier
   - Diff vs in-memory previous state
   - Apply diff via point-reconstruction.applyDiff
   - Update in-memory state
4. Compute next cadence based on aggregated criticality
5. Schedule next setTimeout

Tests cover: starts polling on start(), stops cleanly, adaptive cadence drops on critical state.

Commit: `feat(padelgod): add live-poller-loop engine`

---

### Task 14: Live poller manager worker

**File:** `padelgod/src/workers/live-poller-manager.ts` + test.

Orchestrates the LivePollerLoop instances. Runs every 60s as a "manager":
1. Query `padelgod_tournaments_for_live_polling()` (RPC from migration 016)
2. For each tournament: if not currently polling, create + start a `LivePollerLoop`
3. For each currently-polling tournament: if no longer in the active list, stop the loop

In-memory map of `tournamentId → LivePollerLoop`. Lives in module-level state since it must persist across worker invocations.

```typescript
const activePollers = new Map<string, LivePollerLoop>();

export async function runLivePollerManager(deps: LivePollerManagerDeps): Promise<{
  active: number;
  started: number;
  stopped: number;
}>;
```

Tests cover: starts new loops, stops removed ones, no-op for already-active.

Commit: `feat(padelgod): add live-poller-manager worker`

---

### Task 15: Wire live-poller-manager into scheduler

Update scheduler.ts:
```typescript
if (flags.enableLivePollerManager) {
  entries.push({
    name: 'live-poller-manager',
    cron: '*/1 * * * *',   // every minute — quick to react to live_source flag flips
    run: (deps) => runLivePollerManager(deps),
  });
}
```

Add ENABLE_LIVE_POLLER_MANAGER env flag. Update scheduler test.

Important: the live-poller-manager itself runs on cron, but the LOOPS it manages are continuous setIntervals NOT controlled by node-cron. The cron is just the manager's lifecycle check.

Commit: `feat(padelgod): wire live-poller-manager into scheduler`

---

### Task 16: Apply migrations + smoke test on a real tournament

**Steps (user actions):**
1. **Verify Task 0 relay gate is deployed** (check Railway relay logs for the new log line on startup, and confirm at least one tournament in `live_source='padelapi'` is still being served). If not, STOP — do not proceed.
2. Apply migrations 016 + 017 in Supabase SQL editor.
3. Pick the smoke-test target. Per the 2026-04-20 precondition check, **Brussels P2** (padelapi-sourced row `b91c4c7d-dfdf-47bd-af99-e6d97515634e`, not the FIP-discovered stub with null dates) is the only tournament currently live where we can plausibly get a widget_id. Its Crionet widget code is `FIP-2026-1701`.

   **Watch out — duplicate tournament rows:** there are TWO Brussels P2 2026 entries in DB. Flip the padelapi-sourced one (proper dates). Don't touch the FIP-sourced stub (`8ef5752c`, dates=NULL) — it won't be picked up by the RPC date filter anyway.

4. Seed the widget_id cache and flip `live_source` in one transaction:
   ```sql
   -- Brussels P2 2026, padelapi-sourced row
   INSERT INTO padelgod.widget_id_cache (tournament_id, widget_id, is_active, extraction_method)
   VALUES ('b91c4c7d-dfdf-47bd-af99-e6d97515634e', 'FIP-2026-1701', true, 'manual');

   UPDATE public.tournaments
   SET live_source = 'padelgod'
   WHERE id = 'b91c4c7d-dfdf-47bd-af99-e6d97515634e';
   ```
5. Within 60s of the flip:
   - Railway **relay** logs should show "Unsubscribing — tournament flipped to padelgod" for all Brussels P2 channels.
   - Railway **padelgod** logs should show live-poller-manager started a loop for Brussels P2.
6. Verify rows appear in `match_points`:
   ```sql
   SELECT match_id, point_number, score_after, winner_pair, created_at
   FROM public.match_points
   ORDER BY created_at DESC LIMIT 20;
   ```
7. **Abort criteria** — if ANY of the following happens in the first 15 min, flip back to `live_source='padelapi'` immediately:
   - Padelgod poller not producing match_points rows
   - match_points rows with `suspectedMissedPoints=true` exceeding 20% of rows (indicates comparator bug, not just poll latency)
   - Any error from the relay about writing to a Brussels P2 match
   - Main app UI shows score regression on a Brussels P2 match

If point counts are reasonable (~1-2 per minute per active match) and no abort criteria fire, live polling works.

Commit: (no code, this is a verification step)

---

### Task 17: Push branch + open PR + merge

Standard flow. Body should reference the live data validation report and the `live_source` flag for cutover.

After merge → Railway redeploys → live-poller-manager fires within 60s → if any tournament has `live_source='padelgod'`, it starts polling immediately.

---

## Definition of done

1. ✅ Static reconciler produces canonical players + tournament_draws + matches + sets from snapshots
2. ✅ Live poller writes to match_points during a live match
3. ✅ Match stats fetcher populates match_stats for finished matches
4. ✅ All workers test-covered
5. ✅ Migrations 016 + 017 applied to Supabase, verifications pass
6. ✅ At least one tournament cut over to `live_source='padelgod'` and producing live data in production
7. ✅ Aggregate validation: reconstructed point count for a finished match matches `match_stats.total_points` within 5%

---

## What this plan deliberately does NOT do

- ❌ Per-tournament golden-point detection (we capture it from `match_points.is_golden_point` if the score label is `"GP"`, but `tournaments.uses_golden_point` flag stays NULL — populated manually for V1)
- ❌ Aggregate validation auto-write to `padelgod.unresolved_matches` — implement only the validator function; wiring to write the queue can come later
- ❌ Playwright fallback for widget-code-lookup (still skipped tournaments) — Plan 4.5 if needed
- ❌ Reconciler conflict resolution between competing sources (padelapi vs padelgod) — relies on per-tournament `live_source` flag to keep them disjoint
- ❌ Backfill historical matches via Plan 3 snapshots beyond the 50-tournament active window — V1.5

If you find yourself wanting to add any of these, capture as follow-up — don't bloat Plan 4.
