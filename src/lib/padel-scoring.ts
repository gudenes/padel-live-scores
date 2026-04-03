/**
 * padel-scoring.ts
 *
 * Pure TypeScript padel scoring engine.
 * No external dependencies. All functions are immutable (return new state).
 *
 * Padel scoring rules:
 * - Standard game: 0 → 15 → 30 → 40 → game
 * - Deuce (40-40): need 2-consecutive-point lead; advantage → game or back to deuce
 * - Set: first to 6 games with 2-game lead (or tiebreak at 6-6)
 * - Tiebreak: numeric scoring 0,1,2...; first to 7 with 2-point lead
 * - Match: best of 3 sets (first to 2 sets)
 * - Service: alternates every game; in tiebreak every 2 points after first
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GameState {
  gameNumber: number
  points: string[]           // ["0:0", "15:0", "30:0", ...]
  pair1Points: string        // "0", "15", "30", "40", "A" | "0","1","2"... in tiebreak
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

// ---------------------------------------------------------------------------
// Helpers — point progression
// ---------------------------------------------------------------------------

const STANDARD_POINTS = ['0', '15', '30', '40'] as const

/** Next standard point score after current. Returns null if game should be decided. */
function nextStandardPoint(current: string): string | null {
  const idx = STANDARD_POINTS.indexOf(current as typeof STANDARD_POINTS[number])
  if (idx === -1) return null
  if (idx < STANDARD_POINTS.length - 1) return STANDARD_POINTS[idx + 1]
  return null // already at 40
}

/**
 * Given current pair1/pair2 points in a standard (non-tiebreak) game,
 * compute the new points after `pair` scores.
 * Returns { pair1Points, pair2Points, winner } or null if invalid state.
 */
function advanceStandardGame(
  pair1Points: string,
  pair2Points: string,
  pair: 1 | 2,
): { pair1Points: string; pair2Points: string; winner: 1 | 2 | null } {
  const scorer = pair === 1 ? pair1Points : pair2Points
  const other = pair === 1 ? pair2Points : pair1Points

  let newScorer: string
  let newOther = other
  let winner: 1 | 2 | null = null

  if (scorer === 'A') {
    // Advantage → game
    winner = pair
    newScorer = scorer
  } else if (scorer === '40' && other === '40') {
    // Deuce → advantage for scorer
    newScorer = 'A'
    newOther = '40'
  } else if (scorer === '40' && other === 'A') {
    // Opponent has advantage, scorer scores → back to deuce
    newScorer = '40'
    newOther = '40'
  } else if (scorer === '40') {
    // 40 vs anything less than 40 or A → game
    winner = pair
    newScorer = scorer
  } else {
    const next = nextStandardPoint(scorer)
    newScorer = next !== null ? next : scorer
  }

  return pair === 1
    ? { pair1Points: newScorer, pair2Points: newOther, winner }
    : { pair1Points: newOther, pair2Points: newScorer, winner }
}

/**
 * Advance a tiebreak game after `pair` scores.
 * Points are numeric strings: "0", "1", "2", ...
 * Service rotates: after 1st point, then every 2 points.
 */
function advanceTiebreakGame(
  pair1Points: string,
  pair2Points: string,
  pair: 1 | 2,
  state: MatchState,
): { pair1Points: string; pair2Points: string; winner: 1 | 2 | null; newServingPair: 1 | 2 } {
  const p1 = parseInt(pair1Points, 10)
  const p2 = parseInt(pair2Points, 10)

  const newP1 = pair === 1 ? p1 + 1 : p1
  const newP2 = pair === 2 ? p2 + 1 : p2

  // Win condition: first to 7 with at least 2-point lead
  let winner: 1 | 2 | null = null
  if (newP1 >= 7 && newP1 - newP2 >= 2) winner = 1
  else if (newP2 >= 7 && newP2 - newP1 >= 2) winner = 2

  // Service rotation: after 1st point, then every 2 points
  const totalTbPoints = newP1 + newP2
  let newServingPair: 1 | 2 = state.servingPair
  if (totalTbPoints === 1 || (totalTbPoints > 1 && (totalTbPoints - 1) % 2 === 0)) {
    newServingPair = state.servingPair === 1 ? 2 : 1
  }

  return {
    pair1Points: String(newP1),
    pair2Points: String(newP2),
    winner,
    newServingPair,
  }
}

/** Build the point string for a game snapshot (e.g. "15:0") */
function buildPointString(pair1Points: string, pair2Points: string): string {
  return `${pair1Points}:${pair2Points}`
}

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

