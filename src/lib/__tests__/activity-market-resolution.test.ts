import {expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({access:vi.fn(),local:vi.fn()}))
vi.mock('@/lib/play-access',()=>({requirePlayAccess:mocks.access}))
vi.mock('@/lib/local-market-activity',()=>({localMarketActivity:mocks.local,productionMarketActivity:mocks.local}))
vi.mock('@/app/api/play/_shared',()=>({MARKET_SELECT:'id',describeMarket:(m:any)=>({question:`Will ${m.pair} win?`,publicId:'market-public',context:'Rotterdam'}),num:Number,parseLocale:()=> 'en',playNotFound:()=>new Response(null,{status:404})}))
import {GET} from '@/app/api/play/activity/route'
it('resolves bot placeholders from the canonical market without changing the recorded bet',async()=>{
 const bot={id:'sim:1',marketId:'m1',question:'Will {pair1} win?',side:'no',guacas:137,price:.42,createdAt:'2026-09-29T10:00:00Z',isSimulation:true}
 mocks.local.mockReturnValue([bot,{...bot,id:'sim:orphan',marketId:'deleted'}])
 mocks.access.mockResolvedValue({userId:'viewer',supabase:{from:(table:string)=>({select:()=> table==='market_trades'?{order:()=>({limit:async()=>({data:[],error:null})})}:{in:async()=>({data:[{id:'m1',pair:'Tapia / Coello',status:'open',locks_at:'2030-01-01'}],error:null})}})}})
 const response=await GET(new Request('http://localhost/api/play/activity'))
 const body=await response.json()
 expect(body.trades).toHaveLength(1)
 expect(body.trades[0]).toMatchObject({...bot,question:'Will Tapia / Coello win?',context:'Rotterdam',publicId:'market-public'})
})
