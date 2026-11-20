import { expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),load:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/integration-history-source',()=>({loadIntegrationHistory:mocks.load}))
import { GET } from '@/app/api/internal/integration-monitor/history/route'
it('requires an operator before loading history',async()=>{
  mocks.auth.mockResolvedValue({user:{isOperator:false}})
  expect((await GET(new Request('http://localhost/api?range=24h'))).status).toBe(401)
  expect(mocks.load).not.toHaveBeenCalled()
})
it('rejects unbounded history ranges',async()=>{
  mocks.auth.mockResolvedValue({user:{isOperator:true}})
  expect((await GET(new Request('http://localhost/api?range=365d'))).status).toBe(400)
  expect(mocks.load).not.toHaveBeenCalled()
})
it('does not substitute empty history for database errors',async()=>{
  mocks.load.mockRejectedValueOnce(new Error('private database error'))
  const response=await GET(new Request('http://localhost/api?range=24h'))
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('private database error')
})
it('returns real aggregates and privately caches repeated requests',async()=>{
  mocks.load.mockResolvedValueOnce({fetchedAt:'2026-11-20T13:00:00Z',hours:24,rows:[]})
  const response=await GET(new Request('http://localhost/api?range=24h'))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  await GET(new Request('http://localhost/api?range=24h'))
  expect(mocks.load).toHaveBeenCalledTimes(2)
})
