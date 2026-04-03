# Tournament Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a testing tool in the ops dashboard that creates simulated tournaments, lets operators score matches live through the relay pipeline, and purge all simulated data afterwards.

**Architecture:** Client-side scoring engine computes padel rules and sends complete state snapshots to relay via ops API proxy. Simulated data identified by `tournaments.source = 'simulated'` column, purged with a single cascading DELETE. The Simulator tab in OpsClient.tsx delegates to a new `SimulatorTab.tsx` component (same pattern as EntryListTab).

**Tech Stack:** Next.js API routes, Express (relay), Supabase (Postgres), TypeScript, React 19, inline CSS

---

### Task 1: Padel Scoring Engine

**Files:**
- Create: `src/lib/padel-scoring.ts`
- Create: `src/lib/__tests__/padel-scoring.test.ts`

This is the scoring brain — a pure TypeScript module with zero dependencies. The referee UI calls `addPoint()` to advance the score, and `stateToRelayPayload()` to convert for the relay.

- [ ] **Step 1: Write the type definitions and `createInitialState()`**

```typescript
// src/lib/padel-scoring.ts

export interface GameState {
  gameNumber: number
  points: string[]           // ["0:0", "15:0", "30:0", ...]
  pair1Points: string        // "0", "15", "30", "40", "A"
  pair2Points: string
  winner: 1 | 2 | null
}

export interface SetState {
  setNumber: number
  pair1Games: number
  pair2Games: number
  games: GameState[]
  isTiebreak: boolean
  winner: 1 | 2 | null
}

export interface MatchState {
  sets: SetState[]
  currentSet: number         // 1-indexed
  currentGame: number        // 1-indexed within set
  status: 'scheduled' | 'live' | 'finished'
  servingPair: 1 | 2
  winner: 1 | 2 | null
}

export function createInitialState(): MatchState {
  return {
    sets: [{
      setNumber: 1,
      pair1Games: 0,
      pair2Games: 0,
      games: [{
        gameNumber: 1,
        points: ['0:0'],
        pair1Points: '0',
        pair2Points: '0',
        winner: null,
      }],
      isTiebreak: false,
      winner: null,
    }],
    currentSet: 1,
    currentGame: 1,
    status: 'live',
    servingPair: 1,
    winner: null,
  }
}
```

- [ ] **Step 2: Write failing tests for standard game scoring**

```typescript
// src/lib/__tests__/padel-scoring.test.ts
import { describe, it, expect } from 'vitest'
import { createInitialState, addPoint } from '../padel-scoring'

describe('padel-scoring', () => {
  describe('createInitialState', () => {
    it('creates a fresh match state', () => {
      const state = createInitialState()
      expect(state.status).toBe('live')
      expect(state.sets).toHaveLength(1)
      expect(state.sets[0].games).toHaveLength(1)
      expect(state.sets[0].games[0].pair1Points).toBe('0')
      expect(state.sets[0].games[0].pair2Points).toBe('0')
    })
  })

  describe('addPoint - standard game', () => {
    it('advances 0 → 15 → 30 → 40 → game', () => {
      let state = createInitialState()
      state = addPoint(state, 1) // 15:0
      expect(currentPoints(state)).toEqual(['15', '0'])
      state = addPoint(state, 1) // 30:0
      expect(currentPoints(state)).toEqual(['30', '0'])
      state = addPoint(state, 1) // 40:0
      expect(currentPoints(state)).toEqual(['40', '0'])
      state = addPoint(state, 1) // game won
      expect(state.sets[0].pair1Games).toBe(1)
      expect(state.sets[0].games).toHaveLength(2) // new game started
    })

    it('handles deuce → advantage → game', () => {
      let state = createInitialState()
      // Get to 40:40
      for (let i = 0; i < 3; i++) state = addPoint(state, 1)
      for (let i = 0; i < 3; i++) state = addPoint(state, 2)
      expect(currentPoints(state)).toEqual(['40', '40'])
      // Advantage pair 1
      state = addPoint(state, 1)
      expect(currentPoints(state)).toEqual(['A', '40'])
      // Back to deuce
      state = addPoint(state, 2)
      expect(currentPoints(state)).toEqual(['40', '40'])
      // Advantage pair 2, then game
      state = addPoint(state, 2)
      expect(currentPoints(state)).toEqual(['40', 'A'])
      state = addPoint(state, 2)
      expect(state.sets[0].pair2Games).toBe(1)
    })
  })
})

function currentPoints(state: MatchState): [string, string] {
  const set = state.sets[state.currentSet - 1]
  const game = set.games[state.currentGame - 1]
  return [game.pair1Points, game.pair2Points]
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `export PATH="/usr/local/bin:$PATH" && npx vitest run src/lib/__tests__/padel-scoring.test.ts`
Expected: FAIL — `addPoint` not exported yet

- [ ] **Step 4: Implement `addPoint()` for standard games**

```typescript
// src/lib/padel-scoring.ts (add after createInitialState)

const POINT_PROGRESSION: Record<string, string> = {
  '0': '15', '15': '30', '30': '40',
}

export function addPoint(state: MatchState, pair: 1 | 2): MatchState {
  // Deep clone to maintain immutability
  const next: MatchState = JSON.parse(JSON.stringify(state))
  const set = next.sets[next.currentSet - 1]
  const game = set.games[next.currentGame - 1]

  if (set.isTiebreak) {
    return addTiebreakPoint(next, pair)
  }

  const isP1 = pair === 1
  const scorerPoints = isP1 ? game.pair1Points : game.pair2Points
  const opponentPoints = isP1 ? game.pair2Points : game.pair1Points

  // At 40 — check for game win or deuce logic
  if (scorerPoints === '40' || scorerPoints === 'A') {
    if (scorerPoints === 'A') {
      // Advantage → game won
      finishGame(next, pair)
    } else if (opponentPoints === '40') {
      // 40:40 → advantage
      if (isP1) game.pair1Points = 'A'
      else game.pair2Points = 'A'
      game.points.push(`${game.pair1Points}:${game.pair2Points}`)
    } else {
      // 40:something → game won
      finishGame(next, pair)
    }
  } else if (opponentPoints === 'A') {
    // Opponent had advantage → back to deuce
    game.pair1Points = '40'
    game.pair2Points = '40'
    game.points.push('40:40')
  } else {
    // Normal progression: 0→15→30→40
    if (isP1) game.pair1Points = POINT_PROGRESSION[scorerPoints]
    else game.pair2Points = POINT_PROGRESSION[scorerPoints]
    game.points.push(`${game.pair1Points}:${game.pair2Points}`)
  }

  return next
}

