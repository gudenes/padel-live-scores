import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryMock = vi.fn()
const connectMock = vi.fn()
vi.mock('@/lib/db', () => ({ pgPool: () => ({ query: queryMock, connect: connectMock }) }))

import { findFipTwin, linkFipTwin } from '@/lib/fip-twin-finder'

beforeEach(() => {
  queryMock.mockReset()
  connectMock.mockReset()
})

describe('findFipTwin', () => {
  it('returns null when target already has a fip_id', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 't1', name: 'X', fip_id: 'fip-x-2026', starts_at: '2026-05-01' }],
    })
    const out = await findFipTwin('t1')
    expect(out).toBeNull()
  })

  it('returns the best twin candidate by name overlap + year', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: 't1', name: 'FIP Platinum Albania', fip_id: null, starts_at: '2026-05-26' }],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: 't2', name: 'FIP Platinum Albania 2026', slug: 'fip-platinum-albania-2026', fip_id: 'fip-platinum-albania-2026', starts_at: '2026-05-26' },
          { id: 't3', name: 'FIP Bronze Tirana', slug: 'fip-bronze-tirana-2026', fip_id: 'fip-bronze-tirana-2026', starts_at: '2026-04-10' },
        ],
      })
    const out = await findFipTwin('t1')
    expect(out?.candidate.id).toBe('t2')
    expect(out?.confidence).toBe('high')
  })
})

describe('linkFipTwin', () => {
  it('clears source row fip_id + slug, then copies them onto target inside a transaction', async () => {
    const clientQueryMock = vi.fn()
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })                                            // begin
      .mockResolvedValueOnce({ rows: [{ fip_id: 'fip-x-2026', slug: 'x-2026' }] })   // select for update
      .mockResolvedValueOnce({ rows: [] })                                            // UPDATE source
      .mockResolvedValueOnce({ rows: [] })                                            // UPDATE target
      .mockResolvedValueOnce({ rows: [] })                                            // commit
    const releaseMock = vi.fn()
    connectMock.mockResolvedValueOnce({
      query: clientQueryMock,
      release: releaseMock,
    })

    await linkFipTwin({ targetTournamentId: 't1', sourceTournamentId: 't2' })
    expect(clientQueryMock).toHaveBeenCalledTimes(5) // begin, select, 2x update, commit
    expect(releaseMock).toHaveBeenCalledTimes(1)
  })
})
