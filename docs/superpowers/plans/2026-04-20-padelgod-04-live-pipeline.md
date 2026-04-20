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
2. Query `entity_external_ids` for `(entity_type='match', source='crionet_widget', external_id=composite)` → if found, return that match_id
3. If not found, INSERT into `matches` with available fields, then INSERT into `entity_external_ids` linking the new match to the widget id
4. Return `{ matchId, created: true|false }`

Tests:
1. Returns existing match id when entity_external_ids has it
2. Creates new match + entity_external_ids row when not found
3. Handles concurrent create gracefully (second caller gets existing id, not error)

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

Note: draw doesn't have a widget match id (only OOP/results do). For matches that exist only in draws, we use the canonical `matches.id` UUID without a crionet_widget external_id mapping. The OOP/results reconciler will later link them.

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

```typescript
export interface LiveMatchState {
  matchWidgetId: string;
  matchId: string;                    // canonical UUID (resolved via match-identifier)
  team1Points: string;                // "15", "30", "AD", "GP"
  team2Points: string;
  team1Sets: Array<{ games: number; tiebreak: number | null } | null>;
  team2Sets: Array<{ games: number; tiebreak: number | null } | null>;
  servingTeam: 1 | 2 | null;
  status: 'scheduled' | 'live' | 'finished';
}

export interface LiveStateDiff {
  pointsAdded: Array<{ winnerTeam: 1 | 2; scoreAfter: string }>;
  gameChanged: boolean;               // a game just ended
  setChanged: boolean;                // a set just ended
  serverChanged: boolean;
  statusChanged: boolean;
}

export function diffLiveState(prev: LiveMatchState | null, curr: LiveMatchState): LiveStateDiff;
```

Logic:
- Compare `currentPoints` strings; the team whose points went up won the most recent point. (If both unchanged → no diff.)
- Set boundary: when team1Sets[N].games or team2Sets[N].games changes → game ended in that set
- Server change: simple equality check
- Status change: simple equality

Tests cover: 15 → 30 (1 point added), 30 → 0 + games went 0 → 1 (game just ended), set change, server flip.

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
1. Apply migrations 016 + 017 in Supabase SQL editor
2. Pick one currently-active tournament (e.g. Brussels P2 if still live, or whatever is live next):
   ```sql
   UPDATE public.tournaments
   SET live_source = 'padelgod'
   WHERE name ILIKE '%brussels%';
   ```
3. Watch Railway logs for `live-poller-manager` to detect + start the loop
4. Verify rows appear in `match_points`:
   ```sql
   SELECT match_id, point_number, score_after, winner_pair, created_at
   FROM public.match_points
   ORDER BY created_at DESC LIMIT 20;
   ```

If point counts are reasonable (~1-2 per minute per active match), live polling works.

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
