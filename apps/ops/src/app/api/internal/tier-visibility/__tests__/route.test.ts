import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  stats: { data: [] as unknown[], error: null as { message: string } | null },
  config: { data: [] as unknown[], error: null as { message: string } | null },
  upserts: [] as Array<{ row: unknown; opts: unknown }>,
}))

vi.mock('@/lib/auth', () => ({ auth: mocks.auth }))
vi.mock('@/lib/supabase', () => ({
  serviceClient: () => ({
    rpc: async () => mocks.stats,
    from: () => ({
      select: () => Promise.resolve(mocks.config),
      upsert: (row: unknown, opts: unknown) => {
        mocks.upserts.push({ row, opts })
        return {
          select: () => ({ single: async () => ({ data: { ...(row as object), updated_at: 'now' }, error: null }) }),
        }
      },
    }),
  }),
}))

import { GET } from '../route'
import { PATCH } from '../[level]/route'

const patch = (level: string, body: unknown) =>
  PATCH(
    new Request(`http://x/api/internal/tier-visibility/${level}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ level }) },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ user: { isOperator: true } })
  mocks.stats = { data: [], error: null }
  mocks.config = { data: [], error: null }
  mocks.upserts = []
})

describe('GET /api/internal/tier-visibility', () => {
  it('401s without an operator session', async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await GET()).status).toBe(401)
  })

  it('unions stats with config, defaults unconfigured tiers to shown, sorts by sort_order', async () => {
    mocks.stats.data = [
      { level: 'fip_bronze', tournaments: 277, matches_90d: 1796, live_now: 2 },
      { level: 'fip_new_thing', tournaments: 1, matches_90d: 3, live_now: 0 },
    ]
    mocks.config.data = [
      { level: 'fip_bronze', label: 'FIP Bronze', show_on_matches: true, sort_order: 12, updated_at: 't', updated_by: null },
      { level: 'fip_promises', label: 'FIP Promises', show_on_matches: false, sort_order: 20, updated_at: 't', updated_by: 'ops' },
    ]
    const json = (await (await GET()).json()) as { tiers: Array<Record<string, unknown>> }
    expect(json.tiers.map((t) => t.level)).toEqual(['fip_bronze', 'fip_promises', 'fip_new_thing'])
    const fresh = json.tiers.find((t) => t.level === 'fip_new_thing')
    expect(fresh).toMatchObject({ configured: false, show_on_matches: true, label: 'fip_new_thing', matches_90d: 3 })
    const promises = json.tiers.find((t) => t.level === 'fip_promises')
    expect(promises).toMatchObject({ configured: true, show_on_matches: false, tournaments: 0 })
  })

  it('500s when the stats query fails', async () => {
    mocks.stats = { data: [], error: { message: 'boom' } }
    expect((await GET()).status).toBe(500)
  })
})

describe('PATCH /api/internal/tier-visibility/[level]', () => {
  it('401s without an operator session', async () => {
    mocks.auth.mockResolvedValueOnce(null)
    expect((await patch('fip_promises', { show_on_matches: true })).status).toBe(401)
  })

  it('rejects a malformed level without writing', async () => {
    const res = await patch('Bad-Level', { show_on_matches: true })
    expect(res.status).toBe(400)
    expect(mocks.upserts).toHaveLength(0)
  })

  it('rejects a non-boolean', async () => {
    expect((await patch('fip_promises', { show_on_matches: 'yes' })).status).toBe(400)
  })

  it('upserts, keeping label from the body or falling back to the level code', async () => {
    const res = await patch('fip_new_thing', { show_on_matches: false })
    expect(res.status).toBe(200)
    expect(mocks.upserts[0].opts).toEqual({ onConflict: 'level' })
    expect(mocks.upserts[0].row).toEqual({
      level: 'fip_new_thing',
      label: 'fip_new_thing',
      show_on_matches: false,
      updated_by: 'ops',
    })
    await patch('fip_beyond', { show_on_matches: true, label: 'FIP Beyond' })
    expect(mocks.upserts[1].row).toMatchObject({ label: 'FIP Beyond', show_on_matches: true })
  })
})
