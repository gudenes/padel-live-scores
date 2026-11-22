import {describe,expect,it} from 'vitest'
import {applyAwards,bestResults,rankPlayers,tournamentAwards,matchWinPoints,matchRoundPoints} from './engine'
import {parseBreakdown} from './fip'
import type {Award,Breakdown,MatchResult,RacePlayer,Tournament} from './types'
const event:Tournament={id:'event',name:'FIP PLATINUM TEST',level:'fip_platinum',starts_at:'2026-11-18',ends_at:'2026-11-22'}
const player:RacePlayer={id:'a',name:'Player',country:'ES',avatar_url:null,category:'men',race_points:220,race_ranking:17,officialPoints:220,officialRank:17,liveGain:0,pending:false}
const history:Breakdown={date:'2026-11-16',results:Array.from({length:22},(_,i)=>({key:`old${i}`,name:`Old ${i}`,date:'2026-08-01',points:10}))}
const award:Award={playerId:'a',tournament:event,points:300,uncertain:false}
function match(round:string,winner=1,extra:Partial<MatchResult>={}):MatchResult{return {id:round,tournament_id:'event',category:'men',round,round_canonical:round,status:'finished',winner_pair:winner,finished_at:'2026-11-22T10:00:00Z',scheduled_at:null,pair1_player1_id:'a',pair1_player2_id:'b',pair2_player1_id:'c',pair2_player2_id:'d',pair1_seed:null,pair2_seed:null,...extra}}
describe('live Race calculation',()=>{
 it('labels match stakes by tier and round without guessing qualifying or future points',()=>{
  expect(matchWinPoints('major','FINALS','2026')).toBe(2000)
  expect(matchRoundPoints('fip_platinum','FINALS','2026')).toEqual({winner:300,loser:180})
  expect(matchRoundPoints('p1','QUARTERFINALS','2026')).toEqual({winner:360,loser:180})
  expect(matchWinPoints('fip_platinum','FINALS','2026')).toBe(300)
  expect(matchWinPoints('p1','QUARTERFINALS','2026')).toBe(360)
  expect(matchWinPoints('p2','R64','2026')).toBeNull()
  expect(matchWinPoints('major','Q2','2026')).toBeNull()
  expect(matchWinPoints('major','FINALS','2027')).toBeNull()
  expect(matchWinPoints('unknown','FINALS','2026')).toBeNull()
 })
 it('uses the highest secured round, not a sum of match wins',()=>{
  const rows=tournamentAwards(event,[match('QF'),match('SF'),match('F')])
  expect(rows.find(r=>r.playerId==='a')?.points).toBe(300)
  expect(rows.find(r=>r.playerId==='c')?.points).toBe(180)
 })
 it('replaces the 22nd result; does not just add tournament points',()=>{
  expect(applyAwards(player,history,[award],history.date)).toMatchObject({race_points:510,liveGain:290,pending:false})
  expect(applyAwards(player,history,[{...award,points:5}],history.date).liveGain).toBe(0)
 })
 it('recomputes corrections and removes previously granted points',()=>{
  expect(applyAwards(player,history,[{...award,points:50}],history.date).race_points).toBe(260)
  expect(applyAwards(player,history,[],history.date).race_points).toBe(220)
 })
 it('rebases on Monday without counting the same tournament twice',()=>{
  const monday={date:'2026-11-23',results:[...history.results,{key:'event',name:event.name,date:event.starts_at,points:300}]}
  const official={...player,officialPoints:510,race_points:510}
  expect(applyAwards(official,monday,[award],monday.date)).toMatchObject({race_points:510,liveGain:0,pending:false})
 })
 it('does not apply a stale or unreconciled player history',()=>{
  expect(applyAwards(player,null,[award],history.date).pending).toBe(true)
  expect(applyAwards({...player,officialPoints:221},history,[award],history.date).pending).toBe(true)
  expect(applyAwards(player,history,[award],'2026-11-23').pending).toBe(true)
 })
 it('deduplicates repeated round wins including seed bonuses',()=>{
  const premier={...event,level:'p1'}
  expect(tournamentAwards(premier,[match('QF',1,{pair2_seed:1}),match('QF',1,{id:'duplicate',pair2_seed:1})]).find(r=>r.playerId==='a')?.points).toBe(380)
 })
 it('recognizes a qualifying bonus without awarding it to lucky losers',()=>{
  expect(tournamentAwards(event,[match('Q2'),match('R32',2)]).find(r=>r.playerId==='a')?.points).toBe(17)
  expect(tournamentAwards(event,[match('Q2',2),match('R32',2)]).find(r=>r.playerId==='a')?.points).toBe(14)
 })
 it('excludes youth, future seasons, cancelled matches and unresolved winners',()=>{
  expect(tournamentAwards({...event,level:'fip_promises'},[match('F')])).toEqual([])
  expect(tournamentAwards({...event,starts_at:'2027-01-01'},[match('F')])).toEqual([])
  expect(tournamentAwards(event,[match('F',1,{status:'cancelled'}),match('SF',1,{winner_pair:null})])).toEqual([])
 })
 it('does not award a withdrawing player first-match walkover points',()=>{
  expect(tournamentAwards(event,[match('R32',1,{status:'walkover'})]).find(r=>r.playerId==='c')?.points).toBe(0)
 })
 it('defers conflicting results and overlapping events',()=>{
  expect(tournamentAwards(event,[match('F'),match('F',2,{id:'conflict'})]).find(r=>r.playerId==='a')?.uncertain).toBe(true)
  expect(applyAwards(player,history,[award,{...award,tournament:{...event,id:'other',name:'Other'}}],history.date).pending).toBe(true)
 })
 it('ranks the entire list with competition ties',()=>{
  const rows=rankPlayers(Array.from({length:1001},(_,i)=>({...player,id:`${i}`,race_points:i<2?2000:1001-i})))
  expect(rows).toHaveLength(1001);expect(rows.slice(0,3).map(p=>p.race_ranking)).toEqual([1,1,3])
 })
})
describe('FIP breakdown parsing',()=>{
 it('includes non-countable results for the Race and preserves the source publication date',()=>{
  const row=(name:string,points:number)=>`<tr><td>City</td><td>${name}</td><td>FIP GOLD</td><td>01/09/2026</td><td>SF</td><td>${points}</td></tr>`
  const result=parseBreakdown(`<span>16/11/2026</span><table id="data-tournament-table"><tbody>${row('First',50)}</tbody></table><table id="data-tournament-table-nc"><tbody>${row('Second',8)}</tbody></table>`)
  expect(result.date).toBe('2026-11-16');expect(result.results).toHaveLength(2);expect(bestResults(result.results)).toBe(58)
 })
 it('rejects blocked pages or a missing publication date',()=>{
  expect(()=>parseBreakdown('<html>Access denied</html>')).toThrow()
 })
})
