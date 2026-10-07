import {videoPayload,validateVideoState} from './server-model.mjs';
const hash=payload=>JSON.stringify(validateVideoState(payload));
export function cloudSync({read,write,request,uuid}){
 let queue=Promise.resolve(),flushing=null;
 const mutate=fn=>{const next=queue.then(async()=>{const store=await read()??{entries:{}};store.entries??={};const result=await fn(store);await write(store);return result;});queue=next.catch(()=>{});return next;};
 const track=state=>mutate(store=>{
  const id=state.selectedMatch?.id;if(!id)return;
  const payload=videoPayload(state),value=hash(payload),old=store.entries[id];
  if(old?.hash===value)return;
  store.entries[id]={...old,payload,hash:value,writeId:uuid(),revision:old?.revision??null,status:old?.status==='conflict'?'conflict':'pending',error:old?.status==='conflict'?old.error:''};
 });
 function flush(){
  if(flushing)return flushing;
  flushing=drain().finally(()=>{flushing=null;});return flushing;
 }
 async function drain(){
   const ids=await mutate(store=>Object.keys(store.entries));
   for(const id of ids){
    let entry=await mutate(store=>structuredClone(store.entries[id]));
    if(!entry||!['pending','error'].includes(entry.status))continue;
    try{
     if(entry.revision===null){
      const result=await request({matchId:id,method:'GET'});
      if(!result.ok)throw Object.assign(Error(result.error),{status:result.status});
      const remote=result.session;
      if(remote){
       const same=hash(remote.document)===entry.hash;
       await mutate(store=>{const current=store.entries[id];current.revision=remote.revision;if(same){current.status=current.hash===entry.hash?'saved':'pending';current.savedAt=remote.updated_at;current.ackHash=entry.hash;current.error='';}else{current.status='conflict';current.error='A server copy already exists. Load it before continuing; your local copy is retained.';}});
       continue;
      }
      await mutate(store=>{store.entries[id].revision=0;});entry.revision=0;
     }
     const sending=entry.flight??{revision:entry.revision,writeId:entry.writeId,payload:entry.payload,hash:entry.hash};
     await mutate(store=>{store.entries[id].flight=sending;});
     const result=await request({matchId:id,method:'POST',revision:sending.revision,writeId:sending.writeId,document:sending.payload});
     if(!result.ok)throw Object.assign(Error(result.error),{status:result.status});
     await mutate(store=>{const current=store.entries[id];current.revision=result.revision;current.ackHash=sending.hash;current.savedAt=result.savedAt;current.error='';delete current.flight;current.status=current.hash===sending.hash?'saved':'pending';});
    }catch(error){await mutate(store=>{const current=store.entries[id];if([400,413].includes(error.status)&&current.flight){const rejected=current.flight;current.rejectedFlights=[...(current.rejectedFlights??[]),{...rejected,error:error.message}].slice(-5);delete current.flight;current.writeId=uuid();current.status=current.hash!==rejected.hash?'pending':'error';}else current.status=error.status===409?'conflict':'error';current.error=error.message||'Server unavailable. Your local copy is retained.';});}
   }
  await queue;const remaining=(await read())?.entries??{};if(Object.values(remaining).some(e=>e.status==='pending'))await drain();
 }
 async function load(id){
  const result=await request({matchId:id,method:'GET'});
  if(!result.ok)throw Error(result.error);
  if(!result.session)throw Error('No server copy is saved for this match yet.');
  return {payload:validateVideoState(result.session.document),revision:result.session.revision,savedAt:result.session.updated_at};
 }
 const acknowledge=(id,remote)=>mutate(store=>{const payload=validateVideoState(remote.payload);store.entries[id]={payload,hash:hash(payload),ackHash:hash(payload),revision:remote.revision,writeId:uuid(),status:'saved',savedAt:remote.savedAt,error:''};});
 const status=async id=>{await queue;const entry=(await read())?.entries?.[id];return entry?{status:entry.status,error:entry.error,savedAt:entry.savedAt,revision:entry.revision}:{status:'local',error:''};};
 return {track,flush,load,acknowledge,status};
}
// Runs in the connected admin tab; credentials never enter the extension.
export async function adminVideoSync(request){
 // A string preserves null fields across Chrome’s executeScript argument bridge.
 if(typeof request==='string')request=JSON.parse(request);
 if(location.origin!=='https://admin.padelnachos.com')return {ok:false,error:'Open admin in Chrome, sign in and load tournaments to enable server saves.'};
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request.matchId??'')||!['GET','POST'].includes(request.method))throw Error('Invalid server sync request.');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
 try{
  const typed=r=>r?.attempts?.some(a=>a.smashType)||r?.point?.smashType||r?.point?.x4;
  const records=[...(request.document?.rallies??[]),...(request.document?.cancelled??[]),request.document?.pending];
  const required=[...(records.some(typed)?['smash-types-v1']:[]),...(records.some(r=>r?.point?.smashType==='soft'||r?.attempts?.some(a=>a.smashType==='soft'||a.touchIndex!==undefined))?['soft-smash-v1']:[]),...(records.some(r=>r?.varReviewed)?['var-review-v1']:[]),...(records.some(r=>r?.touches?.length)?['rally-touches-v1']:[]),...(records.some(r=>r?.point?.forcedBy!==undefined||r?.point?.netTouch)?['point-tags-v2']:[])];
  if(request.method==='POST'&&required.length){
   const check=await fetch('/api/internal/video-scouting/'+encodeURIComponent(request.matchId),{credentials:'same-origin',cache:'no-store',signal:controller.signal});
   const support=await check.json();
   if(!check.ok)return {ok:false,status:check.status,error:support.error??'Sign in to admin again. Your local copy is retained.'};
   if(!required.every(f=>support.features?.includes(f)))return {ok:false,error:'The server update for point tags, shot tracking, X3, Power, Soft smash, X4 or VAR is pending. Your full local record is retained and will retry after the update.'};
  }
  const response=await fetch('/api/internal/video-scouting/'+encodeURIComponent(request.matchId),{method:request.method,credentials:'same-origin',cache:'no-store',signal:controller.signal,...(request.method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:request.revision,writeId:request.writeId,document:request.document})}:{})});
  let data;try{data=await response.json();}catch{return {ok:false,status:response.status,error:'Server sync is not available yet. Your local copy is retained.'};}
  return {...data,ok:response.ok,status:response.status};
 }catch{return {ok:false,error:'Could not reach the server. Your local copy is retained.'};}finally{clearTimeout(timer);}
}
