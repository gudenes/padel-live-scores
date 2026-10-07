import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {scoutingUI} from '../scout-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
import {quickShots} from '../shot-shortcuts.mjs';
import {shots} from '../generated/shots.mjs';
import {mediaShortcuts} from '../media-shortcuts.mjs';
test('gaming shot keys select then Enter saves the canonical shot; detail mode waits for save and inputs ignore shot keys',()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const $=id=>document.getElementById(id),actions=[];
 let state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'rally',start:{time:100},finish:{player:0,outcome:'winner',end:{time:110}}}};
 const render=scoutingUI({$,act:msg=>actions.push(msg),getState:()=>state});
 try{
  render(state,{time:110,paused:false},false,true);
  for(const id of ['first-fault','double-fault','var-review'])assert.equal($(id).closest('section').id,'scouting-workspace');
  assert.equal(document.querySelectorAll('#first-fault').length,1);assert.equal($('double-fault').disabled,true);
  $('var-review').click();assert.deepEqual(actions.pop(),{type:'var-review',reviewed:true});
  state.pending.varReviewed=true;render(state,{time:110},false,true);assert.equal($('shot-var').checked,true);assert.equal($('var-review').getAttribute('aria-pressed'),'true');
  $('shot-var').checked=false;$('shot-var').dispatchEvent(new dom.window.Event('change'));assert.deepEqual(actions.pop(),{type:'var-review',reviewed:false});delete state.pending.varReviewed;render(state,{time:110},false,true);
  assert.equal($('score').querySelector('strong').getAttribute('aria-label'),'Player A1, serving');
  const pressNoShot=new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});$('shot-options').querySelector('button').dispatchEvent(pressNoShot);assert.equal(actions.length,0);assert.match($('shot-error').textContent,/Choose a shot/);
  const initial=state;
  state={...state,setup:{...state.setup,startingScore:{completed:[{a:6,b:4}],games:{a:5,b:4},points:{a:40,b:40},server:0,near:'a',advantageReturns:2}}};render(state,{time:110},false,true);
  assert.match($('pressure').textContent,/Star Point/);assert.match($('pressure').textContent,/Break point/);assert.match($('pressure').textContent,/Match point/);
  const rows=$('score').querySelectorAll('tr');assert.equal(rows[1].querySelector('strong').textContent,'Player A1');assert.doesNotMatch(rows[2].textContent,/Break point/);
  state={...state,setup:{...state.setup,startingScore:{...state.setup.startingScore,completed:[],points:{a:40,b:0},advantageReturns:0}}};render(state,{time:110},false,true);assert.match($('pressure').textContent,/Set point/);assert.doesNotMatch($('pressure').textContent,/Match point/);
  state=initial;render(state,{time:110},false,true);
  assert.equal($('shot-options').querySelector('[aria-label="Common shots"]').children.length,9);
  assert.deepEqual(quickShots.map(([key])=>key),['q','w','e','a','s','d','1','2','3']);
  assert.deepEqual(quickShots.slice(-2),[['2','block'],['3','bajada']]);
  assert.equal($('shot-options').querySelector('[data-shot=wall]').dataset.shortcut,undefined);
  assert.equal($('shot-options').querySelector('[data-shot=return]').dataset.shortcut,undefined);
  assert.equal(new Set([...$('shot-options').querySelectorAll('button')].map(b=>b.dataset.shot)).size,Object.keys(shots).length);
  const press=(target,key,options={})=>target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
  for(const [key,shot] of quickShots){
   state.pending.id='rally-'+key;render(state,{time:110},false,true);const before=actions.length;press($('shot-form'),key);assert.equal(actions.length,before);assert.equal($('shot-options').querySelector(`[data-shot="${shot}"]`).getAttribute('aria-pressed'),'true');if(shot==='smash')press($('shot-form'),'z');press($('shot-options').querySelector('button'),'Enter');
   assert.deepEqual(actions.at(-1),{type:'score',details:{shot,...(shot==='smash'?{smashType:'power'}:{})}});
  }
  state.pending.id='soft-flow';render(state,{time:110},false,true);press($('shot-form'),'q');press($('shot-form'),'c');press($('shot-form'),' ');assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'smash',smashType:'soft'}});
  state.pending.id='space-flow';render(state,{time:110},false,true);press($('shot-form'),'w');const beforeSpace=actions.length;press($('shot-options').querySelector('button'),' ');assert.equal(actions.length,beforeSpace+1);assert.equal(actions.at(-1).details.shot,'volley');press($('shot-form'),' ',{repeat:true});assert.equal(actions.length,beforeSpace+1);
  $('quick-save').checked=true;$('quick-save').dispatchEvent(new dom.window.Event('change'));$('shot-options').querySelector('[data-shot="volley"]').click();assert.equal(actions.at(-1).details.shot,'volley');
  $('quick-save').checked=false;$('quick-save').dispatchEvent(new dom.window.Event('change'));const before=actions.length;
  press($('shot-form'),'s');assert.equal(actions.length,before);
  $('assist').checked=true;press($('shot-form'),'Enter',{ctrlKey:true});assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'groundstroke',assistBy:1}});
  const saved=actions.length;press($('shot-form'),'Enter',{repeat:true});press($('shot-side'),'q');press($('shot-form'),'w',{repeat:true});assert.equal(actions.length,saved);
  render(state,{time:110},true,true);press($('shot-form'),'Enter',{ctrlKey:true});assert.equal(actions.length,saved);
  state.pending.id='typed-flow';state.pending.attempts=[{player:0,smashType:'power',snapshot:{time:105}}];render(state,{time:110},false,true);const typedBefore=actions.length;press($('shot-form'),'q');press($('shot-form'),'Enter');assert.equal(actions.length,typedBefore);assert.match($('shot-error').textContent,/smash type/);press($('shot-form'),'z');assert.match($('shot-summary').textContent,/Attempt already counted/);press($('shot-form'),'4');press($('shot-form'),'Enter');assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'smash',smashType:'power',x4:true,smashAlreadyCounted:true,smashAttemptIndex:0}});press($('shot-form'),'x');assert.equal($('x4').checked,false);assert.match($('shot-summary').textContent,/Adds one attempt/);
 }finally{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});
