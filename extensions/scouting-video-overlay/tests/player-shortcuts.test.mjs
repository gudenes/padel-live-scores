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
