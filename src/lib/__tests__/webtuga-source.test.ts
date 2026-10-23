import { describe, it, expect, vi } from 'vitest'
import { isMatchWebtugaSourced } from '../webtuga-source'
function fakeSupabase(row: unknown, error: unknown = null) {
  const chain: any = {
    select: () => chain, eq: () => chain, in: vi.fn(() => chain),
    limit: vi.fn(() => chain), maybeSingle: async () => ({ data: row, error }),
  }
  return { from: vi.fn(() => chain), chain } as any
}
describe('scoreboard-provider recap policy', () => {
  it('recognizes Webtuga and Puntuate and limits multiple mappings safely', async () => {
    const db = fakeSupabase({ entity_id: 'm1' })
    expect(await isMatchWebtugaSourced(db, 'm1')).toBe(true)
    expect(db.chain.in).toHaveBeenCalledWith('source', ['webtuga', 'puntuate'])
    expect(db.chain.limit).toHaveBeenCalledWith(1)
  })
  it('returns false when no provider mapping exists', async () => {
    expect(await isMatchWebtugaSourced(fakeSupabase(null), 'm1')).toBe(false)
  })
  it('returns false on query errors', async () => {
    expect(await isMatchWebtugaSourced(fakeSupabase(null, { message: 'boom' }), 'm1')).toBe(false)
  })
})