export function createInitialState(): MatchState {
  const initialGame: GameState = {
    gameNumber: 1,
    points: [],
    pair1Points: '0',
    pair2Points: '0',
    winner: null,
  }

  const initialSet: SetState = {
    setNumber: 1,
    pair1Games: 0,
    pair2Games: 0,
    games: [initialGame],
    isTiebreak: false,
    winner: null,
  }

  return {
    sets: [initialSet],
    currentSet: 1,
    currentGame: 1,
    status: 'scheduled',
    servingPair: 1,
    winner: null,
  }
}

// ---------------------------------------------------------------------------
// addPoint
// ---------------------------------------------------------------------------

export function addPoint(state: MatchState, pair: 1 | 2): MatchState {
  // Don't allow points after match is finished
  if (state.status === 'finished') return state

  const sets = state.sets.map(s => ({
    ...s,
    games: s.games.map(g => ({ ...g, points: [...g.points] })),
  }))

  const setIdx = state.currentSet - 1
  const currentSet = { ...sets[setIdx], games: [...sets[setIdx].games] }
  const gameIdx = state.currentGame - 1
  const currentGame = { ...currentSet.games[gameIdx] }

  // Advance the game
  let newGame: GameState
  let tiebreakServingPair: 1 | 2 | null = null
  if (currentSet.isTiebreak) {
    const { pair1Points, pair2Points, winner, newServingPair } = advanceTiebreakGame(
      currentGame.pair1Points,
      currentGame.pair2Points,
      pair,
      state,
    )
    tiebreakServingPair = newServingPair
    const pointStr = buildPointString(pair1Points, pair2Points)
    newGame = {
      ...currentGame,
      pair1Points,
      pair2Points,
      points: [...currentGame.points, pointStr],
      winner,
    }
  } else {
    const { pair1Points, pair2Points, winner } = advanceStandardGame(
      currentGame.pair1Points,
      currentGame.pair2Points,
      pair,
    )
    const pointStr = buildPointString(pair1Points, pair2Points)
    newGame = {
      ...currentGame,
      pair1Points,
      pair2Points,
      points: [...currentGame.points, pointStr],
      winner,
    }
  }

  currentSet.games[gameIdx] = newGame
  sets[setIdx] = currentSet

  // Determine new serving pair
  let newServingPair: 1 | 2 = state.servingPair
  let newStatus: 'scheduled' | 'live' | 'finished' = state.status === 'scheduled' ? 'live' : state.status
  let newCurrentSet = state.currentSet
  let newCurrentGame = state.currentGame
  let matchWinner: 1 | 2 | null = state.winner

  if (newGame.winner !== null) {
    // Game is complete — update set game counts
    const updatedSet = { ...currentSet }

    if (currentSet.isTiebreak) {
      // Tiebreak win: set scores are 7-6 for the winner
      if (newGame.winner === 1) {
        updatedSet.pair1Games = 7
        updatedSet.pair2Games = 6
      } else {
        updatedSet.pair1Games = 6
        updatedSet.pair2Games = 7
      }
      updatedSet.winner = newGame.winner
    } else {
      if (newGame.winner === 1) {
        updatedSet.pair1Games = currentSet.pair1Games + 1
        updatedSet.pair2Games = currentSet.pair2Games
      } else {
        updatedSet.pair1Games = currentSet.pair1Games
        updatedSet.pair2Games = currentSet.pair2Games + 1
      }

      // Check set win conditions
      const p1g = updatedSet.pair1Games
      const p2g = updatedSet.pair2Games

      if (
        (p1g >= 6 && p1g - p2g >= 2) ||
        (p2g >= 6 && p2g - p1g >= 2)
      ) {
        updatedSet.winner = p1g > p2g ? 1 : 2
      } else if (p1g === 6 && p2g === 6) {
        // Tiebreak!
        updatedSet.isTiebreak = true
      }
    }

    // After game server alternates (for regular games; tiebreak: stays)
    if (!currentSet.isTiebreak) {
      newServingPair = state.servingPair === 1 ? 2 : 1
    } else {
      // After tiebreak, server is whoever serves next set
      newServingPair = state.servingPair === 1 ? 2 : 1
    }

    if (updatedSet.winner !== null) {
      // Set is done — check match win
      const setsWonByP1 = [...sets.slice(0, setIdx), updatedSet].filter(s => s.winner === 1).length
      const setsWonByP2 = [...sets.slice(0, setIdx), updatedSet].filter(s => s.winner === 2).length

      if (setsWonByP1 >= 2) {
        matchWinner = 1
        newStatus = 'finished'
        const finalSets = [...sets]
        finalSets[setIdx] = { ...updatedSet, games: [...updatedSet.games] }
        finalSets[setIdx].games[gameIdx] = newGame
        return {
          sets: finalSets,
          currentSet: newCurrentSet,
          currentGame: newCurrentGame,
          status: newStatus,
          servingPair: newServingPair,
          winner: matchWinner,
        }
      } else if (setsWonByP2 >= 2) {
        matchWinner = 2
        newStatus = 'finished'
        const finalSets = [...sets]
        finalSets[setIdx] = { ...updatedSet, games: [...updatedSet.games] }
        finalSets[setIdx].games[gameIdx] = newGame
        return {
          sets: finalSets,
          currentSet: newCurrentSet,
          currentGame: newCurrentGame,
          status: newStatus,
          servingPair: newServingPair,
          winner: matchWinner,
        }
      } else {
        // Start a new set
        const newSetNumber = state.currentSet + 1
        const newSetGame: GameState = {
          gameNumber: 1,
          points: [],
          pair1Points: '0',
          pair2Points: '0',
          winner: null,
        }
        const newSet: SetState = {
          setNumber: newSetNumber,
          pair1Games: 0,
          pair2Games: 0,
          games: [newSetGame],
          isTiebreak: false,
          winner: null,
        }
        const finalSets = [...sets]
        finalSets[setIdx] = { ...updatedSet, games: [...updatedSet.games] }
        finalSets[setIdx].games[gameIdx] = newGame
        finalSets.push(newSet)
        return {
          sets: finalSets,
          currentSet: newSetNumber,
          currentGame: 1,
          status: newStatus,
          servingPair: newServingPair,
          winner: null,
        }
      }
    } else if (updatedSet.isTiebreak && !currentSet.isTiebreak) {
      // Just entered tiebreak — start tiebreak game
      const tbGame: GameState = {
        gameNumber: currentSet.games.length + 1,
        points: [],
        pair1Points: '0',
        pair2Points: '0',
        winner: null,
      }
      updatedSet.games = [...updatedSet.games]
      updatedSet.games[gameIdx] = newGame
      updatedSet.games.push(tbGame)
      newCurrentGame = updatedSet.games.length

      const finalSets = [...sets]
      finalSets[setIdx] = updatedSet
      return {
        sets: finalSets,
        currentSet: newCurrentSet,
        currentGame: newCurrentGame,
        status: newStatus,
        servingPair: newServingPair,
        winner: null,
      }
    } else {
      // Set still in progress — start next game
      const nextGameNumber = updatedSet.games.length + 1
      const nextGame: GameState = {
        gameNumber: nextGameNumber,
        points: [],
        pair1Points: '0',
        pair2Points: '0',
        winner: null,
      }
      updatedSet.games = [...updatedSet.games]
      updatedSet.games[gameIdx] = newGame
      updatedSet.games.push(nextGame)
      newCurrentGame = nextGameNumber

      const finalSets = [...sets]
      finalSets[setIdx] = updatedSet
      return {
        sets: finalSets,
        currentSet: newCurrentSet,
        currentGame: newCurrentGame,
        status: newStatus,
        servingPair: newServingPair,
        winner: null,
      }
    }
  }

  // Game not yet complete — use tiebreak service rotation if applicable
  if (tiebreakServingPair !== null) {
    newServingPair = tiebreakServingPair
  }

  const finalSets = [...sets]
  finalSets[setIdx] = { ...currentSet, games: [...currentSet.games] }
  finalSets[setIdx].games[gameIdx] = newGame

  return {
    sets: finalSets,
    currentSet: newCurrentSet,
    currentGame: newCurrentGame,
    status: newStatus,
    servingPair: newServingPair,
    winner: matchWinner,
  }
}

