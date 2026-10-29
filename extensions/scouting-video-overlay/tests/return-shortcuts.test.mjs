import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {scoutingUI} from '../scout-ui.mjs';
import {scoutingUI as liveUI} from '../../../apps/ops/public/scout-web/live-extension/scout-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
import {validateKeyAssignment} from '../scouting-keys.mjs';

for(const [surface,ui,html] of [['extension',scoutingUI,'../panel.html'],['live',liveUI,'../../../apps/ops/public/scout-web/live-extension/panel.html']])
for(const outcome of ['winner','unforced','forced'])
test(`${surface}: keyboard return details for ${outcome}, remapping and smash isolation`,()=>{
 const dom=new JSDOM(readFileSync(new URL(html,import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;
 Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};
 const $=id=>document.getElementById(id),actions=[];
 const snap={tabId:1,documentId:'doc',videoId:'v',mediaId:'m',time:12,seekEpoch:0,readyState:4,paused:false,seeking:false,ended:false,at:'2026-10-28T00:00:00Z'};
 const state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'p',start:{...snap,time:10},finish:{player:2,outcome,end:snap}}};
 const press=key=>$('shot-form').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
 try{
  localStorage.setItem('pn-scouting-keys',JSON.stringify({'return-low':'j'}));
  const render=ui({$,act:m=>actions.push(m),getState:()=>state});render(state,snap,false,true);
  press('6');assert.equal($('return-details').hidden,false);
  press('F1');assert.equal($('return-type').value,'lob');
  press('F2');assert.equal($('return-type').value,'lob','old shortcut must not change return');
  press('j');assert.equal($('return-type').value,'low');
  assert.equal(document.querySelector('[data-scout-key="return-low"]').textContent,'J');
  for(const [i,value] of ['net','long','wide','wall','miss','unclear'].entries()){
   press('F'+(i+4));assert.equal($('return-failure').value,outcome==='winner'?'':value);
  }
  assert.equal(actions.length,0,'choosing details must not auto-save');
  press(' ');
  if(outcome==='forced'){
   $('forced-opponents').querySelector('button').click();
   press(' ');
  }
  assert.equal(actions.at(-1)?.details?.returnType,'low');
  assert.equal(actions.at(-1)?.details?.returnFailure,outcome==='winner'?undefined:'unclear');
  state.pending.id='next';render(state,snap,false,true);
  press('q');assert.equal($('return-details').hidden,true);assert.equal($('return-type').value,'');
  press('F1');assert.equal(document.querySelector('[data-smash-type="power"]').getAttribute('aria-pressed'),'true');
  press('F2');assert.equal(document.querySelector('[data-smash-type="x3"]').getAttribute('aria-pressed'),'true');
  press('F3');assert.equal(document.querySelector('[data-smash-type="soft"]').getAttribute('aria-pressed'),'true');
  press('6');render(state,snap,true,true);press('F1');assert.equal($('return-type').value,'','busy state blocks changes');
 }finally{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});

test('return shortcuts reject collisions with shot keys and allow smash keys in a separate context',()=>{
 assert.throws(()=>validateKeyAssignment({},'return-lob','q'),/Already used/);
 assert.doesNotThrow(()=>validateKeyAssignment({},'return-lob','f1'));
});
