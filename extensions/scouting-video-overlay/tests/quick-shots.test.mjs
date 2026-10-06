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
test('gaming shot keys quick-save the canonical shot; detail mode waits for save and inputs ignore shot keys',()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const $=id=>document.getElementById(id),actions=[];
 let state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'rally',start:{time:100},finish:{player:0,outcome:'winner',end:{time:110}}}};
 const render=scoutingUI({$,act:msg=>actions.push(msg),getState:()=>state});
 try{
  render(state,{time:110,paused:false},false,true);
  assert.equal($('shot-options').querySelector('[aria-label="Common shots"]').children.length,9);
  assert.deepEqual(quickShots.map(([key])=>key),['q','w','e','a','s','d','1','2','3']);
  assert.equal(new Set([...$('shot-options').querySelectorAll('button')].map(b=>b.dataset.shot)).size,Object.keys(shots).length);
  const press=(target,key,options={})=>target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
  for(const [key,shot] of quickShots){
   state.pending.id='rally-'+key;render(state,{time:110},false,true);press($('shot-form'),key);
   assert.deepEqual(actions.at(-1),{type:'score',details:{shot}});
  }
  $('quick-save').checked=false;$('quick-save').dispatchEvent(new dom.window.Event('change'));const before=actions.length;
  press($('shot-form'),'s');assert.equal(actions.length,before);
  $('assist').checked=true;press($('shot-form'),'Enter',{ctrlKey:true});assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'groundstroke',assistBy:1}});
  const saved=actions.length;press($('shot-side'),'q');press($('shot-form'),'w',{repeat:true});assert.equal(actions.length,saved);
  render(state,{time:110},true,true);press($('shot-form'),'Enter',{ctrlKey:true});assert.equal(actions.length,saved);
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
