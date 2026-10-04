import { describe, it, expect } from 'vitest'
import {
  apply,
  createInitialState,
  type MatchConfig,
  type MatchState,
  type TeamId,
  type PlayerIndex,
} from '@/lib/scouting/scoring'

const baseConfig: MatchConfig = {
  format: 'bo3',
  goldenPoint: false,
  superTiebreak: false,
  setTiebreakAt: 6,
}

function winGames(s: MatchState, team: TeamId, n: number): MatchState {
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < 4; j++) s = apply(s, { kind: 'point_for', team })
  }
  return s
}

// ─── Task 6: createInitialState ─────────────────────────────────────────────
describe('createInitialState', () => {
  it('creates a best-of-3 match ready to play', () => {
    const s = createInitialState({ ...baseConfig, goldenPoint: true, superTiebreak: true })
    expect(s.config.format).toBe('bo3')
    expect(s.sets).toEqual([{ a: 0, b: 0 }])
    expect(s.currentGame).toEqual({ a: 0, b: 0 })
    expect(s.servingTeam).toBe('a')
    expect(s.servingPlayer).toBe(0)
    expect(s.phase).toBe('playing')
    expect(s.winner).toBeNull()
    expect(s.endReason).toBeNull()
  })
})

// ─── Task 7: basic game progression ─────────────────────────────────────────
describe('apply — basic game progression', () => {
  it('0 → 15 → 30 → 40 for team A', () => {
    let s = createInitialState(baseConfig)
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.currentGame).toEqual({ a: 15, b: 0 })
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.currentGame).toEqual({ a: 30, b: 0 })
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.currentGame).toEqual({ a: 40, b: 0 })
  })

  it('winning from 40-0 ends the game and resets currentGame', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 4; i++) s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.currentGame).toEqual({ a: 0, b: 0 })
    expect(s.sets[0]).toEqual({ a: 1, b: 0 })
  })

  it('serve passes to the other team after a game ends', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 4; i++) s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.servingTeam).toBe('b')
  })
})

// ─── Task 8: deuce + advantage (classic) ────────────────────────────────────
describe('apply — deuce and advantage (classic)', () => {
  it('40-40 stays until someone scores advantage', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 3; i++) {
      s = apply(s, { kind: 'point_for', team: 'a' })
      s = apply(s, { kind: 'point_for', team: 'b' })
    }
    expect(s.currentGame).toEqual({ a: 40, b: 40 })
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.currentGame).toEqual({ a: 'Adv', b: 40 })
  })

  it('team at Adv losing a point returns to 40-40', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 3; i++) {
      s = apply(s, { kind: 'point_for', team: 'a' })
      s = apply(s, { kind: 'point_for', team: 'b' })
    }
    s = apply(s, { kind: 'point_for', team: 'a' })
    s = apply(s, { kind: 'point_for', team: 'b' })
    expect(s.currentGame).toEqual({ a: 40, b: 40 })
  })

  it('team at Adv winning the next point wins the game', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 3; i++) {
      s = apply(s, { kind: 'point_for', team: 'a' })
      s = apply(s, { kind: 'point_for', team: 'b' })
    }
    s = apply(s, { kind: 'point_for', team: 'a' })
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.sets[0]).toEqual({ a: 1, b: 0 })
    expect(s.currentGame).toEqual({ a: 0, b: 0 })
  })
})

// ─── Task 9: golden point ──────────────────────────────────────────────────
describe('apply — golden point (punto de oro)', () => {
  const goldenConfig: MatchConfig = { ...baseConfig, goldenPoint: true }

  it('at 40-40 the next point wins the game (no advantage)', () => {
    let s = createInitialState(goldenConfig)
    for (let i = 0; i < 3; i++) {
      s = apply(s, { kind: 'point_for', team: 'a' })
      s = apply(s, { kind: 'point_for', team: 'b' })
    }
    expect(s.currentGame).toEqual({ a: 40, b: 40 })
    s = apply(s, { kind: 'point_for', team: 'b' })
    expect(s.sets[0]).toEqual({ a: 0, b: 1 })
    expect(s.currentGame).toEqual({ a: 0, b: 0 })
  })

  it('classic rules when golden point is off', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 3; i++) {
      s = apply(s, { kind: 'point_for', team: 'a' })
      s = apply(s, { kind: 'point_for', team: 'b' })
    }
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.currentGame).toEqual({ a: 'Adv', b: 40 })
  })
})

