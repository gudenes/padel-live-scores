import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoutingQuality,qualityCheckpoint,qualityScoreKey,validateQualityCheckpoint} from '../scouting-quality.mjs';
import {defaults,match} from '../match.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
import {engine} from '../engine.mjs';
const point=(id,extra={})=>({id,at:'2026-10-11T00:00:00Z',player:0,outcome:'winner',winner:'a',shot:'volley',...extra});
const model=(points=[])=>({points:points.length,score:{sets:[{a:0,b:0}],currentGame:{a:0,b:0},phase:'playing'},tracking:{timeline:points}});
const rate=(m,extra={})=>scoutingQuality({model:m,doc:{events:[]},...extra});
test('empty sessions are unrated; complete records need reconciliation and enough evidence',()=>{
 assert.equal(rate(model()).score,null);assert.equal(rate(model()).label,'Not rated');
 const m=model([point('1')]);assert.equal(rate(m).score,80);assert.equal(rate(m).label,'Medium');
 const confirmed=rate(m,{checkpoint:qualityCheckpoint(m)});assert.equal(confirmed.score,100);assert.equal(confirmed.provisional,true);
 const ten=model(Array.from({length:10},(_,i)=>point(String(i))));assert.equal(rate(ten,{checkpoint:qualityCheckpoint(ten)}).provisional,false);
});
test('score edits and additional observations invalidate reconciliation',()=>{
 const m=model([point('1')]),checkpoint=qualityCheckpoint(m);
 m.score.currentGame.a=30;assert.equal(rate(m,{checkpoint}).components.reconciliation,0);
 m.score.currentGame.a=0;assert.equal(rate(m,{checkpoint}).components.reconciliation,100);
 m.tracking.timeline.push(point('2'));m.points++;assert.equal(rate(m,{checkpoint}).components.reconciliation,0);
});
test('Pro and Expert share core requirements; optional detail, sync and correction gaps do not inflate quality',()=>{
 const m=model([point('1',{outcome:'forced',winner:'b',previousPlayer:2,forcedBy:2})]);
 const checkpoint=qualityCheckpoint(m),pro=rate(m,{checkpoint});
 m.tracking.timeline[0].previousShot='smash';
 const expert=rate(m,{checkpoint,doc:{events:[{kind:'score'}]}});
 assert.equal(expert.score,pro.score);assert.equal(expert.coverage.unknownGap,true);assert.equal(expert.details.previousStrokes,1);
});
test('missing error attribution, stroke, inconsistent identities and duplicate ids lower quality',()=>{
 const m=model([point('1',{outcome:'unforced',winner:'b',shot:undefined}),point('1',{player:9})]);
 const q=rate(m);assert.equal(q.label,'Low');assert.ok(q.issues.some(x=>x.includes('opponent')));assert.ok(q.issues.some(x=>x.includes('finishing stroke')));assert.ok(q.components.consistency<100);
});
test('double faults and recovery winners need no finishing stroke; unclassified points are coverage only',()=>{
 const m=model([point('1',{outcome:'double_fault',winner:'b',shot:undefined}),point('2',{smashRecovery:true,shot:undefined}),{id:'3',outcome:'unclassified'}]);
 const q=rate(m,{checkpoint:qualityCheckpoint(m)});assert.equal(q.score,100);assert.equal(q.coverage.scouted,2);assert.equal(q.coverage.scoreOnly,1);
});
test('official completed result reconciles but a mismatch cannot be overridden by an operator checkpoint',()=>{
 const m=model([point('1')]);m.score.phase='finished';m.score.sets=[{a:6,b:4},{a:6,b:4}];
 assert.equal(rate(m,{officialSets:m.score.sets}).components.reconciliation,100);
 assert.equal(rate(m,{officialSets:[{a:4,b:6},{a:4,b:6}],checkpoint:qualityCheckpoint(m)}).components.reconciliation,0);
});
test('confirmation survives server sanitization and can be undone without removing a point',async()=>{
 const snap=time=>({tabId:7,documentId:'d',videoId:'v',mediaId:'m',time,at:'2026-10-11T00:00:00Z',readyState:4,seekEpoch:0,paused:false});
 let state={version:1,selectedMatch:{id:'match'},setup:defaults(),label:'Test',rallies:[{id:'r',label:'Test',start:snap(1),end:snap(5),point:{player:0,outcome:'winner',shot:'volley'}}],cancelled:[],pending:null};
 const dispatch=engine({read:async()=>structuredClone(state),write:async s=>{state=s;}});
 await dispatch({type:'confirm-quality-score'});
 const payload=validateVideoState(videoPayload(state));assert.deepEqual(payload.setup.qualityCheckpoint,state.setup.qualityCheckpoint);assert.equal(payload.setup.qualityCheckpoint.key,qualityScoreKey(match(state)));
 await dispatch({type:'undo-last'});assert.equal(state.setup.qualityCheckpoint,undefined);assert.equal(state.rallies.length,1);
 assert.throws(()=>validateQualityCheckpoint({version:1,key:'x',at:'bad'}),/Invalid/);
});

