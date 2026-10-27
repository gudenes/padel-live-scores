import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudSync} from '../cloud.mjs';
import {videoPayload} from '../server-model.mjs';
import {defaults} from '../match.mjs';
const base=()=>({version:1,selectedMatch:{id:'match'},setup:defaults(),label:'Test',rallies:[],cancelled:[],pending:null});
const snapshot=time=>({tabId:7,documentId:'d',videoId:'v',mediaId:'m',time,at:'2026-10-27T08:00:00Z',readyState:4,seekEpoch:0,paused:false});
const scored=()=>({...base(),rallies:[{id:'r',label:'Test',start:snapshot(1),end:snapshot(5),point:{player:0,outcome:'winner',shot:'smash'}}]});
function fixture(){
 let disk,serial=0,remote={document:videoPayload(base()),revision:4,updated_at:'2026-10-27T08:00:00Z'};
 const backups=[],writes=[];
 const f={backups,writes,get remote(){return remote},set remote(value){remote=value},backupError:false,beforePost:null};
 f.sync=cloudSync({read:async()=>structuredClone(disk),write:async s=>{disk=structuredClone(s)},uuid:()=>String(++serial),backup:async r=>{if(f.backupError)throw Error('Disk full');backups.push(structuredClone(r));},request:async r=>{
  if(r.method==='GET')return {ok:true,session:structuredClone(remote)};
  writes.push(r);if(f.beforePost)await f.beforePost();
  if(r.revision!==remote.revision)return {ok:false,status:409,error:'Changed elsewhere'};
  remote={document:r.document,revision:r.revision+1,updated_at:'2026-10-27T09:00:00Z'};
  return {ok:true,revision:remote.revision,savedAt:remote.updated_at};
 }});return f;
}
test('explicit retry clears a conflict when server matches local; different records are never auto-overwritten',async()=>{
 const f=fixture();await f.sync.track(scored());await f.sync.flush();
 await f.sync.retry('match');assert.equal((await f.sync.status('match')).status,'conflict');assert.equal(f.writes.length,0);
 f.remote={...f.remote,document:videoPayload(scored())};await f.sync.retry('match');
 assert.equal((await f.sync.status('match')).status,'saved');assert.equal(f.writes.length,0);
});
test('reviewed replacement preserves both copies and saves using server revision',async()=>{
 const f=fixture();await f.sync.track(scored());await f.sync.flush();
 const review=await f.sync.review('match');assert.equal(review.local.points,1);assert.equal(review.remote.points,0);
 await f.sync.keepLocal('match',review.token);
 assert.equal(f.backups.length,1);assert.equal(f.backups[0].remote.payload.rallies.length,0);assert.equal(f.backups[0].local.rallies.length,1);
 assert.equal(f.writes[0].revision,4);assert.equal(f.remote.document.rallies.length,1);assert.equal((await f.sync.status('match')).status,'saved');
 await assert.rejects(f.sync.keepLocal('match',review.token),/Review/);
});
test('local changes, remote changes, and backup failure block replacement',async()=>{
 for(const change of ['local','remote','backup']){
  const f=fixture();await f.sync.track(scored());await f.sync.flush();const review=await f.sync.review('match');
  if(change==='local')await f.sync.track({...scored(),label:'Edited'});
  if(change==='remote')f.remote={...f.remote,revision:5};
  if(change==='backup')f.backupError=true;
  await assert.rejects(f.sync.keepLocal('match',review.token));assert.equal(f.writes.length,0);assert.equal(f.remote.document.rallies.length,0);
 }
});
test('concurrent server writer after review is protected by compare-and-swap',async()=>{
 const f=fixture();await f.sync.track(scored());await f.sync.flush();const review=await f.sync.review('match');
 f.beforePost=async()=>{f.remote={...f.remote,revision:5}};
 await f.sync.keepLocal('match',review.token);
 assert.equal((await f.sync.status('match')).status,'conflict');assert.equal(f.remote.document.rallies.length,0);assert.equal(f.backups.length,1);
});
test('upload reports syncing until the server acknowledges',async()=>{
 const f=fixture();await f.sync.track(scored());await f.sync.flush();const review=await f.sync.review('match');
 let release,started;const waiting=new Promise(r=>started=r);
 f.beforePost=async()=>{started();await new Promise(r=>release=r)};
 const save=f.sync.keepLocal('match',review.token);await waiting;
 assert.equal((await f.sync.status('match')).status,'syncing');release();await save;
 assert.equal((await f.sync.status('match')).status,'saved');
});
