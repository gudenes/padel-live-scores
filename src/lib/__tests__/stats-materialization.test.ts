import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, afterAll, it, expect } from 'vitest'
const db = new PGlite()
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
async function totals(player = 1) {
  return (await db.query<{season:number;wins:number;matches:number;win_rate:number|null}>(`SELECT season,wins,matches,win_rate FROM player_season_stats WHERE player_id=$1 ORDER BY season`, [id(player)])).rows
}
async function match(n: number, date: string | null = '2026-11-25', status = 'finished') {
  await db.query(`INSERT INTO matches(id,tournament_id,status,winner_pair,scheduled_at,finished_at,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id) VALUES($1,$2,$3,1,$4,'2026-11-26',$5,$6,$7,$8)`,[id(n),id(50),status,date,id(1),id(2),id(3),id(4)])
}
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
    CREATE TABLE players(id uuid PRIMARY KEY);
    CREATE TABLE tournaments(id uuid PRIMARY KEY,starts_at timestamptz,level text);
    CREATE TABLE matches(id uuid PRIMARY KEY,tournament_id uuid REFERENCES tournaments(id),status text,winner_pair integer,scheduled_at timestamptz,started_at timestamptz,finished_at timestamptz,pair1_player1_id uuid,pair1_player2_id uuid,pair2_player1_id uuid,pair2_player2_id uuid);
    CREATE TABLE match_stats(match_id uuid,set_number integer,source text,computed_at timestamptz,raw_payload jsonb,PRIMARY KEY(match_id,set_number));
    CREATE TABLE entity_external_ids(entity_id uuid,entity_type text,source text,external_id text);
    INSERT INTO players SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,5) n;
    INSERT INTO tournaments VALUES('${id(50)}','2026-01-01T00:00:00Z','major');`)
  await match(100)
  await db.exec(readFileSync('supabase/migrations/20261126090000_player_season_stats.sql','utf8'))
  await db.query(`INSERT INTO match_stats VALUES($1,0,'crionet_widget',now(),$2)`,[id(100),JSON.stringify({team1:{breakPointsConvertedPct:33},team2:{breakPointsConvertedPct:30}})])
  await db.exec(readFileSync('supabase/migrations/20261126091000_match_stats_fetch_candidates.sql','utf8'))
}, 30000)
afterAll(() => db.close())
it('backfills and updates only the stored counts; repeat writes are idempotent',async()=>{
  expect((await db.query('SELECT team1_break_points_converted_pct,team2_break_points_converted_pct FROM match_stats')).rows[0]).toEqual({team1_break_points_converted_pct:33,team2_break_points_converted_pct:30})
  expect(await totals()).toEqual([{season:2026,wins:1,matches:1,win_rate:100}])
  await db.exec(`UPDATE matches SET winner_pair=1 WHERE id='${id(100)}'`)
  expect((await totals())[0].matches).toBe(1)
  await db.exec(`UPDATE matches SET winner_pair=2 WHERE id='${id(100)}'`)
  expect((await totals())[0]).toMatchObject({wins:0,matches:1,win_rate:0})
  expect((await totals(3))[0].wins).toBe(1)
})
it('moves contributions when a player or season is corrected and removes cancelled/deleted results',async()=>{
  await db.exec(`UPDATE matches SET pair1_player1_id='${id(5)}', scheduled_at='2025-12-31' WHERE id='${id(100)}'`)
  expect((await totals())[0].matches).toBe(0)
  expect(await totals(5)).toEqual([{season:2025,wins:0,matches:1,win_rate:0}])
  await db.exec(`UPDATE matches SET status='walkover' WHERE id='${id(100)}'`)
  expect((await totals(5))[0].matches).toBe(0)
  await db.exec(`UPDATE matches SET status='retired' WHERE id='${id(100)}'`)
  expect((await totals(5))[0].matches).toBe(1)
  await db.exec(`DELETE FROM matches WHERE id='${id(100)}'`)
  expect((await totals(5))[0].matches).toBe(0)
})
it('moves undated matches when the tournament season changes',async()=>{
  await match(101,null)
  await db.exec(`UPDATE tournaments SET starts_at='2027-01-01T00:00:00Z' WHERE id='${id(50)}'`)
  expect((await totals()).find(r=>r.season===2027)?.matches).toBe(1)
  expect((await totals()).find(r=>r.season===2026)?.matches).toBe(0)
  await db.exec(`DELETE FROM matches WHERE id='${id(101)}'`)
})
it('claims a bounded recent batch beyond 10,000 old mappings, skips final stats and delays retries',async()=>{
  await db.exec(`INSERT INTO entity_external_ids SELECT gen_random_uuid(),'match','crionet_widget','FIP-2026-1:MD'||n FROM generate_series(1,10001) n`)
  for(let n=200;n<222;n++) {
    await match(n)
    await db.query(`INSERT INTO entity_external_ids VALUES($1,'match','crionet_widget',$2)`,[id(n),`FIP-2026-4801:MD${n}`])
  }
  await db.query(`INSERT INTO match_stats VALUES($1,0,'crionet_widget','2026-11-27',null,null,null)`,[id(200)])
  expect((await db.query('SELECT * FROM claim_match_stats_candidates($1)',[[id(51)]])).rows).toHaveLength(0)
  const first=await db.query<{entity_id:string}>('SELECT * FROM claim_match_stats_candidates()')
  expect(first.rows).toHaveLength(20)
  expect(first.rows.some(r=>r.entity_id===id(200))).toBe(false)
  const second=await db.query('SELECT * FROM claim_match_stats_candidates()')
  expect(second.rows).toHaveLength(1)
  expect((await db.query('SELECT * FROM claim_match_stats_candidates()')).rows).toHaveLength(0)
  await db.exec(`UPDATE match_stats_fetch_state SET next_attempt_at=now()-interval '1 second'`)
  expect((await db.query('SELECT * FROM claim_match_stats_candidates()')).rows).toHaveLength(20)
})
it('prioritizes live and recently completed matches over historical catch-up',async()=>{
  await match(300,'2026-11-25','live')
  await match(301)
  await db.query('UPDATE matches SET finished_at=now() WHERE id=$1',[id(301)])
  for(const n of [300,301]) await db.query(`INSERT INTO entity_external_ids VALUES($1,'match','crionet_widget',$2)`,[id(n),`FIP-2026-4801:MD${n}`])
  const batch=(await db.query<{entity_id:string}>('SELECT * FROM claim_match_stats_candidates()')).rows
  expect(batch.some(r=>r.entity_id===id(300))).toBe(true)
  expect(batch.some(r=>r.entity_id===id(301))).toBe(true)
  const delays=(await db.query<{match_id:string;seconds:number}>(`SELECT match_id,extract(epoch FROM next_attempt_at-now())::integer AS seconds FROM match_stats_fetch_state WHERE match_id IN ($1,$2)`,[id(300),id(301)])).rows
  expect(delays.find(r=>r.match_id===id(300))!.seconds).toBeGreaterThan(230)
  expect(delays.find(r=>r.match_id===id(301))!.seconds).toBeGreaterThan(890)
})
it('does not expose claim or materialization writes to anonymous users',async()=>{
  await db.exec('SET ROLE anon')
  expect((await db.query('SELECT * FROM player_season_stats LIMIT 1')).rows).toHaveLength(1)
  await expect(db.query('SELECT * FROM claim_match_stats_candidates()')).rejects.toThrow(/permission denied/)
  await expect(db.query('DELETE FROM player_season_stats')).rejects.toThrow(/permission denied/)
  await db.exec('RESET ROLE')
})
