import './shortcut-keys.js';
import {extensionAccount,ADMIN_ORIGIN} from './account.mjs';
const account=extensionAccount({extensionId:chrome.runtime.id});
import {videoPayload} from './server-model.mjs';
import {cloudSync,adminVideoSync} from './cloud.mjs';
import {match} from './match.mjs';
import {scoreLabel} from './generated/score-label.mjs';
import {shots} from './generated/shots.mjs';
import {readAdminCatalog} from './catalog.mjs';
import {videoProbe} from './probe.mjs';
import {engine} from './engine.mjs';
chrome.action.onClicked.addListener(tab=>{
  // open() must run directly inside the toolbar user gesture.
  chrome.sidePanel.open({windowId:tab.windowId}).catch(console.error);
  chrome.storage.session.set({candidateTab:tab.id}).catch(console.error);
});
async function invoke(connection,command){
  const selected=connection.selected;
  let results;
  try{results=await chrome.scripting.executeScript({target:{tabId:connection.tabId,documentIds:[selected.documentId]},func:videoProbe,args:[{...command,videoId:selected.videoId}]});}
  catch(error){if(/No document with id|selected player disappeared|video source changed/i.test(error.message))throw Error('Video connection expired. Reconnect video in the overlay or use Connect video in the side panel. If a rally is open, cancel it first.');throw error;}
  const result=results.find(r=>r.documentId===selected.documentId)?.result;
  if(!result||Array.isArray(result))throw Error('Video unavailable. Reopen the video tab and reconnect.');
  return {...result,tabId:connection.tabId,documentId:selected.documentId,frameId:selected.frameId};
}
const sync=cloudSync({
 read:async()=>(await chrome.storage.local.get('videoScoutingCloud')).videoScoutingCloud,
 write:store=>chrome.storage.local.set({videoScoutingCloud:store}),
 uuid:()=>crypto.randomUUID(),
 request:async request=>{
  try{const result=await adminVideoSync(request,await account.connection());account.invalidate(result.status);return result;}
  catch(error){return {ok:false,error:error.message};}
 }
});
function scheduleSync(){
 chrome.alarms?.create('video-scouting-sync',{delayInMinutes:1,periodInMinutes:1});
 sync.flush().catch(console.error);
}
chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name==='video-scouting-sync')sync.flush().catch(console.error);});
const dispatch=engine({
  read:async()=>(await chrome.storage.local.get('scoutingVideo')).scoutingVideo,
  write:async (state,context)=>{
    await chrome.storage.local.set({scoutingVideo:state});
    if(context?.remote)await sync.acknowledge(state.selectedMatch.id,context.remote);
    if(state.selectedMatch?.id&&context?.type!=='restore-cloud'){await sync.track(state);scheduleSync();}
  },
  uuid:()=>crypto.randomUUID(),
  catalog:async request=>{
    const connection=await account.connection();
    if(request.kind==='manual-session'){const result=await adminVideoSync({kind:'manual',method:'GET',matchId:request.matchId},connection);if(!result.ok)throw Error(result.error);return result;}
    if(['create-manual','manual-matches','search-players'].includes(request.kind)){
     const path='/api/internal/manual-scouting-matches'+(request.kind==='search-players'?'?players='+encodeURIComponent(request.query):'');
     const response=await fetch(ADMIN_ORIGIN+path,{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(10000),...(request.kind==='create-manual'?{method:'POST',headers:{'Content-Type':'application/json','X-Scouting-Authorization':connection.token},body:JSON.stringify(request.input)}:{})});
     account.invalidate(response.status);let data;try{data=await response.json();}catch{throw Error('Private match support is unavailable. Your local work is retained.');}
     if(!response.ok)throw Error(data.error??'Could not load private scouting.');return data;
    }
    return readAdminCatalog(request,{origin:ADMIN_ORIGIN});
  },
  discover:async tabId=>{
    // Resolve the tab at Connect time, not the last toolbar click (which may be admin).
    const tab=Number.isInteger(tabId)?await chrome.tabs.get(tabId):(await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0];
    if(!tab?.url||!/^https?:/.test(tab.url))throw Error('Select the match video tab, click the Padel Nachos toolbar icon to allow access, then Connect video.');
    let frames;
    try{frames=await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},func:videoProbe,args:[{kind:'list'}]});}
    catch{frames=await chrome.scripting.executeScript({target:{tabId:tab.id},func:videoProbe,args:[{kind:'list'}]});}
    const videos=frames.flatMap(f=>Array.isArray(f.result)?f.result.map(v=>({...v,tabId:tab.id,documentId:f.documentId,frameId:f.frameId})):[]);
    videos.sort((a,b)=>Number(b.visible)-Number(a.visible)||Number(a.paused)-Number(b.paused)||b.area-a.area);
    return {tabId:tab.id,url:tab.url,videos};
  },
  capture:connection=>invoke(connection,{kind:'read'}),
  setRate:(connection,current,rate)=>invoke(connection,{kind:'speed',mediaId:current.mediaId,rate}),
  playback:(connection,current,paused)=>invoke(connection,{kind:'playback',mediaId:current.mediaId,paused}),
  seek:(connection,current,time)=>invoke(connection,{kind:'seek',mediaId:current.mediaId,time})
});
let bindingsQueue=Promise.resolve();
function savedBindings(){
 const read=async()=>{const stored=await chrome.storage.local.get(['videoMediaShortcuts','videoFastKeysV1']);
  const bindings=stored.videoFastKeysV1?globalThis.__pnMediaKeys.normalize(stored.videoMediaShortcuts):globalThis.__pnMediaKeys.upgradeFastBindings(stored.videoMediaShortcuts);
  if(!stored.videoFastKeysV1)await chrome.storage.local.set({videoMediaShortcuts:bindings,videoFastKeysV1:true});return bindings;};
 const result=bindingsQueue.then(read);bindingsQueue=result.catch(()=>{});return result;
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
 if(sender.id!==chrome.runtime.id)return;
 const panel=sender.url?.startsWith(chrome.runtime.getURL('panel.html'));
 const allowed=new Set(['state','sample','get-shortcuts','reconnect','start','prepare','score','clear-outcome','first-fault','double-fault','smash','undo','cancel','server','ends','skip','positions','playback','overlay-layout','speed','cycle-speed']);
 const run=async()=>{
  if(!panel){
   const {overlayTab}=await chrome.storage.session.get('overlayTab');
   const state=(await chrome.storage.local.get('scoutingVideo')).scoutingVideo;
   const connectedTab=state?.connection?.tabId??overlayTab;
   if(!Number.isInteger(connectedTab)||sender.tab?.id!==connectedTab||sender.frameId!==0||!allowed.has(message.type))throw Error('Connect this video in the side panel, then show the video remote again.');
  }
  if(message.type==='account-status'){const auth=await account.check(true);if(auth.status==='connected')scheduleSync();return {auth};}
  if(message.type==='sign-in'){await chrome.tabs.create({url:ADMIN_ORIGIN+'/login'});return {auth:{status:'signing-in'}};}
  if(message.type==='search-players'){return {players:(await dispatch({type:'search-players',query:message.query})).players};}
  if(message.type==='open-video'){const {state}=await dispatch({type:'state'});const link=state.selectedMatch?.videoUrl;if(!link||!/^https?:\/\//.test(link))throw Error('No video link is saved.');await chrome.tabs.create({url:link});return {state};}
  if(message.type==='get-shortcuts'){return {bindings:await savedBindings()};}
  if(message.type==='set-shortcuts'){const bindings=globalThis.__pnMediaKeys.normalize(message.bindings);await savedBindings();await chrome.storage.local.set({videoMediaShortcuts:bindings,videoFastKeysV1:true});return {bindings};}
  if(message.type==='cloud-backup'){
   const {state}=await dispatch({type:'state'});
   const {videoScoutingBackups}=await chrome.storage.local.get('videoScoutingBackups');
   const backup=videoScoutingBackups?.[state.selectedMatch?.id];if(!backup)throw Error('No local backup is available for this match yet.');return {backup};
  }
  if(message.type==='sync-server'){
   const {state}=await dispatch({type:'state'});
   for(const session of Object.values(state.sessions??{})){if(session.selectedMatch?.id)await sync.track({...session,version:1,pending:null});}
   if(state.selectedMatch){await sync.track(state);await sync.flush();}
   return {state,sync:state.selectedMatch?await sync.status(state.selectedMatch.id):{status:'local'}};
  }
  if(message.type==='load-server'){
   const {state}=await dispatch({type:'state'});
   if(!state.selectedMatch||state.pending)throw Error('Select a match and finish or cancel the open rally first.');
   await sync.flush();const id=state.selectedMatch.id,remote=await sync.load(id);
   const previous=(await chrome.storage.local.get('videoScoutingBackups')).videoScoutingBackups??{};
   previous[id]={at:new Date().toISOString(),selectedMatch:state.selectedMatch,document:videoPayload(state)};await chrome.storage.local.set({videoScoutingBackups:previous});
   const result=await dispatch({type:'restore-cloud',matchId:id,document:remote.payload,expectedHash:JSON.stringify(videoPayload(state))});
   await sync.acknowledge(id,remote);await sync.track(result.state);scheduleSync();
   const shortcuts=await savedBindings();
  return {...result,bindings:globalThis.__pnMediaKeys.normalize(shortcuts),sync:await sync.status(id)};
  }
  if(message.type==='restore-cloud')throw Error('Load the saved server copy through the side panel.');
  if(message.type==='show-overlay'){
   const {state}=await dispatch({type:'state'});
   if(!state.selectedMatch||!state.connection)throw Error('Select a match and connect the video first.');
   await chrome.storage.session.set({overlayTab:state.connection.tabId});
   await chrome.scripting.executeScript({target:{tabId:state.connection.tabId},files:['shortcut-keys.js','overlay.js']});
   return {state};
  }
  const result=await dispatch(message),m=match(result.state);
  const shortcuts=await savedBindings();
  return {...result,auth:account.status(),bindings:globalThis.__pnMediaKeys.normalize(shortcuts),sync:result.state.selectedMatch?await sync.status(result.state.selectedMatch.id):{status:'local'},view:{score:m.score,stats:m.stats,near:m.near,server:m.server,points:m.points,labels:{a:scoreLabel(m.score,'a'),b:scoreLabel(m.score,'b')},shots}};
 };
 run().then(data=>sendResponse({ok:true,...data}),error=>sendResponse({ok:false,error:error.message||'Overlay unavailable.'}));
 return true;
});

// Retry the durable outbox after browser/extension restarts; no admin tab is required.
scheduleSync();
