import { describe, it, expect, vi } from 'vitest'

// Mock pgPool — its query returns canned rows.
const queryMock = vi.fn()
vi.mock('@/lib/db', () => ({
  pgPool: () => ({ query: queryMock }),
}))

import { getActiveTournamentList } from '@/lib/tournament-list-aggregator'

describe('getActiveTournamentList', () => {
  it('returns tournaments sorted by starts_at desc, with latestSnapshotAt', async () => {
    queryMock.mockReset()
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 't1', name: 'FIP PLATINUM ALBANIA', starts_at: '2026-05-24', ends_at: '2026-05-30',
          source: 'padelapi', level: 'fip_platinum', country: 'AL', fip_id: 'fip-platinum-albania-2026',
          latest_snapshot_at: '2026-05-25T08:00:00Z',
        },
      ],
    })
    const out = await getActiveTournamentList()
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('t1')
    expect(out[0].latestSnapshotAt).toBe('2026-05-25T08:00:00Z')
  })
})
