import {describe,it,expect} from 'vitest'
import {partnership,averageOfficialDuration,officialSeason,historyGroups,historySearch,tournamentPage} from '../history'
import type {HistoryMatch} from '../data'
const row=(overrides:Partial<HistoryMatch>={}):HistoryMatch=>({id:'1',manual:false,date:'2026-10-18',tournament:'Milano',tournamentId:'t1',level:'p1',round:'Final',status:'finished',winner:1,playerIds:['a','b','c','d'],names:['Álvaro','Bea','Carlo','Dani'],score:'6–4 6–3',scouted:false,...overrides})
describe('official history summaries',()=>{
 it('deduplicates titles and excludes unknown, unfinished and league results',()=>{const s=officialSeason([row(),row({id:'2'}),row({id:'3',winner:2,tournamentId:'t2'}),row({id:'4',winner:null}),row({id:'5',status:'scheduled'}),row({id:'6',level:'ppl'})],'a');expect(s.titles).toHaveLength(1);expect(s.wins).toBe(2);expect(s.losses).toBe(1)})
 it('uses the correct team and groups tournament editions separately',()=>{expect(officialSeason([row()],'c').wins).toBe(0);expect(historyGroups([row(),row({tournamentId:'t2'})])).toHaveLength(2)})
 it('paginates sparse tournament groups independently of match count',()=>{const groups=historyGroups(Array.from({length:8},(_,i)=>row({id:String(i),tournamentId:String(i)})));expect(tournamentPage(2,groups.length)).toBe(2);expect(tournamentPage(99,groups.length)).toBe(2)})
 it('searches names and tournament with accents normalized',()=>{expect(historySearch(row(),'alvaro milano')).toBe(true);expect(historySearch(row(),'unknown')).toBe(false)})
})

it('averages official durations across scouted and unscouted finished matches only',()=>{
 const result=averageOfficialDuration([row({duration:'01:00',scouted:true}),row({duration:'02:00'}),row({duration:null}),row({duration:'00:00'}),row({duration:'99:00'}),row({duration:'01:99'}),row({duration:'01:00',status:'scheduled'}),row({duration:'01:00',manual:true})])
 expect(result).toEqual({count:2,ms:5400000})
 expect(averageOfficialDuration([])).toEqual({count:0,ms:null})
})

it('partnership records exclude scheduled and unknown results and opponents',()=>{
 const result=partnership([row(),row({id:'2',winner:2,date:'2026-10-19'}),row({id:'3',status:'scheduled',date:'2026-12-01'}),row({id:'4',winner:null,date:null}),row({id:'5',playerIds:['a','c','b','d']})],'a','b')
 expect(result.completed).toBe(2)
 expect(result.wins).toBe(1)
 expect(result.losses).toBe(1)
 expect(result.total).toBe(4)
 expect(result.last?.id).toBe('2')
})
