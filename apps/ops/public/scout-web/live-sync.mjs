// Network and payload validation run after local capture commits, never inside capture().
export function liveSync({envelope,store,payload,request,onStatus=()=>{},delay=1200,storage='local-server'}){
 let timer,running=null,closed=false;
 let status={status:envelope.dirty||envelope.outbox?'pending':'saved',storage};
 const emit=value=>{status={...value,storage};onStatus(status)};
 const schedule=(wait=delay)=>{if(!closed&&!timer&&status.status!=='conflict')timer=setTimeout(()=>{timer=null;void flush().catch(()=>{})},wait)};
 async function update(state){
  envelope.state=state;envelope.generation=(envelope.generation??0)+1;envelope.dirty=true;envelope.completed=false;
  await store(envelope);if(status.status!=='conflict'){emit({status:'pending'});schedule()}
 }
 async function flush(){
  if(running)return running;
  if(status.status==='conflict')throw Error(status.error);
  if(!envelope.dirty&&!envelope.outbox)return;
  running=(async()=>{
   try{
    if(!envelope.outbox){const revision=envelope.revision,generation=envelope.generation??0,completed=!!envelope.completed;const document=await payload(envelope.state);envelope.outbox={revision,writeId:crypto.randomUUID(),document,completed,generation};await store(envelope)}
    const sent=structuredClone(envelope.outbox);emit({status:'syncing'});
    const result=await request(sent);
    envelope.revision=result.revision;envelope.outbox=null;envelope.dirty=(envelope.generation??0)!==sent.generation||!!envelope.completed!==sent.completed;
    await store(envelope);emit({status:envelope.dirty?'pending':'saved',savedAt:result.savedAt});
   }catch(error){emit({status:[401,403,409].includes(error.status)?'conflict':'error',error:error.message});throw error}
   finally{running=null;if(envelope.dirty||envelope.outbox)schedule(status.status==='error'?15000:delay)}
  })();return running;
 }
 async function finish(){
  clearTimeout(timer);timer=null;
  if(envelope.state.pending)throw Error('Finish or cancel the current rally first.');
  if(running)await running;
  envelope.completed=true;envelope.dirty=true;await store(envelope);
  while(envelope.dirty||envelope.outbox)await flush();
  return status;
 }
 function close(){closed=true;clearTimeout(timer)}
 return {update,flush,finish,close,status:()=>status,start:()=>{if(envelope.dirty||envelope.outbox)schedule()},conflict:message=>emit({status:'conflict',error:message})};
}
