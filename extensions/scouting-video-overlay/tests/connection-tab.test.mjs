import {test} from 'node:test';
import assert from 'node:assert/strict';
test('Connect uses the current video tab even after the toolbar was clicked on admin',async()=>{
 let listener,probedTab;
 globalThis.chrome={
  action:{onClicked:{addListener(){}}},sidePanel:{},
  storage:{local:{get:async()=>({}),set:async()=>{}},session:{get:async()=>({candidateTab:99,adminTab:99})}},
  tabs:{query:async options=>{assert.deepEqual(options,{active:true,lastFocusedWindow:true});return [{id:7,url:'https://www.redbull.tv/replay'}];}},
  scripting:{executeScript:async args=>{probedTab=args.target.tabId;return [{documentId:'doc',frameId:0,result:[]}];}},
  runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn}}
 };
 try{
  await import('../background.mjs');
  const result=await new Promise(resolve=>listener({type:'connect'},{id:'test',url:'chrome-extension://test/panel.html'},resolve));
  assert.equal(probedTab,7);assert.equal(result.ok,false);assert.match(result.error,/No accessible video/);
 }finally{delete globalThis.chrome;}
});
