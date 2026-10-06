import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudSync} from '../cloud.mjs';
import {videoPayload,videoSummary} from '../server-model.mjs';
import {defaults} from '../match.mjs';
const base=()=>({version:1,selectedMatch:{id:'match'},setup:defaults(),label:'Test',rallies:[],cancelled:[],pending:null});
const snap=time=>({tabId:7,documentId:'d',videoId:'v',mediaId:'m',time,at:`2026-10-06T12:00:${String(time).padStart(2,'0')}Z`,readyState:4,seekEpoch:0,paused:false});
const scored=()=>({...base(),rallies:[{id:'r',label:'Test',start:snap(1),end:snap(5),point:{player:0,outcome:'winner',shot:'smash'}}]});
function fixture(request){let disk,serial=0;return {sync:cloudSync({read:async()=>structuredClone(disk),write:async x=>{disk=structuredClone(x)},uuid:()=>String(++serial),request}),disk:()=>disk};}
test('persisted outbox retries the same save after a failed connection and reports confirmed score',async()=>{
 let fail=true;const writes=[];
 const f=fixture(async r=>{if(r.method==='GET')return {ok:true,session:null};writes.push(r);return fail?{ok:false,error:'Offline'}:{ok:true,revision:1,savedAt:'now'};});
 await f.sync.track(scored());await f.sync.flush();assert.equal((await f.sync.status('match')).status,'error');assert.equal(f.disk().entries.match.payload.rallies.length,1);
 fail=false;await f.sync.flush();assert.equal((await f.sync.status('match')).status,'saved');assert.equal(writes[0].writeId,writes[1].writeId);
 assert.equal(videoSummary(f.disk().entries.match.payload).score.currentGame.a,15);
});
test('a new point during an upload remains pending and is saved using the acknowledged revision',async()=>{
 let release,started;const waiting=new Promise(resolve=>started=resolve),writes=[];
 const f=fixture(async r=>{if(r.method==='GET')return {ok:true,session:null};writes.push(r);if(writes.length===1){started();await new Promise(resolve=>release=resolve);}return {ok:true,revision:writes.length,savedAt:'now'};});
 await f.sync.track(base());const work=f.sync.flush();await waiting;await f.sync.track(scored());release();await work;
 assert.equal(writes.length,2);assert.equal(writes[1].revision,1);assert.equal(writes[1].document.rallies.length,1);assert.equal((await f.sync.status('match')).status,'saved');
});
test('existing remote data and revision conflicts are retained without being overwritten',async()=>{
 let writes=0;const f=fixture(async r=>r.method==='GET'?{ok:true,session:{revision:4,document:videoPayload(scored())}}:(writes++,{ok:false,status:409,error:'Changed elsewhere'}));
 await f.sync.track(base());await f.sync.flush();assert.equal(writes,0);assert.equal((await f.sync.status('match')).status,'conflict');
 await f.sync.track(scored());await f.sync.flush();assert.equal(writes,0);assert.equal((await f.sync.status('match')).status,'conflict');
});
test('sanitized payload ignores client-supplied scores and keeps timestamps, undo and valid shots',()=>{
 const state=scored();state.score={currentGame:{a:40,b:0}};state.rallies[0].end.page='https://private.example?token=not-sent';
 const payload=videoPayload(state);assert.equal(payload.score,undefined);assert.equal(payload.rallies[0].end.page,undefined);assert.equal(payload.rallies[0].videoSeconds,4);assert.equal(videoSummary(payload).score.currentGame.a,15);
 state.rallies[0].undone=true;state.rallies[0].undoneAt='2026-10-06T12:01:00Z';assert.equal(videoSummary(videoPayload(state)).score.currentGame.a,0);
 state.rallies[0].point.shot='fake';assert.throws(()=>videoPayload(state),/Invalid shot/);
});
test('loading and acknowledging a server copy does not generate an upload',async()=>{
 let writes=0;const payload=videoPayload(scored());const f=fixture(async r=>r.method==='GET'?{ok:true,session:{document:payload,revision:8,updated_at:'now'}}:(writes++,{ok:true,revision:9}));
 const remote=await f.sync.load('match');await f.sync.acknowledge('match',remote);await f.sync.track(scored());await f.sync.flush();assert.equal(writes,0);assert.equal((await f.sync.status('match')).revision,8);
});
test('restoring a server copy preserves disconnected scores and rejects a changed local session',async()=>{
 const {engine}=await import('../engine.mjs');let disk={...scored(),connection:{tabId:7}};
 const dispatch=engine({read:async()=>structuredClone(disk),write:async s=>{disk=s;}});
 const expectedHash=JSON.stringify(videoPayload(disk));
 await dispatch({type:'restore-cloud',matchId:'match',document:videoPayload(base()),expectedHash});assert.equal(disk.connection,null);assert.equal(videoSummary(videoPayload(disk)).points,0);
 await assert.rejects(dispatch({type:'restore-cloud',matchId:'match',document:videoPayload(scored()),expectedHash}),/Local scouting changed/);
});
test('a lost acknowledgement is retried unchanged even when a newer local edit exists',async()=>{
 const writes=[];let saved=null,lose=true;
 const f=fixture(async r=>{
  if(r.method==='GET')return {ok:true,session:null};writes.push(r);
  if(saved?.writeId===r.writeId)return {ok:true,revision:saved.revision,savedAt:'now'};
  if(r.revision!==(saved?.revision??0))return {ok:false,status:409,error:'Conflict'};
  saved={writeId:r.writeId,revision:r.revision+1};
  if(lose){lose=false;return {ok:false,error:'Response lost after database commit'};}
  return {ok:true,revision:saved.revision,savedAt:'now'};
 });
 await f.sync.track(base());await f.sync.flush();await f.sync.track(scored());await f.sync.flush();
 assert.equal(writes.length,3);assert.equal(writes[0].writeId,writes[1].writeId);assert.equal(writes[1].document.rallies.length,0);assert.equal(writes[2].revision,1);assert.equal(writes[2].document.rallies.length,1);assert.equal((await f.sync.status('match')).status,'saved');
});
