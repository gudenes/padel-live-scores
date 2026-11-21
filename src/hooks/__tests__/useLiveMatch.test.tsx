// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Match } from '@/types/match'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/match-fetch', () => ({ fetchMatchById: mocks.fetch }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  channel: () => { const c = { on: () => c, subscribe: () => c }; return c },
  removeChannel: mocks.remove,
} }))
import { useLiveMatch } from '../useLiveMatch'
const match = (level = 'ppl', status = 'live') => ({ id: 'match', status, tournament: { level } }) as unknown as Match
beforeEach(() => {
  vi.useFakeTimers(); mocks.fetch.mockReset(); mocks.remove.mockClear()
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  mocks.fetch.mockResolvedValue(match())
})
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('PPL live-card fallback refresh', () => {
  it('refreshes without realtime, stops at final, and cleans up', async () => {
    const { result, unmount } = renderHook(() => useLiveMatch('match', true, match()))
    await act(async () => {})
    mocks.fetch.mockResolvedValue(match('ppl', 'finished'))
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(result.current.status).toBe('finished')
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    unmount(); expect(mocks.remove).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not overlap reads or poll a hidden tab', async () => {
    let resolve!: (m: Match) => void
    mocks.fetch.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    renderHook(() => useLiveMatch('match', true, match()))
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    await act(async () => { resolve(match()) })
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(mocks.fetch).toHaveBeenCalledOnce()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it.each(['p1', 'fip_platinum', 'fip_gold'])('keeps %s on its existing realtime behavior', async level => {
    renderHook(() => useLiveMatch('match', true, match(level)))
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })
})