test('media shortcuts dispatch once, respect disabled controls and ignore typing',()=>{
 const dom=new JSDOM('<button id="back"></button><button id="pause"></button><button id="forward"></button><input>');
 const document=dom.window.document,buttons=['back','pause','forward'].map(id=>document.getElementById(id)),calls=[];
 buttons.forEach((button,i)=>button.onclick=()=>calls.push(i));
 const remove=mediaShortcuts({target:document,back:buttons[0],pause:buttons[1],forward:buttons[2]});
 const press=(target,key,options={})=>target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
 for(const key of ['j','k','l'])press(document,key);assert.deepEqual(calls,[0,1,2]);
 buttons[2].disabled=true;press(document,'l');press(document,'j',{repeat:true});press(document.querySelector('input'),'k');assert.equal(calls.length,3);
 remove();press(document,'j');assert.equal(calls.length,3);dom.window.close();
});
test('rapid tap then C queues classification behind the in-flight shot save',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 const $=id=>document.getElementById(id),state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'r',start:{time:100}}},calls=[];let release;
 const render=scoutingUI({$,getState:()=>state,act:async msg=>{calls.push(msg);if(msg.type==='touch'){render(state,{time:101},true,true);await new Promise(resolve=>release=resolve);}render(state,{time:101},false,true);return {ok:true};}});
 try{
  render(state,{time:101},false,true);
  const key=(type,key)=>document.dispatchEvent(new dom.window.KeyboardEvent(type,{key,bubbles:true,cancelable:true}));
  key('keydown','w');key('keyup','w');await new Promise(resolve=>setImmediate(resolve));
  key('keydown','c');assert.equal(calls.length,1);release();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(calls,[{type:'touch',player:3},{type:'smash',player:3,smashType:'soft',latestTouch:true}]);
 }finally{await new Promise(resolve=>setTimeout(resolve,1100));dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});
