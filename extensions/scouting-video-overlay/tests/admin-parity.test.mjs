import {test} from 'node:test';
import assert from 'node:assert/strict';
import {match,defaults} from '../match.mjs';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
const start=(points={a:0,b:0},games={a:0,b:0},completed=[],returns=0)=>({...fresh(),setup:{...defaults(),startingScore:{completed,games,points,server:0,near:'a',advantageReturns:returns}},selectedMatch:{id:'m'}});
const point=(id,player,time=Number(id)*20+100)=>({id,start:{time},end:{time:time+10},point:{player,outcome:'winner'}});
test('same admin counts: saved and converted break opportunities, Star Point, Golden Point and tie-break exclusion',()=>{
 const s=start({a:15,b:40});s.rallies=[point('0',0),point('1',2)];let m=match(s);assert.equal(m.tracking.pairs.b.breakPoints,2);assert.equal(m.tracking.pairs.b.breaks,1);assert.equal(m.tracking.pairs.a.breakPointsSaved,1);
 const star=start({a:40,b:40},{a:0,b:0},[],2);assert.equal(match(star).situation.star,true);star.rallies=[point('0',2)];m=match(star);assert.equal(m.tracking.pairs.b.starPointsWon,1);assert.equal(m.tracking.pairs.b.breaks,1);
 const deuce=start({a:40,b:40});assert.equal(match(deuce).situation.breakPoint,null);
 deuce.setup.rule='golden-point';assert.equal(match(deuce).situation.breakPoint,'b');deuce.rallies=[point('0',2)];assert.equal(match(deuce).tracking.pairs.b.starPoints,0);
 const tb=start({a:6,b:5},{a:6,b:6});tb.rallies=[point('0',0)];assert.equal(match(tb).tracking.pairs.a.breaks,0);assert.equal(match(tb).tracking.games[0].tieBreak,true);
});
test('set and match pressure is counted before the point and removed by undo',()=>{
 const s=start({a:40,b:0},{a:5,b:4},[{a:6,b:4}]);assert.equal(match(s).situation.matchPoint.a,true);s.rallies=[point('0',0)];let m=match(s);assert.equal(m.tracking.pairs.a.matchPointsWon,1);assert.equal(m.tracking.pairs.a.setPointsWon,1);assert.equal(m.score.phase,'finished');s.rallies[0].undone=true;m=match(s);assert.equal(m.tracking.pairs.a.matchPointsWon,0);assert.equal(m.score.phase,'playing');
});
test('timing follows video first serve, includes intervals, preserves partial-game scope and first faults',()=>{
 const s={...fresh(),setup:defaults(),rallies:[point('0',0,100),point('1',0,130)]};s.rallies[0].firstFault={time:103};const m=match(s);assert.equal(Date.parse(m.tracking.startedAt),100000);assert.equal(Date.parse(m.tracking.timeline[1].at)-Date.parse(m.tracking.startedAt),40000);assert.equal(m.tracking.service[0].firstFaults,1);assert.equal(m.tracking.scope,'match');
 const partial=start({a:30,b:0});partial.rallies=[point('0',0)];assert.equal(match(partial).tracking.scope,'observation');assert.equal(match(partial).tracking.gameStartedAt,null);
});
test('undo last action restores baseline, sides, faults and rally start in order and is isolated per match',async()=>{
 let disk={...fresh(),setup:defaults(),selectedMatch:{id:'m'}};const snapshot=()=>({tabId:1,documentId:'d',videoId:'v',mediaId:'m',time:100,seekEpoch:0,readyState:4,paused:false,seeking:false,at:'2026-10-06T00:00:00Z'});
 const send=engine({read:async()=>structuredClone(disk),write:async s=>{disk=s;},uuid:()=>crypto.randomUUID(),capture:async()=>snapshot()});
 await send({type:'starting-score',score:{completed:[{a:6,b:4}],games:{a:3,b:2},points:{a:15,b:30},server:0,near:'a',elapsedSeconds:2400}});assert.deepEqual(match(disk).score.sets,[{a:6,b:4},{a:3,b:2}]);assert.equal(match(disk).timeOffset,2400);
 await send({type:'positions',pair:'a'});assert.equal(match(disk).swapped.a,true);await send({type:'undo-last'});assert.equal(match(disk).swapped.a,false);
 await send({type:'undo-last'});assert.deepEqual(match(disk).score.sets,[{a:0,b:0}]);
 disk.connection={};await send({type:'start'});await send({type:'first-fault'});await send({type:'undo-last'});assert.equal(disk.pending.firstFault,undefined);await send({type:'undo-last'});assert.equal(disk.pending,null);
 await send({type:'positions',pair:'b'});await send({type:'leave-match'});assert.equal(disk.history.length,0);assert.ok(disk.sessions.m.history.length);
});
test('undo scored point restores its open rally without awarding it twice',async()=>{
 let disk={...fresh(),setup:defaults(),selectedMatch:{id:'m'},connection:{}};let time=100;const snap=()=>({tabId:1,documentId:'d',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,at:'2026-10-06T00:00:00Z'});
 const send=engine({read:async()=>structuredClone(disk),write:async s=>{disk=s;},uuid:()=>crypto.randomUUID(),capture:async()=>snap()});
 await send({type:'start'});time=110;await send({type:'prepare',player:0,outcome:'winner'});await send({type:'score',details:{shot:'volley'}});assert.equal(match(disk).points,1);
 await send({type:'undo-last'});assert.equal(match(disk).points,0);assert.ok(disk.pending.finish);await send({type:'score',details:{shot:'volley'}});assert.equal(match(disk).points,1);assert.equal(disk.rallies.length,1);
});
