import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {scoutingUI} from '../scout-ui.mjs';
import {scoutingUI as webUI} from '../../../apps/ops/public/scout-web/scout-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults,match} from '../match.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
import {scoutingKeyActions,keyLabel} from '../scouting-keys.mjs';
const snapshot=time=>({tabId:1,documentId:'doc',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,ended:false,at:'2026-10-10T00:00:00Z'});
for(const [surface,ui,html] of [['extension',scoutingUI,'../panel.html'],['web',webUI,'../../../apps/ops/public/scout-web/panel.html']])for(const mode of ['expert','pro'])test(`${surface} ${mode}: smash defaults, assist scope and outside attempts survive saving`,()=>{
 const dom=new JSDOM(readFileSync(new URL(html,import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.matchMedia=()=>({matches:false});globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const $=id=>document.getElementById(id),actions=[];
 const pending={id:'r',start:snapshot(100),touches:[1,2,0].map((player,i)=>({player,order:[2,3,0,1],snapshot:snapshot(101+i)})),attempts:[{player:0,touchIndex:2,smashType:'x3',snapshot:snapshot(103)}],finish:{player:0,outcome:'winner',end:snapshot(104)}};
 const state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending};
 try{
  dom.window.localStorage.setItem('pn-rally-taps',mode==='expert'?'on':'off');
  const render=ui({$,act:m=>actions.push(m),getState:()=>state});render(state,snapshot(104),false,true);
  assert.equal($('assist').checked,mode==='expert');assert.equal($('counted').checked,true);
  assert.equal($('shot-options').querySelector('[data-shot=smash]').getAttribute('aria-pressed'),'true');
  $('outside-attempts').querySelector('input[value="2"]').checked=true;
  $('shot-form').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:' ',bubbles:true,cancelable:true}));
  assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'smash',smashType:'x3',outsideRecoveryBy:[2],...(mode==='expert'?{assistBy:1}:{}),smashAlreadyCounted:true,smashAttemptIndex:0}});
  const rally={...pending,end:snapshot(104),point:{player:0,outcome:'winner',...actions.at(-1).details}};delete rally.finish;
  const restored=validateVideoState(JSON.parse(JSON.stringify(videoPayload({...state,pending:null,rallies:[rally]}))));
  assert.equal(match(restored).stats[0].smashes,1);assert.equal(match(restored).stats[1].assists,mode==='expert'?1:0);
  assert.deepEqual(match(restored).tracking.timeline[0].outsideRecoveryBy,[2]);
  $('assist').checked=false;$('save-point').click();assert.equal(actions.at(-1).details.assistBy,undefined);
  state.pending={...pending,id:'recovery',attempts:[{player:2,touchIndex:1,smashType:'power',snapshot:snapshot(102)}]};
  render(state,snapshot(104),false,true);$('smash-recovery').click();
  assert.equal($('recovery-smash-label').hidden,false);assert.equal($('recovery-smash').value,'2:0');
  $('save-point').click();assert.equal(actions.at(-1).details.recoverySmashPlayer,2);assert.equal(actions.at(-1).details.recoverySmashAttemptIndex,0);
  state.pending={...pending,id:'recovery-unknown',touches:[],attempts:[]};render(state,snapshot(104),false,true);$('smash-recovery').click();
  const before=actions.length;$('save-point').click();assert.equal(actions.length,before);assert.match($('shot-error').textContent,/Choose the opponent|Elige el remate rival/);
  $('recovery-smash').value='3:new';$('save-point').click();assert.equal(actions.at(-1).details.recoverySmashPlayer,3);assert.equal(actions.at(-1).details.recoverySmashAttemptIndex,undefined);
  state.setup.firstServer=1;
  state.pending={...pending,id:'implicit-serve',attempts:[],touches:[2,0].map((player,i)=>({player,order:[2,3,0,1],snapshot:snapshot(101+i)}))};
  render(state,snapshot(104),false,true);
  assert.equal($('assist').checked,mode==='expert');
  state.setup.firstServerUnknown=true;state.pending.id='unknown-serve';render(state,snapshot(104),false,true);
  assert.equal($('assist').checked,false);

 }finally{dom.window.close();delete globalThis.matchMedia;delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});
test('F1, F2 and F3 map to Power, X3 and Soft',()=>{
 for(const [id,key] of [['smash-power','f1'],['smash-x3','f2'],['smash-soft','f3']]){assert.equal(scoutingKeyActions.find(a=>a.id===id).defaultKey,key);assert.equal(keyLabel(key),key.toUpperCase());}
});