// ─── Task 10: set progression ───────────────────────────────────────────────
describe('set progression', () => {
  it('first to 6 with 2-game lead wins the set', () => {
    let s = createInitialState(baseConfig)
    s = winGames(s, 'a', 6)
    expect(s.sets[0]).toEqual({ a: 6, b: 0 })
    expect(s.sets.length).toBe(2)
    expect(s.sets[1]).toEqual({ a: 0, b: 0 })
  })

  it('7-5 closes the set (no tiebreak)', () => {
    let s = createInitialState(baseConfig)
    s = winGames(s, 'a', 5)
    s = winGames(s, 'b', 5)
    expect(s.sets[0]).toEqual({ a: 5, b: 5 })
    expect(s.sets.length).toBe(1)
    s = winGames(s, 'a', 2)
    expect(s.sets[0]).toEqual({ a: 7, b: 5 })
    expect(s.sets.length).toBe(2)
  })

  it('5-6 continues (no 2-game lead)', () => {
    let s = createInitialState(baseConfig)
    s = winGames(s, 'a', 5)
    s = winGames(s, 'b', 6)
    expect(s.sets[0]).toEqual({ a: 5, b: 6 })
    expect(s.sets.length).toBe(1)
  })
})

// ─── Task 11: tiebreak at 6-6 ───────────────────────────────────────────────
describe('tiebreak at 6-6', () => {
  it('entering tiebreak resets currentGame to integer 0-0', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 6; i++) {
      s = winGames(s, 'a', 1)
      s = winGames(s, 'b', 1)
    }
    expect(s.sets[0]).toEqual({ a: 6, b: 6 })
    expect(s.phase).toBe('tiebreak')
    expect(s.currentGame).toEqual({ a: 0, b: 0 })
  })

  it('first to 7 with 2-point lead wins the tiebreak and the set 7-6', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 6; i++) {
      s = winGames(s, 'a', 1)
      s = winGames(s, 'b', 1)
    }
    for (let i = 0; i < 7; i++) s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.sets[0]).toEqual({ a: 7, b: 6 })
    expect(s.sets.length).toBe(2)
    expect(s.phase).toBe('playing')
  })

  it('tiebreak continues past 6-6 (win by 2)', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 6; i++) {
      s = winGames(s, 'a', 1)
      s = winGames(s, 'b', 1)
    }
    for (let i = 0; i < 6; i++) s = apply(s, { kind: 'point_for', team: 'a' })
    for (let i = 0; i < 6; i++) s = apply(s, { kind: 'point_for', team: 'b' })
    expect(s.currentGame).toEqual({ a: 6, b: 6 })
    expect(s.phase).toBe('tiebreak')
    s = apply(s, { kind: 'point_for', team: 'a' })
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.sets[0]).toEqual({ a: 7, b: 6 })
  })
})

// ─── Task 12: BO3 completion ────────────────────────────────────────────────
describe('BO3 match completion', () => {
  it('first team to 2 sets wins', () => {
    let s = createInitialState(baseConfig)
    s = winGames(s, 'a', 6)
    s = winGames(s, 'a', 6)
    expect(s.phase).toBe('finished')
    expect(s.winner).toBe('a')
    expect(s.endReason).toBe('completed')
    expect(s.sets.length).toBe(2)
  })

  it('1-1 in sets → third set decides', () => {
    let s = createInitialState(baseConfig)
    s = winGames(s, 'a', 6)
    s = winGames(s, 'b', 6)
    expect(s.sets.length).toBe(3)
    expect(s.phase).toBe('playing')
    s = winGames(s, 'a', 6)
    expect(s.phase).toBe('finished')
    expect(s.winner).toBe('a')
  })
})

// ─── Task 13: super-tiebreak in final set ───────────────────────────────────
describe('super-tiebreak in final set', () => {
  const stbConfig: MatchConfig = { ...baseConfig, superTiebreak: true }

  it('at 1-1 in sets enters super-tiebreak immediately', () => {
    let s = createInitialState(stbConfig)
    s = winGames(s, 'a', 6)
    s = winGames(s, 'b', 6)
    expect(s.phase).toBe('super-tiebreak')
    expect(s.currentGame).toEqual({ a: 0, b: 0 })
    expect(s.sets.length).toBe(3)
    expect(s.sets[2]).toEqual({ a: 0, b: 0 })
  })

  it('first to 10 (min 2-point lead) wins the super-tiebreak and match', () => {
    let s = createInitialState(stbConfig)
    s = winGames(s, 'a', 6)
    s = winGames(s, 'b', 6)
    for (let i = 0; i < 10; i++) s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.phase).toBe('finished')
    expect(s.winner).toBe('a')
    expect(s.sets[2]).toEqual({ a: 1, b: 0 })
  })

  it('9-9 super-tiebreak continues (win by 2)', () => {
    let s = createInitialState(stbConfig)
    s = winGames(s, 'a', 6)
    s = winGames(s, 'b', 6)
    for (let i = 0; i < 9; i++) s = apply(s, { kind: 'point_for', team: 'a' })
    for (let i = 0; i < 9; i++) s = apply(s, { kind: 'point_for', team: 'b' })
    expect(s.currentGame).toEqual({ a: 9, b: 9 })
    expect(s.phase).toBe('super-tiebreak')
    s = apply(s, { kind: 'point_for', team: 'a' })
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.phase).toBe('finished')
  })
})

