import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {playerShortcuts} from '../player-shortcuts.mjs';
test('holds select by current quadrant; taps, stale holds and repeat outcomes do not record',()=>{
 const dom=new JSDOM('<button>Winner</button><input>'),doc=dom.window.document;
 let c={enabled:true,token:'first',order:[2,3,0,1]},callback,selected=null;const calls=[],taps=[];
 const controls=playerShortcuts({target:doc,context:()=>c,select:p=>selected=p,prepare:(...p)=>calls.push(p),tap:p=>taps.push(p),setTimer:(fn,delay)=>{assert.equal(delay,1300);callback=fn;return 1;},clearTimer:()=>{callback=null;}});
 const key=(type,key,options={})=>doc.dispatchEvent(new dom.window.KeyboardEvent(type,{key,bubbles:true,cancelable:true,...options}));
 controls.update();key('keydown','q');key('keyup','q');assert.equal(callback,null);assert.equal(selected,null);assert.deepEqual(taps,[2]);
 key('keydown','w');callback();assert.equal(selected,3);key('keyup','w');assert.deepEqual(taps,[2]);key('keydown','w');assert.deepEqual(calls,[[3,'winner']]);key('keydown','w',{repeat:true});assert.equal(calls.length,1);
 key('keydown','a');const stale=callback;c={...c,token:'ends-changed',order:[1,0,3,2]};controls.update();stale();assert.equal(selected,null);
 key('keydown','a');callback();assert.equal(selected,3);key('keyup','a');key('keydown','a');assert.deepEqual(calls.at(-1),[3,'unforced']);
 key('keydown','s');doc.defaultView.dispatchEvent(new dom.window.Event('blur'));assert.equal(callback,null);assert.equal(selected,null);
 dom.window.close();
});
test('player plus Z/X counts one typed attempt without a tap or outcome',()=>{
 const dom=new JSDOM(''),doc=dom.window.document,c={enabled:true,token:'r',order:[2,3,0,1]},calls=[];let timer;
 const controls=playerShortcuts({target:doc,context:()=>c,select:()=>{},prepare:()=>calls.push('outcome'),tap:()=>calls.push('tap'),smash:(...args)=>calls.push(args),setTimer:fn=>(timer=fn,1),clearTimer:()=>timer=null});controls.update();
 const key=(type,key,repeat=false)=>doc.dispatchEvent(new dom.window.KeyboardEvent(type,{key,repeat,bubbles:true}));
 key('keydown','w');key('keydown','z');key('keydown','z',true);key('keyup','w');assert.deepEqual(calls,[[3,'power']]);assert.equal(timer,null);
 key('keydown','a');key('keydown','x');key('keyup','a');assert.deepEqual(calls,[[3,'power'],[0,'x3']]);dom.window.close();
});
test('fault keys require an active rally, respect first fault and ignore repeats, typing and shot mode',()=>{
 const dom=new JSDOM('<input>'),doc=dom.window.document,c={enabled:false,token:'r',order:[2,3,0,1],firstFault:false},calls=[];
 const controls=playerShortcuts({target:doc,context:()=>c,select:()=>{},prepare:()=>{},fault:type=>{calls.push(type);if(type==='first-fault')c.firstFault=true;else c.enabled=false;}});controls.update();
 const key=(key,options={},target=doc)=>target.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
 key('1');assert.equal(calls.length,0);c.enabled=true;key('2');assert.equal(calls.length,0);key('1',{},doc.querySelector('input'));key('1',{ctrlKey:true});key('1',{repeat:true});assert.equal(calls.length,0);
 key('1');key('1');key('2',{repeat:true});assert.deepEqual(calls,['first-fault']);key('2');assert.deepEqual(calls,['first-fault','double-fault']);
 const strokeKey=new dom.window.KeyboardEvent('keydown',{key:'1',bubbles:true,cancelable:true});doc.dispatchEvent(strokeKey);assert.equal(strokeKey.defaultPrevented,false);assert.equal(calls.length,2);dom.window.close();
});
test('tap then Z/X/C classifies the latest player shot; resets on blur, rally and outcome selection',()=>{
 const dom=new JSDOM(''),doc=dom.window.document;let c={enabled:true,token:'r',order:[2,3,0,1]},timer;const taps=[],attempts=[];
 const controls=playerShortcuts({target:doc,context:()=>c,select:()=>{},prepare:()=>{},tap:p=>taps.push(p),smash:(...args)=>attempts.push(args),setTimer:fn=>(timer=fn,1),clearTimer:()=>timer=null});controls.update();
 const key=(type,key,repeat=false)=>doc.dispatchEvent(new dom.window.KeyboardEvent(type,{key,repeat,bubbles:true}));
 key('keydown','c');assert.equal(attempts.length,0);
 key('keydown','w');key('keyup','w');c={...c,enabled:false,recording:true};controls.update();key('keydown','c');key('keydown','c',true);c={...c,enabled:true,recording:false};controls.update();key('keydown','z');assert.deepEqual(taps,[3]);assert.deepEqual(attempts,[[3,'soft',true],[3,'power',true]]);
 doc.defaultView.dispatchEvent(new dom.window.Event('blur'));key('keydown','x');assert.equal(attempts.length,2);
 key('keydown','q');key('keyup','q');c={...c,token:'next'};controls.update();key('keydown','x');assert.equal(attempts.length,2);
 key('keydown','a');timer();key('keyup','a');key('keydown','c');assert.equal(attempts.length,2);
 dom.window.close();
});
