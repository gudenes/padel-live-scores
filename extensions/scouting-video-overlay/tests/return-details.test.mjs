import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {scoutingUI} from '../scout-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults,match,validatePoint} from '../match.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
const snapshot=time=>({tabId:1,documentId:'doc',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,ended:false,at:'2026-10-27T00:00:00Z'});
test('return types and failure reasons survive saving and report replay without changing the score',()=>{
 for(const returnType of ['lob','low'])for(const returnFailure of ['net','long','wide','wall','miss','unclear']){
  const state={...fresh(),setup:defaults(),rallies:[{id:'return',start:snapshot(10),end:snapshot(12),point:{player:2,outcome:'unforced',shot:'return',returnType,returnFailure}}]};
  const saved=validateVideoState(JSON.parse(JSON.stringify(videoPayload(state))));assert.deepEqual(saved.rallies[0].point,state.rallies[0].point);const m=match(saved);assert.equal(m.tracking.timeline[0].returnType,returnType);assert.equal(m.tracking.timeline[0].returnFailure,returnFailure);assert.equal(m.score.currentGame.a,15);
 }
 for(const p of [{shot:'volley',returnType:'low'},{shot:'return',returnType:'invalid'},{shot:'return',returnFailure:'invalid'},{shot:'return',outcome:'winner',returnFailure:'net'}])assert.throws(()=>validatePoint({player:2,outcome:'unforced',...p},{},0));
 assert.equal(validatePoint({player:2,outcome:'unforced',shot:'return'},{},0).returnFailure,undefined);
});
test('Spanish return popup waits for confirmation and clears details when changing shots',()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};
 const $=id=>document.getElementById(id),actions=[];const state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'p',start:snapshot(10),finish:{player:2,outcome:'unforced',end:snapshot(12)}}};
 try{const render=scoutingUI({$,act:m=>actions.push(m),getState:()=>state});render(state,snapshot(12),false,true);$('quick-save').checked=true;document.querySelector('[data-shot="return"]').click();assert.equal(actions.length,0);assert.equal($('return-details').hidden,false);assert.equal($('return-failure-label').hidden,false);assert.match(document.querySelector('[data-shot="return"]').textContent,/Resto/);assert.equal($('return-details').querySelectorAll('select').length,0);const type=document.querySelector('[data-return-value=lob]'),failure=document.querySelector('[data-return-value=net]');type.click();assert.equal(type.getAttribute('aria-pressed'),'true');type.click();assert.equal($('return-type').value,'');type.click();failure.click();assert.equal(failure.getAttribute('aria-pressed'),'true');assert.equal(document.querySelector('[data-shot=return]').getAttribute('aria-pressed'),'true');assert.equal(actions.length,0);$('shot-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));assert.equal(actions.at(-1).details.returnType,'lob');assert.equal(actions.at(-1).details.returnFailure,'net');$('quick-save').checked=false;document.querySelector('[data-shot="volley"]').click();assert.equal($('return-details').hidden,true);assert.equal($('return-type').value,'');assert.equal($('return-failure').value,'');}finally{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});
