import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {scoutingUI} from '../scout-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults,match} from '../match.mjs';
import {engine} from '../engine.mjs';
const snapshot=time=>({tabId:1,documentId:'doc',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,ended:false,at:'2026-10-18T00:00:00Z'});
test('recovery attribution is reachable and selecting a finishing smash reuses the final attempt',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const $=id=>document.getElementById(id),actions=[];
 let state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'r',start:snapshot(100),attempts:[{player:0,smashType:'power',snapshot:snapshot(105)}],finish:{player:0,outcome:'winner',end:snapshot(110)}}};
 const render=scoutingUI({$,act:m=>actions.push(m),getState:()=>state});
 try{
  render(state,{time:110},false,true);
  $('shot-options').querySelector('[data-shot=volley]').click();
  $('shot-options').querySelector('[data-shot=smash]').click();
  assert.equal($('counted').checked,true);
  $('save-point').click();
  const action=actions.at(-1);assert.equal(action.details.smashAlreadyCounted,true);
  const dispatch=engine({read:async()=>structuredClone(state),write:async s=>{state=s}});
  await dispatch(action);assert.equal(match(state).stats[0].smashes,1);
  state.pending={id:'recovery',start:snapshot(120),attempts:[],finish:{player:0,outcome:'winner',end:snapshot(130)}};
  render(state,{time:130},false,true);
  $('shot-options').querySelector('[data-tag=smash-recovery]').click();
  assert.equal($('recovery-smash-label').hidden,false);
  assert.equal($('recovery-smash-label').closest('#winner-tags'),null);
  $('save-point').click();assert.match($('shot-error').textContent,/opponent/);
  assert.equal(document.activeElement,$('recovery-smash'));
  $('recovery-smash').value='2:new';$('recovery-smash').dispatchEvent(new dom.window.Event('change'));
  $('save-point').click();await dispatch(actions.at(-1));assert.equal(match(state).stats[2].smashes,1);
 }finally{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});
test('classifying the same tapped smash twice updates its type and returns distinct feedback',async()=>{
 let state={...fresh(),setup:defaults(),connection:{},pending:{id:'r',start:snapshot(100),touches:[{player:0,snapshot:snapshot(101)}]}};
 const dispatch=engine({read:async()=>structuredClone(state),write:async s=>{state=s},capture:async()=>snapshot(102)});
 assert.equal((await dispatch({type:'smash',player:0,smashType:'power',latestTouch:true})).smashFeedback.kind,'added');
 assert.equal((await dispatch({type:'smash',player:0,smashType:'x3',latestTouch:true})).smashFeedback.kind,'updated');
 assert.equal(state.pending.attempts.length,1);assert.equal(state.pending.attempts[0].smashType,'x3');
});
