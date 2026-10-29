// Each successful set atomically commits the changed fields and their index.
// The legacy snapshot is retained for recovery, but never read after migration.
export function localStore(storage, legacyKey) {
 const indexKey=legacyKey+':fields:v1', prefix=indexKey+':';
 let encoded=null, cached, tail=Promise.resolve();
 const serial=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};
 async function load(){
  if(cached)return structuredClone(cached);
  const index=(await storage.get(indexKey))[indexKey];
  if(!index)return (await storage.get(legacyKey))[legacyKey];
  const values=await storage.get(index.map(key=>prefix+key));
  const state={};
  for(const key of index){if(!(prefix+key in values))throw Error('Local scouting data is incomplete. Keep your backup and contact support.');state[key]=values[prefix+key];}
  encoded=new Map(Object.entries(state).map(([key,value])=>[key,JSON.stringify(value)]));
  cached=structuredClone(state);
  return state;
 }
 return {
  read:()=>serial(load),
  write:state=>{const queuedAt=performance.now();return serial(async()=>{
   const timing={storageQueueMs:performance.now()-queuedAt};let start=performance.now();
   const next=new Map(Object.entries(state).filter(([,v])=>v!==undefined).map(([k,v])=>[k,JSON.stringify(v)]));
   const changes={};
   for(const [key,value] of next)if(encoded?.get(key)!==value)changes[prefix+key]=state[key];
   if(!encoded||JSON.stringify([...encoded.keys()])!==JSON.stringify([...next.keys()]))changes[indexKey]=[...next.keys()];
   timing.encodeMs=performance.now()-start;
   timing.changedChars=Object.keys(changes).reduce((n,key)=>n+(next.get(key.slice(prefix.length))?.length??0),0);
   timing.totalStateChars=[...next.values()].reduce((n,value)=>n+value.length,0);
   start=performance.now();
   if(Object.keys(changes).length)await storage.set(changes);
   timing.storageSetMs=performance.now()-start;
   start=performance.now();encoded=next;cached=structuredClone(state);
   timing.cacheCloneMs=performance.now()-start;
   return timing;
  });}
 };
}
