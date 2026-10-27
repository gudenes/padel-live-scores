import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {syncUI,syncLabel} from '../sync-ui.mjs';
test('save labels distinguish local durability, upload in progress, confirmation and conflicts',()=>{
 assert.match(syncLabel({status:'pending'},185),/device.*waiting/);
 assert.match(syncLabel({status:'syncing'},185),/Syncing/);
 assert.equal(syncLabel({status:'saved'},185),'185 points saved to server');
 assert.match(syncLabel({status:'conflict'},185),/conflict/);
 assert.match(syncLabel({status:'error'},185),/device.*failed/);
});
test('comparison requires an explicit choice and uses the reviewed token; switching matches discards it',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8')),$=id=>dom.window.document.getElementById(id),actions=[];
 const review={matchId:'a',token:'review-a',local:{points:134,sets:[{a:6,b:2},{a:7,b:6}],finished:true},remote:{points:3,sets:[{a:0,b:0}],finished:false}};
 const render=syncUI({$,act:async message=>{actions.push(message);return {ok:true,review}}});
 try{
  render({selectedMatch:{id:'a'}},{status:'conflict'},false,134);
  await $('sync-review').onclick();
  assert.equal(actions.length,1);assert.equal($('sync-comparison').hidden,false);
  assert.match($('sync-local-summary').textContent,/134 points.*6–2, 7–6.*Finished/);
  assert.match($('sync-remote-summary').textContent,/3 points.*In progress/);
  render({selectedMatch:{id:'a'},pending:{}},{status:'conflict'},false,134);
  assert.equal($('sync-keep-local').disabled,true);assert.equal($('sync-use-server').disabled,true);
  render({selectedMatch:{id:'a'}},{status:'conflict'},false,134);
  await $('sync-keep-local').onclick();assert.deepEqual(actions.at(-1),{type:'keep-local',token:'review-a'});
  assert.equal($('sync-comparison').hidden,true);
  await $('load-server').onclick();assert.equal(actions.at(-1).type,'review-conflict');
  await $('sync-use-server').onclick();assert.deepEqual(actions.at(-1),{type:'load-server',token:'review-a'});
  await $('sync-review').onclick();render({selectedMatch:{id:'b'}},{status:'pending'},false,1);
  assert.equal($('sync-comparison').hidden,true);
 }finally{dom.window.close()}
});
test('failed comparison is explained inside the sync menu without offering replacement',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8')),$=id=>dom.window.document.getElementById(id);
 try{
  const render=syncUI({$,act:async()=>({ok:false,error:'The server copy changed. Review the copies again.'})});
  render({selectedMatch:{id:'a'}},{status:'conflict'},false,134);
  await $('sync-review').onclick();
  assert.match($('sync-review-error').textContent,/server copy changed/);assert.equal($('sync-comparison').hidden,true);
 }finally{dom.window.close()}
});
