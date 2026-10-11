import {it,expect} from 'vitest'
import {officialPoints,pbpAnalysis,pbpCsv} from '../pbp-report'
import type {ReportContext} from '../report-view'
const context:ReportContext={meta:{duration:'01:30',round:null,category:'men',tournament:'Test',scheduled_at:null},avatars:{},players:[0,1,2,3].map(i=>({id:'p'+i,name:'Player '+i})),pbp:[{id:'b',game_id:'g2',set_number:2,game_number:1,point_number:1,winner_pair:2,score_after:'0-15',server_player_id:null},{id:'a',game_id:'g1',set_number:1,game_number:1,point_number:1,winner_pair:1,score_after:'15-0',server_player_id:'p0'},{id:'c',game_id:'g1',set_number:1,game_number:1,point_number:3,winner_pair:1,score_after:'40-0',server_player_id:'p0'}],games:[{id:'g1',set_number:1,game_number:1,winner_pair:1,server_player_id:'p0',is_tiebreak:false,points:['15:0','30:0','40:0']},{id:'g2',set_number:2,game_number:1,winner_pair:2,server_player_id:null,is_tiebreak:false}],sets:[{a:6,b:4},{a:4,b:6}]}
it('uses stored point identities instead of duplicating game snapshots and orders by set/game/point',()=>{
 expect(officialPoints(context).map(p=>p.id)).toEqual(['a','c','b'])
 expect(pbpAnalysis(context,'1').records).toBe(2)
 expect(pbpAnalysis(context).teams[0]).toMatchObject({won:2,servicePlayed:2,serviceWon:2,longestRecordedRun:1,holds:1})
 expect(pbpAnalysis(context).teams[1].returnPlayed).toBe(2)
 expect(pbpAnalysis(context,'2').knownServerPoints).toBe(0);expect(pbpAnalysis(context,'2').knownServerGames).toBe(0)
})
it('retains snapshot gaps and unknown winners instead of inventing point outcomes',()=>{
 const result=officialPoints({...context,pbp:[],games:[{...context.games![0],points:['0:15','30:15','40:30','40:40','A:40','40:40']} ]})
 expect(result.map(p=>p.winner_pair)).toEqual([2,null,null,2,1,2])
 expect(pbpAnalysis({...context,pbp:[],games:[{...context.games![0],points:['30:30']}] }).unknown).toBe(1)
})
it('only shows a tie-break superscript for an explicit terminal tie-break score',()=>{
 const base={...context,games:[{...context.games![0],is_tiebreak:true}],pbp:[{...context.pbp[1],score_after:'7-3'}]}
 expect(pbpAnalysis(base).ties[1]).toEqual({a:7,b:3})
 expect(pbpAnalysis({...base,pbp:[{...base.pbp[0],score_after:'6-3'}]}).ties).toEqual({})
})
it('exports only the selected set and leaves unknown server information blank',()=>{
 const csv=pbpCsv(context,'2');expect(csv).toContain('0-15');expect(csv).not.toContain('15-0');expect(csv).toContain('Official PBP')
})
it('excludes post-match game artifacts from statistics while retaining raw exports',()=>{
 const finished={...context,status:'finished',sets:[{a:6,b:2,set_number:1}],games:[{...context.games![0],game_number:9}],pbp:[{...context.pbp[1],game_number:9}]}
 expect(pbpAnalysis(finished).records).toBe(0);expect(pbpAnalysis(finished).excludedRecords).toBe(1);expect(pbpCsv(finished)).toContain('15-0')
})
