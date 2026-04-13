# Point-by-Point Backfill on Match Finish — Design Spec

**Date:** 2026-04-13
**Status:** Approved for implementation

## Overview

When a match with PBP coverage finishes, automatically backfill any missing games and points from the padelapi.org live endpoint. This ensures the Match Journey chart and Live Feed always show complete data, even when the relay lost connection mid-match.

## Problem

The Pusher relay can lose connection mid-match, causing:
- Missing games (e.g. Set 2 has 0 games in DB despite 8 in the API)
- Missing points (games with `points: []` despite the API having full data)
- Match Journey shows incomplete bars or empty chart
- Live Feed shows "Waiting for first point" for games that actually have data

The padelapi.org live endpoint (`/api/matches/{id}/live`) retains full point-by-point data for all games even after the match finishes — this is the recovery source.

## Solution

Add a `backfillPointData` step that runs once when a match transitions to `finished`. It fetches the live endpoint and fills any gaps in games and points.

### When it runs

In the scores cron, after `cleanupMatchFinish` completes — only for matches where:
1. Source is `padelapi` (has PBP tracking) — checked via `match.padelapi_id IS NOT NULL` or `match.external_id IS NOT NULL`
2. Coverage is NOT `'full'` — no need to backfill if we already have everything

### What it does

```
1. Fetch /api/matches/{externalId}/live
2. For each set in the API response:
   a. Find or create the set row in DB
   b. For each game in the set:
      - If game doesn't exist in DB → insert it with full points
      - If game exists but DB points array is shorter than API → update with API's longer array
      - If game exists and DB points are equal or longer → skip (DB already has better data)
3. Recompute coverage after backfill
```

### Points merge strategy

Same "keep longer array" rule already used by the resync endpoint:
```typescript
const mergedPoints = existingPoints.length >= apiPoints.length 
  ? existingPoints   // DB already has more/equal data
  : apiPoints        // API has more data — use it
```

### API budget

1 extra API call per match at finish time. With ~20-30 matches per tournament day, this adds ~30 calls/day — well within the 2,000/day budget.

## Integration point

In `src/app/api/cron/scores/route.ts`, the call chain when a match finishes:

```
upsertMatch (status = finished)
  → writeFinalState (writes sets from detail endpoint)
  → cleanupMatchFinish (clears is_current, computes coverage, infers winner)
  → NEW: backfillPointData (fetches live endpoint, fills game/point gaps)
```

Also runs from the reconciliation path when `ended` matches are repaired.

## Function signature

```typescript
async function backfillPointData(
  matchDbId: string, 
  externalId: string
): Promise<{ gamesAdded: number; pointsUpdated: number }>
```

### Logic

```typescript
async function backfillPointData(matchDbId, externalId) {
  // Check if match has PBP coverage source
  const { data: match } = await supabase
    .from('matches')
    .select('coverage, padelapi_id, external_id')
    .eq('id', matchDbId)
    .single()
  
  if (!match) return { gamesAdded: 0, pointsUpdated: 0 }
  if (match.coverage === 'full') return { gamesAdded: 0, pointsUpdated: 0 }
  if (!match.padelapi_id && !match.external_id) return { gamesAdded: 0, pointsUpdated: 0 }
  
  // Fetch live endpoint
  if (isRateLimited()) return { gamesAdded: 0, pointsUpdated: 0 }
  const liveState = await fetchMatchLiveState(Number(externalId))
  if (!liveState?.sets) return { gamesAdded: 0, pointsUpdated: 0 }
  
  let gamesAdded = 0
  let pointsUpdated = 0
  
  for (const apiSet of liveState.sets) {
    // Find matching set row in DB
    const { data: dbSet } = await supabase
      .from('sets')
      .select('id')
      .eq('match_id', matchDbId)
      .eq('set_number', apiSet.set_number)
      .single()
    
    if (!dbSet) continue  // Set doesn't exist — writeFinalState should have created it
    
    for (const apiGame of apiSet.games) {
      const apiPoints = apiGame.points ?? []
      
      // Check if game exists in DB
      const { data: dbGame } = await supabase
        .from('games')
        .select('id, points')
        .eq('set_id', dbSet.id)
        .eq('game_number', apiGame.game_number)
        .maybeSingle()
      
      if (!dbGame) {
        // Game missing entirely — insert it
        await supabase.from('games').insert({
          set_id: dbSet.id,
          match_id: matchDbId,
          game_number: apiGame.game_number,
          game_score: apiGame.game_score,
          points: apiPoints,
          is_current: false,
        })
        gamesAdded++
      } else {
        // Game exists — check if API has more points
        const dbPoints = (dbGame.points as string[]) ?? []
        if (apiPoints.length > dbPoints.length) {
          await supabase
            .from('games')
            .update({ points: apiPoints, game_score: apiGame.game_score })
            .eq('id', dbGame.id)
          pointsUpdated++
        }
      }
    }
  }
  
  // Recompute coverage after backfill
  if (gamesAdded > 0 || pointsUpdated > 0) {
    // Coverage recomputation is already done in cleanupMatchFinish
    // but we may need to re-run it after backfill
    console.log(`[Backfill] Match ${externalId}: +${gamesAdded} games, ${pointsUpdated} points updated`)
  }
  
  return { gamesAdded, pointsUpdated }
}
```

## Scope

### In scope
- `backfillPointData` function in scores cron
- Called after `cleanupMatchFinish` for finished matches with PBP source
- Fills missing games and updates shorter points arrays
- Recomputes coverage after backfill

### Out of scope
- Backfilling non-PBP matches (FIP-only tournaments)
- On-demand backfill from the UI
- Periodic batch backfill cron
- Backfilling historical matches (only new finishes)
