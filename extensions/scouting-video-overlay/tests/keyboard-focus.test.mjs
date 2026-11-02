import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
import {liveWorkspace} from '../../../apps/ops/public/scout-web/live-workspace.mjs';

for(const [name,base] of [['extension','../'],['web','../../../apps/ops/public/scout-web/']]){
 test(`${name}: shot keys survive focus outside the form without changing input or dialog behavior`,async()=>{
  const {scoutingUI}=await import(new URL(base+'scout-ui.mjs',import.meta.url));
  const dom=new JSDOM(readFileSync(new URL(base+'panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
  globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
  globalThis.matchMedia=()=>({matches:false});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const $=id=>document.getElementById(id),actions=[];
  const state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'rally',start:{time:100},finish:{player:0,outcome:'winner',end:{time:110}}}};
  const press=(target,key)=>target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
  const selected=()=>$('shot-options').querySelector('[data-shot][aria-pressed=true]')?.dataset.shot;
  try{
   const render=scoutingUI({$,getState:()=>state,act:action=>actions.push(action)});
   for(const outcome of ['winner','unforced','forced']){
    state.pending.id=outcome;state.pending.finish.outcome=outcome;render(state,{time:110},false,true);
    press($('shot-form'),'w');assert.equal(selected(),'volley');
    press($('shot-dialog'),'e');assert.equal(selected(),'vibora');
    press(document.body,'a');assert.equal(selected(),'bandeja');
    press($('shot-side'),'w');assert.equal(selected(),'bandeja');
    $('scouting-menu').open=true;press(document.body,'w');assert.equal(selected(),'bandeja');$('scouting-menu').open=false;
    press($('shot-options').querySelector('[data-shot=volley]'),'w');assert.equal(selected(),'volley');
   }
   state.pending.id='save-once';state.pending.finish.outcome='winner';render(state,{time:110},false,true);
   press($('shot-dialog'),'w');press($('shot-dialog'),' ');
   assert.equal(actions.filter(a=>a.type==='score').length,1);
   $('shot-dialog').close();press(document.body,'e');assert.equal(selected(),'volley');
  }finally{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;delete globalThis.matchMedia;}
 });
}

test('workspace forwards shot keys only while the panel owns point selection and cleans up',()=>{
 const panel=new JSDOM('<dialog id="shot-dialog" open></dialog>'),host=new JSDOM('<button>Outside panel</button><input>');
 host.window.__pnLiveScout={};const doc=panel.window.document,dialog=doc.querySelector('dialog'),received=[];
 dialog.addEventListener('keydown',e=>{received.push(e.key);if(e.key==='w')e.preventDefault();});
 liveWorkspace({document:doc,host:host.window});
 const press=(key,target=host.window.document.querySelector('button'))=>{const e=new host.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});target.dispatchEvent(e);return e;};
 try{
  assert.equal(press('w').defaultPrevented,true);assert.deepEqual(received,['w']);
  assert.equal(press('Tab').defaultPrevented,false);
  press('w',host.window.document.querySelector('input'));assert.deepEqual(received,['w','Tab']);
  const other=doc.createElement('dialog');other.open=true;doc.body.append(other);press('w');assert.equal(received.length,2);other.remove();
  dialog.open=false;press('w');assert.equal(received.length,2);dialog.open=true;
  panel.window.dispatchEvent(new panel.window.Event('pagehide'));press('w');assert.equal(received.length,2);
 }finally{panel.window.close();host.window.close();}
});