// ---------------------------------------------------------------------------
// undoPoint
// ---------------------------------------------------------------------------

export function undoPoint(
  state: MatchState,
  history: MatchState[],
): { state: MatchState; history: MatchState[] } {
  if (history.length === 0) {
    return { state, history: [] }
  }
  const newHistory = history.slice(0, -1)
  const previousState = history[history.length - 1]
  return { state: previousState, history: newHistory }
}

// ---------------------------------------------------------------------------
// quickGame
// ---------------------------------------------------------------------------

/**
 * Simulate a complete game win for `pair`.
 * Loops until the current game/set advances, adding opponent points for realism.
 * Collects the initial state and each intermediate state in history.
 */
export function quickGame(
  state: MatchState,
  pair: 1 | 2,
): { state: MatchState; history: MatchState[] } {
  // history collects all states leading up to (but not including) the final state
  const history: MatchState[] = []
  let current = state

  const startGame = current.currentGame
  const startSet = current.currentSet
  const isTiebreak = current.sets[startSet - 1]?.isTiebreak ?? false
  const loser: 1 | 2 = pair === 1 ? 2 : 1

  if (isTiebreak) {
    // Tiebreak: loop until set changes or match finishes, sprinkling 0-2 loser points
    let loserPointsLeft = Math.floor(Math.random() * 3) // 0, 1, or 2
    let pointsSinceLastLoser = 0
    while (
      current.currentSet === startSet &&
      current.sets[startSet - 1]?.winner === null &&
      current.status !== 'finished'
    ) {
      history.push(current)
      // Occasionally give loser a point for realism
      if (loserPointsLeft > 0 && pointsSinceLastLoser >= 2 && Math.random() < 0.4) {
        current = addPoint(current, loser)
        loserPointsLeft--
        pointsSinceLastLoser = 0
      } else {
        current = addPoint(current, pair)
        pointsSinceLastLoser++
      }
    }
  } else {
    // Standard game: loop until game or set advances, sprinkling 0-2 loser points
    let loserPointsLeft = Math.floor(Math.random() * 3) // 0, 1, or 2
    let pointsSinceLastLoser = 0
    while (
      current.currentGame === startGame &&
      current.currentSet === startSet &&
      current.status !== 'finished'
    ) {
      history.push(current)
      // Occasionally give loser a point for realism
      if (loserPointsLeft > 0 && pointsSinceLastLoser >= 2 && Math.random() < 0.4) {
        current = addPoint(current, loser)
        loserPointsLeft--
        pointsSinceLastLoser = 0
      } else {
        current = addPoint(current, pair)
        pointsSinceLastLoser++
      }
    }
  }

  return { state: current, history }
}

