import {afterEach, expect, it, vi} from 'vitest'
vi.mock('@/lib/supabase', () => ({createAnonServerClient: () => {throw new Error('database unavailable')}}))
import {GET} from '@/app/api/world-cup/route'
afterEach(()=>vi.unstubAllGlobals())
it('keeps official scheduled ties available when upstream squads and broadcasts fail', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('upstream unavailable')))
  const response = await GET()
  const data = await response.json()
  expect(response.status).toBe(200)
  expect(data.partial).toBe(true)
  expect(data.ties).toHaveLength(4)
  expect(data.ties.every((tie: {videoId:string; liveObservedAt?: string})=>!tie.videoId && !tie.liveObservedAt)).toBe(true)
})
