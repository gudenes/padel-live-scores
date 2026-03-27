/**
 * score-inference.ts
 * 
 * Final Score Inference Rule — Pure domain logic
 * 
 * When a match is marked `finished`, but the last set's score is incomplete,
 * this module infers the final result by reading the last recorded point
 * and awarding the game to the winner.
 * 
 * Design principles:
 * - Idempotent: safe to call multiple times on the same match
 * - Never creates rows: only UPDATES existing set rows (prevents orphan sets)
 * - Yields to authority: never overwrites scores with source = 'api'
 * - Defensive: returns null when data is insufficient — never guesses
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScoreSource = 'api' | 'inferred' | 'live'
export type GameWinner = 1 | 2 | null

export interface InferenceResult {
  matchId: string
  action: 'inferred' | 'skipped' | 'already_complete' | 'no_data' | 'invalid_status'
  detail: string
  setNumber?: number
  inferredScore?: string
  gameWinner?: GameWinner
}

interface SetRow {
  id: string
  match_id: string
  set_number: number
  set_score: string | null
  is_current: boolean
  score_source: ScoreSource | null
}

interface GameRow {
  id: string
  set_id: string
  game_number: number
  game_score: string | null
  is_current: boolean
  points: string[] | null
}

interface MatchRow {
  id: string
  external_id: number | null
  status: string
  winner_pair: number | null
}

// ---------------------------------------------------------------------------
// Tennis/Padel scoring constants
// ---------------------------------------------------------------------------

/** Standard game point hierarchy — higher index = higher value */
const STANDARD_POINTS: Record<string, number> = {
  '0': 0,
  '15': 1,
  '30': 2,
  '40': 3,
  'A': 4,
}

/** Statuses that are eligible for score inference */
const INFERABLE_STATUSES = ['finished'] as const

/** Statuses where inference must NOT run */
const SKIP_STATUSES = [
  'live', 'scheduled', 'warmup', 'suspended',
  'retired', 'walkover', 'bye', 'cancelled', 'incomplete',
  'ended',  // transitional — wait for 'finished'
] as const

// ---------------------------------------------------------------------------
// Pure functions (no DB access — fully testable)
// ---------------------------------------------------------------------------

/**
 * Determine which team won a game based on the last recorded point.
 * 
 * @param points  Array of point strings, e.g. ["0:0","15:0","30:0","40:0"]
 * @param isTiebreak  Whether the game is a tiebreak (numeric scoring)
 * @returns 1 (team_1 won), 2 (team_2 won), or null (cannot determine)
 */
export function determineGameWinner(
  points: string[],
  isTiebreak: boolean
): GameWinner {
  // Filter out "0:0" phantom points (tracking artifacts, not real scores)
  const realPoints = points.filter(p => p !== '0:0')

  if (realPoints.length === 0) return null

  const lastPoint = realPoints[realPoints.length - 1]
  const parts = lastPoint.split(':')
  if (parts.length !== 2) return null

  const [raw1, raw2] = parts

  if (isTiebreak) {
    // Tiebreak: simple numeric comparison
    const val1 = parseInt(raw1, 10)
    const val2 = parseInt(raw2, 10)
    if (isNaN(val1) || isNaN(val2)) return null
    if (val1 === val2) return null
    return val1 > val2 ? 1 : 2
  }

  // Standard scoring: use point hierarchy
  const val1 = STANDARD_POINTS[raw1]
  const val2 = STANDARD_POINTS[raw2]

  if (val1 === undefined || val2 === undefined) {
    // Unknown point value — might be a tiebreak we didn't detect
    // Try numeric fallback
    const num1 = parseInt(raw1, 10)
    const num2 = parseInt(raw2, 10)
    if (!isNaN(num1) && !isNaN(num2) && num1 !== num2) {
      return num1 > num2 ? 1 : 2
    }
    return null
  }

  if (val1 === val2) return null
  return val1 > val2 ? 1 : 2
}

