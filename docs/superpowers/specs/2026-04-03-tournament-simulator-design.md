# Tournament Simulator — Design Spec

**Date:** 2026-04-03
**Status:** Approved

## Overview

A testing tool in the ops dashboard that lets operators create simulated tournaments with real players, act as referee to score points live through the relay pipeline, and purge all simulated data afterwards. Designed for testing live features during gaps between real tournaments. Multiple referees can score different matches simultaneously.

## Architecture

### Data Flow

```
Referee UI (ops/Simulator tab)
    ↓ POST /api/ops/simulator/score
    ↓ (proxies with RELAY_SECRET)
Relay service (POST /simulate)
    ↓ handleLiveUpdate() — existing pipeline
Supabase (matches, sets, games tables)
    ↓ (client polls / realtime)
App UI (live scores, momentum chart, etc.)
```

The referee UI sends each point through the relay's existing `handleLiveUpdate()` flow, ensuring the full real-time pipeline is tested end-to-end. The relay receives simulated events in the same format as Pusher events.

### Simulated Data Identification

New column on `tournaments` table: `source TEXT DEFAULT 'api'` with values `'api'` | `'simulated'`.

Purge operation: `DELETE FROM tournaments WHERE source = 'simulated'` — cascades via FK to matches → sets → games → match_ratings. One query, no orphans.

## Database Changes

### Migration: `tournaments.source` column

```sql
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'api'
  CHECK (source IN ('api', 'simulated'));
```

No changes to matches, sets, or games tables — they inherit simulated status through their tournament FK.

## Relay Changes

### New endpoint: `POST /simulate`

Added to `relay/index.js`. Accepts referee score events and runs them through the existing write pipeline.

**Auth:** `Authorization: Bearer {RELAY_SECRET}` header (same as existing `/sync` endpoint).

**Request body:**

```json
{
  "action": "point" | "start_match" | "finish_match" | "undo_point",
  "matchId": "uuid (DB id)",
  "externalId": "string (external_id)",
  "data": {
    "sets": [...],
    "status": "live" | "finished",
    "points": [...]
  }
}
```

**Actions:**

- `start_match`: Transitions match from `scheduled` → `live`. Creates initial set and game rows. Updates `started_at`.
- `point`: Writes the full current score state (sets, games, points arrays) via `handleLiveUpdate()`. The referee UI computes the next state client-side and sends the complete snapshot.
- `undo_point`: Accepts the previous score state (referee UI tracks history) and overwrites current state.
- `finish_match`: Transitions match to `finished`. Calls `cleanupMatchFinish()` to compute coverage, clear `is_current`, infer winner.

**Key design decision:** The referee UI is the scoring brain — it computes padel scoring rules (0→15→30→40, deuce, tiebreak) and sends complete state snapshots. The relay just writes what it receives, same as it does for real Pusher events. This keeps the relay simple and the scoring logic testable in the browser.

## API Routes

All ops API routes use the existing middleware auth pattern (httpOnly `ops_token` cookie validated against `CRON_SECRET`).

### `POST /api/ops/simulator/create-tournament`

Creates a simulated tournament with matches populated by real players.

**Request body:**

```json
{
  "name": "Test Tournament — Apr 2026",
  "category": "men" | "women",
  "matchCount": 8,
  "playerIds": ["uuid", "uuid", ...],
  "round": "Round of 16"
}
```

**Logic:**
1. Create tournament row with `source: 'simulated'`, `starts_at: now`, `ends_at: now + 5 days`.
2. Validate `playerIds` — need `matchCount * 4` players (2 per pair, 2 pairs per match). If fewer provided, repeat/cycle through the list.
3. Create `matchCount` matches with status `scheduled`, assigning 4 players per match from the list.
4. Return `{ tournament, matches }`.

### `GET /api/ops/simulator/tournaments`

Lists simulated tournaments with match counts and status summary.

**Response:**

```json
{
  "tournaments": [
    {
      "id": "uuid",
      "name": "Test Tournament",
      "category": "men",
      "matchCount": 8,
      "liveCount": 1,
      "finishedCount": 3,
      "scheduledCount": 4,
      "createdAt": "2026-04-03T..."
    }
  ]
}
```

### `POST /api/ops/simulator/score`

Proxies referee scoring events to the relay service.

**Request body:** Same as relay `/simulate` endpoint.

**Logic:**
1. Read `ops_token` cookie, validate against `CRON_SECRET`.
2. Forward request to `${RELAY_URL}/simulate` with `Authorization: Bearer ${RELAY_SECRET}`.
3. Return relay response.

This proxy exists so the browser doesn't need the `RELAY_SECRET` — it only has the ops cookie.

### `POST /api/ops/simulator/purge`

Deletes all simulated tournaments and cascading data.

