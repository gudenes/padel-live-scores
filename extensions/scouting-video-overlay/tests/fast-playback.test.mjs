import {test} from 'node:test';
import assert from 'node:assert/strict';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {defaults,match} from '../match.mjs';
import '../shortcut-keys.js';
function fixture(){
 let disk={...fresh(),setup:defaults(),selectedMatch:{id:'m'},connection:{tabId:1}},time=100,rate=1,seq=0,fail=false;
 const snap=()=>({tabId:1,documentId:'d',videoId:'v',mediaId:'m',time,rate,at:new Date(time*1000).toISOString(),paused:false,ended:false,seeking:false,readyState:4,seekEpoch:0,seekable:[[0,1000]]});
 const dispatch=engine({read:async()=>structuredClone(disk),write:async s=>{disk=s},capture:async()=>snap(),uuid:()=>String(++seq),seek:async(_c,_s,t)=>{time=t},setRate:async(_c,_s,r)=>{if(!fail)rate=r;return snap()}});
 return {dispatch,get:()=>disk,time:t=>{time=t},rate:()=>rate,fail:()=>{fail=true}};
}
test('skipping waits and fast playback retain match time; rally start restores 1× before recording',async()=>{
 const f=fixture();await f.dispatch({type:'start'});f.time(110);await f.dispatch({type:'prepare',player:0,outcome:'winner'});await f.dispatch({type:'score',details:{shot:'volley'}});
 const before=structuredClone(f.get());await f.dispatch({type:'skip',seconds:30});await f.dispatch({type:'speed',rate:4});assert.deepEqual(f.get(),before);assert.equal(f.rate(),4);
 f.time(150);await f.dispatch({type:'start'});assert.equal(f.rate(),1);assert.equal(f.get().pending.start.rate,1);
 await assert.rejects(f.dispatch({type:'skip',seconds:5}),/Finish or cancel/);await assert.rejects(f.dispatch({type:'speed',rate:2}),/between rallies/);
 f.time(160);await f.dispatch({type:'prepare',player:1,outcome:'winner'});await f.dispatch({type:'score',details:{shot:'volley'}});
 const m=match(f.get());assert.equal(m.points,2);assert.equal(Date.parse(m.tracking.timeline.at(-1).at)-Date.parse(m.tracking.startedAt),60000);assert.deepEqual(f.get().rallies.map(r=>r.videoSeconds),[10,10]);
});
test('cycle speed supports 1×/2×/4× and refuses unavailable or invalid rate without changing records',async()=>{
 const f=fixture();for(const expected of [2,4,1]){await f.dispatch({type:'cycle-speed'});assert.equal(f.rate(),expected)}
 await assert.rejects(f.dispatch({type:'speed',rate:8}),/Choose/);await f.dispatch({type:'speed',rate:4});f.fail();const before=structuredClone(f.get());
 await assert.rejects(f.dispatch({type:'start'}),/restore normal/);assert.deepEqual(f.get(),before);assert.equal(f.get().pending,null);
});
test('requested navigation bindings migrate without stealing other custom keys',()=>{
 const k=globalThis.__pnMediaKeys;
 const older={back10:{key:'Home'},pause:{key:'Insert'},forward30:{key:'End'},back5:{key:'PageUp'},forward5:{key:'l',shift:true}};
 const out=k.upgradeFastBindings(older);assert.equal(out.pause.key,'Home');assert.equal(out.back5.key,'Insert');assert.equal(out.forward5.key,'PageUp');assert.equal(out.back10,null);assert.equal(out.forward30.key,'End');assert.equal(out.forward10,null);
 assert.equal(k.normalize({...out,pause:{key:'F10'}}).pause.key,'F10');
});

test('worker applies requested keys once, preserves scouting storage, and retains later shortcut edits',async()=>{
 let listener;const store={scoutingVideo:{...fresh(),rallies:[{id:'saved'}],sessions:{other:{rallies:[{id:'old'}]}}}},original=structuredClone(store.scoutingVideo);
 globalThis.chrome={action:{onClicked:{addListener(){}}},sidePanel:{},storage:{local:{get:async()=>structuredClone(store),set:async fields=>Object.assign(store,structuredClone(fields))},session:{get:async()=>({})}},runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn}}};
 try{
 await import('../background.mjs');const sender={id:'test',url:'chrome-extension://test/panel.html'};const send=m=>new Promise(resolve=>listener(m,sender,resolve));
 const first=await send({type:'get-shortcuts'});assert.equal(first.ok,true);assert.equal(first.bindings.pause.key,'Home');assert.equal(store.videoFastKeysV1,true);
 await send({type:'set-shortcuts',bindings:{...first.bindings,pause:{key:'F10'}}});
 const next=await send({type:'get-shortcuts'});assert.equal(next.bindings.pause.key,'F10');assert.deepEqual(store.scoutingVideo,original);
 }finally{delete globalThis.chrome}
});