/**
 * Detect whether a game is a tiebreak based on game score context.
 * 
 * A tiebreak occurs when both teams are at 6 games in the set.
 * We detect this from the game_score of the last completed game
 * or the current game count.
 */
export function isTiebreakGame(
  team1Games: number,
  team2Games: number
): boolean {
  return team1Games === 6 && team2Games === 6
}

/**
 * Calculate the new set score after awarding one game to the winner.
 * 
 * @param team1Games  Current game count for team 1 in this set
 * @param team2Games  Current game count for team 2 in this set
 * @param gameWinner  1 or 2
 * @returns The formatted set score string, e.g. "6-4", "7-6", or null if invalid
 */
export function calculateSetScore(
  team1Games: number,
  team2Games: number,
  gameWinner: 1 | 2,
): string | null {
  const newTeam1 = gameWinner === 1 ? team1Games + 1 : team1Games
  const newTeam2 = gameWinner === 2 ? team2Games + 1 : team2Games

  // Validate the resulting score makes sense for padel/tennis
  const winnerGames = Math.max(newTeam1, newTeam2)
  const loserGames = Math.min(newTeam1, newTeam2)

  // Winner must have 6 or 7 games
  if (winnerGames < 6 || winnerGames > 7) return null

  // If winner has 6, loser must have 0-4 (2-game lead required)
  if (winnerGames === 6 && loserGames > 4) return null

  // If winner has 7, loser must have 5 (7-5) or 6 (7-6 tiebreak)
  if (winnerGames === 7 && loserGames !== 5 && loserGames !== 6) return null

  return `${newTeam1}-${newTeam2}`
}

/**
 * Parse a game_score string like "5 - 4" or "5-4" into team counts.
 * Returns null if unparseable.
 */
export function parseGameScore(gameScore: string | null): { team1: number; team2: number } | null {
  if (!gameScore) return null
  
  // Handle formats: "5 - 4", "5-4", "5 -4", etc.
  const cleaned = gameScore.replace(/\s/g, '')
  const parts = cleaned.split('-')
  if (parts.length !== 2) return null

  const team1 = parseInt(parts[0], 10)
  const team2 = parseInt(parts[1], 10)
  if (isNaN(team1) || isNaN(team2)) return null

  return { team1, team2 }
}

/**
 * Validate that a set score string is valid according to padel rules.
 */
export function isValidSetScore(score: string): boolean {
  // Match formats: "6-3", "7-6", "7-6(4)", reversed like "3-6"
  const match = score.match(/^(\d+)-(\d+)(?:\((\d+)\))?$/)
  if (!match) return false

  const s1 = parseInt(match[1], 10)
  const s2 = parseInt(match[2], 10)
  const winner = Math.max(s1, s2)
  const loser = Math.min(s1, s2)

  if (winner === 6 && loser <= 4) return true
  if (winner === 7 && (loser === 5 || loser === 6)) return true

  return false
}

// ---------------------------------------------------------------------------
// Database-aware functions
// ---------------------------------------------------------------------------

/**
 * Main entry point: infer the final score for a finished match.
 * 
 * Reads the last set with null score, examines the last game's points,
 * and derives the set score. Only updates — never inserts.
 * 
 * @param supabase  Supabase client (service role for writes)
 * @param matchId   The match UUID (internal DB id)
 * @returns InferenceResult describing what happened
 */
