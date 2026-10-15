import { describe, expect, it } from 'vitest'
import { buildDrawNotificationContent, loadDrawNotificationContents } from '@/lib/draw-notification-content'

const tournament = { id: 't1', name: 'Brussels P2', level: 'P2' }
const triay = { id: 'p1', name: 'Gemma Triay Pons', display_name: 'Gemma Triay', avatar_url: 'https://example.test/triay.png', ranking: 1 }

describe('draw notification content', () => {
  it('personalizes the title and image, names the tournament and opens its draw', () => {
    expect(buildDrawNotificationContent(tournament, [triay], 'pt')).toEqual({
      title: 'O caminho de Triay já está definido',
      body: 'Saiu o quadro de Brussels P2. Veja os adversários e o caminho até a final.',
      icon: triay.avatar_url,
      url: '/tournaments/t1?tab=draw',
    })
  })
  it('uses the circuit image for tournament-only followers', () => {
    const result = buildDrawNotificationContent(tournament, [], 'pt')
    expect(result.title).toBe('Quadro disponível · Brussels P2')
    expect(result.icon).toBe('https://padelnachos.com/branding/premier-padel-star.png')
  })
  it('uses FIP branding when a FIP player has no photo', () => {
    const result = buildDrawNotificationContent({ ...tournament, level: 'fip_gold' }, [{ ...triay, avatar_url: null }], 'pt')
    expect(result.title).toContain('Triay')
    expect(result.icon).toBe('https://padelnachos.com/branding/fip-tour-icon.png')
  })
  it('selects a stable headliner when following several players', () => {
    const other = { ...triay, id: 'p2', display_name: 'Paula Brea', ranking: 2 }
    expect(buildDrawNotificationContent(tournament, [other, triay], 'pt'))
      .toEqual(buildDrawNotificationContent(tournament, [triay, other], 'pt'))
  })
  it('supports all app languages without leaking placeholders', () => {
    for (const locale of ['en', 'pt', 'es', 'fr', 'it']) {
      const result = buildDrawNotificationContent(tournament, [triay], locale)
      expect(result.title).toContain('Triay')
      expect(result.body).toContain('Brussels P2')
      expect(result.title + result.body).not.toMatch(/[{}]/)
    }
  })
  it('only personalizes for favorites actually in this bracket', async () => {
    const rows: Record<string, unknown> = {
      tournaments: tournament,
      tournament_draws: [{ player1_id: 'p1', player2_id: null, category: 'women' }],
      user_bookmarks: [{ user_id: 'follower', target_id: 'p1' }, { user_id: 'other', target_id: 'outside' }],
      players: [triay],
    }
    const supabase = { from: (table: string) => {
      const query = {
        select: () => query, eq: () => query, in: () => query, maybeSingle: () => query,
        then: (resolve: (value: unknown) => void) => resolve({ data: rows[table], error: null }),
      }
      return query
    } }
    const result = await loadDrawNotificationContents(supabase as never, 't1', ['follower', 'other'], new Map([['follower', 'pt'], ['other', 'pt']]))
    expect(result.byUser.get('follower')?.icon).toBe(triay.avatar_url)
    expect(result.byUser.get('follower')?.url).toBe('/tournaments/t1?tab=draw&category=women')
    expect(result.anonymous.url).toBe('/tournaments/t1?tab=draw&category=women')
    expect(result.byUser.get('other')?.title).toBe('Quadro disponível · Brussels P2')
    expect(result.anonymous.title).toBe('Draw available · Brussels P2')
    expect(result.anonymous.icon).toContain('premier-padel-star')
  })
})
