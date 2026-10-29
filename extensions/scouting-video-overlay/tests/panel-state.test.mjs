import test from 'node:test';
import assert from 'node:assert/strict';
import {panelState} from '../panel-state.mjs';
import {savedVideoUrl} from '../replay-source.mjs';
import {fresh} from '../core.mjs';
import {engine} from '../engine.mjs';
import {latestRivalSmash} from '../tap-selection.mjs';

test('compact replies retain the active record and saved video while leaving full backups intact',()=>{
 const state={...fresh(),rallies:[{id:'active'}],history:[{type:'score',rallies:[{id:'undo'}]}],sessions:{old:{selectedMatch:{id:'old'},setup:{videoPageUrl:'https://www.youtube.com/watch?v=abcdefghijk'},rallies:[{point:{}},{point:{},undone:true},{id:'bookmark'}]}}};
 const before=structuredClone(state),reply=panelState(state);
 assert.deepEqual(reply.rallies,state.rallies);
 assert.deepEqual(reply.history,[{type:'score'}]);
 assert.equal(reply.sessions.old.pointCount,1);
 assert.equal(reply.sessions.old.rallies,undefined);
 assert.equal(savedVideoUrl(reply.sessions.old),'https://www.youtube.com/watch?v=abcdefghijk');
 assert.deepEqual(state,before);
 assert.equal(state.sessions.old.rallies.length,3);
});

test('rally start returns its video sample and timing, and write failures remain failures',async()=>{
 let state={...fresh(),connection:{tabId:1},selectedMatch:{id:'match'}};
 const sample={videoId:'v',mediaId:'m',time:10,rate:1,at:new Date().toISOString(),paused:false,ended:false,seeking:false,readyState:4,seekEpoch:0,seekable:[[0,100]]};
 const dispatch=engine({read:async()=>structuredClone(state),write:async(s,c)=>{state=s;c.timing.storageSetMs=2;},capture:async()=>sample,uuid:()=> 'r'});
 const result=await dispatch({type:'start'});
 assert.deepEqual(result.sample,sample);
 assert.equal(result.state.pending.id,'r');
 assert.equal(result.timing.storageSetMs,2);
 for(const key of ['queueMs','readMs','videoMs','writeMs','engineMs'])assert.ok(result.timing[key]>=0);
 const failing=engine({read:async()=>structuredClone(state),write:async()=>{throw Error('Disk full');}});
 await assert.rejects(failing({type:'cancel'}),error=>error.message==='Disk full'&&error.scoutTiming.writeMs>=0);
 assert.equal(state.pending.id,'r');
});

test('explicit recovery selection reuses the latest rival smash, including rallies without taps',()=>{
 const pending={attempts:[{player:2},{player:3},{player:0}]};
 assert.equal(latestRivalSmash(pending,0),1);
 assert.equal(latestRivalSmash({attempts:[{player:0}]},0),-1);
 assert.equal(latestRivalSmash(pending,4),-1);
});
