import { describe, it, expect } from 'vitest'
import {
  hydrateThinPlayers,
  synthesizeThinPlayer,
  isThinPlayer,
} from '../thin-match-player'

// These tests cover the contract that the public app's tournament page
// + match page + matches-by-day fetcher all rely on: when padelgod's
// fip-draw-populator inserts an amateur-tier "thin match" (FK columns
// NULL, names in pair*_player*_name), the UI hydrator should turn each
// non-null name into a synthetic player with empty id, and leave fully
// resolved rows untouched.

describe('synthesizeThinPlayer', () => {
  it('builds a Player-shaped object with empty id and the given name', () => {
    const p = synthesizeThinPlayer('Some Player')
    expect(p.id).toBe('')
    expect(p.name).toBe('Some Player')
    expect(p.country).toBeNull()
    expect(p.display_name).toBeNull()
    expect(p.ranking).toBeNull()
    expect(p.avatar_url).toBeNull()
  })

  it('trims surrounding whitespace from the name', () => {
    expect(synthesizeThinPlayer('  Carla  ').name).toBe('Carla')
  })
})

describe('isThinPlayer', () => {
  it('true when id is missing or empty', () => {
    expect(isThinPlayer({ id: '' })).toBe(true)
    expect(isThinPlayer({ id: undefined })).toBe(true)
    expect(isThinPlayer({ id: null })).toBe(true)
  })

  it('false when id is a real UUID', () => {
    expect(isThinPlayer({ id: 'abc-123' })).toBe(false)
  })

  it('false when player is null/undefined', () => {
    expect(isThinPlayer(null)).toBe(false)
    expect(isThinPlayer(undefined)).toBe(false)
  })
})

describe('hydrateThinPlayers', () => {
  it('leaves a fully resolved row alone (no thin name columns)', () => {
    const row = {
      pair1_player1: { id: 'u1', name: 'A' },
      pair1_player2: { id: 'u2', name: 'B' },
      pair2_player1: { id: 'u3', name: 'C' },
      pair2_player2: { id: 'u4', name: 'D' },
    }
    const out = hydrateThinPlayers({ ...row })
    expect(out.pair1_player1?.id).toBe('u1')
    expect(out.pair2_player2?.id).toBe('u4')
  })

  it('synthesizes 4 players when all FKs are null but all names set (B3 Singapore case)', () => {
    // Cast through `any` because TS narrows `null` literals to `never`
    // when the row keys aren't pre-typed. The real call sites pass rows
    // typed as `MatchesDayMatch` / `Match` where the slot type is
    // `Player | null`, so this isn't a production concern.
    const row: any = {
      pair1_player1: null,
      pair1_player2: null,
      pair2_player1: null,
      pair2_player2: null,
      pair1_player1_name: 'Local A',
      pair1_player2_name: 'Local B',
      pair2_player1_name: 'Local C',
      pair2_player2_name: 'Local D',
    }
    const out = hydrateThinPlayers({ ...row })
    expect(out.pair1_player1?.id).toBe('')
    expect(out.pair1_player1?.name).toBe('Local A')
    expect(out.pair1_player2?.name).toBe('Local B')
    expect(out.pair2_player1?.name).toBe('Local C')
    expect(out.pair2_player2?.name).toBe('Local D')
  })

  it('mixes resolved + thin slots when populator partially upgraded the row', () => {
    // Recovery scenario: team 1 just got resolved by a later populator
    // pass, team 2 still thin until the next pass. Both should render.
    const row: any = {
      pair1_player1: { id: 'u1', name: 'Real One' },
      pair1_player2: { id: 'u2', name: 'Real Two' },
      pair2_player1: null,
      pair2_player2: null,
      pair1_player1_name: null,
      pair1_player2_name: null,
      pair2_player1_name: 'Thin Three',
      pair2_player2_name: 'Thin Four',
    }
    const out = hydrateThinPlayers({ ...row })
    expect(out.pair1_player1?.id).toBe('u1')
    expect(out.pair2_player1?.id).toBe('')
    expect(out.pair2_player1?.name).toBe('Thin Three')
    expect(out.pair2_player2?.name).toBe('Thin Four')
  })

  it('leaves a slot null when both FK and name are null (genuine TBD)', () => {
    // R16 match where the prior round hasn't finished → no winners
    // populated yet AND no name fallback either. Render as TBD.
    const row = {
      pair1_player1: { id: 'u1', name: 'A' },
      pair1_player2: { id: 'u2', name: 'B' },
      pair2_player1: null,
      pair2_player2: null,
      pair2_player1_name: null,
      pair2_player2_name: null,
    }
    const out = hydrateThinPlayers({ ...row })
    expect(out.pair2_player1).toBeNull()
    expect(out.pair2_player2).toBeNull()
  })

  it('treats whitespace-only names as missing (no synthesis, leave slot null)', () => {
    const row = {
      pair1_player1: null,
      pair1_player1_name: '   ',
    }
    const out = hydrateThinPlayers({ ...row })
    expect(out.pair1_player1).toBeNull()
  })

  it('does not overwrite an existing FK player with the thin-name fallback', () => {
    // Defensive: even if the DB somehow has BOTH the FK player AND a
    // stale name string, the FK wins (it's the authoritative identity).
    const row = {
      pair1_player1: { id: 'u-real', name: 'Real Name' },
      pair1_player1_name: 'Stale Name',
    }
    const out = hydrateThinPlayers({ ...row })
    expect(out.pair1_player1?.id).toBe('u-real')
    expect(out.pair1_player1?.name).toBe('Real Name')
  })
})
