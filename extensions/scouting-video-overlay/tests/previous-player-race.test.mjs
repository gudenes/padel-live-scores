import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
import {scoutingUI} from '../scout-ui.mjs';
const snapshot=time=>({time,tabId:0,documentId:'d',videoId:'v',mediaId:'m',at:'2026-10-27T00:00:00Z',seekEpoch:0,readyState:4,paused:false});
const touch=(player,time)=>({player,order:[2,3,0,1],snapshot:snapshot(time)});
function fixture(){
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false};dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const $=id=>document.getElementById(id),actions=[],state={...fresh(),setup:defaults(),selectedMatch:{id:'m'},pending:{id:'r',start:snapshot(100),touches:[touch(2,101)],finish:{player:0,outcome:'forced',end:snapshot(103)}}};
 const render=scoutingUI({$,act:m=>actions.push(m),getState:()=>state});
 return {$,actions,state,render:()=>render(state,snapshot(103),false,true),close:()=>{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage}};
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
