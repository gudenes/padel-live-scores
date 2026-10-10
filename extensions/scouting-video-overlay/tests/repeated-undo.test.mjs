import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {scoutingUI} from '../scout-ui.mjs';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {defaults,match} from '../match.mjs';
import {videoPayload,videoSummary} from '../server-model.mjs';

test('repeated Undo works across the reopened shot dialog, undoing outcome, smash, touch and rally start',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;
 Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 let disk={...fresh(),setup:defaults(),selectedMatch:{id:'m'},connection:{}};let time=100,render,task;
 const snap=()=>({tabId:1,documentId:'d',videoId:'v',mediaId:'m',time,seekEpoch:0,readyState:4,paused:false,seeking:false,at:'2026-10-08T00:00:00Z'});
 const send=engine({read:async()=>structuredClone(disk),write:async state=>{disk=structuredClone(state);},uuid:()=>crypto.randomUUID(),capture:async()=>snap()});
 const $=id=>document.getElementById(id);
 const press=(key,options={})=>{const event=new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options});document.dispatchEvent(event);return event;};
 try{
  await send({type:'start'});time=105;await send({type:'touch',player:0});await send({type:'smash',player:0,smashType:'x3',latestTouch:true});time=110;
  await send({type:'prepare',player:0,outcome:'winner'});await send({type:'score',details:{shot:'smash',smashType:'x3',smashAlreadyCounted:true,smashAttemptIndex:0}});
  render=scoutingUI({$,getState:()=>disk,act:message=>{task=send(message).then(()=>render(disk,snap(),false,true));return task;}});render(disk,snap(),false,true);
  assert.equal(match(disk).points,1);assert.equal($('undo').closest('.point-controls').contains($('var-review')),true);
  $('undo').click();await task;assert.equal($('shot-dialog').open,true);assert.equal(match(disk).points,0);assert.equal($('shot-undo').disabled,false);
  $('shot-undo').click();await task;assert.equal($('shot-dialog').open,false);assert.equal(disk.pending.finish,undefined);
  assert.equal(press('z',{metaKey:true}).defaultPrevented,true);await task;assert.equal(disk.pending.attempts?.length??0,0);
  press('ArrowLeft');await task;assert.equal(disk.pending.touches?.length??0,0);
  press('z',{ctrlKey:true});await task;assert.equal(disk.pending,null);assert.equal(disk.history.length,0);assert.equal($('undo').disabled,true);
  assert.equal(videoSummary(videoPayload(disk)).stats[0].x3Smashes,0);
  assert.equal(press('z',{ctrlKey:true}).defaultPrevented,false);
 }finally{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});

test('Undo shortcut preserves text editing and ignores repeat, Shift+Z, busy controls and open menu',()=>{
 const dom=new JSDOM('<input id="name"><button id="undo">Undo</button><dialog id="scouting-menu"></dialog>');let calls=0;
 const {document}=dom.window,button=document.getElementById('undo');button.onclick=()=>calls++;
 const detach=globalThis.__pnMediaKeys.attachUndo({target:document,control:()=>button});
 const press=(target,options={})=>{const event=new dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
 try{
  assert.equal(press(document.getElementById('name')).defaultPrevented,false);
  press(document,{repeat:true});press(document,{shiftKey:true});button.disabled=true;press(document);button.disabled=false;
  document.getElementById('scouting-menu').open=true;press(document);assert.equal(calls,0);
  document.getElementById('scouting-menu').open=false;assert.equal(press(document).defaultPrevented,true);assert.equal(calls,1);
  detach();press(document);assert.equal(calls,1);
 }finally{dom.window.close();}
});
