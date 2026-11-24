import { beforeEach, describe, expect, it, vi } from 'vitest'
const access = vi.hoisted(()=>vi.fn())
vi.mock('@/lib/play-access',()=>({requirePlayAccess:access}))
vi.mock('../_signals',()=>({collectPlayerIds:()=>[],fetchRecentForm:async()=>new Map(),fetchHeadToHead:async()=>new Map()}))
import { GET } from './route'
import { parseMarkets } from '@/app/[locale]/(app)/play/_components/types'
const row={id:'ranking-market',public_id:'ranking-market',resolver_key:'player.reaches_ranking_v1',resolver_params:{playerId:'javi',rank:12,endsAt:'2026-11-30T23:59:59Z'},category:'men',seed_prob:.25,seed_source:'fixed',tokens:{price_source:'Editorial estimate from official rankings'},lmsr_b:1000,q_yes:1000*Math.log(.25),q_no:1000*Math.log(.75),volume_guacas:0,locks_at:'2026-10-01T00:00:00Z',question_snapshot:{es:'¿Llegará Javi al top 12?'},rules_snapshot:{es:'Clasificación oficial FIP'},match:null,template:{horizon:'season'},tournament:null}
function query(data:unknown){const q:any={select:vi.fn(()=>q),eq:vi.fn(()=>q),gt:vi.fn(()=>q),order:vi.fn(()=>q),limit:vi.fn(()=>q),in:vi.fn(()=>q),range:vi.fn(()=>q),then:(r:any)=>Promise.resolve({data,error:null,count:45}).then(r)};return q}
beforeEach(()=>access.mockReset())
describe('editorial market feed integration',()=>{
 it('hides the market API before querying data when Play access is absent',async()=>{access.mockResolvedValue(null);expect((await GET(new Request('http://localhost/api/play/markets'))).status).toBe(404)})
 it('delivers the large portrait, target and book through the real API and client parser',async()=>{
  const markets=query([row]);const from=vi.fn((table:string)=>table==='market_trades'?query([]):table==='markets'?markets:query([{id:'javi',name:'Javier Leal',display_name:'Javi Leal',photo_url:'https://example.com/javi-full.webp',avatar_url:'https://example.com/javi.png',ranking:15}]))
  access.mockResolvedValue({supabase:{from}})
  const response=await GET(new Request('http://localhost/api/play/markets?locale=es'))
  expect(response.status).toBe(200)
  const payload=await response.json()
  expect(payload.totalAvailable).toBe(45) // Total is not the bounded page length.
  const [card]=parseMarkets(payload)
  expect(card.editorial?.players[0].photoUrl).toContain('javi-full.webp')
  expect(card.editorial?.target).toBe(12)
  expect(card.editorial?.players[0].ranking).toBe(15)
  expect(card.modelProb).toBeNull();expect(card.baselineProb).toBeNull()
  expect(card.editorial?.openingProbability).toBe(.25)
  expect(card.book?.b).toBe(1000);expect(card.rules).toBe('Clasificación oficial FIP')
  expect(markets.select).toHaveBeenCalledWith(expect.any(String),{count:'exact'})
  expect(markets.eq).toHaveBeenCalledWith('status','open')
  expect(markets.gt).toHaveBeenCalledWith('locks_at',expect.any(String))
 })
})

it('counts unique unplayed open markets globally, including beyond the first page',async()=>{
 const trades=query([{market_id:'played-a'},{market_id:'played-a'},{market_id:'played-b'}])
 const markets=query([])
 access.mockResolvedValue({userId:'me',supabase:{from:(table:string)=>table==='market_trades'?trades:markets}})
 const response=await GET(new Request('http://localhost/api/play/markets?matchId=11111111-1111-1111-1111-111111111111'))
 expect(await response.json()).toMatchObject({totalAvailable:45,unplayedCount:43,playedMarketIds:['played-a','played-b']})
 expect(trades.eq).toHaveBeenCalledWith('user_id','me')
 expect(trades.eq).toHaveBeenCalledWith('direction','buy')
 expect(trades.eq).toHaveBeenCalledWith('markets.status','open')
 expect(trades.gt).toHaveBeenCalledWith('markets.locks_at',expect.any(String))
})
