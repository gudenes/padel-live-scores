import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fresh} from '../core.mjs';
import {engine} from '../engine.mjs';
test('expired document reports recovery; overlay reconnect targets its own tab and restores +30s',async()=>{
 let listener,seekTime,queried=false;
 const snap={videoId:'new-video',mediaId:'new-media',time:100,at:new Date().toISOString(),paused:false,ended:false,seeking:false,readyState:4,rate:1,seekEpoch:0,seekable:[[0,5000]]};
 let disk={...fresh(),connection:{tabId:7,page:'https://www.youtube.com/watch',candidates:[],selected:{documentId:'old-document',videoId:'old-video'}}};
 globalThis.chrome={
  action:{onClicked:{addListener(){}}},sidePanel:{},
  storage:{local:{get:async()=>({scoutingVideo:structuredClone(disk)}),set:async value=>{disk=value.scoutingVideo;}},session:{get:async()=>({})}},
  tabs:{query:async()=>{queried=true;throw Error('Must not use an unrelated active tab');},get:async id=>{assert.equal(id,7);return {id,url:'https://www.youtube.com/watch?v=replay'};}},
  scripting:{executeScript:async args=>{
   assert.equal(args.target.tabId,7);
   if(args.target.documentIds?.[0]==='old-document')throw Error('No document with id old-document in tab with id 7');
   const command=args.args[0];if(command.kind==='seek')seekTime=command.time;
   return [{documentId:'new-document',frameId:0,result:command.kind==='list'?[snap]:snap}];
  }},
  runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn}}
 };
 try{
  await import('../background.mjs');
  const sender={id:'test',tab:{id:7},frameId:0,url:'https://www.youtube.com/watch?v=replay'};
  const send=(message,who=sender)=>new Promise(resolve=>listener(message,who,resolve));
  const failed=await send({type:'sample'});assert.equal(failed.ok,false);assert.match(failed.error,/Video connection expired.*Reconnect video/);
  const recovered=await send({type:'reconnect'});assert.equal(recovered.ok,true);assert.equal(disk.connection.selected.documentId,'new-document');assert.equal(queried,false);
  const skipped=await send({type:'skip',seconds:30});assert.equal(skipped.ok,true);assert.equal(seekTime,130);
  assert.equal((await send({type:'reconnect'},{...sender,tab:{id:8}})).ok,false);
 }finally{delete globalThis.chrome;}
});
test('reconnection preserves saved scouting data and refuses to interrupt an open rally',async()=>{
 const rally={id:'saved-rally'},selectedMatch={id:'match'},sessions={other:{label:'Other match'}};
 let disk={...fresh(),selectedMatch,sessions,rallies:[rally],connection:{tabId:7}};
 const dispatch=engine({read:async()=>structuredClone(disk),write:async s=>{disk=s;},discover:async tabId=>{assert.equal(tabId,7);return {tabId,url:'https://www.youtube.com/watch?v=replay',videos:[{documentId:'new'}]};}});
 await dispatch({type:'reconnect'});assert.deepEqual(disk.rallies,[rally]);assert.deepEqual(disk.selectedMatch,selectedMatch);assert.deepEqual(disk.sessions,sessions);
 disk.pending={id:'open-rally'};await assert.rejects(dispatch({type:'reconnect'}),/Finish or cancel/);assert.equal(disk.pending.id,'open-rally');
});
