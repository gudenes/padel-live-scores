// A rival smash that was already counted must stay one attempt when the next
// winner is tagged as its recovery or names it as the previous stroke.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {scoutingUI} from '../scout-ui.mjs';
import {scoutingUI as webUI} from '../../../apps/ops/public/scout-web/scout-ui.mjs';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {defaults,match} from '../match.mjs';
const snapshot=time=>({tabId:1,documentId:'doc',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,ended:false,at:'2026-11-15T00:00:00Z'});
const taps=players=>players.map((player,i)=>({player,order:[2,3,0,1],snapshot:snapshot(101+i)}));
const rally=(id,touches,attempts)=>({id,start:snapshot(100),touches:taps(touches),attempts,finish:{player:0,outcome:'winner',end:snapshot(110)}});
const surfaces=[['extension',scoutingUI,'../panel.html'],['web',webUI,'../../../apps/ops/public/scout-web/panel.html']];
function mount(ui,html,mode,pending){
 const dom=new JSDOM(readFileSync(new URL(html,import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.matchMedia=()=>({matches:false});globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 dom.window.localStorage.setItem('pn-rally-taps',mode==='expert'?'on':'off');
 const $=id=>document.getElementById(id),actions=[],state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending};
 const render=ui({$,act:m=>actions.push(m),getState:()=>state});
 const paint=()=>render(state,snapshot(110),false,true);paint();
 // Walk from the finishing-shot step to the rival's previous-stroke step.
 const toPrevious=rival=>{$('save-point').click();const pick=$('forced-opponents').querySelector(`[data-player="${rival}"]`);if($('shot-form').dataset.step==='opponent')pick.click();assert.equal($('shot-form').dataset.step,'previous');};
 const close=()=>{dom.window.close();delete globalThis.matchMedia;delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;};
 return {$,actions,state,paint,toPrevious,close,window:dom.window};
}
async function saved(pending,details){
 let state={...fresh(),setup:defaults(),pending:structuredClone(pending)};
 const act=engine({read:async()=>state,write:async s=>{state=s;}});
 await act({type:'score',details});
 return {attempts:state.rallies[0].attempts??[],stats:match(state).stats};
}
for(const [surface,ui,html] of surfaces)for(const mode of ['expert','pro']){
 test(`${surface} ${mode}: recovery then previous stroke Smash reuses the last recorded smash`,async()=>{
  const pending=rally('reuse',mode==='expert'?[2,0,2,0]:[],[{player:2,...(mode==='expert'?{touchIndex:2}:{}),smashType:'x3',snapshot:snapshot(103)}]);
  const f=mount(ui,html,mode,pending);
  try{
   f.$('smash-recovery').click();assert.equal(f.$('recovery-smash').value,'2:0');
   f.toPrevious(2);f.$('shot-options').querySelector('[data-shot=smash]').click();
   assert.equal(f.$('reuse-smash').getAttribute('aria-pressed'),'true');assert.equal(f.$('new-smash').getAttribute('aria-pressed'),'false');
   f.$('save-point').click();const details=f.actions.at(-1).details;
   assert.equal(f.actions.at(-1).type,'score');assert.equal(details.previousShot,'smash');assert.equal(details.previousSmashType,'x3');
   assert.equal(details.previousSmashNew,undefined);assert.equal(details.recoverySmashAttemptIndex,0);
   const result=await saved(pending,details);
   assert.equal(result.attempts.length,1);assert.equal(result.stats[2].smashes,1);assert.equal(result.stats[0].smashRecoveryWinners,1);
  }finally{f.close();}
 });
 test(`${surface} ${mode}: New smash remains an explicit choice for a distinct previous attempt`,async()=>{
  const pending=rally('distinct',mode==='expert'?[2,0,2,0]:[],[{player:2,...(mode==='expert'?{touchIndex:0}:{}),smashType:'power',snapshot:snapshot(101)}]);
  const f=mount(ui,html,mode,pending);
  try{
   f.$('shot-options').querySelector('[data-shot=volley]').click();if(f.$('shot-form').dataset.step==='shot')f.toPrevious(2);
   f.$('shot-options').querySelector('[data-shot=smash]').click();f.$('new-smash').click();f.$('save-point').click();
   const details=f.actions.at(-1).details;assert.equal(details.previousSmashNew,true);
   assert.equal((await saved(pending,details)).stats[2].smashes,2);
  }finally{f.close();}
 });
}
for(const [surface,ui,html] of surfaces){
 test(`${surface}: recovery defaults to the rival pair's latest smash, even when it was not the adjacent tap`,()=>{
  const f=mount(ui,html,'expert',rally('earlier',[2,0,2,0],[{player:3,snapshot:snapshot(100.5)},{player:2,touchIndex:0,snapshot:snapshot(101)}]));
  try{f.$('smash-recovery').click();assert.equal(f.$('recovery-smash').value,'2:1');}finally{f.close();}
 });
 test(`${surface}: a smash saved after the dialog opened becomes the default, unless the scout already chose`,()=>{
  const f=mount(ui,html,'pro',rally('late',[],[]));
  try{
   f.$('smash-recovery').click();assert.equal(f.$('recovery-smash').value,'');
   f.state.pending.attempts=[{player:3,smashType:'power',snapshot:snapshot(105)}];f.paint();
   assert.equal(f.$('smash-recovery').checked,true);assert.equal(f.$('recovery-smash').value,'3:0');
   f.$('recovery-smash').value='2:new';f.$('recovery-smash').dispatchEvent(new f.window.Event('change',{bubbles:true}));
   f.state.pending.attempts=[...f.state.pending.attempts,{player:3,smashType:'x3',snapshot:snapshot(106)}];f.paint();
   assert.equal(f.$('recovery-smash').value,'2:new');assert.ok([...f.$('recovery-smash').options].some(o=>o.value==='3:1'));
  }finally{f.close();}
 });
}
test('recovery and previous-stroke Smash by the same rival always save one attempt',async()=>{
 const recorded=[{player:2,touchIndex:2,smashType:'power',snapshot:snapshot(103)}];
 // A stale "new attempt" request still resolves to the smash linked to the recovery.
 let result=await saved(rally('guard',[2,0,2,0],recorded),{smashRecovery:true,recoverySmashPlayer:2,recoverySmashAttemptIndex:0,previousPlayer:2,previousShot:'smash',previousSmashType:'x3',previousSmashNew:true});
 assert.equal(result.attempts.length,1);assert.equal(result.attempts[0].smashType,'x3');assert.equal(result.stats[2].smashes,1);
 // Nothing recorded: the recovered smash and the previous stroke are the same hit.
 result=await saved(rally('missing',[],[]),{smashRecovery:true,recoverySmashPlayer:2,previousPlayer:2,previousShot:'smash',previousSmashType:'soft'});
 assert.equal(result.attempts.length,1);assert.equal(result.attempts[0].smashType,'soft');assert.equal(result.stats[2].smashes,1);
 // A different rival named as the previous hitter keeps their own attempt.
 result=await saved(rally('partner',[],recorded.map(a=>({player:a.player,smashType:a.smashType,snapshot:a.snapshot}))),{smashRecovery:true,recoverySmashPlayer:2,recoverySmashAttemptIndex:0,previousPlayer:3,previousShot:'smash',previousSmashType:'power'});
 assert.equal(result.attempts.length,2);assert.equal(result.stats[2].smashes,1);assert.equal(result.stats[3].smashes,1);
});
