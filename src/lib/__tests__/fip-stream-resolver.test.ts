// src/lib/__tests__/fip-stream-resolver.test.ts
import { describe, it, expect } from 'vitest'
import { resolveStreamForMatch } from '../fip-stream-resolver'

function mockClient(courtRows: unknown[], anyRows: unknown[]) {
  // Two-stage mock: first .maybeSingle() (court+day query) resolves to
  // courtRows[0]; second (any-stream-for-tournament query) resolves to
  // anyRows[0]. Mimics Supabase's maybeSingle() which returns a single
  // object (or null), not an array.
  let queryCount = 0
  const supabase = {
    from(_table: string) {
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.in = () => builder
      builder.order = () => builder
      builder.limit = () => builder
      builder.maybeSingle = () => {
        queryCount++
        const rows = queryCount === 1 ? courtRows : anyRows
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      }
      return builder as never
    },
  }
  return { supabase }
}

describe('resolveStreamForMatch', () => {
  it('returns null for non-FIP-tier matches', async () => {
    const { supabase } = mockClient([], [])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'premier_p1',
      court: 'Centre Court',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    })
    expect(r).toBeNull()
  })

  it('returns Tier 2 when court stream exists', async () => {
    const { supabase } = mockClient([{
      youtube_video_id: 'abc123',
      title: 'FIP Silver Mendoza | Day 4 | Centre Court',
      thumbnail_url: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
      state: 'live',
      manual_offset_seconds: null,
    }], [])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'fip_silver',
      court: 'Centre Court',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    })
    expect(r?.tier).toBe(2)
    expect(r?.state).toBe('live')
    expect(r?.url).toBe('https://www.youtube.com/watch?v=abc123')
  })

  it('returns Tier 1 when manual_offset_seconds is set', async () => {
    const { supabase } = mockClient([{
      youtube_video_id: 'abc123',
      title: 'Day stream',
      thumbnail_url: null,
      state: 'archived',
      manual_offset_seconds: 6210,
    }], [])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'fip_silver',
      court: 'Centre Court',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    })
    expect(r?.tier).toBe(1)
    expect(r?.url).toBe('https://www.youtube.com/watch?v=abc123&t=6210s')
  })

  it('returns Tier 3 when tournament has streams but none for this court', async () => {
    const { supabase } = mockClient([], [{ youtube_video_id: 'other' }])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'fip_silver',
      court: 'Pista 5',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    }, 'Mendoza Open')
    expect(r?.tier).toBe(3)
    expect(r?.state).toBe('channel')
    expect(r?.url).toContain('search?query=Mendoza')
  })

  it('returns Tier 4 when tournament has no streams known at all', async () => {
    const { supabase } = mockClient([], [])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'fip_bronze',
      court: 'Court 2',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    })
    expect(r?.tier).toBe(4)
    expect(r?.url).toBe('https://www.youtube.com/c/fipinternationalpadelfederation')
  })
})
