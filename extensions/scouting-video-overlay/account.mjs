export const ADMIN_ORIGIN='https://admin.padelnachos.com';
export function extensionAccount({fetch:request=globalThis.fetch,extensionId,now=Date.now}){
 let cached=null,checkedAt=0,inflight=null,status={status:'checking'};
 async function check(force=false){
  if(!force&&cached&&now()-checkedAt<30000&&cached.expiresAt>now()+60000)return status;
  if(inflight)return inflight;
  inflight=(async()=>{
   try{
    const response=await request(ADMIN_ORIGIN+'/api/internal/scouting-extension/session?extensionId='+encodeURIComponent(extensionId),{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!response.ok){cached=null;status={status:response.status===401?'signed-out':response.status===403?'not-authorized':response.status===404?'update-required':'offline'};return status;}
    const data=await response.json();
    if(typeof data.token!=='string'||!Number.isFinite(data.expiresAt)||data.expiresAt<=now())throw Error('Invalid connection.');
    cached=data;checkedAt=now();status={status:'connected',email:data.email??null};
   }catch{cached=null;status={status:'offline'};}
   return status;
  })().finally(()=>{inflight=null;});return inflight;
 }
 async function connection(){
  await check();
  if(!cached)throw Error(({ 'signed-out':'Sign in to Padel Nachos again. Changes are saved locally.', 'not-authorized':'Scouting access is required. Ask an administrator to grant it. Changes are saved locally.', 'update-required':'The admin sign-in update is not deployed yet. Changes are saved locally.' })[status.status]??'Offline. Changes are saved locally and will retry automatically.');
  return {origin:ADMIN_ORIGIN,token:cached.token};
 }
 function invalidate(code){if([401,403].includes(code)){cached=null;status={status:code===401?'signed-out':'not-authorized'};}}
 return {check,connection,invalidate,status:()=>status};
}