export async function inferFinalScore(
  supabase: SupabaseClient,
  matchId: string,
): Promise<InferenceResult> {

  // 1. Fetch the match and validate status
  const { data: match, error: matchErr } = await supabase
    .from('matches')
    .select('id, external_id, status, winner_pair')
    .eq('id', matchId)
    .single()

  if (matchErr || !match) {
    return { matchId, action: 'skipped', detail: `Match not found: ${matchErr?.message}` }
  }

  if (!INFERABLE_STATUSES.includes(match.status as any)) {
    return {
      matchId,
      action: 'invalid_status',
      detail: `Status "${match.status}" is not eligible for inference`,
    }
  }

  // 2. Find the last set that needs inference
  //    - set_score IS NULL
  //    - score_source is NOT 'api' (don't override authoritative data)
  const { data: sets, error: setsErr } = await supabase
    .from('sets')
    .select('id, match_id, set_number, set_score, is_current, score_source')
    .eq('match_id', matchId)
    .order('set_number', { ascending: false })

  if (setsErr || !sets || sets.length === 0) {
    return { matchId, action: 'no_data', detail: 'No sets found for match' }
  }

  // Find the incomplete set (null score, not already from API)
  const incompleteSet = sets.find(
    (s: SetRow) => s.set_score === null && s.score_source !== 'api'
  )

  if (!incompleteSet) {
    // All sets have scores — check if any are still is_current on a finished match
    const staleCurrentSet = sets.find(
      (s: SetRow) => s.is_current === true && s.set_score !== null
    )
    if (staleCurrentSet) {
      // Fix: mark is_current = false since match is finished
      await supabase
        .from('sets')
        .update({ is_current: false })
        .eq('id', staleCurrentSet.id)
    }
    return { matchId, action: 'already_complete', detail: 'All sets have scores' }
  }

  // Safety: only infer the LAST null set. If there are multiple null sets,
  // that indicates a deeper data issue — only fix the last one.
  const nullSets = sets.filter((s: SetRow) => s.set_score === null)
  if (nullSets.length > 1) {
    // Multiple incomplete sets on a finished match — flag but still try the last one
    console.warn(
      `[score-inference] Match ${matchId} has ${nullSets.length} null sets. ` +
      `Only inferring the last one (set ${incompleteSet.set_number}).`
    )
  }

  // 3. Get all games for this set, ordered by game_number desc
  const { data: games, error: gamesErr } = await supabase
    .from('games')
    .select('id, set_id, game_number, game_score, is_current, points')
    .eq('set_id', incompleteSet.id)
    .order('game_number', { ascending: false })

  if (gamesErr || !games || games.length === 0) {
    return {
      matchId,
      action: 'no_data',
      detail: `No games found for set ${incompleteSet.set_number}`,
      setNumber: incompleteSet.set_number,
    }
  }

  // 4. Get the last game (highest game_number)
  const lastGame = games[0]
  const points = lastGame.points

  if (!points || points.length === 0) {
    return {
      matchId,
      action: 'no_data',
      detail: `No points in last game (game ${lastGame.game_number}) of set ${incompleteSet.set_number}`,
      setNumber: incompleteSet.set_number,
    }
  }

  // 5. Determine current game counts from the game_score of the last game
  //    game_score represents the SET game count BEFORE this game was played
  //    e.g., game_score "5 - 4" means the set was 5-4 when this game started
  let team1Games: number
  let team2Games: number

  const parsed = parseGameScore(lastGame.game_score)
  if (parsed) {
    team1Games = parsed.team1
    team2Games = parsed.team2
  } else {
    // Fallback: count completed games from earlier games in this set
    // Games with is_current=false are completed, their count minus current = game score
    const completedGames = games.filter((g: GameRow) => g.id !== lastGame.id)
    // This is less reliable — try to derive from game numbers
    // If we have games 1..N, game N's score should be derivable
    // For safety, bail out if we can't parse
    return {
      matchId,
      action: 'no_data',
      detail: `Cannot parse game_score "${lastGame.game_score}" for game ${lastGame.game_number}`,
      setNumber: incompleteSet.set_number,
    }
  }

  // 6. Check if this is a tiebreak game
  const tiebreak = isTiebreakGame(team1Games, team2Games)

  // 7. Determine the game winner from points
  const gameWinner = determineGameWinner(points, tiebreak)

  if (gameWinner === null) {
    return {
      matchId,
      action: 'no_data',
      detail: `Cannot determine game winner from points in game ${lastGame.game_number}`,
      setNumber: incompleteSet.set_number,
    }
  }

  // 8. Calculate the new set score
  const newScore = calculateSetScore(team1Games, team2Games, gameWinner)

  if (newScore === null) {
    return {
      matchId,
      action: 'skipped',
      detail: `Calculated score would be invalid (${team1Games + (gameWinner === 1 ? 1 : 0)}-${team2Games + (gameWinner === 2 ? 1 : 0)})`,
      setNumber: incompleteSet.set_number,
      gameWinner,
    }
  }

  // 9. Validate the inferred score
  if (!isValidSetScore(newScore)) {
    return {
      matchId,
      action: 'skipped',
      detail: `Inferred score "${newScore}" is not a valid padel set score`,
      setNumber: incompleteSet.set_number,
      gameWinner,
    }
  }

  // 10. Write the inferred score — UPDATE only, never INSERT
  const { error: updateErr } = await supabase
    .from('sets')
    .update({
      set_score: newScore,
      is_current: false,
      score_source: 'inferred' as ScoreSource,
    })
    .eq('id', incompleteSet.id)
    .eq('match_id', matchId) // belt-and-suspenders: ensure we're updating the right match

  if (updateErr) {
    return {
      matchId,
      action: 'skipped',
      detail: `DB update failed: ${updateErr.message}`,
      setNumber: incompleteSet.set_number,
      gameWinner,
    }
  }

  // 11. Also mark the last game as not current
  await supabase
    .from('games')
    .update({ is_current: false })
    .eq('id', lastGame.id)

  console.log(
    `[score-inference] Match ${matchId}: ` +
    `inferred set ${incompleteSet.set_number} score = ${newScore} ` +
    `(game winner: team_${gameWinner}, from ${points.length} points, ` +
    `tiebreak: ${tiebreak})`
  )

  return {
    matchId,
    action: 'inferred',
    detail: `Set ${incompleteSet.set_number}: ${team1Games}-${team2Games} → ${newScore}`,
    setNumber: incompleteSet.set_number,
    inferredScore: newScore,
    gameWinner,
  }
}