function finishGame(state: MatchState, winner: 1 | 2): void {
  const set = state.sets[state.currentSet - 1]
  const game = set.games[state.currentGame - 1]
  game.winner = winner

  if (winner === 1) set.pair1Games++
  else set.pair2Games++

  // Check for set win
  const p1 = set.pair1Games
  const p2 = set.pair2Games
  const leader = Math.max(p1, p2)
  const trailer = Math.min(p1, p2)

  if (leader >= 6 && leader - trailer >= 2) {
    // Set won
    finishSet(state, winner)
  } else if (p1 === 6 && p2 === 6) {
    // Tiebreak
    set.isTiebreak = true
    state.currentGame++
    set.games.push({
      gameNumber: state.currentGame,
      points: ['0:0'],
      pair1Points: '0',
      pair2Points: '0',
      winner: null,
    })
  } else {
    // Next game
    state.currentGame++
    set.games.push({
      gameNumber: state.currentGame,
      points: ['0:0'],
      pair1Points: '0',
      pair2Points: '0',
      winner: null,
    })
    // Alternate serve every game
    state.servingPair = state.servingPair === 1 ? 2 : 1
  }
}

function finishSet(state: MatchState, winner: 1 | 2): void {
  const set = state.sets[state.currentSet - 1]
  set.winner = winner

  // Check for match win (best of 3)
  const setsWon = state.sets.filter(s => s.winner === winner).length
  if (setsWon >= 2) {
    state.status = 'finished'
    state.winner = winner
    return
  }

  // Start next set
  state.currentSet++
  state.currentGame = 1
  state.sets.push({
    setNumber: state.currentSet,
    pair1Games: 0,
    pair2Games: 0,
    games: [{
      gameNumber: 1,
      points: ['0:0'],
      pair1Points: '0',
      pair2Points: '0',
      winner: null,
    }],
    isTiebreak: false,
    winner: null,
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `export PATH="/usr/local/bin:$PATH" && npx vitest run src/lib/__tests__/padel-scoring.test.ts`
Expected: PASS

- [ ] **Step 6: Add tiebreak tests**

```typescript
// Add to src/lib/__tests__/padel-scoring.test.ts

describe('addPoint - tiebreak', () => {
  function getToTiebreak(): MatchState {
    let state = createInitialState()
    // Get to 6-6 (12 games, alternating wins)
    for (let g = 0; g < 6; g++) {
      for (let p = 0; p < 4; p++) state = addPoint(state, 1) // game for P1
      for (let p = 0; p < 4; p++) state = addPoint(state, 2) // game for P2
    }
    return state
  }

  it('triggers tiebreak at 6-6', () => {
    const state = getToTiebreak()
    expect(state.sets[0].pair1Games).toBe(6)
    expect(state.sets[0].pair2Games).toBe(6)
    expect(state.sets[0].isTiebreak).toBe(true)
  })

  it('uses numeric scoring in tiebreak', () => {
    let state = getToTiebreak()
    state = addPoint(state, 1) // 1:0
    const set = state.sets[0]
    const game = set.games[set.games.length - 1]
    expect(game.pair1Points).toBe('1')
    expect(game.pair2Points).toBe('0')
  })

  it('wins tiebreak at 7 with 2-point lead', () => {
    let state = getToTiebreak()
    for (let i = 0; i < 7; i++) state = addPoint(state, 1) // 7:0
    expect(state.sets[0].winner).toBe(1)
    expect(state.sets[0].pair1Games).toBe(7)
    expect(state.currentSet).toBe(2) // moved to set 2
  })

  it('requires 2-point lead in tiebreak', () => {
    let state = getToTiebreak()
    // Get to 6:6 in tiebreak
    for (let i = 0; i < 6; i++) state = addPoint(state, 1)
    for (let i = 0; i < 6; i++) state = addPoint(state, 2)
    const set = state.sets[0]
    const game = set.games[set.games.length - 1]
    expect(game.pair1Points).toBe('6')
    expect(game.pair2Points).toBe('6')
    // 7:6 — not won yet
    state = addPoint(state, 1)
    expect(state.sets[0].winner).toBeNull()
    // 7:7
    state = addPoint(state, 2)
    expect(state.sets[0].winner).toBeNull()
    // 8:7
    state = addPoint(state, 1)
    expect(state.sets[0].winner).toBeNull()
    // 9:7 — won!
    state = addPoint(state, 1)
    expect(state.sets[0].winner).toBe(1)
  })
})
```

- [ ] **Step 7: Implement `addTiebreakPoint()`**

```typescript
// src/lib/padel-scoring.ts (add before addPoint)

function addTiebreakPoint(state: MatchState, pair: 1 | 2): MatchState {
  const set = state.sets[state.currentSet - 1]
  const game = set.games[state.currentGame - 1]

  const p1 = parseInt(game.pair1Points)
  const p2 = parseInt(game.pair2Points)

  if (pair === 1) game.pair1Points = String(p1 + 1)
  else game.pair2Points = String(p2 + 1)

  game.points.push(`${game.pair1Points}:${game.pair2Points}`)

  const newP1 = parseInt(game.pair1Points)
  const newP2 = parseInt(game.pair2Points)
  const leader = Math.max(newP1, newP2)
  const trailer = Math.min(newP1, newP2)

  if (leader >= 7 && leader - trailer >= 2) {
    const tbWinner = newP1 > newP2 ? 1 : 2
    game.winner = tbWinner
    if (tbWinner === 1) set.pair1Games++
    else set.pair2Games++
    finishSet(state, tbWinner)
  } else {
    // Serve alternates every 2 points (after the first point)
    const totalPoints = newP1 + newP2
    if (totalPoints === 1 || (totalPoints > 1 && (totalPoints - 1) % 2 === 0)) {
      state.servingPair = state.servingPair === 1 ? 2 : 1
    }
  }

  return state
}
```

- [ ] **Step 8: Run tiebreak tests**

Run: `export PATH="/usr/local/bin:$PATH" && npx vitest run src/lib/__tests__/padel-scoring.test.ts`
Expected: PASS

- [ ] **Step 9: Add match completion test**

```typescript
// Add to src/lib/__tests__/padel-scoring.test.ts

describe('match completion', () => {
  it('finishes match when a pair wins 2 sets (best of 3)', () => {
    let state = createInitialState()
    // Win 2 sets for pair 1 (6-0, 6-0)
    for (let s = 0; s < 2; s++) {
      for (let g = 0; g < 6; g++) {
        for (let p = 0; p < 4; p++) state = addPoint(state, 1)
      }
    }
    expect(state.status).toBe('finished')
    expect(state.winner).toBe(1)
    expect(state.sets).toHaveLength(2)
  })

  it('plays third set if each pair wins one', () => {
    let state = createInitialState()
    // Pair 1 wins set 1 (6-0)
    for (let g = 0; g < 6; g++) {
      for (let p = 0; p < 4; p++) state = addPoint(state, 1)
    }
    expect(state.sets[0].winner).toBe(1)
    expect(state.currentSet).toBe(2)
    // Pair 2 wins set 2 (6-0)
    for (let g = 0; g < 6; g++) {
      for (let p = 0; p < 4; p++) state = addPoint(state, 2)
    }
    expect(state.sets[1].winner).toBe(2)
    expect(state.currentSet).toBe(3)
    expect(state.status).toBe('live')
  })
})
```

- [ ] **Step 10: Run all tests**

Run: `export PATH="/usr/local/bin:$PATH" && npx vitest run src/lib/__tests__/padel-scoring.test.ts`
Expected: PASS

- [ ] **Step 11: Add `undoPoint()`, `quickGame()`, and conversion functions**

```typescript
// src/lib/padel-scoring.ts (add at bottom)

export function undoPoint(state: MatchState, history: MatchState[]): { state: MatchState; history: MatchState[] } {
  if (history.length === 0) return { state, history }
  const previous = history[history.length - 1]
  return { state: previous, history: history.slice(0, -1) }
}

export function quickGame(state: MatchState, pair: 1 | 2): { state: MatchState; history: MatchState[] } {
  const history: MatchState[] = []
  let current = state
  const set = current.sets[current.currentSet - 1]
  const startGame = current.currentGame

  // Generate realistic points: winner gets 4, loser gets 0-2
  const loserPoints = Math.floor(Math.random() * 3) // 0, 1, or 2
  const loser: (1 | 2) = pair === 1 ? 2 : 1

  // Interleave points somewhat realistically
  let winnerLeft = 4
  let loserLeft = loserPoints

  while (winnerLeft > 0 || loserLeft > 0) {
    // Check if match/set already finished from a previous point
    if (current.status === 'finished') break
    if (current.currentGame !== startGame || current.currentSet !== state.currentSet) break

    history.push(JSON.parse(JSON.stringify(current)))
    if (loserLeft > 0 && Math.random() < 0.4) {
      current = addPoint(current, loser)
      loserLeft--
    } else if (winnerLeft > 0) {
      current = addPoint(current, pair)
      winnerLeft--
    } else {
      current = addPoint(current, loser)
      loserLeft--
    }
  }

  return { state: current, history }
}

export function stateToRelayPayload(
  state: MatchState,
  matchId: string,
  externalId: string,
  action: 'start_match' | 'point' | 'undo_point' | 'finish_match'
): object {
  return {
    action,
    matchId,
    externalId,
    data: stateToDbFormat(state),
  }
}

export function stateToDbFormat(state: MatchState): object {
  return {
    status: state.status,
    sets: state.sets.map(set => ({
      set_number: set.setNumber,
      set_score: set.winner
        ? (set.isTiebreak
            ? `${Math.max(set.pair1Games, set.pair2Games)}-${Math.min(set.pair1Games, set.pair2Games)}(${set.games[set.games.length - 1]?.points.length ? Math.min(parseInt(set.games[set.games.length - 1].pair1Points), parseInt(set.games[set.games.length - 1].pair2Points)) : ''})`
            : `${Math.max(set.pair1Games, set.pair2Games)}-${Math.min(set.pair1Games, set.pair2Games)}`)
        : null,
      pair1_games: set.pair1Games,
      pair2_games: set.pair2Games,
      games: set.games.map(game => ({
        game_number: game.gameNumber,
        game_score: `${set.pair1Games}-${set.pair2Games}`,
        points: game.points,
        is_current: game.winner === null,
        winner_pair: game.winner,
      })),
      is_current: set.winner === null,
    })),
  }
}
```

- [ ] **Step 12: Add tests for `undoPoint`, `quickGame`, `stateToDbFormat`**

```typescript
// Add to src/lib/__tests__/padel-scoring.test.ts
import { undoPoint, quickGame, stateToDbFormat } from '../padel-scoring'

describe('undoPoint', () => {
  it('restores previous state from history', () => {
    const state = createInitialState()
    const history = [JSON.parse(JSON.stringify(state))]
    const after = addPoint(state, 1)
    const result = undoPoint(after, history)
    expect(result.state.sets[0].games[0].pair1Points).toBe('0')
    expect(result.history).toHaveLength(0)
  })

  it('returns same state when history is empty', () => {
    const state = createInitialState()
    const result = undoPoint(state, [])
    expect(result.state).toBe(state)
  })
})

describe('quickGame', () => {
  it('completes a game for the specified pair', () => {
    const state = createInitialState()
    const result = quickGame(state, 1)
    // Either the game advanced (pair1Games went up) or match structure changed
    const set = result.state.sets[0]
    expect(set.pair1Games).toBeGreaterThanOrEqual(1)
  })
})

describe('stateToDbFormat', () => {
  it('converts to relay-compatible format', () => {
    let state = createInitialState()
    state = addPoint(state, 1)
    const db = stateToDbFormat(state) as any
    expect(db.status).toBe('live')
    expect(db.sets).toHaveLength(1)
    expect(db.sets[0].set_number).toBe(1)
    expect(db.sets[0].games[0].points).toContain('15:0')
  })
})
```

- [ ] **Step 13: Run all scoring tests**

Run: `export PATH="/usr/local/bin:$PATH" && npx vitest run src/lib/__tests__/padel-scoring.test.ts`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add src/lib/padel-scoring.ts src/lib/__tests__/padel-scoring.test.ts
git commit -m "feat: add padel scoring engine with TDD (standard, deuce, tiebreak, match completion)"
```

---

### Task 2: Database Migration — `tournaments.source` Column

**Files:**
- Create: `supabase/migrations/20260403_tournament_source.sql`

This migration adds the `source` column that distinguishes simulated tournaments from real ones. Applied manually via Supabase SQL editor (same pattern as existing migrations).

- [ ] **Step 1: Write the migration SQL**

```sql
-- supabase/migrations/20260403_tournament_source.sql
-- Tournament source tracking: 'api' (real) vs 'simulated' (test data)
-- Simulated tournaments + all cascading data can be purged with:
--   DELETE FROM tournaments WHERE source = 'simulated'

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'api'
  CHECK (source IN ('api', 'simulated'));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260403_tournament_source.sql
git commit -m "feat: add tournaments.source column migration for simulator"
```

**Note:** Tell the user to apply this migration in the Supabase SQL editor before testing. The column must exist before the API routes can create simulated tournaments.

---

### Task 3: Relay `POST /simulate` Endpoint

**Files:**
- Modify: `relay/index.js` (add ~60 lines after existing routes, around line 700)

This endpoint accepts referee scoring events and writes them through the existing `handleLiveUpdate()` pipeline. Authenticated with the same `RELAY_SECRET` as `/sync`.

- [ ] **Step 1: Add the `/simulate` endpoint to `relay/index.js`**

Add after the existing `app.post('/subscribe', ...)` block (around line 702):

```javascript
// ── Simulator: accept referee scoring events ─────────────────
app.post('/simulate', requireSecret, async (req, res) => {
  const { action, matchId, externalId, data } = req.body

  if (!action || !matchId) {
    return res.status(400).json({ error: 'action and matchId required' })
  }

  try {
    if (action === 'start_match') {
      // Transition match from scheduled → live
      await supabase
        .from('matches')
        .update({
          status: 'live',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchId)

      // Create initial set and game
      const { data: setRow } = await supabase
        .from('sets')
        .upsert({
          match_id: matchId,
          set_number: 1,
          pair1_games: 0,
          pair2_games: 0,
          is_current: true,
          score_source: 'live',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'match_id, set_number' })
        .select('id')
        .single()

      if (setRow) {
        await supabase
          .from('games')
          .upsert({
            set_id: setRow.id,
            match_id: matchId,
            game_number: 1,
            game_score: '0-0',
            points: ['0:0'],
            is_current: true,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'set_id, game_number' })
      }

      console.log(`[Simulator] Started match ${matchId}`)
      return res.json({ ok: true, action: 'start_match' })
    }

    if (action === 'point' || action === 'undo_point') {
      // Write complete state snapshot through the existing pipeline
      // The data object has the same shape as what handleLiveUpdate expects
      if (!data?.sets) {
        return res.status(400).json({ error: 'data.sets required for point/undo_point' })
      }

      // Write sets and games directly (same pattern as handleLiveUpdate)
      for (const set of data.sets) {
        const { data: setRow, error: setError } = await supabase
          .from('sets')
          .upsert({
            match_id: matchId,
            set_number: set.set_number,
            set_score: set.set_score,
            pair1_games: set.pair1_games,
            pair2_games: set.pair2_games,
            is_current: set.is_current ?? false,
            score_source: 'live',
            updated_at: new Date().toISOString(),
          }, { onConflict: 'match_id, set_number' })
          .select('id')
          .single()

        if (setError || !setRow) continue

        for (const game of set.games ?? []) {
          await supabase
            .from('games')
            .upsert({
              set_id: setRow.id,
              match_id: matchId,
              game_number: game.game_number,
              game_score: game.game_score,
              points: game.points ?? [],
              is_current: game.is_current ?? false,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'set_id, game_number' })
        }
      }

      // Update match status
      await supabase
        .from('matches')
        .update({
          status: data.status ?? 'live',
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchId)

      console.log(`[Simulator] ${action} on match ${matchId}`)
      return res.json({ ok: true, action })
    }

    if (action === 'finish_match') {
      // Write final state
      if (data?.sets) {
        for (const set of data.sets) {
          const { data: setRow } = await supabase
            .from('sets')
            .upsert({
              match_id: matchId,
              set_number: set.set_number,
              set_score: set.set_score,
              pair1_games: set.pair1_games,
              pair2_games: set.pair2_games,
              is_current: false,
              score_source: 'live',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'match_id, set_number' })
            .select('id')
            .single()

          if (!setRow) continue

          for (const game of set.games ?? []) {
            await supabase
              .from('games')
              .upsert({
                set_id: setRow.id,
                match_id: matchId,
                game_number: game.game_number,
                game_score: game.game_score,
                points: game.points ?? [],
                is_current: false,
                updated_at: new Date().toISOString(),
              }, { onConflict: 'set_id, game_number' })
          }
        }
      }

      // Run cleanup (same as real match finish)
      await cleanupMatchFinish(matchId)

      // Infer winner from sets
      const { data: sets } = await supabase
        .from('sets')
        .select('set_score, set_number')
        .eq('match_id', matchId)
        .not('set_score', 'is', null)
        .order('set_number')

      let p1Sets = 0, p2Sets = 0
      for (const s of sets ?? []) {
        if (!s.set_score) continue
        const parts = s.set_score.split('-')
        const a = parseInt(parts[0]) || 0
        const b = parseInt((parts[1]?.match(/^\d+/) ?? ['0'])[0]) || 0
        if (a > b) p1Sets++
        else p2Sets++
      }

      await supabase
        .from('matches')
        .update({
          status: 'finished',
          finished_at: new Date().toISOString(),
          winner_pair: p1Sets > p2Sets ? 1 : p2Sets > p1Sets ? 2 : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchId)

      console.log(`[Simulator] Finished match ${matchId} (${p1Sets}-${p2Sets} sets)`)
      return res.json({ ok: true, action: 'finish_match', winner: p1Sets > p2Sets ? 1 : 2 })
    }

    return res.status(400).json({ error: `Unknown action: ${action}` })
  } catch (err) {
    console.error(`[Simulator] Error:`, err)
    return res.status(500).json({ error: 'Internal error', message: err.message })
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add relay/index.js
git commit -m "feat: add POST /simulate endpoint to relay for referee scoring"
```

**Note:** This relay change needs to be deployed to Railway separately. The existing `handleLiveUpdate()` is not reused directly because the simulator sends pre-computed state snapshots (the scoring brain is in the browser). Instead, we follow the same DB write pattern (sets FIRST, then matches LAST).

---

### Task 4: Ops API Routes

**Files:**
- Create: `src/app/api/ops/simulator/create-tournament/route.ts`
- Create: `src/app/api/ops/simulator/tournaments/route.ts`
- Create: `src/app/api/ops/simulator/score/route.ts`
- Create: `src/app/api/ops/simulator/purge/route.ts`

All routes use the same auth pattern as existing ops routes (httpOnly `ops_token` cookie validated against `CRON_SECRET`).

- [ ] **Step 1: Create shared auth helper**

Since all 4 routes need the same auth check, extract it. But since the existing ops routes each define `checkOpsAuth` inline (no shared module), follow the same pattern — copy the auth function into each route. This avoids changing existing routes.

- [ ] **Step 2: Create `GET /api/ops/simulator/tournaments`**

```typescript
// src/app/api/ops/simulator/tournaments/route.ts
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  if (token !== cronSecret) return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  return null
}

export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const { data: tournaments, error } = await supabase
    .from('tournaments')
    .select('id, name, category, created_at')
    .eq('source', 'simulated')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Fetch match status counts for each tournament
  const enriched = await Promise.all((tournaments ?? []).map(async (t) => {
    const { data: matches } = await supabase
      .from('matches')
      .select('status')
      .eq('tournament_id', t.id)

    const statuses = (matches ?? []).map(m => m.status)
    return {
      ...t,
      matchCount: statuses.length,
      liveCount: statuses.filter(s => s === 'live').length,
      finishedCount: statuses.filter(s => s === 'finished').length,
      scheduledCount: statuses.filter(s => s === 'scheduled').length,
    }
  }))

  return Response.json({ tournaments: enriched })
}
```

- [ ] **Step 3: Create `POST /api/ops/simulator/create-tournament`**

```typescript
// src/app/api/ops/simulator/create-tournament/route.ts
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  if (token !== cronSecret) return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  return null
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json()
  const { name, category, matchCount, playerIds, round } = body

  if (!name || !category || !matchCount || !playerIds?.length) {
    return Response.json({ error: 'name, category, matchCount, and playerIds are required' }, { status: 400 })
  }

  const neededPlayers = matchCount * 4
  // Cycle through playerIds if not enough
  const players: string[] = []
  for (let i = 0; i < neededPlayers; i++) {
    players.push(playerIds[i % playerIds.length])
  }

  // Create tournament
  const now = new Date()
  const endsAt = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000)

  const { data: tournament, error: tErr } = await supabase
    .from('tournaments')
    .insert({
      name,
      category,
      source: 'simulated',
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      external_id: `sim_${Date.now()}`,
      level: 'simulated',
    })
    .select('id, name, category')
    .single()

  if (tErr) return Response.json({ error: tErr.message }, { status: 500 })

  // Create matches
  const matchInserts = []
  for (let i = 0; i < matchCount; i++) {
    const base = i * 4
    matchInserts.push({
      tournament_id: tournament.id,
      external_id: `sim_match_${Date.now()}_${i}`,
      status: 'scheduled',
      category,
      round: round || `Round of ${matchCount * 2}`,
      pair1_player1_id: players[base],
      pair1_player2_id: players[base + 1],
      pair2_player1_id: players[base + 2],
      pair2_player2_id: players[base + 3],
    })
  }

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .insert(matchInserts)
    .select('id, external_id, status, round, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')

  if (mErr) return Response.json({ error: mErr.message }, { status: 500 })

  return Response.json({ tournament, matches })
}
```

- [ ] **Step 4: Create `POST /api/ops/simulator/score`**

```typescript
// src/app/api/ops/simulator/score/route.ts
import { cookies } from 'next/headers'

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  if (token !== cronSecret) return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  return null
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json()
  const relayUrl = process.env.RELAY_URL
  const relaySecret = process.env.RELAY_SECRET

  if (!relayUrl || !relaySecret) {
    return Response.json({ error: 'RELAY_URL or RELAY_SECRET not configured' }, { status: 500 })
  }

  const res = await fetch(`${relayUrl}/simulate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${relaySecret}`,
    },
    body: JSON.stringify(body),
  })

  const data = await res.json()
  return Response.json(data, { status: res.status })
}
```

- [ ] **Step 5: Create `POST /api/ops/simulator/purge`**

```typescript
// src/app/api/ops/simulator/purge/route.ts
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: 'Unauthorized', reason: 'server_misconfigured' }, { status: 401 })
  if (token !== cronSecret) return Response.json({ error: 'Unauthorized', reason: 'token_mismatch' }, { status: 401 })
  return null
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body = await request.json()
  if (body.confirm !== 'PURGE') {
    return Response.json({ error: 'Must confirm with { "confirm": "PURGE" }' }, { status: 400 })
  }

  // Count what will be deleted
  const { count: tournamentCount } = await supabase
    .from('tournaments')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'simulated')

  const { data: simTournaments } = await supabase
    .from('tournaments')
    .select('id')
    .eq('source', 'simulated')

  const tournamentIds = (simTournaments ?? []).map(t => t.id)
  let matchCount = 0
  if (tournamentIds.length > 0) {
    const { count } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .in('tournament_id', tournamentIds)
    matchCount = count ?? 0
  }

  // Delete (cascades via FK: tournaments → matches → sets → games → match_ratings)
  const { error } = await supabase
    .from('tournaments')
    .delete()
    .eq('source', 'simulated')

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({
    deleted: {
      tournaments: tournamentCount ?? 0,
      matches: matchCount,
    },
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/ops/simulator/
git commit -m "feat: add 4 ops API routes for simulator (create, list, score proxy, purge)"
```

---

### Task 5: Simulator Tab — Tournament Setup & Match List

**Files:**
- Create: `src/app/ops/SimulatorTab.tsx`
- Modify: `src/app/ops/OpsClient.tsx` (add tab + import)

This task builds the top two sections of the Simulator tab: tournament selector/creator and the match list. The referee panel (Task 6) plugs in below.

- [ ] **Step 1: Add the Simulator tab to `OpsClient.tsx`**

In `src/app/ops/OpsClient.tsx`, make these changes:

1. Add import at top (after `EntryListTab` import):
```typescript
import SimulatorTab from './SimulatorTab'
```

2. Update the tab type (line ~229):
```typescript
const [tab, setTab] = useState<'health' | 'data' | 'entry-lists' | 'simulator'>('health')
```

3. Update the tab bar array (line ~357):
```typescript
{(['health', 'data', 'entry-lists', 'simulator'] as const).map(t => (
```

4. Update the tab label mapping (line ~373):
```typescript
{t === 'health' ? 'Integration Health' : t === 'data' ? 'Data' : t === 'entry-lists' ? 'Entry Lists' : 'Simulator'}
```

5. Add the tab content (after the `entry-lists` tab content, before the closing `</div>`):
```typescript
{tab === 'simulator' && <SimulatorTab />}
```

- [ ] **Step 2: Create `SimulatorTab.tsx` with tournament setup and match list**

```typescript
// src/app/ops/SimulatorTab.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────

interface SimTournament {
  id: string
  name: string
  category: string
  matchCount: number
  liveCount: number
  finishedCount: number
  scheduledCount: number
  createdAt: string
}

interface SimMatch {
  id: string
  external_id: string
  status: string
  round: string | null
  pair1_player1: { id: string; name: string; country: string | null } | null
  pair1_player2: { id: string; name: string; country: string | null } | null
  pair2_player1: { id: string; name: string; country: string | null } | null
  pair2_player2: { id: string; name: string; country: string | null } | null
  sets?: { set_number: number; set_score: string | null; pair1_games: number; pair2_games: number }[]
}

interface DbPlayer {
  id: string
  name: string
  country: string | null
  ranking: number | null
}

// ── Styles ───────────────────────────────────────────────────────

const card: React.CSSProperties = { background: 'white', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12 }
const sectionLabel: React.CSSProperties = { fontSize: 10, color: '#999', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }
const btnPrimary: React.CSSProperties = { background: '#22c55e', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const btnDanger: React.CSSProperties = { background: '#ef4444', color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }
const btnSecondary: React.CSSProperties = { background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', padding: '6px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer' }

// ── Component ────────────────────────────────────────────────────

export default function SimulatorTab() {
  const [tournaments, setTournaments] = useState<SimTournament[]>([])
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null)
  const [matches, setMatches] = useState<SimMatch[]>([])
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New tournament form
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<'men' | 'women'>('men')
  const [newMatchCount, setNewMatchCount] = useState(4)
  const [newRound, setNewRound] = useState('Round of 16')

  // Player picker
  const [availablePlayers, setAvailablePlayers] = useState<DbPlayer[]>([])
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([])
  const [playerSearch, setPlayerSearch] = useState('')

  // Purge modal
  const [showPurge, setShowPurge] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState('')

  // ── Fetch tournaments ──────────────────────────────────────────

  const fetchTournaments = useCallback(async () => {
    try {
      const res = await fetch('/api/ops/simulator/tournaments')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setTournaments(data.tournaments ?? [])
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { fetchTournaments() }, [fetchTournaments])

  // ── Fetch matches for selected tournament ──────────────────────

  const fetchMatches = useCallback(async (tournamentId: string) => {
    try {
      const res = await fetch(`/api/ops/simulator/tournaments?id=${tournamentId}`)
      if (!res.ok) throw new Error('Failed to fetch matches')
      const data = await res.json()
      setMatches(data.matches ?? [])
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    if (selectedTournamentId) fetchMatches(selectedTournamentId)
  }, [selectedTournamentId, fetchMatches])

  // ── Fetch players for picker ───────────────────────────────────

  const fetchPlayers = useCallback(async (category: string) => {
    try {
      const res = await fetch(`/api/ops/simulator/tournaments?players=${category}`)
      if (!res.ok) return
      const data = await res.json()
      setAvailablePlayers(data.players ?? [])
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    if (showNewForm) fetchPlayers(newCategory)
  }, [showNewForm, newCategory, fetchPlayers])

  // ── Create tournament ──────────────────────────────────────────

  const createTournament = async () => {
    if (!newName || selectedPlayerIds.length < newMatchCount * 4) {
      setError(`Need at least ${newMatchCount * 4} players (have ${selectedPlayerIds.length})`)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ops/simulator/create-tournament', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          category: newCategory,
          matchCount: newMatchCount,
          playerIds: selectedPlayerIds,
          round: newRound,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const data = await res.json()
      setShowNewForm(false)
      setSelectedTournamentId(data.tournament.id)
      setNewName('')
      setSelectedPlayerIds([])
      await fetchTournaments()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Start match ────────────────────────────────────────────────

  const startMatch = async (matchId: string) => {
    setLoading(true)
    try {
      const res = await fetch('/api/ops/simulator/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start_match', matchId }),
      })
      if (!res.ok) throw new Error('Failed to start')
      setActiveMatchId(matchId)
      if (selectedTournamentId) await fetchMatches(selectedTournamentId)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Purge ──────────────────────────────────────────────────────

  const purge = async () => {
    if (purgeConfirm !== 'PURGE') return
    setLoading(true)
    try {
      const res = await fetch('/api/ops/simulator/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'PURGE' }),
      })
      if (!res.ok) throw new Error('Purge failed')
      const data = await res.json()
      setShowPurge(false)
      setPurgeConfirm('')
      setSelectedTournamentId(null)
      setMatches([])
      setActiveMatchId(null)
      await fetchTournaments()
      setError(`Purged ${data.deleted.tournaments} tournaments, ${data.deleted.matches} matches`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Player toggle ──────────────────────────────────────────────

  const togglePlayer = (id: string) => {
    setSelectedPlayerIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    )
  }

  const filteredPlayers = availablePlayers.filter(p =>
    p.name.toLowerCase().includes(playerSearch.toLowerCase())
  )

  // ── Helpers ────────────────────────────────────────────────────

  const pairLabel = (m: SimMatch, pair: 1 | 2) => {
    const p1 = pair === 1 ? m.pair1_player1 : m.pair2_player1
    const p2 = pair === 1 ? m.pair1_player2 : m.pair2_player2
    const name1 = p1?.name?.split(' ').pop() ?? '?'
    const name2 = p2?.name?.split(' ').pop() ?? '?'
    return `${name1} / ${name2}`
  }

  const scoreLabel = (m: SimMatch) => {
    if (!m.sets?.length) return ''
    return m.sets
      .filter(s => s.set_score)
      .map(s => s.set_score)
      .join(' ')
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div>
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#dc2626' }}>
          {error}
          <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>×</button>
        </div>
      )}

      {/* Tournament Setup */}
      <div style={sectionLabel}>Simulated Tournaments</div>
      <div style={{ ...card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: showNewForm ? 16 : 0 }}>
          <select
            value={selectedTournamentId ?? ''}
            onChange={e => setSelectedTournamentId(e.target.value || null)}
            style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
          >
            <option value="">Select tournament...</option>
            {tournaments.map(t => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.matchCount} matches — {t.liveCount} live, {t.finishedCount} done)
              </option>
            ))}
          </select>
          <button style={btnPrimary} onClick={() => setShowNewForm(!showNewForm)}>+ New</button>
          <button style={btnDanger} onClick={() => setShowPurge(true)} disabled={tournaments.length === 0}>Purge All</button>
        </div>

        {/* New Tournament Form */}
        {showNewForm && (
          <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: '#999', fontWeight: 600, display: 'block', marginBottom: 4 }}>Name</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Test Tournament — Apr 2026"
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#999', fontWeight: 600, display: 'block', marginBottom: 4 }}>Round</label>
                <input
                  value={newRound}
                  onChange={e => setNewRound(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: '#999', fontWeight: 600, display: 'block', marginBottom: 4 }}>Category</label>
                <select
                  value={newCategory}
                  onChange={e => setNewCategory(e.target.value as 'men' | 'women')}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
                >
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#999', fontWeight: 600, display: 'block', marginBottom: 4 }}>Matches</label>
                <select
                  value={newMatchCount}
                  onChange={e => setNewMatchCount(Number(e.target.value))}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
                >
                  <option value={4}>4</option>
                  <option value={8}>8</option>
                  <option value={16}>16</option>
                </select>
              </div>
            </div>

            {/* Player Picker */}
            <label style={{ fontSize: 10, color: '#999', fontWeight: 600, display: 'block', marginBottom: 4 }}>
              Players ({selectedPlayerIds.length} / {newMatchCount * 4} needed)
            </label>
            <input
              value={playerSearch}
              onChange={e => setPlayerSearch(e.target.value)}
              placeholder="Search players..."
              style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12, marginBottom: 8 }}
            />
            <div style={{ maxHeight: 200, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 6 }}>
              {filteredPlayers.slice(0, 50).map(p => (
                <div
                  key={p.id}
                  onClick={() => togglePlayer(p.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    cursor: 'pointer', fontSize: 12,
                    background: selectedPlayerIds.includes(p.id) ? '#dcfce7' : 'transparent',
                    borderBottom: '1px solid #f3f4f6',
                  }}
                >
                  <span style={{ width: 16, textAlign: 'center' }}>{selectedPlayerIds.includes(p.id) ? '✓' : ''}</span>
                  <span style={{ flex: 1 }}>{p.name}</span>
                  <span style={{ fontSize: 10, color: '#999' }}>{p.country ?? ''}</span>
                  {p.ranking && <span style={{ fontSize: 10, color: '#6b7280' }}>#{p.ranking}</span>}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button style={btnSecondary} onClick={() => setShowNewForm(false)}>Cancel</button>
              <button
                style={{ ...btnPrimary, opacity: loading ? 0.5 : 1 }}
                onClick={createTournament}
                disabled={loading}
              >
                {loading ? 'Creating...' : 'Create Tournament'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Match List */}
      {selectedTournamentId && (
        <>
          <div style={sectionLabel}>Matches</div>
          <div style={{ ...card, marginBottom: 16, padding: 0 }}>
            {matches.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#999', fontSize: 12 }}>Loading matches...</div>
            )}
            {matches.map(m => (
              <div
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  borderBottom: '1px solid #f3f4f6',
                  background: activeMatchId === m.id ? 'rgba(34,197,94,0.06)' : 'transparent',
                  cursor: m.status === 'live' ? 'pointer' : undefined,
                }}
                onClick={() => m.status === 'live' && setActiveMatchId(m.id)}
              >
                <div style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: m.status === 'live' ? '#22c55e' : m.status === 'finished' ? '#9ca3af' : '#d1d5db',
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: m.status === 'finished' ? '#999' : '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {pairLabel(m, 1)} vs {pairLabel(m, 2)}
                  </div>
                </div>
                {m.status === 'scheduled' && (
                  <button style={{ ...btnPrimary, padding: '3px 10px', fontSize: 10 }} onClick={() => startMatch(m.id)}>Start</button>
                )}
                {m.status === 'live' && activeMatchId === m.id && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e' }}>SCORING</span>
                )}
                {m.status === 'live' && activeMatchId !== m.id && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#f59e0b' }}>LIVE</span>
                )}
                {m.status === 'finished' && (
                  <span style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>{scoreLabel(m)}</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Referee Panel placeholder — Task 6 */}
      {activeMatchId && (
        <RefereePanel
          matchId={activeMatchId}
          match={matches.find(m => m.id === activeMatchId) ?? null}
          onUpdate={() => selectedTournamentId && fetchMatches(selectedTournamentId)}
          onFinish={() => {
            setActiveMatchId(null)
            if (selectedTournamentId) fetchMatches(selectedTournamentId)
          }}
        />
      )}

      {/* Purge Modal */}
      {showPurge && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
          <div style={{ background: 'white', borderRadius: 8, padding: 20, maxWidth: 360, width: '90%' }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>Purge All Simulated Data</div>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
              This will delete {tournaments.reduce((s, t) => s + t.matchCount, 0)} matches across {tournaments.length} simulated tournaments. Type PURGE to confirm.
            </p>
            <input
              value={purgeConfirm}
              onChange={e => setPurgeConfirm(e.target.value)}
              placeholder="Type PURGE"
              style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 13, marginBottom: 12 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={btnSecondary} onClick={() => { setShowPurge(false); setPurgeConfirm('') }}>Cancel</button>
              <button
                style={{ ...btnDanger, opacity: purgeConfirm === 'PURGE' ? 1 : 0.4 }}
                onClick={purge}
                disabled={purgeConfirm !== 'PURGE' || loading}
              >
                {loading ? 'Purging...' : 'Purge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

Note: The `RefereePanel` component is defined in this same file in Task 6. For now, add a stub at the bottom:

```typescript
// Stub — replaced in Task 6
function RefereePanel({ matchId, match, onUpdate, onFinish }: {
  matchId: string
  match: SimMatch | null
  onUpdate: () => void
  onFinish: () => void
}) {
  return <div style={{ ...card, textAlign: 'center', color: '#999', fontSize: 12 }}>Referee panel loading...</div>
}
```

- [ ] **Step 3: Update the tournaments GET route to also return matches and players**

The `SimulatorTab` needs two additional queries from the tournaments route. Update `src/app/api/ops/simulator/tournaments/route.ts` to handle query params:

```typescript
// Add to the GET handler, after the auth check:

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)

  // Return players for the picker
  const playersCategory = url.searchParams.get('players')
  if (playersCategory) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, country, ranking')
      .eq('category', playersCategory)
      .not('name', 'is', null)
      .order('ranking', { ascending: true, nullsFirst: false })
      .limit(200)

    return Response.json({ players: players ?? [] })
  }

  // Return matches for a specific tournament
  const tournamentId = url.searchParams.get('id')
  if (tournamentId) {
    const { data: matches } = await supabase
      .from('matches')
      .select(`
        id, external_id, status, round,
        pair1_player1:pair1_player1_id(id, name, country),
        pair1_player2:pair1_player2_id(id, name, country),
        pair2_player1:pair2_player1_id(id, name, country),
        pair2_player2:pair2_player2_id(id, name, country),
        sets(set_number, set_score, pair1_games, pair2_games)
      `)
      .eq('tournament_id', tournamentId)
      .order('created_at')

    return Response.json({ matches: matches ?? [] })
  }

  // Default: list tournaments
  const { data: tournaments, error } = await supabase
    .from('tournaments')
    .select('id, name, category, created_at')
    .eq('source', 'simulated')
    .order('created_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const enriched = await Promise.all((tournaments ?? []).map(async (t) => {
    const { data: matches } = await supabase
      .from('matches')
      .select('status')
      .eq('tournament_id', t.id)

    const statuses = (matches ?? []).map(m => m.status)
    return {
      ...t,
      matchCount: statuses.length,
      liveCount: statuses.filter(s => s === 'live').length,
      finishedCount: statuses.filter(s => s === 'finished').length,
      scheduledCount: statuses.filter(s => s === 'scheduled').length,
    }
  }))

  return Response.json({ tournaments: enriched })
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/ops/SimulatorTab.tsx src/app/ops/OpsClient.tsx src/app/api/ops/simulator/
git commit -m "feat: add Simulator tab to ops dashboard with tournament setup and match list"
```

---

### Task 6: Referee Scoring Panel

**Files:**
- Modify: `src/app/ops/SimulatorTab.tsx` (replace RefereePanel stub)

This is the bottom section of the Simulator tab — the live scoring interface with point buttons, scoreboard, quick game, and undo.

- [ ] **Step 1: Replace the `RefereePanel` stub with the full implementation**

Replace the stub `RefereePanel` function at the bottom of `SimulatorTab.tsx` with:

```typescript
// ── Referee Panel ────────────────────────────────────────────────

import {
  createInitialState,
  addPoint,
  undoPoint,
  quickGame,
  stateToRelayPayload,
  stateToDbFormat,
  type MatchState,
} from '@/lib/padel-scoring'

function RefereePanel({ matchId, match, onUpdate, onFinish }: {
  matchId: string
  match: SimMatch | null
  onUpdate: () => void
  onFinish: () => void
}) {
  const [matchState, setMatchState] = useState<MatchState>(createInitialState)
  const [history, setHistory] = useState<MatchState[]>([])
  const [sending, setSending] = useState(false)
  const [lastAction, setLastAction] = useState<string | null>(null)

  // Send score to relay via proxy
  const sendScore = async (action: string, state: MatchState) => {
    setSending(true)
    try {
      const payload = stateToRelayPayload(state, matchId, match?.external_id ?? '', action as any)
      const res = await fetch('/api/ops/simulator/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Failed to send score')
      setLastAction(action)
      onUpdate()
    } catch (e: any) {
      console.error('Score send failed:', e)
    } finally {
      setSending(false)
    }
  }

  // Point handlers
  const handlePoint = async (pair: 1 | 2) => {
    const prev = JSON.parse(JSON.stringify(matchState))
    const next = addPoint(matchState, pair)
    setHistory([...history, prev])
    setMatchState(next)

    if (next.status === 'finished') {
      await sendScore('finish_match', next)
      onFinish()
    } else {
      await sendScore('point', next)
    }
  }

  const handleUndo = async () => {
    const result = undoPoint(matchState, history)
    setMatchState(result.state)
    setHistory(result.history)
    await sendScore('undo_point', result.state)
  }

  const handleQuickGame = async (pair: 1 | 2) => {
    const result = quickGame(matchState, pair)
    setHistory([...history, ...result.history])
    setMatchState(result.state)

    if (result.state.status === 'finished') {
      await sendScore('finish_match', result.state)
      onFinish()
    } else {
      await sendScore('point', result.state)
    }
  }

  const handleFinish = async () => {
    await sendScore('finish_match', matchState)
    onFinish()
  }

  // Current state helpers
  const currentSet = matchState.sets[matchState.currentSet - 1]
  const currentGame = currentSet?.games[matchState.currentGame - 1]

  const pair1Label = match ? pairLabelFromMatch(match, 1) : 'Pair 1'
  const pair2Label = match ? pairLabelFromMatch(match, 2) : 'Pair 2'

  return (
    <div>
      <div style={sectionLabel}>Referee Panel</div>
      <div style={{ ...card, padding: 0 }}>
        {/* Status bar */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', textAlign: 'center' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '1px' }}>
            LIVE — Set {matchState.currentSet} · Game {matchState.currentGame}
            {currentSet?.isTiebreak ? ' (Tiebreak)' : ''}
          </span>
        </div>

        {/* Scoreboard */}
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: 16 }}>
            {/* Pair 1 */}
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>Pair 1</div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>{pair1Label}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                {matchState.sets.map((set, i) => (
                  <div key={i} style={{ background: '#f3f4f6', padding: '4px 10px', borderRadius: 4, textAlign: 'center' }}>
                    <div style={{ fontSize: 8, color: '#999' }}>S{set.setNumber}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: set.winner === 1 ? '#f59e0b' : '#333', fontFamily: 'monospace' }}>
                      {set.pair1Games}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Current Points */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 8, color: '#999', marginBottom: 4 }}>PTS</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#dc2626', fontFamily: 'monospace', lineHeight: 1 }}>
                {currentGame?.pair1Points ?? '0'}
              </div>
              <div style={{ fontSize: 10, color: '#ccc', margin: '2px 0' }}>—</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#dc2626', fontFamily: 'monospace', lineHeight: 1 }}>
                {currentGame?.pair2Points ?? '0'}
              </div>
            </div>

            {/* Pair 2 */}
            <div style={{ textAlign: 'center', flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#14b8a6', marginBottom: 4 }}>Pair 2</div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>{pair2Label}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                {matchState.sets.map((set, i) => (
                  <div key={i} style={{ background: '#f3f4f6', padding: '4px 10px', borderRadius: 4, textAlign: 'center' }}>
                    <div style={{ fontSize: 8, color: '#999' }}>S{set.setNumber}</div>
                    <div style={{ fontSize: 16, fontWeight: 900, color: set.winner === 2 ? '#14b8a6' : '#333', fontFamily: 'monospace' }}>
                      {set.pair2Games}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Point history breadcrumb */}
          {currentGame && currentGame.points.length > 1 && (
            <div style={{ fontSize: 10, color: '#999', textAlign: 'center', marginBottom: 12, fontFamily: 'monospace' }}>
              {currentGame.points.slice(-8).join(' → ')}
            </div>
          )}

          {/* Scoring Buttons */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            <button
              onClick={() => handlePoint(1)}
              disabled={sending || matchState.status === 'finished'}
              style={{
                flex: 1, padding: 20, background: 'rgba(245,158,11,0.1)', border: '2px solid rgba(245,158,11,0.3)',
                borderRadius: 8, cursor: 'pointer', textAlign: 'center', opacity: sending ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b' }}>POINT</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#f59e0b' }}>Pair 1</div>
            </button>
            <button
              onClick={() => handlePoint(2)}
              disabled={sending || matchState.status === 'finished'}
              style={{
                flex: 1, padding: 20, background: 'rgba(20,184,166,0.1)', border: '2px solid rgba(20,184,166,0.3)',
                borderRadius: 8, cursor: 'pointer', textAlign: 'center', opacity: sending ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, color: '#14b8a6' }}>POINT</div>
              <div style={{ fontSize: 16, fontWeight: 900, color: '#14b8a6' }}>Pair 2</div>
            </button>
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleQuickGame(1)}
              disabled={sending || matchState.status === 'finished'}
              style={{
                flex: 1, padding: 8, background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: 6, cursor: 'pointer', fontSize: 10, color: '#f59e0b', fontWeight: 600,
              }}
            >
              Quick Game P1
            </button>
            <button
              onClick={() => handleQuickGame(2)}
              disabled={sending || matchState.status === 'finished'}
              style={{
                flex: 1, padding: 8, background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.2)',
                borderRadius: 6, cursor: 'pointer', fontSize: 10, color: '#14b8a6', fontWeight: 600,
              }}
            >
              Quick Game P2
            </button>
            <button
              onClick={handleUndo}
              disabled={sending || history.length === 0}
              style={{
                flex: 1, padding: 8, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 6, cursor: 'pointer', fontSize: 10, color: '#ef4444', fontWeight: 600,
                opacity: history.length === 0 ? 0.3 : 1,
              }}
            >
              Undo Last
            </button>
          </div>

          {/* Finish Match button — only when match could end */}
          {matchState.status === 'live' && (() => {
            const setsWon1 = matchState.sets.filter(s => s.winner === 1).length
            const setsWon2 = matchState.sets.filter(s => s.winner === 2).length
            if (setsWon1 >= 1 || setsWon2 >= 1) {
              return (
                <button
                  onClick={handleFinish}
                  disabled={sending}
                  style={{
                    width: '100%', marginTop: 12, padding: 10, background: '#dc2626', color: '#fff',
                    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  Finish Match
                </button>
              )
            }
            return null
          })()}

          {/* Status indicator */}
          {sending && (
            <div style={{ textAlign: 'center', fontSize: 10, color: '#999', marginTop: 8 }}>Sending to relay...</div>
          )}
          {lastAction && !sending && (
            <div style={{ textAlign: 'center', fontSize: 10, color: '#22c55e', marginTop: 8 }}>✓ {lastAction}</div>
          )}
        </div>
      </div>
    </div>
  )
}

// Helper used by RefereePanel (can't use the closure `pairLabel` from parent)
function pairLabelFromMatch(m: SimMatch, pair: 1 | 2): string {
  const p1 = pair === 1 ? m.pair1_player1 : m.pair2_player1
  const p2 = pair === 1 ? m.pair1_player2 : m.pair2_player2
  const name1 = p1?.name?.split(' ').pop() ?? '?'
  const name2 = p2?.name?.split(' ').pop() ?? '?'
  return `${name1} / ${name2}`
}
```

**Important:** Move the `import` for the scoring engine to the top of `SimulatorTab.tsx` (with the other imports):

```typescript
import {
  createInitialState,
  addPoint,
  undoPoint,
  quickGame,
  stateToRelayPayload,
  type MatchState,
} from '@/lib/padel-scoring'
```

And remove the duplicate import inside the `RefereePanel` function.

- [ ] **Step 2: Verify the build compiles**

Run: `export PATH="/usr/local/bin:$PATH" && npx next build 2>&1 | tail -20`
Expected: Build succeeds (or only pre-existing warnings)

- [ ] **Step 3: Commit**

```bash
git add src/app/ops/SimulatorTab.tsx
git commit -m "feat: add referee scoring panel with live scoreboard, point buttons, quick game, undo"
```

---

### Task 7: Integration Testing & Verification

**Files:** None (testing only)

- [ ] **Step 1: Run scoring engine tests**

Run: `export PATH="/usr/local/bin:$PATH" && npx vitest run src/lib/__tests__/padel-scoring.test.ts`
Expected: All tests pass

- [ ] **Step 2: Run full build**

Run: `export PATH="/usr/local/bin:$PATH" && npx next build 2>&1 | tail -30`
Expected: Build succeeds

- [ ] **Step 3: Verify in preview (after user applies migration and deploys relay)**

1. Open ops dashboard → Simulator tab
2. Create new tournament with 4 matches, select men's players
3. Start a match → referee panel appears
4. Score a few points → verify scoreboard updates
5. Use Quick Game → verify game completes
6. Use Undo → verify previous state restored
7. Open the match in the main app → verify live scores appear
8. Finish the match → verify final score in match list
9. Purge → verify all simulated data removed

- [ ] **Step 4: Final commit with any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for tournament simulator"
```
