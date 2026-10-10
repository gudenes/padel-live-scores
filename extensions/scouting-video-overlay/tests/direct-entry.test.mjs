import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {scoutingUI} from '../scout-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults,validatePoint,match} from '../match.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
import {validateKeyAssignment} from '../scouting-keys.mjs';
const snapshot=time=>({tabId:1,documentId:'doc',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,ended:false,at:'2026-10-10T00:00:00Z'});
function fixture(){
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const $=id=>document.getElementById(id),actions=[],state={...fresh(),setup:defaults(),selectedMatch:{id:'match'},pending:{id:'rally',start:snapshot(100)}};
 let render;const act=message=>{actions.push(message);if(message.type==='prepare'){state.pending.finish={player:message.player,outcome:message.outcome,end:snapshot(110)};render(state,snapshot(110),false,true);}return {ok:true};};
 render=scoutingUI({$,act,getState:()=>state});render(state,snapshot(110),false,true);
 const press=(key,target=$('shot-dialog').open?$('shot-form'):$('players'),extra={})=>{target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra}));target.dispatchEvent(new dom.window.KeyboardEvent('keyup',{key,bubbles:true,cancelable:true,...extra}));};
 return {dom,$,actions,state,render,press,close:()=>{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}};
}
test('direct keys highlight a player before a separate outcome choice, without touches; UE requires previous opponent and allows skipping their stroke',()=>{
 const f=fixture(),{$,actions,state,press}=f;try{
 $('rally-taps').click();press('a');assert.equal(actions.length,0);assert.equal($('shot-dialog').open,false);assert.ok($('players').querySelector('[data-player="0"]').classList.contains('keyboard-selected'));press('w');assert.deepEqual(actions.at(-1),{type:'prepare',player:0,outcome:'winner'});assert.equal(actions.filter(a=>a.type==='touch').length,0);
 press('Escape');assert.equal($('outcome-picker').hidden,false);press('a');assert.equal(state.pending.finish.outcome,'unforced');press('w');press('Enter');assert.equal($('shot-form').dataset.step,'opponent');
 const count=actions.length;press(' ');assert.equal(actions.length,count);press('s');assert.equal(actions.length,count); // teammate cannot be selected
 press('q');assert.equal($('shot-form').dataset.step,'previous');press(' ');
 assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'volley',previousPlayer:2}});assert.equal(actions.at(-1).details.forcedBy,undefined);
 }finally{f.close();}
});
test('previous stroke has its own key stage; going back preserves the finishing stroke',()=>{
 const f=fixture(),{$,actions,press}=f;try{
 $('rally-taps').click();press('a');press('d');press('d');press(' ');press('w');press('q'); // FE lob, opponent B2, previous smash
 press('Escape');assert.equal($('shot-form').dataset.step,'opponent');press('q');press('2');press(' ');
 assert.deepEqual(actions.at(-1),{type:'score',details:{shot:'lob',previousPlayer:2,previousShot:'block',forcedBy:2}});
 }finally{f.close();}
});
test('key editor captures without recording, rejects conflicts, persists and remaps player keys only in their stage',()=>{
 const f=fixture(),{$,actions,press,dom}=f;try{
 $('rally-taps').click();$('edit-scout-keys').click();const editor=$('scout-key-editor');editor.querySelector('[data-action=player-0]').click();
 press('w',editor);assert.match(editor.textContent,/Already used/);assert.equal(actions.length,0);
 press('t',editor);assert.equal(JSON.parse(dom.window.localStorage.getItem('pn-scouting-keys'))['player-0'],'t');editor.querySelector('[data-key-close]').click();
 press('q');assert.equal(actions.length,0);press('t');assert.equal(actions.length,0);press('w');assert.equal(actions.at(-1).player,2);press('q');press('z');press(' ');assert.equal(actions.at(-1).details.shot,'smash');
 }finally{f.close();}
});
test('scouting shortcuts reject overlapping stages and media conflicts but allow different-stage reuse',()=>{
 assert.throws(()=>validateKeyAssignment({},'player-0','w'),/Already used/);
 assert.equal(validateKeyAssignment({},'player-0','t')['player-0'],'t');
 assert.throws(()=>validateKeyAssignment({},'shot-volley','home',['home']),/video controls/);
 assert.throws(()=>validateKeyAssignment({},'shot-volley','tab'),/reserved/);
});
test('previous opponent and stroke round-trip through server validation, replay and undo without UE creation credit',()=>{
 const point=validatePoint({player:0,outcome:'unforced',shot:'volley',previousPlayer:2,previousShot:'bajada'},{},0);
 const state={...fresh(),setup:defaults(),rallies:[{id:'r',start:snapshot(100),end:snapshot(110),point}]};
 const restored=validateVideoState(JSON.parse(JSON.stringify(videoPayload(state))));assert.deepEqual(restored.rallies[0].point,point);assert.equal(match(restored).tracking.timeline[0].previousShot,'bajada');assert.equal(match(restored).stats[2].forcedErrorsCreated,0);
 restored.rallies[0].undone=true;assert.equal(match(restored).tracking.timeline.length,0);
 for(const patch of [{previousPlayer:1},{previousPlayer:4},{previousShot:'made-up'},{previousPlayer:undefined},{outcome:'winner'},{outcome:'forced',forcedBy:3}])assert.throws(()=>validatePoint({...point,...patch},{},0));
});
test('saved custom key survives reload, and capture Escape leaves its previous assignment unchanged',()=>{
 let f=fixture();let saved;try{
 f.$('edit-scout-keys').click();const ed=f.$('scout-key-editor');ed.querySelector('[data-action=player-0]').click();f.press('h',ed);saved=f.dom.window.localStorage.getItem('pn-scouting-keys');
 ed.querySelector('[data-action=player-0]').click();f.press('Escape',ed);assert.equal(f.dom.window.localStorage.getItem('pn-scouting-keys'),saved);
 }finally{f.close();}
 // Test the key controller with the same persisted settings and a new document.
 const dom=new JSDOM('<div id="players"></div><button id="edit-scout-keys"></button>',{url:'https://example.test'});
 Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});dom.window.localStorage.setItem('pn-scouting-keys',saved);
 return import('../scouting-keys.mjs').then(({scoutingKeys})=>{const keys=scoutingKeys({$:id=>dom.window.document.getElementById(id),scope:()=> 'rally'});assert.equal(keys.label('player-0'),'H');dom.window.close();delete globalThis.localStorage;});
});