/**
 * Batch inference: find all finished matches with incomplete set scores
 * and attempt inference on each. Used by the reconciliation cycle.
 * 
 * @param supabase  Supabase client
 * @param lookbackDays  How far back to look (default 7)
 * @param limit  Max matches to process per run (default 20)
 * @returns Array of InferenceResults
 */
export async function inferBatch(
  supabase: SupabaseClient,
  lookbackDays = 7,
  limit = 20,
): Promise<InferenceResult[]> {
  const since = new Date()
  since.setDate(since.getDate() - lookbackDays)

  // Find finished matches that have at least one set with null score
  // and score_source is not 'api'
  const { data: matchIds, error } = await supabase
    .from('sets')
    .select('match_id, matches!inner(id, status, finished_at)')
    .is('set_score', null)
    .or('score_source.is.null,score_source.neq.api')
    .eq('matches.status', 'finished')
    .gte('matches.finished_at', since.toISOString())
    .limit(limit)

  if (error || !matchIds) {
    console.error('[score-inference] Batch query failed:', error?.message)
    return []
  }

  // Deduplicate match IDs
  const uniqueMatchIds = [...new Set(matchIds.map((r: any) => r.match_id))]

  const results: InferenceResult[] = []
  for (const mid of uniqueMatchIds) {
    const result = await inferFinalScore(supabase, mid)
    results.push(result)
  }

  // Log summary
  const inferred = results.filter(r => r.action === 'inferred').length
  const skipped = results.filter(r => r.action !== 'inferred').length
  if (results.length > 0) {
    console.log(
      `[score-inference] Batch complete: ${inferred} inferred, ${skipped} skipped ` +
      `out of ${uniqueMatchIds.length} matches`
    )
  }

  return results
}
