// Never copy undo history or the UI connection into upload preparation.
export function uploadState(state){return {version:1,captureMode:'video',label:state.label,setup:state.setup,rallies:state.rallies,cancelled:state.cancelled,pending:state.pending,scoutingTime:state.scoutingTime}}
export function payloadWorker(){
 const worker=new Worker(new URL('./live-payload-worker.mjs',import.meta.url),{type:'module'}),pending=new Map();
 const fail=()=>{for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error('Upload preparation failed. Your browser copy is retained.'))}pending.clear()};
 worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);clearTimeout(job.timer);data.error?job.reject(Error(data.error)):job.resolve(data.document)};
 worker.onerror=fail;worker.onmessageerror=fail;
 return {prepare:state=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);reject(Error('Upload preparation timed out. Retry saving.'))},30000);pending.set(id,{resolve,reject,timer});worker.postMessage({id,state:uploadState(state)})}),close:()=>{worker.terminate();fail()}};
}
