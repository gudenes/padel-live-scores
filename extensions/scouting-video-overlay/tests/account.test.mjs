import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extensionAccount,ADMIN_ORIGIN} from '../account.mjs';
import {adminVideoSync} from '../cloud.mjs';
import {readAdminCatalog} from '../catalog.mjs';
test('connection survives a fresh worker with no admin tab and never stores credentials',async()=>{
 let calls=0;
 const fetch=async(url,options)=>{calls++;assert.equal(url,ADMIN_ORIGIN+'/api/internal/scouting-extension/session?extensionId='+'a'.repeat(32));assert.equal(options.credentials,'include');return {ok:true,json:async()=>({token:'proof',expiresAt:100000,email:'operator@example.com'})};};
 for(let i=0;i<2;i++){const account=extensionAccount({fetch,extensionId:'a'.repeat(32),now:()=>1000});assert.equal((await account.check()).status,'connected');assert.deepEqual(await account.connection(),{origin:ADMIN_ORIGIN,token:'proof'});}
 assert.equal(calls,2);
});
test('offline, expired login, non-operator and missing deployment preserve a reconnectable account',async()=>{
 let code=401;
 const account=extensionAccount({extensionId:'a'.repeat(32),now:()=>1000,fetch:async()=>{if(code===0)throw Error('Offline');return {ok:code===200,status:code,json:async()=>({token:'new-proof',expiresAt:100000})};}});
 for(const [value,status] of [[401,'signed-out'],[403,'not-authorized'],[404,'update-required'],[0,'offline']]){code=value;assert.equal((await account.check(true)).status,status);await assert.rejects(account.connection());}
 code=200;assert.equal((await account.check(true)).status,'connected');account.invalidate(401);assert.equal(account.status().status,'signed-out');assert.equal((await account.connection()).token,'new-proof');
});
test('direct catalogue and save use fixed admin URLs, included cookies and scoped proof',async()=>{
 const previous=globalThis.fetch;const urls=[];
 globalThis.fetch=async(url,options)=>{urls.push(url);assert.equal(options.credentials,'include');if(options.method==='POST')assert.equal(options.headers['X-Scouting-Authorization'],'proof');return {ok:true,status:200,json:async()=>options.method==='POST'?{revision:2}:{tournaments:[]}};};
 try{
  await readAdminCatalog({kind:'tournaments'},{origin:ADMIN_ORIGIN});
  const result=await adminVideoSync({matchId:'00000000-0000-0000-0000-000000000001',method:'POST',revision:1,writeId:'write',document:{rallies:[]}},{origin:ADMIN_ORIGIN,token:'proof'});
  assert.equal(result.revision,2);assert.equal(urls[0],ADMIN_ORIGIN+'/api/internal/tournament-explorer');assert.equal(urls[1],ADMIN_ORIGIN+'/api/internal/video-scouting/00000000-0000-0000-0000-000000000001');
 }finally{globalThis.fetch=previous;}
});

test('worker reload syncs its durable outbox without admin injection and retains every saved session',async()=>{
 const {fresh}=await import('../core.mjs'),{videoPayload}=await import('../server-model.mjs');
 const state={...fresh(),selectedMatch:{id:'00000000-0000-0000-0000-000000000001'},setup:{...fresh().setup,names:['A1','A2','B1','B2'],firstServer:0,otherServer:2,rule:"star-point"},sessions:{previous:{label:'Preserved earlier match'}},label:'Current scouting'};
 const payload=videoPayload(state),before=structuredClone(state);
 const disk={scoutingVideo:state,videoScoutingCloud:{entries:{[state.selectedMatch.id]:{payload,hash:JSON.stringify(payload),writeId:'00000000-0000-0000-0000-000000000002',revision:8,status:'pending'}}}};
 const previousFetch=globalThis.fetch;let posts=0,listener;
 globalThis.fetch=async(url,options)=>{
  assert.equal(options.credentials,'include');
  if(url.includes('/scouting-extension/session'))return {ok:true,json:async()=>({token:'proof',expiresAt:Date.now()+900000})};
  assert.equal(options.method,'POST');assert.equal(options.headers['X-Scouting-Authorization'],'proof');assert.deepEqual(JSON.parse(options.body).document,JSON.parse(JSON.stringify(payload)));posts++;
  return {ok:true,status:200,json:async()=>({revision:9,savedAt:'confirmed'})};
 };
 globalThis.chrome={runtime:{id:'a'.repeat(32),getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p,onMessage:{addListener:f=>listener=f}},action:{onClicked:{addListener(){}}},storage:{local:{get:async()=>structuredClone(disk),set:async data=>Object.assign(disk,structuredClone(data))},session:{get:async()=>{throw Error('Admin tab must not be needed');}}},scripting:{executeScript:async()=>{throw Error('Admin injection must not be needed');}}};
 try{
  for(let i=0;i<2;i++){
   await import('../background.mjs?account-worker='+i);
   const result=await new Promise(resolve=>listener({type:'sync-server'},{id:chrome.runtime.id,url:chrome.runtime.getURL('panel.html')},resolve));
   assert.equal(result.ok,true);assert.equal(result.sync.status,'saved',JSON.stringify(result));assert.equal(result.sync.revision,9);assert.deepEqual(disk.scoutingVideo,before);
  }
  assert.equal(posts,1);
 }finally{delete globalThis.chrome;globalThis.fetch=previousFetch;}
});
