import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
import {scoutingUI} from '../scout-ui.mjs';
const snapshot=time=>({time,tabId:0,documentId:'d',videoId:'v',mediaId:'m',at:'2026-10-27T00:00:00Z',seekEpoch:0,readyState:4,paused:false});
const touch=(player,time)=>({player,order:[2,3,0,1],snapshot:snapshot(time)});
function fixture(pro=false){
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 if(pro)localStorage.setItem('pn-rally-taps','off');
 const $=id=>document.getElementById(id),actions=[],state={...fresh(),setup:defaults(),selectedMatch:{id:'m'},pending:{id:'r',start:snapshot(100),touches:[touch(2,101)],finish:{player:0,outcome:'forced',end:snapshot(103)}}};
 const render=scoutingUI({$,act:m=>actions.push(m),getState:()=>state});
 return {$,actions,state,key:key=>document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true})),render:(healthy=true)=>render(state,snapshot(103),false,healthy),close:()=>{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage}};
}
test('picks the previous opponent when the last tap arrives after the optimistic outcome popup',()=>{
 const f=fixture();try{f.render();assert.doesNotMatch(f.$('shot-summary').textContent,/Rival anterior/);
 f.state.pending.touches.push(touch(0,102));f.render();assert.match(f.$('shot-summary').textContent,/Rival anterior: Player B1/);
 f.$('shot-options').querySelector('[data-shot=volley]').click();f.$('save-point').click();assert.equal(f.$('shot-form').dataset.step,'previous');f.$('save-point').click();assert.equal(f.actions.at(-1).details.previousPlayer,2);
 }finally{f.close()}
});
test('does not overwrite an explicitly chosen previous opponent when queued taps arrive',()=>{
 const f=fixture();try{f.render();f.$('shot-options').querySelector('[data-shot=volley]').click();f.$('save-point').click();f.$('forced-opponents').querySelector('[data-player="3"]').click();
 f.state.pending.touches.push(touch(0,102));f.render();assert.match(f.$('shot-summary').textContent,/Rival anterior: Player B2/);f.$('save-point').click();assert.equal(f.actions.at(-1).details.previousPlayer,3);
 }finally{f.close()}
});
test('replaces a stale automatic suggestion with the final adjacent opponent',()=>{
 const f=fixture();try{f.state.pending.touches.push(touch(0,101.5));f.render();assert.match(f.$('shot-summary').textContent,/Rival anterior: Player B1/);
 f.state.pending.touches.push(touch(3,102),touch(0,102.5));f.render();assert.match(f.$('shot-summary').textContent,/Rival anterior: Player B2/);
 }finally{f.close()}
});

test('advances an already-open opponent step when the delayed taps identify that opponent',()=>{
 const f=fixture();try{f.render();f.$('shot-options').querySelector('[data-shot=volley]').click();f.$('save-point').click();assert.equal(f.$('shot-form').dataset.step,'opponent');
 f.state.pending.touches.push(touch(0,102));f.render();assert.equal(f.$('shot-form').dataset.step,'previous');f.$('save-point').click();assert.equal(f.actions.at(-1).details.previousPlayer,2);
 }finally{f.close()}
});


test('the panel keeps Pro selection through a readiness refresh and still accepts Winner',()=>{
 const f=fixture(true);try{delete f.state.pending.finish;f.state.pending.touches=[];f.render();f.key('k');
 const highlighted=()=>f.$('players').querySelector('[data-player="0"]').classList.contains('keyboard-selected');
 assert.equal(highlighted(),true);f.render(false);assert.equal(highlighted(),true);f.key('w');assert.equal(f.actions.length,0);
 f.render();f.key('w');assert.deepEqual(f.actions.at(-1),{type:'prepare',player:0,outcome:'winner'});
 }finally{f.close()}
});