// ---------------------------------------------------------------------------
// stateToRelayPayload
// ---------------------------------------------------------------------------

export function stateToRelayPayload(
  state: MatchState,
  matchId: string,
  externalId: string,
  action: string,
): Record<string, unknown> {
  return {
    matchId,
    externalId,
    action,
    status: state.status,
    servingPair: state.servingPair,
    winner: state.winner,
    sets: state.sets.map(set => ({
      setNumber: set.setNumber,
      pair1Games: set.pair1Games,
      pair2Games: set.pair2Games,
      isTiebreak: set.isTiebreak,
      winner: set.winner,
      games: set.games.map(game => ({
        gameNumber: game.gameNumber,
        pair1Points: game.pair1Points,
        pair2Points: game.pair2Points,
        points: game.points,
        winner: game.winner,
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// stateToDbFormat
// ---------------------------------------------------------------------------

/**
 * Build set_score string:
 * - null if set in progress
 * - "X-Y" if set complete (no tiebreak)
 * - "X-Y(Z)" if set complete via tiebreak, Z = loser's tiebreak points
 */
function buildSetScore(set: SetState): string | null {
  if (set.winner === null) return null
  if (!set.isTiebreak) {
    return `${set.pair1Games}-${set.pair2Games}`
  }
  // Tiebreak set: scores are 7-6; find tiebreak game for loser's score
  const tbGame = set.games[set.games.length - 1]
  const loserPoints = set.winner === 1 ? tbGame.pair2Points : tbGame.pair1Points
  return `7-6(${loserPoints})`
}

export function stateToDbFormat(state: MatchState): {
  status: string
  sets: Array<{
    set_number: number
    set_score: string | null
    pair1_games: number
    pair2_games: number
    is_current: boolean
    games: Array<{
      game_number: number
      game_score: string
      points: string[]
      is_current: boolean
      winner_pair: 1 | 2 | null
    }>
  }>
} {
  const currentSetNumber = state.currentSet

  return {
    status: state.status,
    sets: state.sets.map(set => {
      const isCurrentSet = set.setNumber === currentSetNumber && set.winner === null

      // Build game_score for each game: games won by each pair at the START of that game
      let p1GamesAtStart = 0
      let p2GamesAtStart = 0
      const currentGameNumber = set.setNumber === currentSetNumber ? state.currentGame : null

      const games = set.games.map((game) => {
        const gameScore = `${p1GamesAtStart}-${p2GamesAtStart}`
        const isCurrentGame = isCurrentSet && game.gameNumber === currentGameNumber

        // Update counters after building score
        const result = {
          game_number: game.gameNumber,
          game_score: gameScore,
          points: game.points,
          is_current: isCurrentGame,
          winner_pair: game.winner,
        }

        if (game.winner === 1) p1GamesAtStart++
        else if (game.winner === 2) p2GamesAtStart++

        return result
      })

      return {
        set_number: set.setNumber,
        set_score: buildSetScore(set),
        pair1_games: set.pair1Games,
        pair2_games: set.pair2Games,
        is_current: isCurrentSet,
        games,
      }
    }),
  }
}