**Request body:**

```json
{
  "confirm": "PURGE"
}
```

**Logic:**
1. Validate `confirm === 'PURGE'`.
2. Count what will be deleted (tournaments, matches, sets, games).
3. `DELETE FROM tournaments WHERE source = 'simulated'`.
4. Return `{ deleted: { tournaments: N, matches: N } }`.

## Scoring Engine (Client-Side)

A pure TypeScript module that implements padel scoring rules. Runs in the browser as part of the referee UI.

### `src/lib/padel-scoring.ts`

**State shape:**

```typescript
interface MatchState {
  sets: SetState[]
  currentSet: number      // 1-indexed
  currentGame: number     // 1-indexed within set
  status: 'scheduled' | 'live' | 'finished'
  servingPair: 1 | 2
}

interface SetState {
  setNumber: number
  pair1Games: number
  pair2Games: number
  games: GameState[]
  isTiebreak: boolean
  setScore: string | null  // "6-3", "7-6(7)", null if in progress
  winner: 1 | 2 | null
}

interface GameState {
  gameNumber: number
  points: string[]         // ["0:0", "15:0", "30:0", ...]
  pair1Points: string      // "30", "40", "A"
  pair2Points: string
  winner: 1 | 2 | null
}
```

**Core functions:**

- `createInitialState(): MatchState` — empty state for a new match
- `addPoint(state, pair: 1 | 2): MatchState` — returns new state after point awarded. Handles:
  - Standard scoring: 0→15→30→40→game
  - Deuce: 40-40→A→game (or back to deuce)
  - Tiebreak: numeric scoring at 6-6, first to 7 with 2-point lead
  - Set win: first to 6 with 2-game lead (or tiebreak at 6-6)
  - Match win: best of 3 sets
- `undoPoint(state): MatchState` — pops last point, recalculates state
- `quickGame(state, pair: 1 | 2): MatchState` — generates 4-8 realistic points sequence and applies them
- `stateToRelayPayload(state, matchId, externalId): object` — converts MatchState to the relay `/simulate` request format
- `stateToDbFormat(state): object` — converts to the sets/games format matching the DB schema

**Tiebreak rules (padel):**
- Triggered at 6-6 in any set
- Points: 0,1,2,3... (numeric, not 15/30/40)
- Win condition: first to 7 with 2-point lead
- Service alternates every 2 points (after first point)

### History Stack

The referee UI maintains a stack of previous `MatchState` snapshots for undo. Each `addPoint()` pushes the current state before applying the new point. Undo pops the stack and sends the previous state to the relay.

## Ops Dashboard UI

### New tab: "Simulator"

Added as the third tab in `OpsClient.tsx` (after "Integration Health" and "Data").

### Three sections:

**1. Tournament Setup (top)**
- Dropdown to select existing simulated tournament
- "New Tournament" button → opens inline form:
  - Name input
  - Category toggle (men/women)
  - Number of matches (4/8/16)
  - Player picker: multi-select from existing DB players, filtered by category. Shows player name + country flag.
- "Purge All" button (red) → confirmation modal requiring "PURGE" text input

**2. Match List (middle)**
- List of matches in selected tournament
- Each row shows: pair names, status indicator (dot), score (if in progress/finished)
- "Start" button on scheduled matches → transitions to live
- Green highlight on the match currently being scored
- Finished matches show final score, dimmed

**3. Referee Panel (bottom, only visible when a match is selected)**
- Live scoreboard: sets, games, current points for both pairs
- Two large POINT buttons (amber for Pair 1, teal for Pair 2)
- Quick action row: "Quick Game P1" | "Quick Game P2" | "Undo Last"
- "Finish Match" button (appears when match could end — i.e., a pair has match point)
- Current game's point history displayed as breadcrumb: `0:0 → 15:0 → 30:0 → 30:15 → ...`

### Player Picker

Fetches players from the DB filtered by category. Shows:
- Player name
- Country flag
- Ranking (if available)

User selects players in groups of 4 (two pairs). For MVP, just select N*4 players and auto-assign to matches in order.

## Scope

### In scope
- `tournaments.source` column + migration
- Relay `POST /simulate` endpoint
- 4 ops API routes (create, list, score proxy, purge)
- Padel scoring engine (`src/lib/padel-scoring.ts`)
- Simulator tab in ops dashboard (tournament setup, match list, referee panel)
- Player picker from existing DB players
- Point-by-point scoring + quick game shortcut
- Undo last point
- Purge with confirmation
- Multiple referees on different matches

### Out of scope
- Draw bracket visualization
- Tournament progression (winner of match A plays in match B)
- Serving side tracking beyond alternating
- Score correction (edit arbitrary past points)
- Spectator view of referee actions
- Automated match simulation (bot referee)
