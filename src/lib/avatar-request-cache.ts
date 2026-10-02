/** Short-lived, account-scoped cache; concurrent portraits share one request. */
export function createAvatarRequestCache<T>(ttl=60_000){
 const values=new Map<string,{value:T;time:number}>(),pending=new Map<string,Promise<T>>()
 return {
  peek:(key:string)=>values.get(key)?.value,
  prime(key:string,value:T){values.set(key,{value,time:Date.now()})},
  async read(key:string,load:()=>Promise<T>,force=false):Promise<T>{
   const cached=values.get(key)
   if(!force&&cached&&Date.now()-cached.time<ttl)return cached.value
   const running=pending.get(key);if(running)return running
   const request=load().then(value=>{values.set(key,{value,time:Date.now()});return value}).finally(()=>pending.delete(key))
   pending.set(key,request);return request
  },
 }
}
