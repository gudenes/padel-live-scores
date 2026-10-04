import {it,expect} from 'vitest'
import {freshDoc,replay,validateDoc,type Event,type ScoreSeed} from '../scouting/model'
let serial=0
const event=(e:Record<string,unknown>,seconds=0)=>({...e,id:String(++serial),at:new Date(Date.UTC(2026,9,4,12,0,seconds)).toISOString()}) as Event
const pt=(team:'a'|'b',seconds=0)=>event({kind:'unclassified',team},seconds)
const seed=(game:ScoreSeed['game'],sets=[{a:0,b:0}],returns=0)=>event({kind:'score',seed:{sets,game,phase:sets.at(-1)?.a===6&&sets.at(-1)?.b===6?'tiebreak':'playing',returns,server:0}})
const read=(events:Event[])=>replay({...freshDoc(),events}).tracking
it('records timed holds, service points and excludes changeover from the next game',()=>{
 const m=read([event({kind:'start',scope:'match'}),...[30,60,90,120].map(t=>pt('a',t)),event({kind:'game_start'},180)])
 expect(m.games[0]).toMatchObject({durationMs:120000,server:0,winner:'a',partial:false})
 expect(m.pairs.a.holds).toBe(1);expect(m.service[0]).toMatchObject({points:4,won:4})
 expect(m.gameStartedAt).toBe('2026-10-04T12:03:00.000Z')
})
it('counts saved and converted break points before each point',()=>{const m=read([seed({a:15,b:40}),pt('a'),pt('b')]);expect(m.pairs.b).toMatchObject({breaks:1,breakPoints:2});expect(m.pairs.a).toMatchObject({breakPointsFaced:2,breakPointsSaved:1})})
it('counts Star Point as a break chance and records the winner',()=>{const m=read([seed({a:40,b:40},[{a:0,b:0}],2),pt('b')]);expect(m.pairs.b).toMatchObject({starPoints:1,starPointsWon:1,breaks:1,breakPoints:1});expect(m.pairs.a.starPointsWon).toBe(0)})
it('does not count ordinary deuce as a break point',()=>{expect(read([seed({a:40,b:40}),pt('b')]).pairs.b.breakPoints).toBe(0)})
it('excludes tie-break wins from breaks',()=>{const m=read([seed({a:6,b:5},[{a:6,b:6}]),pt('a',30)]);expect(m.pairs.a.breaks).toBe(0);expect(m.pairs.b.breakPoints).toBe(0);expect(m.games[0].tieBreak).toBe(true)})
it('records set and match points and stops the match clock',()=>{const m=read([event({kind:'start',scope:'match'}),seed({a:40,b:0},[{a:6,b:4},{a:5,b:4}]),pt('a',3600)]);expect(m.pairs.a).toMatchObject({setPoints:1,setPointsWon:1,matchPoints:1,matchPointsWon:1});expect(m.endedAt).toBe('2026-10-04T13:00:00.000Z')})
it('undo restores the running game and removes break conversion',()=>{const m=read([event({kind:'start',scope:'match'}),...[20,40,60,80].map(t=>pt('b',t)),event({kind:'undo'},90)]);expect(m.games).toHaveLength(0);expect(m.pairs.b.breaks).toBe(0);expect(m.gameStartedAt).toBe(m.startedAt)})
it('partial games never invent full durations',()=>{const m=read([event({kind:'start',scope:'observation'}),seed({a:30,b:0}),pt('a',20),pt('a',40)]);expect(m.scope).toBe('observation');expect(m.games[0]).toMatchObject({startedAt:null,durationMs:null,partial:true})})
it('rejects duplicate, retrospective and mid-game starts',()=>{for(const events of [[event({kind:'start',scope:'match'}),event({kind:'start',scope:'match'})],[pt('a'),event({kind:'start',scope:'match'})],[event({kind:'start',scope:'observation'}),pt('a'),event({kind:'game_start'})]])expect(()=>validateDoc({...freshDoc(),events})).toThrow()})
it('counts Golden Point breaks separately from Star Points',()=>{const m=replay({...freshDoc(),rule:'golden-point',events:[seed({a:40,b:40}),pt('b')]}).tracking;expect(m.pairs.b.breaks).toBe(1);expect(m.pairs.b.starPoints).toBe(0)})
it('timestamps tie-break turn boundaries without inventing its first serve',()=>{
 const m=read([event({kind:'start',scope:'observation'}),seed({a:0,b:0},[{a:6,b:6}]),event({kind:'game_start'},10),pt('a',30),pt('b',50),pt('a',70)])
 expect(m.turns).toHaveLength(2);expect(m.turns[0]).toMatchObject({player:0,durationMs:20000});expect(m.turns[1].durationMs).toBe(40000)
 expect(m.serviceStartedAt).toBe('2026-10-04T12:01:10.000Z')
})
it('undoing a match-winning point resumes the match clock',()=>{
 const m=read([event({kind:'start',scope:'match'}),seed({a:40,b:0},[{a:6,b:4},{a:5,b:4}]),pt('a',500),event({kind:'undo'},510)])
 expect(m.endedAt).toBeNull();expect(m.pairs.a.matchPointsWon).toBe(0)
})
