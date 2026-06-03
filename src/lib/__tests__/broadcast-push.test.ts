// src/lib/__tests__/broadcast-push.test.ts
import { describe, it, expect, vi } from 'vitest'
import { runBroadcast, resultToCountsRow, type BroadcastDeps } from '../broadcast-push'

function deps(over: Partial<BroadcastDeps> = {}): BroadcastDeps {
  return {
    fetchWebSubs: vi.fn(async () => [
      { id: 'w1', endpoint: 'e1', keys: { p256dh: 'a', auth: 'b' } },
      { id: 'w2', endpoint: 'e2', keys: { p256dh: 'a', auth: 'b' } },
    ]),
    fetchFcmTokens: vi.fn(async () => ['t1', 't2', 't3']),
    fetchAnonSubs: vi.fn(async () => [
      { id: 'a1', endpoint: 'ae1', keys: { p256dh: 'a', auth: 'b' } },
    ]),
    sendWeb: vi.fn(async () => true),
    sendFcm: vi.fn(async (tokens: string[]) => ({ success: tokens.length, failed: 0, invalidTokens: [] })),
    cleanupWebStale: vi.fn(async () => {}),
    cleanupFcmStale: vi.fn(async () => {}),
    cleanupAnonStale: vi.fn(async () => {}),
    ...over,
  }
}

describe('runBroadcast', () => {
  it('sends across all channels and aggregates accepted counts', async () => {
    const d = deps()
    const r = await runBroadcast({ title: 'Hi', body: 'Help us!', sendId: 's1' }, d)

    expect(r.web).toEqual({ fired: 2, accepted: 2, stale: 0 })
    expect(r.fcm).toEqual({ fired: 3, accepted: 3, failed: 0, stale: 0 })
    expect(r.anon).toEqual({ fired: 1, accepted: 1, stale: 0 })
    expect(r.recipients_total).toBe(6)
    expect(r.accepted_total).toBe(6)
    expect(r.dry_run).toBe(false)
    // 2 authenticated web subs + 1 anon sub, all over web-push (sendWeb).
    expect(d.sendWeb).toHaveBeenCalledTimes(3)
    expect(d.cleanupWebStale).not.toHaveBeenCalled()
  })

  it('counts stale web subs and cleans them up', async () => {
    const sendWeb = vi.fn(async (sub: { endpoint: string }) => sub.endpoint !== 'e2')
    const cleanupWebStale = vi.fn(async () => {})
    const r = await runBroadcast({ title: 'x', body: 'y' }, deps({ sendWeb, cleanupWebStale }))
    expect(r.web).toEqual({ fired: 2, accepted: 1, stale: 1 })
    expect(cleanupWebStale).toHaveBeenCalledWith(['w2'])
  })

  it('cleans up stale ANON subs via cleanupAnonStale, not cleanupWebStale', async () => {
    // anon endpoint 'ae1' is stale; web endpoints e1/e2 are fine.
    const sendWeb = vi.fn(async (sub: { endpoint: string }) => sub.endpoint !== 'ae1')
    const cleanupWebStale = vi.fn(async () => {})
    const cleanupAnonStale = vi.fn(async () => {})
    const r = await runBroadcast({ title: 'x', body: 'y' }, deps({ sendWeb, cleanupWebStale, cleanupAnonStale }))
    expect(r.anon).toEqual({ fired: 1, accepted: 0, stale: 1 })
    expect(cleanupAnonStale).toHaveBeenCalledWith(['a1'])
    expect(cleanupWebStale).not.toHaveBeenCalled()
  })

  it('handles empty subscriptions with all-zero counts and no sends', async () => {
    const d = deps({
      fetchWebSubs: vi.fn(async () => []),
      fetchFcmTokens: vi.fn(async () => []),
      fetchAnonSubs: vi.fn(async () => []),
    })
    const r = await runBroadcast({ title: 'x', body: 'y' }, d)
    expect(r.recipients_total).toBe(0)
    expect(r.accepted_total).toBe(0)
    expect(d.sendWeb).not.toHaveBeenCalled()
    expect(d.sendFcm).not.toHaveBeenCalled()
    expect(d.cleanupAnonStale).not.toHaveBeenCalled()
  })

  it('maps fcm failures and invalid tokens', async () => {
    const sendFcm = vi.fn(async () => ({ success: 1, failed: 1, invalidTokens: ['t3'] }))
    const cleanupFcmStale = vi.fn(async () => {})
    const r = await runBroadcast({ title: 'x', body: 'y' }, deps({ sendFcm, cleanupFcmStale }))
    expect(r.fcm).toEqual({ fired: 3, accepted: 1, failed: 1, stale: 1 })
    expect(cleanupFcmStale).toHaveBeenCalledWith(['t3'])
  })

  it('dry run counts reach but sends nothing', async () => {
    const d = deps()
    const r = await runBroadcast({ title: 'x', body: 'y', dryRun: true }, d)
    expect(r.dry_run).toBe(true)
    expect(r.recipients_total).toBe(6)
    expect(r.accepted_total).toBe(0)
    expect(r.web.fired).toBe(2)
    expect(d.sendWeb).not.toHaveBeenCalled()
    expect(d.sendFcm).not.toHaveBeenCalled()
    expect(d.cleanupWebStale).not.toHaveBeenCalled()
  })

  it('resultToCountsRow flattens to DB columns', () => {
    const row = resultToCountsRow({
      web: { fired: 2, accepted: 2, stale: 0 },
      fcm: { fired: 3, accepted: 3, failed: 0, stale: 0 },
      anon: { fired: 1, accepted: 1, stale: 0 },
      recipients_total: 6, accepted_total: 6, dry_run: false,
    })
    expect(row).toEqual({
      web_fired: 2, web_accepted: 2, web_stale: 0,
      fcm_fired: 3, fcm_accepted: 3, fcm_failed: 0, fcm_stale: 0,
      anon_fired: 1, anon_accepted: 1, anon_stale: 0,
      recipients_total: 6, accepted_total: 6,
    })
  })
})
