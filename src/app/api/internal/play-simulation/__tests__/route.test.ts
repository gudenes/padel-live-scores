import { afterEach, expect, it, vi } from 'vitest'
import { POST } from '../route'
afterEach(()=>vi.unstubAllEnvs())
it('fails closed without a secret and rejects malformed credentials without throwing',async()=>{
 const req=(token:string)=>new Request('https://padelnachos.com/api/internal/play-simulation',{method:'POST',headers:{authorization:'Bearer '+token},body:'{}'})
 vi.stubEnv('PLAY_SIMULATION_ADMIN_SECRET','')
 expect((await POST(req(''))).status).toBe(404)
 vi.stubEnv('PLAY_SIMULATION_ADMIN_SECRET','secret')
 vi.stubEnv('PLAY_SIMULATION_DB_PATH','/data/simulation.sqlite')
 expect((await POST(req('éééééé'))).status).toBe(404)
 expect((await POST(req('wrong'))).status).toBe(404)
})
it('accepts no arbitrary command even with the service credential',async()=>{
 vi.stubEnv('PLAY_SIMULATION_ADMIN_SECRET','secret')
 vi.stubEnv('PLAY_SIMULATION_DB_PATH','/data/simulation.sqlite')
 for(const args of [['run'],['import','/etc/passwd'],['configure','1001','5000'],['configure','10','1']]){
 const response=await POST(new Request('https://padelnachos.com/api/internal/play-simulation',{method:'POST',headers:{authorization:'Bearer secret'},body:JSON.stringify({args})}))
 expect(response.status).toBe(400)
 }
})
