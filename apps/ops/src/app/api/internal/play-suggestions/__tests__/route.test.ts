import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),load:vi.fn(),client:vi.fn()}))
vi.mock('@/lib/auth',()=>({auth:mocks.auth}))
vi.mock('@/lib/supabase',()=>({serviceClient:mocks.client}))
vi.mock('@/lib/play-tournament-suggestions',()=>({loadTournamentSuggestions:mocks.load}))
import { GET } from '../route'
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({user:{isOperator:true}});mocks.load.mockResolvedValue({suggestions:[]})})
describe('suggestion access',()=>{
 it('rejects non-operators before reading projections',async()=>{
  mocks.auth.mockResolvedValue({user:{isOperator:false}})
  expect((await GET(new Request('https://admin.test/api/internal/play-suggestions'))).status).toBe(401)
  expect(mocks.client).not.toHaveBeenCalled()
 })
 it('rejects invalid tournament IDs',async()=>{
  expect((await GET(new Request('https://admin.test/api/internal/play-suggestions?tournament=bad'))).status).toBe(400)
  expect(mocks.client).not.toHaveBeenCalled()
 })
 it('returns fresh suggestions without writing or publishing',async()=>{
  const response=await GET(new Request('https://admin.test/api/internal/play-suggestions'))
  expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store')
  expect(mocks.load).toHaveBeenCalledWith(undefined,null)
 })
 it('fails closed without leaking database error details',async()=>{
  mocks.load.mockRejectedValue(new Error('database unavailable'))
  const response=await GET(new Request('https://admin.test/api/internal/play-suggestions'))
  expect(response.status).toBe(503)
  expect((await response.json()).suggestions).toBeUndefined()
 })
})
