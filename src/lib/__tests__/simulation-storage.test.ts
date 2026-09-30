import { afterEach, expect, it, vi } from 'vitest'
import { simulationStoragePath } from '../simulation-storage'
afterEach(()=>vi.unstubAllEnvs())
it('never reads SQLite in production',()=>{
 vi.stubEnv('NODE_ENV','production')
 vi.stubEnv('PLAY_SIMULATION_DB_PATH','')
 expect(simulationStoragePath(new Request('http://localhost'))).toBeNull()
 vi.stubEnv('PLAY_SIMULATION_DB_PATH','/tmp/simulation.sqlite')
 expect(simulationStoragePath(new Request('https://padelnachos.com'))).toBeNull()
 vi.stubEnv('PLAY_SIMULATION_DB_PATH','/data/play-simulation/simulation.sqlite')
 expect(simulationStoragePath(new Request('https://padelnachos.com'))).toBeNull()
})
