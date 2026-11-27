/** Race worker. Derived state and telemetry are shared; the FIP importer owns the Monday
 * publication; this worker adopts new snapshots and revalidates each breakdown.
 * Polling every minute also catches delayed Monday publications and corrections.
 */
import env from '@next/env'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
env.loadEnvConfig(process.cwd())
process.env.NODE_ENV ??= 'development'
const {refreshRace}=await import('../src/lib/live-race/service.ts')
const {acquireRaceLock}=await import('../src/lib/live-race/lock.ts')
const {fipUsage}=await import('../src/lib/live-race/fip.ts')
const lock=path.join(process.cwd(),'.local/race/watcher.lock')
await mkdir(path.dirname(lock),{recursive:true})
if(!await acquireRaceLock(lock)) throw new Error('Race watcher already running')
let stopped=false
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopped=true})
console.log('Race watcher: full FIP snapshots + real results; shared derived snapshots and monitored fetches. Checks every minute, including Mondays.')
try {
  do {
    for(const gender of ['men','women'] as const) {
      if(stopped)break
      try {const s=await refreshRace(gender,process.env.NODE_ENV==='production'?24:512);console.log(JSON.stringify({gender,baseline:s?.baselineDate,total:s?.totalPlayers,applied:s?.appliedPlayers,pending:s?.pendingPlayers,status:s?.status,...fipUsage()}))}
      catch(e) {console.error('Race refresh:',e instanceof Error?e.message:'failed')}
    }
    if(process.argv.includes('--once'))break
    for(let i=0;i<60&&!stopped;i++)await new Promise(resolve=>setTimeout(resolve,1000))
  }while(!stopped)
}finally{await rm(lock,{recursive:true,force:true})}
