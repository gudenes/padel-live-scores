import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { SupabaseClient } from '@supabase/supabase-js'
import { localSimulationLeaders } from '../local-simulation-leaders'
let dir: string | undefined
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); if (dir) rmSync(dir,{recursive:true,force:true}); dir=undefined })
it('excludes simulation from production and remote requests',async()=>{
 vi.stubEnv('NODE_ENV','production')
 expect(await localSimulationLeaders(new Request('http://localhost:3012'),{} as SupabaseClient,'week')).toEqual([])
 vi.stubEnv('NODE_ENV','development')
 expect(await localSimulationLeaders(new Request('https://padelnachos.com'),{} as SupabaseClient,'week')).toEqual([])
})
it('values recorded holdings, respects weekly activity and includes enrolled wallets outside the weekly board',async()=>{
 dir=mkdtempSync(path.join(tmpdir(),'sim-leaders-'));mkdirSync(path.join(dir,'.local/play-simulation'),{recursive:true})
 const db=new DatabaseSync(path.join(dir,'.local/play-simulation/simulation.sqlite'))
 db.exec(`CREATE TABLE bots(id TEXT,name TEXT,balance INTEGER,prize_eligible INTEGER);
 CREATE TABLE markets(id TEXT,source_market_id TEXT,status TEXT,q_yes REAL,q_no REAL,b REAL);
 CREATE TABLE positions(bot_id TEXT,market_id TEXT,side TEXT,shares REAL,cost INTEGER);
 CREATE TABLE trades(bot_id TEXT,created_at INTEGER);
 INSERT INTO bots VALUES('a','Ace',900,0),('b','Rayo',950,0),('idle','Idle',10000,0);
 INSERT INTO markets VALUES('m','source','open',0,0,1000);
 INSERT INTO positions VALUES('a','m','yes',153.9,100),('b','m','no',80,50);
 INSERT INTO trades VALUES('a',${Date.now()}),('b',1);`);db.close()
 vi.stubEnv('NODE_ENV','development');vi.spyOn(process,'cwd').mockReturnValue(dir)
 const client={from:()=>({select:()=>({in:async()=>({data:[{id:'source',status:'settled',outcome:true}],error:null})})})} as unknown as SupabaseClient
 const week=await localSimulationLeaders(new Request('http://localhost:3012'),client,'week')
 expect(week).toEqual([expect.objectContaining({userId:'sim:a',netWorth:1053,isSimulation:true,prizeEligible:false})])
 const all=await localSimulationLeaders(new Request('http://localhost:3012'),client,'all')
 expect(all).toHaveLength(3);expect(all.find(b=>b.userId==='sim:idle')?.netWorth).toBe(10000);expect(all.find(b=>b.userId==='sim:b')?.netWorth).toBe(950)
})
