import {test} from 'node:test';
import assert from 'node:assert/strict';
import {creditRecoverySmash} from '../tap-selection.mjs';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {defaults,match} from '../match.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
const snapshot=time=>({tabId:1,documentId:'doc',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,ended:false,at:'2026-10-14T00:00:00Z'});
const pending=()=>({id:'r',start:snapshot(100),touches:[2,0,2,0].map((player,i)=>({player,order:[2,3,0,1],snapshot:snapshot(101+i)})),attempts:[],finish:{player:0,outcome:'winner',end:snapshot(105)}});
for(const recorded of [false,true])test(`recovery saves exactly one preceding attempt, existing=${recorded}`,async()=>{
 let p=pending();p.attempts.push({player:2,touchIndex:0,snapshot:snapshot(101),smashType:'power'});
 if(recorded)p.attempts.push({player:2,touchIndex:2,snapshot:snapshot(103),smashType:'x3'});
 let state={...fresh(),setup:defaults(),pending:p};
 const act=engine({read:async()=>state,write:async s=>{state=s;}});
 await act({type:'score',details:{smashRecovery:true,recoverySmashPlayer:2}});
 const restored=validateVideoState(JSON.parse(JSON.stringify(videoPayload(state))));
 assert.equal(restored.rallies[0].attempts.length,2);
 const stats=match(restored).stats;assert.equal(stats[2].smashes,2);assert.equal(stats[2].smashPointsWon,0);assert.equal(stats[0].smashRecoveryWinners,1);
 await act({type:'undo'});assert.equal(match(state).stats[2].smashes,0);
});
test('unknown hitter is required; explicit reuse works without taps',()=>{
 const p=pending();p.touches=[];p.attempts=[{player:3,snapshot:snapshot(102)}];
 for(const player of [undefined,0,1,4])assert.throws(()=>creditRecoverySmash(p,0,player));
 assert.throws(()=>creditRecoverySmash(p,0,2,0));
 creditRecoverySmash(p,0,3,0);assert.equal(p.attempts.length,1);
 creditRecoverySmash(p,0,2);assert.equal(p.attempts.length,2);
});