// ─── Task 14: alt formats ───────────────────────────────────────────────────
describe('alt formats', () => {
  it('pro-set: first to 9 with 2-game lead wins the match', () => {
    const cfg: MatchConfig = {
      format: 'pro-set',
      goldenPoint: false,
      superTiebreak: false,
      setTiebreakAt: 'none',
    }
    let s = createInitialState(cfg)
    s = winGames(s, 'a', 9)
    expect(s.phase).toBe('finished')
    expect(s.winner).toBe('a')
  })

  it('single-set: first to 6 with 2-lead wins', () => {
    const cfg: MatchConfig = {
      format: 'single-set',
      goldenPoint: false,
      superTiebreak: false,
      setTiebreakAt: 6,
    }
    let s = createInitialState(cfg)
    s = winGames(s, 'a', 6)
    expect(s.phase).toBe('finished')
    expect(s.winner).toBe('a')
  })
})

// ─── Task 15: serve rotation ────────────────────────────────────────────────
describe('serve rotation (doubles, 4 players)', () => {
  it('server cycles through all 4 players every game', () => {
    let s = createInitialState(baseConfig)
    const servers: PlayerIndex[] = [s.servingPlayer]
    for (let g = 0; g < 5; g++) {
      s = winGames(s, g % 2 === 0 ? 'a' : 'b', 1)
      servers.push(s.servingPlayer)
    }
    expect(servers).toEqual([0, 1, 2, 3, 0, 1])
  })

  it('tiebreak: server changes after point 1, then every 2 points', () => {
    let s = createInitialState(baseConfig)
    for (let i = 0; i < 6; i++) {
      s = winGames(s, 'a', 1)
      s = winGames(s, 'b', 1)
    }
    expect(s.phase).toBe('tiebreak')
    const first = s.servingPlayer
    s = apply(s, { kind: 'point_for', team: 'a' })
    const afterOne = s.servingPlayer
    expect(afterOne).not.toBe(first)
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.servingPlayer).toBe(afterOne)
    s = apply(s, { kind: 'point_for', team: 'a' })
    expect(s.servingPlayer).not.toBe(afterOne)
  })
})

// ─── Task 17: retirement and walkover ───────────────────────────────────────
describe('retirement / walkover', () => {
  it('retirement: opponent wins, endReason=retired', () => {
    let s = createInitialState(baseConfig)
    s = apply(s, { kind: 'point_for', team: 'a' })
    s = apply(s, { kind: 'mark_retirement', team: 'a' })
    expect(s.phase).toBe('finished')
    expect(s.winner).toBe('b')
    expect(s.endReason).toBe('retired')
  })

  it('walkover: opponent wins, endReason=walkover', () => {
    let s = createInitialState(baseConfig)
    s = apply(s, { kind: 'mark_walkover', team: 'b' })
    expect(s.phase).toBe('finished')
    expect(s.winner).toBe('a')
    expect(s.endReason).toBe('walkover')
  })

  it('cannot mark retirement after match ended', () => {
    let s = createInitialState(baseConfig)
    s = winGames(s, 'a', 6)
    s = winGames(s, 'a', 6)
    expect(s.phase).toBe('finished')
    const before = s
    s = apply(s, { kind: 'mark_retirement', team: 'b' })
    expect(s).toEqual(before)
  })
})

// ─── Task 18: correct_score and reset ───────────────────────────────────────
describe('correct_score and reset', () => {
  it('correct_score patches specific fields', () => {
    let s = createInitialState(baseConfig)
    s = apply(s, { kind: 'point_for', team: 'a' })
    s = apply(s, { kind: 'correct_score', patch: { currentGame: { a: 30, b: 15 } } })
    expect(s.currentGame).toEqual({ a: 30, b: 15 })
  })

  it('reset returns to initial state with same config', () => {
    let s = createInitialState(baseConfig)
    s = winGames(s, 'a', 6)
    s = apply(s, { kind: 'reset' })
    expect(s.sets).toEqual([{ a: 0, b: 0 }])
    expect(s.currentGame).toEqual({ a: 0, b: 0 })
    expect(s.phase).toBe('playing')
  })
})
