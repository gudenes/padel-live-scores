import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { localMarketActivity } from '../local-market-activity'

let directory: string | undefined
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined })
it('never exposes simulation activity on production or non-local hosts', () => {
  vi.stubEnv('NODE_ENV', 'production')
  expect(localMarketActivity(new Request('http://localhost:3012/api/play/activity'), null)).toEqual([])
  vi.stubEnv('NODE_ENV', 'development')
  expect(localMarketActivity(new Request('https://padelnachos.com/api/play/activity'), null)).toEqual([])
})
it('returns only persisted trades for the requested source market, explicitly labelled', () => {
  directory = mkdtempSync(path.join(tmpdir(), 'activity-test-'))
  mkdirSync(path.join(directory, '.local/play-simulation'), { recursive: true })
  const db = new DatabaseSync(path.join(directory, '.local/play-simulation/simulation.sqlite'))
  db.exec(`CREATE TABLE bots(id TEXT,name TEXT); CREATE TABLE markets(id TEXT,source_market_id TEXT,question TEXT);
    CREATE TABLE trades(id TEXT,bot_id TEXT,market_id TEXT,side TEXT,cost INTEGER,price REAL,created_at INTEGER);
    INSERT INTO bots VALUES('b1','Chispa'); INSERT INTO markets VALUES('a','source-a','Market A'),('b','source-b','Market B');
    INSERT INTO trades VALUES('t1','b1','a','yes',100,0.5,1000),('t2','b1','b','no',50,0.4,2000);`)
  db.close()
  vi.stubEnv('NODE_ENV', 'development'); vi.spyOn(process, 'cwd').mockReturnValue(directory)
  const result = localMarketActivity(new Request('http://localhost:3012/api/play/activity'), 'source-a')
  expect(result).toHaveLength(1)
  expect(result[0]).toMatchObject({ id:'sim:t1', marketId:'source-a', isSimulation:true, isMe:false, guacas:100, displayName:'Chispa' })
  expect(localMarketActivity(new Request('http://localhost:3012/api/play/activity'), 'unknown')).toEqual([])
})
