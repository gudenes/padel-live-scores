import { describe, it, expect } from 'vitest'
import { isMassDelete } from '../../workers/coach-linker.js'

describe('isMassDelete', () => {
  it('0/0 is false', () => expect(isMassDelete(0, 0)).toBe(false))
  it('60/100 is false (existing <= 100)', () => expect(isMassDelete(60, 100)).toBe(false))
  it('60/101 is true', () => expect(isMassDelete(60, 101)).toBe(true))
  it('50/101 is false', () => expect(isMassDelete(50, 101)).toBe(false))
})

// ---- worker tests with a minimal in-memory fake Supabase ----
import { runCoachLinker } from '../../workers/coach-linker.js'

type Row = Record<string, any>

function makeFake(init: { players: Row[]; coaches?: Row[]; coach_aliases?: Row[]; player_coaches?: Row[]; failCoachInsert?: boolean }) {
  const t: Record<string, Row[]> = {
    players: init.players.map((r) => ({ ...r })),
    coaches: (init.coaches ?? []).map((r) => ({ ...r })),
    coach_aliases: (init.coach_aliases ?? []).map((r) => ({ ...r })),
    player_coaches: (init.player_coaches ?? []).map((r) => ({ ...r })),
    coach_merge_suggestions: [],
    coach_player_link_suggestions: [],
  }
  const keys: Record<string, string[]> = {
    coaches: ['id'], coach_aliases: ['normalized_alias'], player_coaches: ['player_id', 'coach_id'],
    coach_merge_suggestions: ['coach_a', 'coach_b'], coach_player_link_suggestions: ['coach_id', 'player_id'],
  }
  const writes: { op: string; table: string; rows: number }[] = []
  const k = (table: string, r: Row) => keys[table].map((c) => r[c]).join('|')
  const supabase = {
    from(table: string) {
      return {
        select: (_cols: string) => ({
          order: () => ({ order: () => ({ range: async (s: number, e: number) => ({ data: t[table].slice(s, e + 1), error: null }) }),
            range: async (s: number, e: number) => ({ data: t[table].slice(s, e + 1), error: null }) }),
          in: async (col: string, ids: string[]) => ({ data: t[table].filter((r) => ids.includes(r[col])), error: null }),
        }),
        insert: async (rows: Row[]) => {
          writes.push({ op: 'insert', table, rows: rows.length })
          if (table === 'coaches' && init.failCoachInsert) return { error: { message: 'boom' } }
          t[table].push(...rows.map((r) => ({ status: 'unreviewed', ...r })))
          return { error: null }
        },
        upsert: async (rows: Row[]) => {
          writes.push({ op: 'upsert', table, rows: rows.length })
          for (const r of rows) {
            const i = t[table].findIndex((x) => k(table, x) === k(table, r))
            if (i >= 0) t[table][i] = { ...t[table][i], ...r }
            else t[table].push({ ...r })
          }
          return { error: null }
        },
        delete: () => ({
          eq: (_c: string, pid: string) => ({
            in: async (_c2: string, ids: string[]) => {
              writes.push({ op: 'delete', table, rows: ids.length })
              t[table] = t[table].filter((r) => !(r.player_id === pid && ids.includes(r.coach_id)))
              return { error: null }
            },
          }),
        }),
      }
    },
  }
  return { supabase: supabase as any, t, writes }
}

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} } as any
const PLAYERS = [
  { id: 'p1', name: 'Player One', coaches: ['Gustavo Pratto', 'Martin Canali'] },
  { id: 'p2', name: 'Player Two', coaches: ['Martín Canali'] },
]

describe('runCoachLinker', () => {
  it('first run creates coaches/aliases/links; second run writes nothing', async () => {
    const f = makeFake({ players: PLAYERS })
    const r1 = await runCoachLinker({ supabase: f.supabase, logger: quietLogger, dryRun: false })
    expect(r1.coachesCreated).toBe(2)
    expect(r1.autoAliases).toBe(2)
    expect(r1.playerLinksWritten).toBe(3)
    expect(f.t.coaches).toHaveLength(2)
    expect(f.t.coach_aliases).toHaveLength(2)
    expect(f.t.player_coaches).toHaveLength(3)
    const before = f.writes.length
    const r2 = await runCoachLinker({ supabase: f.supabase, logger: quietLogger, dryRun: false })
    expect(r2.batchErrors).toBe(0)
    expect(f.writes.slice(before).filter((w) => w.rows > 0)).toEqual([])
  })

  it('dry run performs no writes', async () => {
    const f = makeFake({ players: PLAYERS })
    const r = await runCoachLinker({ supabase: f.supabase, logger: quietLogger, dryRun: true })
    expect(r.coachesCreated).toBe(2)
    expect(f.writes).toEqual([])
  })

  it('aborts on mass delete without writing', async () => {
    const links = Array.from({ length: 150 }, (_, i) => ({ player_id: `p${i}`, coach_id: 'c1', raw_name: 'X Y', position: 0 }))
    const players = links.map((l) => ({ id: l.player_id, name: 'N', coaches: [] }))
    const f = makeFake({
      players, player_coaches: links,
      coaches: [{ id: 'c1', normalized_name: 'x y', display_name: 'X Y', slug: 'x-y', status: 'unreviewed', merged_into: null, player_id: null }],
    })
    const r = await runCoachLinker({ supabase: f.supabase, logger: quietLogger, dryRun: false })
    expect(r.abortedMassDelete).toBe(true)
    expect(f.writes).toEqual([])
  })

  it('failed coach insert blocks dependent alias/link writes', async () => {
    const f = makeFake({ players: PLAYERS, failCoachInsert: true })
    const r = await runCoachLinker({ supabase: f.supabase, logger: quietLogger, dryRun: false })
    expect(r.batchErrors).toBe(1)
    expect(f.t.coach_aliases).toHaveLength(0)
    expect(f.t.player_coaches).toHaveLength(0)
    expect(f.writes.filter((w) => w.table === 'coach_aliases' || w.table === 'player_coaches')).toEqual([])
  })
})
