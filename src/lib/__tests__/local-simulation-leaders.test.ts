import {afterEach,expect,it,vi} from 'vitest'
import type {SupabaseClient} from '@supabase/supabase-js'
import {localSimulationLeaders,simulationNetWinnings} from '../local-simulation-leaders'
afterEach(()=>{vi.unstubAllEnvs()})
it('excludes simulation from production when disabled and remote local requests',async()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('PLAY_SIMULATION_ENABLED','false')
 expect(await localSimulationLeaders(new Request('http://localhost:3012'),{} as SupabaseClient,'week')).toEqual([])
 vi.stubEnv('NODE_ENV','development')
 expect(await localSimulationLeaders(new Request('https://padelnachos.com'),{} as SupabaseClient,'week')).toEqual([])
})
it('ranks confirmed results by profit using result time, seasons and corrections',()=>{
 const now=Date.parse('2026-10-02T12:00:00Z')
 const result={id:'m',status:'settled',outcome:true,settled_at:'2026-10-01T00:00:00Z',season_id:'s'}
 const holdings=[{bot_id:'a',source_market_id:'m',side:'yes',shares:153.9,cost:100},{bot_id:'b',source_market_id:'m',side:'no',shares:80,cost:50}]
 expect(Object.fromEntries(simulationNetWinnings(holdings,[result],'week','s',now))).toEqual({a:53,b:-50})
 expect(simulationNetWinnings(holdings,[{...result,status:'open'}],'all',null,now).size).toBe(0)
 expect(simulationNetWinnings(holdings,[{...result,status:'void'}],'all',null,now).size).toBe(0)
 expect(simulationNetWinnings(holdings,[result],'season','other',now).size).toBe(0)
 expect(simulationNetWinnings(holdings,[{...result,settled_at:'2026-09-01T00:00:00Z'}],'week','s',now).size).toBe(0)
 expect(simulationNetWinnings(holdings,[result],'all',null,now).get('a')).toBe(53)
 expect(simulationNetWinnings(holdings,[{...result,outcome:false}],'all',null,now).get('a')).toBe(-100)
})
it('includes weekly bot trades before settlement without resetting losses',async()=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('PLAY_SIMULATION_ENABLED','true')
 const now=new Date().toISOString()
 const calls:unknown[][]=[]
 const rows:Record<string,unknown[]>={
  play_sim_bots:[{id:'new',name:'Bot 1'},{id:'lost',name:'Bot 2'},{id:'inactive',name:'Bot 3'}],
  play_sim_positions:[{bot_id:'lost',market_id:'sim-m',side:'no',shares:50,cost:100}],
  play_sim_markets:[{id:'sim-m',source_market_id:'m'}],
  play_sim_trades:[{bot_id:'new'},{bot_id:'new'},{bot_id:'lost'}],
  markets:[{id:'m',status:'settled',outcome:true,settled_at:now,season_id:'s'}],
 }
 const from=(table:string)=>{
  const q:Record<string,unknown>={then:(resolve:(x:unknown)=>unknown)=>Promise.resolve({data:rows[table],error:null}).then(resolve)}
  for(const method of ['select','eq','order','range','not','gte','lt','in'])q[method]=(...args:unknown[])=>{calls.push([table,method,...args]);return q}
  return q
 }
 const leaders=await localSimulationLeaders(new Request('https://padelnachos.com'),{from} as unknown as SupabaseClient,'week','s')
 expect(leaders.map(x=>[x.userId,x.netWinnings])).toEqual([['sim:new',0],['sim:lost',-100]])
 expect(leaders.every(x=>!x.prizeEligible)).toBe(true)
 expect(calls.some(x=>x[0]==='play_sim_trades'&&x[1]==='gte'&&x[2]==='created_at'&&typeof x[3]==='number')).toBe(true)
 expect(calls.some(x=>x[0]==='play_sim_trades'&&x[1]==='lt'&&x[2]==='created_at')).toBe(true)
})
