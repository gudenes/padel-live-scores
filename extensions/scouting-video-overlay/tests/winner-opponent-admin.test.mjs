import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {scoutingUI} from '../../../apps/ops/public/scout-web/scout-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults,validatePoint,match} from '../match.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
import {validateKeyAssignment} from '../scouting-keys.mjs';
const snapshot=time=>({tabId:1,documentId:'doc',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,ended:false,at:'2026-10-10T00:00:00Z'});
function fixture(direct=false){
 const dom=new JSDOM(readFileSync(new URL('../../../apps/ops/public/scout-web/panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.matchMedia=()=>({matches:false});globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 dom.window.localStorage.setItem('pn-rally-taps',direct?'off':'on');
 const $=id=>document.getElementById(id),actions=[],state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'rally',start:snapshot(100)}};
 let render;const act=message=>{actions.push(message);if(message.type==='prepare'){state.pending.finish={player:message.player,outcome:message.outcome,end:snapshot(110)};render(state,snapshot(110),false,true);}return {ok:true};};
 render=scoutingUI({$,act,getState:()=>state});render(state,snapshot(110),false,true);
 const press=(key,target=$('shot-dialog').open?$('shot-form'):$('players'),extra={})=>{if(($('shot-dialog').open&&$('shot-form').dataset.step==='opponent')||(!$('shot-dialog').open&&!$('players').querySelector('.keyboard-selected')))key=({q:'i',w:'o',a:'k',s:'l'})[key]??key;target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));target.dispatchEvent(new dom.window.KeyboardEvent('keyup',{key,bubbles:true,cancelable:true,...extra}));};
 return {dom,$,actions,state,render,press,close:()=>{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}};
}
test('winner captures the opposing player and preceding stroke in both scouting modes',()=>{
 for(const direct of [false,true]){
 const f=fixture(direct),{$,actions,state,render,press}=f;try{
 if(direct)$('rally-taps').click();
 state.pending.finish={player:0,outcome:'winner',end:snapshot(110)};
 render(state,snapshot(110),false,true);press('w');press(' ');
 assert.equal($('shot-form').dataset.step,'opponent');assert.equal($('skip-winner-previous').hidden,false);
 press('q');assert.equal($('shot-form').dataset.step,'previous');press('d');press(' ');
 assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'volley',previousPlayer:2,previousShot:'lob'}});
 const point=validatePoint({player:0,outcome:'winner',...actions.at(-1).details},{},0);
 const restored=validateVideoState(videoPayload({...state,pending:null,rallies:[{id:'r',start:snapshot(100),end:snapshot(110),point}]}));
 assert.equal(match(restored).tracking.timeline[0].previousShot,'lob');assert.equal(match(restored).stats[2].forcedErrorsCreated,0);
 }finally{f.close();}}
});
test('winner skips unknown previous contact without inventing a shot and remains keyboard accessible',()=>{
 const f=fixture(),{$,actions,state,render,press}=f;try{
 state.pending.finish={player:0,outcome:'winner',end:snapshot(110)};render(state,snapshot(110),false,true);press('w');press(' ');
 press('Enter',$('skip-winner-previous'));
 assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'volley'}});
 }finally{f.close();}
});
test('tap-mode winner preselects only the adjacent opponent and preserves the final stroke',()=>{
 const f=fixture(),{$,actions,state,render,press}=f;try{
 state.pending.touches=[{player:2,order:[2,3,0,1]},{player:0,order:[2,3,0,1]}];
 state.pending.finish={player:0,outcome:'winner',end:snapshot(110)};render(state,snapshot(110),false,true);
 press('w');press(' ');assert.equal($('shot-form').dataset.step,'previous');press('1');press(' ');
 assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'volley',previousPlayer:2,previousShot:'chiquita'}});
 }finally{f.close();}
});
