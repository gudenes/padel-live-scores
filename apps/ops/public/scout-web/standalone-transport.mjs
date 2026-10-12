import {webResumeState} from './web-resume.mjs';
import {confirmResume} from './resume-warning.mjs';
import './shortcut-keys.js';
import {engine} from './engine.mjs';
import {videoPayload,validateVideoState} from './server-model.mjs';
import {defaults} from './match.mjs';
import {fresh} from './core.mjs';
const matchId=new URL(location.href).searchParams.get('matchId');
if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(matchId??''))throw Error('Open a match card in admin to start scouting.');
async function request(path,options={}){
 const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000),...options});
 const body=await response.json().catch(()=>({error:'Unexpected server response. Please sign in again.'}));
 if(!response.ok)throw Object.assign(Error(body.error??'Could not save scouting.'),{status:response.status});
 return body;
}
const bootstrap=await request('/api/internal/standalone-scouting/'+matchId);
const restart=new URL(location.href).searchParams.get('action')==='new';
const transfer=!!bootstrap.session&&bootstrap.session.document?.captureMode!=='standalone';
if(!await confirmResume(bootstrap.resumeWarning,restart?'new':'resume',transfer)){
 window.top.location.href='/scouting/'+matchId+'/report';
 await new Promise(()=>{});
}
const key=bootstrap.user.id+':'+matchId;
if(!navigator.locks)throw Error('This browser cannot protect your scouting session. Use a current version of Safari or Chrome.');
await new Promise((resolve,reject)=>{
 navigator.locks.request('pn-web-scout:'+key,{ifAvailable:true},async lock=>{
  if(!lock){reject(Error('This match is already open in another tab. Continue there or close it first.'));return;}
  resolve();await new Promise(release=>addEventListener('pagehide',release,{once:true}));
 }).catch(reject);
});
const database=await new Promise((resolve,reject)=>{const r=indexedDB.open('pn-web-scout',1);r.onupgradeneeded=()=>r.result.createObjectStore('sessions');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
let envelope=await new Promise((resolve,reject)=>{const r=database.transaction('sessions').objectStore('sessions').get(key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error)});
const remote=bootstrap.session;
if(transfer&&envelope&&(envelope.dirty||envelope.outbox))throw Error('This browser has unsaved scouting for this match. Export or sync that session before transferring from the extension.');
if(restart||transfer){
 const backup={savedAt:new Date().toISOString(),matchId,server:remote,local:envelope};
 await new Promise((resolve,reject)=>{const t=database.transaction('sessions','readwrite');t.objectStore('sessions').put(backup,key+':backup:'+crypto.randomUUID());t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});
 // Also provide a portable copy; the IndexedDB backup is committed first.
 const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='scouting-backup-'+matchId+'-'+Date.now()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 envelope=null;
 const cleanUrl=new URL(window.top.location.href);cleanUrl.searchParams.delete('action');window.top.history.replaceState(null,'',cleanUrl);
 const frameUrl=new URL(location.href);frameUrl.searchParams.delete('action');history.replaceState(null,'',frameUrl);
}
let sync={status:remote?'saved':'local',savedAt:remote?.updated_at},timer,running=false,initializing=true;
let diskQueue=Promise.resolve();
function store(){const value=structuredClone(envelope);const operation=()=>new Promise((resolve,reject)=>{const t=database.transaction('sessions','readwrite');t.objectStore('sessions').put(value,key);t.oncomplete=resolve;t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)});const result=diskQueue.then(operation);diskQueue=result.catch(()=>{});return result;}
if(!envelope||(!envelope.dirty&&!envelope.outbox&&(remote?.revision??0)>envelope.revision)){
 envelope={state:{...fresh(),setup:{...defaults(),names:bootstrap.match.names,onboardingComplete:false,firstServerUnknown:true,otherServerUnknown:true},...(!restart&&remote?webResumeState(validateVideoState(remote.document),matchId):{}),selectedMatch:bootstrap.match,captureMode:'standalone'},revision:remote?.revision??0,dirty:restart||transfer,transferToWeb:transfer,outbox:null,clockOrigin:Date.now()};
}
if(envelope.state.captureMode!=='standalone')throw Error('This local session is not standalone scouting.');
if(envelope.revision!==(remote?.revision??0)&&envelope.outbox?.writeId!==remote?.write_id){sync={status:'conflict',error:'This match changed on another device. Export your local backup before resolving the conflict.'};}
envelope.state.selectedMatch=bootstrap.match;
// Resume the logical clock after its last recorded event; never use a video timestamp.
const previousTimes=[...(envelope.state.rallies??[]),...(envelope.state.cancelled??[]),envelope.state.pending].filter(Boolean).flatMap(r=>[r.start,r.end,r.finish?.end,r.firstFault,...(r.touches??[]).map(t=>t.snapshot),...(r.attempts??[]).map(a=>a.snapshot)]).filter(Boolean).map(s=>s.time);
const offset=Math.max(0,...previousTimes),started=performance.now();
function snapshot(){return {tabId:0,documentId:'standalone:'+matchId,videoId:'standalone',mediaId:'standalone:'+matchId,seekEpoch:0,time:offset+(performance.now()-started)/1000,at:new Date().toISOString(),paused:false,ended:false,seeking:false,readyState:4,rate:1,page:'',visible:true,area:1};}
function schedule(){clearTimeout(timer);if(!initializing)timer=setTimeout(()=>void flush(),700);}
async function persist(state){
 state.captureMode='standalone';
 const changed=JSON.stringify(videoPayload(state))!==JSON.stringify(videoPayload(envelope.state));
 const prior=envelope;envelope={...envelope,state:structuredClone(state),dirty:envelope.dirty||changed};
 try{await store()}catch(error){envelope=prior;throw Error('Could not save on this device. Free storage before continuing.');}
 if(changed&&sync.status!=='conflict'){sync={...sync,status:'pending'};schedule();}
}
async function flush(){
 if(running||initializing||sync.status==='conflict'||!envelope.dirty&&!envelope.outbox)return;
 running=true;
 try{
  if(!envelope.outbox){envelope.outbox={revision:envelope.revision,writeId:crypto.randomUUID(),...(envelope.transferToWeb?{transferToWeb:true}:{}),document:videoPayload(envelope.state)};await store();}
  const sent=structuredClone(envelope.outbox);
  const result=await request('/api/internal/video-scouting/'+matchId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(sent)});
  envelope.revision=result.revision;envelope.outbox=null;envelope.transferToWeb=false;
  envelope.dirty=JSON.stringify(videoPayload(envelope.state))!==JSON.stringify(sent.document);
  await store();sync={status:envelope.dirty?'pending':'saved',savedAt:result.savedAt};
 }catch(error){sync={status:[401,403,409].includes(error.status)?'conflict':'error',error:error.message};}
 finally{running=false;if(envelope.dirty&&sync.status!=='conflict')timer=setTimeout(()=>void flush(),sync.status==='error'?15000:700);}
}
const dispatch=engine({read:async()=>structuredClone(envelope.state),write:persist,uuid:()=>crypto.randomUUID(),
 discover:async()=>({tabId:0,url:location.origin+'/scouting/'+matchId+'/live',videos:[snapshot()]}),capture:async()=>snapshot(),
 catalog:async input=>{if(input.kind==='coaches')return request('/api/internal/scouting-coaches?players='+encodeURIComponent(input.playerIds.join(',')));throw Error('Choose another match from the admin Matches page.');}});
