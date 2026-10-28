import {seekLiveCommand,canRestartLiveMedia} from './live-player-commands.mjs';
// Server-selected storage keeps local test sessions separate from production.
import {liveSync} from './live-sync.mjs';
import {payloadWorker} from './live-payload.mjs';
import {engine} from './engine.mjs';
import {fresh} from './core.mjs';
import {defaults} from './match.mjs';
import './shortcut-keys.js';
const matchId=new URL(location.href).searchParams.get('matchId');
if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(matchId??''))throw Error('Open Scout live from a match report.');
const response=await fetch('/api/internal/scouting/'+matchId+'/live-bootstrap',{cache:'no-store'});
const bootstrap=await response.json();if(!response.ok)throw Error(bootstrap.error??'Scouting access required.');
const bridge=window.parent!==window&&window.parent.__pnLiveScout;
if(!bridge)throw Error('Open Scout live and connect a video first.');
bridge.matchPlayers=bootstrap.match.players;
bridge.matchInfo={tournament:bootstrap.match.tournamentName,round:bootstrap.match.round,category:bootstrap.match.category,court:bootstrap.match.court};
const localTest=bootstrap.localTest===true;
document.querySelector('.local-test-note').textContent=localTest?'Local test · background saves to local server':'Background saving · Finish scouting to review on the match page';
const key=bootstrap.user.id+':'+matchId+':'+bridge.videoId;
if(!navigator.locks)throw Error('Use a browser with session locking support.');
let releaseLock;
await new Promise((resolve,reject)=>{navigator.locks.request((localTest?'pn-live-lab:':'pn-live:')+key,{ifAvailable:true},async lock=>{if(!lock){reject(Error('This live test is already open in another tab.'));return}resolve();await new Promise(release=>{releaseLock=release;addEventListener('pagehide',release,{once:true})})}).catch(reject)});
const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(localTest?'pn-live-scout-lab':'pn-live-scout',1);r.onupgradeneeded=()=>r.result.createObjectStore('sessions');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const endpoint=localTest?'/api/internal/scouting/'+matchId+'/live-session':'/api/internal/video-scouting/'+matchId;
async function request(options={}){const r=await fetch(endpoint,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000),...options});const body=await r.json();if(!r.ok)throw Object.assign(Error(body.error??'Could not save.'),{status:r.status});return body;}
const remoteResponse=await request(),remote=remoteResponse.session;
if(!localTest&&remote&&!remoteResponse.canResume)throw Error('This session belongs to another scouter. Ask an administrator to assign it to you.');
if(remote?.document?.captureMode==='standalone')throw Error('This match has an existing session without video. Open that scouting session to continue.');
const local=await new Promise((resolve,reject)=>{const r=db.transaction('sessions').objectStore('sessions').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
let envelope=local?.state?local:{state:local??remote?.document??{...fresh(),setup:{...defaults(),names:bootstrap.match.names,videoSourceUrl:'https://www.youtube.com/watch?v='+bridge.videoId,onboardingComplete:false,firstServerUnknown:true,otherServerUnknown:true}},revision:local?0:remote?.revision??0,dirty:!!local,generation:0,outbox:null};
if(!envelope.dirty&&!envelope.outbox&&(remote?.revision??0)>envelope.revision)envelope={state:remote.document,revision:remote.revision,dirty:false,generation:0,outbox:null};
let saved=envelope.state;
saved.selectedMatch=bootstrap.match;
if(saved.setup?.videoSourceUrl&&saved.setup.videoSourceUrl!=='https://www.youtube.com/watch?v='+bridge.videoId)throw Error('This saved session uses a different video. Reconnect its original video to continue.');
let disk=Promise.resolve(),finishing=false,finished=false;
async function store(value){const copy=structuredClone(value);const operation=()=>new Promise((resolve,reject)=>{const tx=db.transaction('sessions','readwrite');tx.objectStore('sessions').put(copy,key);tx.oncomplete=resolve;tx.onerror=()=>reject(Error('Local save failed. Export your test before continuing.'));tx.onabort=tx.onerror});const next=disk.then(operation);disk=next.catch(()=>{});await next;}
const uploads=payloadWorker();
const sync=liveSync({storage:localTest?'local-server':'server',envelope,store,payload:uploads.prepare,request:body=>request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
if(envelope.revision!==(remote?.revision??0)&&envelope.outbox?.writeId!==remote?.write_id)sync.conflict('This match changed elsewhere. Export this browser copy before resolving the conflict.');
async function persist(value){await sync.update(structuredClone(value));saved=envelope.state;publishPoints();}
function publishPoints(){bridge.points=saved.rallies.filter(r=>r.point&&!r.undone&&Number.isFinite(r.end?.time)).map((r,index)=>({id:r.id,number:index+1,start:r.start.time,end:r.end.time,player:saved.setup.names[r.point.player]}));}
publishPoints();bridge.reviewPoint=(id,position='start')=>{if(finishing||finished)throw Error('Reopen Scout live to continue.');seekLiveCommand(saved,bridge,{type:'replay',id,position});bridge.pause(true);};
bridge.pending=()=>!!saved.pending;bridge.exportState=()=>structuredClone(saved);bridge.syncStatus=()=>sync.status();
bridge.finish=async()=>{if(finishing)throw Error('Finishing is already in progress.');finishing=true;try{await dispatch({type:'state'});await sync.finish();finished=true;}finally{finishing=false}};
let storedBindings=null;try{storedBindings=JSON.parse(localStorage.getItem('pn-live-media-keys')??'null')}catch{}
let bindings=globalThis.__pnMediaKeys.normalize(storedBindings),lastCapture=null;
const dispatch=engine({canRestartMedia:canRestartLiveMedia,read:async()=>structuredClone(saved),write:persist,uuid:()=>crypto.randomUUID(),
 discover:async()=>({tabId:0,url:'https://www.youtube.com/watch?v='+bridge.videoId,videos:[bridge.snapshot()]}),capture:async()=>{lastCapture=bridge.snapshot();return lastCapture},
 seek:async(_c,_s,time)=>bridge.seek(time),playback:async(_c,_s,paused)=>bridge.pause(paused),setRate:async(_c,_s,rate)=>{bridge.rate(rate);for(let i=0;i<15;i++){const s=bridge.snapshot();if(s.rate===rate)return s;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('YouTube did not apply that playback speed.');},
 catalog:async()=>{throw Error('Choose a match from its report before opening Scout live.');}});
// Rebind the player without rewriting an interrupted rally's original identity.
saved.connection={tabId:0,page:'https://www.youtube.com/watch',candidates:[bridge.snapshot()],selected:bridge.snapshot()};
await store(envelope);sync.start();
const online=()=>void sync.flush().catch(()=>{});addEventListener('online',online);
const captures=new Set(['start','prepare','touch','first-fault','double-fault','smash','end','restart-rally']);
const blocked=new Set(['load-server','select-match','leave-match','create-manual','open-video','open-video-link','show-overlay','save-video-link']);
export async function send(message){try{
 if(message.type==='get-shortcuts')return {ok:true,bindings};
 if(message.type==='set-shortcuts'){bindings=globalThis.__pnMediaKeys.normalize(message.bindings);localStorage.setItem('pn-live-media-keys',JSON.stringify(bindings));return {ok:true,bindings};}
 if(message.type==='account-status')return {ok:true,auth:{status:'connected',email:localTest?'Local live test':'Browser scouting'},state:saved,sync:sync.status()};
 if(message.type==='sync-server'){await sync.flush();return {ok:true,state:structuredClone(saved),sync:sync.status()};}
 if((finishing||finished)&&!['state','sample'].includes(message.type))throw Error('Scouting is finishing. Open the match review.');
 if(sync.status().status==='conflict'&&!['state','sample'].includes(message.type))throw Error(sync.status().error);
 if(['skip','replay'].includes(message.type)){seekLiveCommand(saved,bridge,message);return {ok:true,state:structuredClone(saved),sample:bridge.snapshot(),sync:sync.status(),bindings};}
 if(blocked.has(message.type))throw Error('Use the match workspace to connect your video.');
 lastCapture=null;const result=await dispatch(message);
 if(captures.has(message.type)&&lastCapture)bridge.record({action:message.type,time:lastCapture.time,at:lastCapture.at,epoch:lastCapture.seekEpoch});
 return {ok:true,...result,sample:bridge.snapshot(),sync:sync.status(),bindings};
}catch(error){return {ok:false,error:error.message};}}
addEventListener('pagehide',()=>{sync.close();uploads.close();removeEventListener('online',online);releaseLock?.();db.close();bridge.exportState=undefined;bridge.pending=undefined;bridge.finish=undefined;bridge.reviewPoint=undefined},{once:true});
