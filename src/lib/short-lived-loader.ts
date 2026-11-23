/** Coalesce concurrent reads and briefly reuse successful, non-personal data. */
export function shortLivedLoader<T>(ttlMs:number){
 const entries=new Map<string,{value?:T;expires:number;pending?:Promise<T>}>()
 return (key:string,load:()=>Promise<T>):Promise<T>=>{
  const current=entries.get(key)
  if(current?.pending)return current.pending
  if(current&&current.expires>Date.now())return Promise.resolve(current.value as T)
  // Bound old week/environment keys without evicting an in-flight request.
  for(const [k,entry] of entries)if(!entry.pending&&entry.expires<=Date.now())entries.delete(k)
  const entry:{value?:T;expires:number;pending?:Promise<T>}={expires:0}
  entry.pending=Promise.resolve().then(load).then(value=>{entry.value=value;entry.expires=Date.now()+ttlMs;entry.pending=undefined;return value},error=>{entries.delete(key);throw error})
  entries.set(key,entry)
  return entry.pending
 }
}
