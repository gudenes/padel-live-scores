import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {adminVideoSync} from '../cloud.mjs';
const run=(env,request)=>runInNewContext(`(${adminVideoSync.toString()})(request)`,{...env,request,setTimeout,clearTimeout,AbortController});
const id='11111111-1111-4111-8111-111111111111';
test('admin transport only posts to the fixed same-origin route using operator cookies',async()=>{
 let path,options;
 const env={location:{origin:'https://admin.padelnachos.com'},fetch:async(p,o)=>{path=p;options=o;return {ok:true,status:200,json:async()=>({revision:2})};}};
 const r=await run(env,{matchId:id,method:'POST',revision:1,writeId:id,document:{version:1}});
 assert.equal(r.ok,true);assert.equal(path,'/api/internal/video-scouting/'+id);assert.equal(options.credentials,'same-origin');assert.equal(JSON.parse(options.body).revision,1);
 await assert.rejects(run(env,{matchId:'https://other.example',method:'POST'}),/Invalid server sync/);
 const wrong=await run({...env,location:{origin:'https://other.example'}},{matchId:id,method:'GET'});assert.equal(wrong.ok,false);
});
test('unavailable API and expired login are visible, never falsely reported as saved',async()=>{
 const env={location:{origin:'https://admin.padelnachos.com'},fetch:async()=>({ok:false,status:401,json:async()=>({error:'Sign in again'})})};
 const r=await run(env,{matchId:id,method:'GET'});assert.equal(r.ok,false);assert.equal(r.status,401);assert.match(r.error,/Sign in/);
 env.fetch=async()=>({ok:false,status:404,json:async()=>{throw Error('HTML');}});assert.equal((await run(env,{matchId:id,method:'GET'})).ok,false);
});

test('typed smash records wait for a capable server instead of silently losing their fields',async()=>{
 const calls=[],request={matchId:id,method:'POST',document:{rallies:[{point:{shot:'smash',smashType:'power',x4:true}}]}};
 const env={location:{origin:'https://admin.padelnachos.com'},fetch:async(p,o)=>{calls.push(o.method??'GET');return {ok:true,status:200,json:async()=>({session:null})};}};
 const blocked=await run(env,request);assert.equal(blocked.ok,false);assert.match(blocked.error,/server update/);assert.deepEqual(calls,['GET']);
 calls.length=0;env.fetch=async(p,o)=>{calls.push(o.method??'GET');return {ok:true,status:200,json:async()=>o.method==='POST'?{revision:1}:{features:['smash-types-v1']}};};
 assert.equal((await run(env,request)).ok,true);assert.deepEqual(calls,['GET','POST']);
});

test('VAR records wait for VAR support even when smash support is already deployed',async()=>{
 const calls=[],request={matchId:id,method:'POST',document:{pending:{varReviewed:true}}};
 const env={location:{origin:'https://admin.padelnachos.com'},fetch:async(p,o)=>{calls.push(o.method??'GET');return {ok:true,status:200,json:async()=>({features:['smash-types-v1']})};}};
 assert.equal((await run(env,request)).ok,false);assert.deepEqual(calls,['GET']);
 env.fetch=async(p,o)=>({ok:true,status:200,json:async()=>({features:['smash-types-v1','var-review-v1']})});
 assert.equal((await run(env,request)).ok,true);
});
