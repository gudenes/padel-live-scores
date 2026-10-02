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