const tracked=(id,players,mode='expert',extra={})=>({id,mode,point:{outcome:'winner'},touches:players.map(player=>({player})),...extra});
test('Expert sequence scoring checks alternating teams, not alternating player names',()=>{
 const m=model([point('a'),point('b'),point('c')]);
 const q=rate(m,{checkpoint:qualityCheckpoint(m),rallies:[tracked('a',[0,2,1,3]),tracked('b',[0,0,2]),tracked('c',[0,1,2])]});
 assert.equal(q.mode,'Expert');assert.equal(q.sequences.consistent,1);assert.equal(q.sequences.invalidTransitions,2);assert.equal(q.components.sequenceConsistency,33.3);assert.equal(q.score,88.3);assert.equal(q.label,'Medium');
});
test('a single-tap return error is valid, double faults exempt and unassessable Expert rallies disclosed',()=>{
 const m=model([point('a',{player:2,outcome:'unforced',winner:'a',shot:'return',previousPlayer:0}),point('b',{outcome:'double_fault',winner:'b',shot:undefined}),point('c')]);
 const q=rate(m,{checkpoint:qualityCheckpoint(m),rallies:[tracked('a',[2]),tracked('b',[]),tracked('c',[0])]});
 assert.equal(q.sequences.eligible,2);assert.equal(q.sequences.consistent,1);assert.equal(q.sequences.missing,1);assert.equal(q.provisional,true);assert.equal(q.score,94.2);
});
test('Pro has no sequence deduction, mixed sessions retain mode and exclude undone/cancelled observations',()=>{
 const m=model([point('a'),point('b')]);
 assert.equal(rate(m,{checkpoint:qualityCheckpoint(m),rallies:[tracked('a',[],'pro'),tracked('b',[],'pro')]}).score,100);
 const q=rate(m,{checkpoint:qualityCheckpoint(m),rallies:[tracked('a',[],'pro'),tracked('b',[0,0]),tracked('gone',[0,0],'expert',{undone:true})]});
 assert.equal(q.mode,'Mixed');assert.equal(q.sequences.eligible,1);assert.equal(q.score,91.3);
});
test('legacy mode is inferred only from taps; missing mode is not assumed to be Pro',()=>{
 const m=model([point('a')]);
 const r=tracked('a',[0,2]);delete r.mode;
 assert.equal(rate(m,{rallies:[r]}).modeInferred,true);assert.equal(rate(m,{rallies:[r]}).mode,'Expert');
 assert.equal(rate(m).mode,'Unknown');
});
test('rally mode survives restart, save and server sanitization',async()=>{
 const snap={tabId:7,documentId:'d',videoId:'v',mediaId:'m',time:1,at:'2026-10-11T00:00:00Z',readyState:4,seekEpoch:0,paused:false};
 let serial=0,state={version:1,selectedMatch:{id:'match'},connection:{},setup:defaults(),label:'Test',rallies:[],cancelled:[],pending:null};
 const dispatch=engine({read:async()=>structuredClone(state),write:async s=>{state=s;},capture:async()=>({...snap,time:++serial}),uuid:()=>String(serial)});
 await assert.rejects(dispatch({type:'start',mode:'bad'}),/Invalid scouting mode/);
 await dispatch({type:'start',mode:'pro'});assert.equal(state.pending.mode,'pro');
 await dispatch({type:'restart-rally'});assert.equal(state.pending.mode,'pro');assert.equal(state.cancelled[0].mode,'pro');
 await dispatch({type:'prepare',player:0,outcome:'winner'});await dispatch({type:'score',details:{shot:'volley'}});
 assert.equal(videoPayload(state).rallies[0].mode,'pro');
 state.rallies[0].mode='bad';assert.throws(()=>videoPayload(state),/Invalid scouting mode/);
});
