import { describe, expect, it } from 'vitest'
import { buildScheduledNotificationContent, loadScheduledNotificationContents } from '@/lib/scheduled-notification-content'
import type { PushMatch, PushPlayer } from '@/lib/push-copy'
const tapia: PushPlayer = { id: 't', name: 'Agustin Tapia', display_name: 'Agustin Tapia', avatar_url: 'https://image/tapia.png', ranking: 1 }
const galan: PushPlayer = { id: 'g', name: 'Ale Galan', display_name: 'Ale Galan', avatar_url: 'https://image/galan.png', ranking: 3 }
const other: PushPlayer = { id: 'o', name: 'Other Player', display_name: 'Other Player', avatar_url: null, ranking: 2 }
function match(id: string, player: PushPlayer, time = '2026-10-16T16:00:00Z'): PushMatch {
  return { id, round: 'R16', court: 'Court 1', status: 'scheduled', schedule_label: 'Followed by', scheduled_at: time,
    category: 'men', winner_pair: null, tournament: { name: 'Madrid', level: 'P1', timezone: 'Europe/Madrid' },
    pair1_player1: player, pair1_player2: other, pair2_player1: null, pair2_player2: null, sets: [] }
}
const recipient = { locale: 'en', timeZone: 'America/Sao_Paulo' }
const none = new Set<string>()

describe('grouped schedule content', () => {
  it('sends a single summary led by the best-ranked followed player, with local estimated time', () => {
    const out = buildScheduledNotificationContent([match('g1', galan), match('t1', tapia)], new Set(['g', 't']), none, recipient)
    expect(out?.title).toBe('Tapia +1 more · schedules ready')
    expect(out?.icon).toBe(tapia.avatar_url)
    expect(out?.body).toContain('Tapia · estimated start 13:00')
    expect(out?.url).toBe('/following')
  })
  it('does not count opponents or a repeated favorite twice', () => {
    const out = buildScheduledNotificationContent([match('t1', tapia), match('t2', tapia), match('g1', galan)], new Set(['t', 'g']), none, recipient)
    expect(out?.title).toBe('Tapia +1 more · schedules ready')
  })
  it('chooses from this recipient’s favorites, not the globally top-ranked player', () => {
    const out = buildScheduledNotificationContent([match('t1', tapia), match('g1', galan)], new Set(['g']), none, recipient)
    expect(out?.title).toBe('Galan · estimated start 13:00')
    expect(out?.icon).toBe(galan.avatar_url)
    expect(out?.url).toBe('/match/g1')
  })
  it('handles match-only bookmarks without inventing a followed player', () => {
    const out = buildScheduledNotificationContent([match('t1', tapia), match('g1', galan)], none, new Set(['t1', 'g1']), recipient)
    expect(out?.title).toBe('2 matches · schedules ready')
    expect(out?.icon).toContain('premier-padel-star')
  })
  it('shows +1 when following two players in the same match and opens that match', () => {
    const out = buildScheduledNotificationContent([match('t1', tapia)], new Set(['t', 'o']), none, recipient)
    expect(out?.title).toBe('Tapia +1 more · schedules ready')
    expect(out?.url).toBe('/match/t1')
  })
  it('puts unranked favorites last and ignores finished matches', () => {
    const out = buildScheduledNotificationContent([match('t1', { ...tapia, ranking: null }), match('g1', galan)], new Set(['t', 'g']), none, recipient)
    expect(out?.title).toBe('Galan +1 more · schedules ready')
    expect(buildScheduledNotificationContent([{ ...match('t1', tapia), status: 'finished' }], new Set(['t']), none, recipient)).toBeNull()
  })
  it('personalizes anonymous subscriptions using each device’s own follows', async () => {
    const m = match('t1', tapia)
    const data: Record<string, unknown[]> = {
      matches: [m], anon_bookmarks: [{ device_id: 'd1', bookmark_type: 'player', target_id: 't' }, { device_id: 'd2', bookmark_type: 'player', target_id: 'unrelated' }],
    }
    const supa = { from: (table: string) => {
      const q = { select: () => q, in: () => q, then: (resolve: (v: unknown) => void) => resolve({ data: data[table] ?? [], error: null }) }
      return q
    } }
    const subs = ['d1', 'd2'].map(id => ({ id, device_id: id, endpoint: 'e', p256dh_key: 'k', auth_key: 'a' }))
    const out = await loadScheduledNotificationContents(supa as never, ['t1'], [], subs, new Map(), new Map())
    expect(out.bySubscription.get('d1')?.icon).toBe(tapia.avatar_url)
    expect(out.bySubscription.has('d2')).toBe(false)
  })
})
