import pg from 'pg'
import { setTimeout as sleep } from 'node:timers/promises'
import { postgresTick } from './postgres-engine.mjs'
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:1,connectionTimeoutMillis:10000,statement_timeout:15000,application_name:'play-simulation'})
pool.on('error',()=>console.warn('[simulation] database connection interrupted'))
let stopping=false
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{stopping=true})
try {
 while(!stopping) {
  let db
  try {
   db=await pool.connect()
   const result=await postgresTick(db)
   if(result.accepted) console.log('[simulation] recorded simulated trade')
  } catch {console.warn('[simulation] tick failed; transaction rolled back')}
  finally {db?.release()}
  await sleep(5000)
 }
} finally {await pool.end()}