// Rebuild the adapter connection even when the browser was closed during a rally.
envelope.state.connection={tabId:0,page:'',candidates:[snapshot()],selected:snapshot()};
await store();initializing=false;if(envelope.dirty||envelope.outbox)schedule();
addEventListener('online',()=>void flush());
let savedBindings=null;try{savedBindings=JSON.parse(localStorage.getItem('pn-web-media-keys')??'null')}catch{}
let bindings=globalThis.__pnMediaKeys.normalize(savedBindings);
export async function send(message){
 try{
  if(message.type==='get-shortcuts')return {ok:true,bindings};
  if(message.type==='set-shortcuts'){bindings=globalThis.__pnMediaKeys.normalize(message.bindings);localStorage.setItem('pn-web-media-keys',JSON.stringify(bindings));return {ok:true,bindings};}
  if(message.type==='account-status')return {ok:true,auth:{status:'connected',email:bootstrap.user.email},state:envelope.state,sync};
  if(['sync-server','checkpoint'].includes(message.type)){await flush();return {ok:true,state:structuredClone(envelope.state),sync};}
  if(message.type==='load-server')throw Error('Export your local backup and reopen this match on the device with the latest saved session.');
  if(['leave-match','select-match','create-manual','open-video','open-video-link','playback','speed','skip','cycle-speed','replay','show-overlay'].includes(message.type))throw Error('This session records without video. Choose matches from admin.');
  if(sync.status==='conflict'&&!['state','sample','coach-suggestions'].includes(message.type))throw Error(sync.error);
  const result=await dispatch(message);return {ok:true,...result,sample:snapshot(),sync,bindings};
 }catch(error){return {ok:false,error:error.message};}
}
