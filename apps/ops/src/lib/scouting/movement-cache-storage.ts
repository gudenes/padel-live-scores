import type {MovementData,MovementStore} from './movement-cache';
const DATABASE='padel-movement-cache',STORE='series',MAX_ENTRIES=3,MAX_AGE=30*24*60*60*1000;
type Entry={key:string;savedAt:number;value:MovementData};
function open():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(Error('Browser storage unavailable'));return;}
  const request=indexedDB.open(DATABASE,1);
  let expired=false;
  const timer=setTimeout(()=>{expired=true;reject(Error('Browser storage timed out'));},2000);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'key'}).createIndex('savedAt','savedAt');};
  request.onerror=()=>{clearTimeout(timer);reject(request.error);};
  request.onblocked=()=>{expired=true;clearTimeout(timer);reject(Error('Browser storage blocked'));};
  request.onsuccess=()=>{clearTimeout(timer);if(expired){request.result.close();return;}request.result.onversionchange=()=>request.result.close();resolve(request.result);};
 });
}
async function transaction<T>(mode:IDBTransactionMode,run:(store:IDBObjectStore,set:(value:T)=>void)=>void):Promise<T>{
 const db=await open();
 try{return await new Promise<T>((resolve,reject)=>{
  const tx=db.transaction(STORE,mode);let value:T;
  const timer=setTimeout(()=>{tx.abort();reject(Error('Browser storage timed out'));},5000);
  tx.oncomplete=()=>{clearTimeout(timer);resolve(value);};
  tx.onabort=tx.onerror=()=>{clearTimeout(timer);reject(tx.error??Error('Browser storage unavailable'));};
  try{run(tx.objectStore(STORE),v=>{value=v;});}catch(e){clearTimeout(timer);tx.abort();reject(e);}
 });}finally{db.close();}
}
export const movementStore:MovementStore={
 async read(key){
  return transaction<MovementData|null>('readonly',(store,set)=>{
   const request=store.get(key);
   request.onsuccess=()=>{
    const entry=request.result as Entry|undefined,value=entry?.value;
    const valid=value&&value.data&&value.motion&&Object.values(value.data).every(Array.isArray)&&Object.values(value.motion).every(Array.isArray);
    set(entry&&Date.now()-entry.savedAt<MAX_AGE&&valid?value!:null);
   };
  });
 },
 async write(key,value){
  await transaction<void>('readwrite',(store,set)=>{
   store.put({key,value,savedAt:Date.now()} satisfies Entry);
   // Prune via the index, without reading all the large series into JS memory.
   let kept=0;const request=store.index('savedAt').openCursor(null,'prev');
   request.onsuccess=()=>{const cursor=request.result;if(!cursor){set(undefined);return;}if(++kept>MAX_ENTRIES||Number(cursor.key)<Date.now()-MAX_AGE)cursor.delete();cursor.continue();};
  });
 }
};
