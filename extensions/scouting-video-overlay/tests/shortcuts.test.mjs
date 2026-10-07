import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import '../shortcut-keys.js';
import {shortcutSettings} from '../shortcut-settings.mjs';
const keys=globalThis.__pnMediaKeys;
test('shortcut editor saves key combinations, rejects duplicates, clears a binding and resets defaults',async()=>{
 const dom=new JSDOM('<div id="shortcut-fields"></div><button id="reset-shortcuts"></button><p id="shortcut-error"></p>');globalThis.document=dom.window.document;
 let stored=keys.defaults;const $=id=>document.getElementById(id);
 try{
  const get=shortcutSettings({$,send:async m=>{if(m.type==='set-shortcuts')stored=m.bindings;return {ok:true,bindings:stored};},onChange:()=>{}});
  await new Promise(resolve=>setImmediate(resolve));
  const field=name=>document.querySelector(`[aria-label="${name} shortcut"]`);
  const press=(input,key,options={})=>input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));
  press(field('Play / pause'),'p',{ctrlKey:true});await new Promise(resolve=>setImmediate(resolve));assert.equal(get().pause.key,'p');assert.equal(get().pause.ctrl,true);assert.equal(field('Play / pause').value,'Ctrl+P');
  press(field('Forward 5 seconds'),'j');await new Promise(resolve=>setImmediate(resolve));assert.match($('shortcut-error').textContent,/already assigned/);assert.equal(get().forward5.key,'PageUp');
  press(field('Play / pause'),'Backspace');await new Promise(resolve=>setImmediate(resolve));assert.equal(get().pause,null);
  $('reset-shortcuts').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(get().pause.key,'Home');
 }finally{dom.window.close();delete globalThis.document;}
});
test('remote uses the saved pause key and exposes both five-second controls',async()=>{
 const dom=new JSDOM('<html></html>',{runScripts:'outside-only'});let calls=[];
 dom.window.setInterval=()=>0;dom.window.chrome={runtime:{sendMessage:async m=>{calls.push(m);return {ok:true,state:{pending:null},sample:{time:20,paused:false,seeking:false},bindings:{...keys.defaults,pause:{key:'p',alt:true}}};}}};
 try{
  for(const name of ['shortcut-keys.js','overlay.js'])dom.window.eval(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));const root=dom.window.document.querySelector('div').shadowRoot;
  assert.ok([...root.querySelectorAll('button')].some(b=>b.firstChild?.textContent==='−5s'));assert.ok([...root.querySelectorAll('button')].some(b=>b.firstChild?.textContent==='+5s'));
  assert.match(root.textContent,/Alt\+P/);
  for(const [key,options] of [['k',{}],['p',{altKey:true}]]){dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options}));await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(calls.filter(m=>m.type==='playback').length,1);
 }finally{dom.window.close();}
});
test('saving navigation keys releases the assignment field and controls the video on the next press',async()=>{
 const dom=new JSDOM('<div id="shortcut-fields"></div><button id="reset-shortcuts"></button><p id="shortcut-error"></p><dialog open></dialog>');globalThis.document=dom.window.document;
 const mapping={back10:'F9',pause:'Insert',forward30:'PageDown',back5:'PageUp',forward5:'End'};
 let stored=Object.fromEntries(Object.keys(keys.actions).map(action=>[action,null]));const $=id=>document.getElementById(id),calls=[];
 try{
  const get=shortcutSettings({$,send:async m=>{if(m.type==='set-shortcuts')stored=m.bindings;return {ok:true,bindings:stored};},onChange:()=>{}});
  const controls=Object.fromEntries(Object.keys(mapping).map(action=>[action,{click:()=>calls.push(action)}]));
  const detach=keys.attach({target:document,controls,getBindings:get});
  await new Promise(resolve=>setImmediate(resolve));
  for(const [action,key] of Object.entries(mapping)){
   const input=document.querySelector(`[aria-label="${keys.actions[action]} shortcut"]`);input.focus();
   input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(get()[action].key,key);assert.notEqual(document.activeElement,input);assert.equal(calls.length,0);
  }
  for(const [action,key] of Object.entries(mapping)){
   const event=new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});document.dispatchEvent(event);
   assert.equal(event.defaultPrevented,true);assert.equal(calls.at(-1),action);
  }
  assert.equal(calls.length,5);detach();
 }finally{dom.window.close();delete globalThis.document;}
});
test('video remote receives all saved navigation shortcuts',async()=>{
 const dom=new JSDOM('<html></html>',{runScripts:'outside-only'});const calls=[];
 const bindings=keys.normalize({back10:{key:'Home'},pause:{key:'Insert'},forward30:{key:'PageDown'},back5:{key:'PageUp'},forward5:{key:'End'}});
 dom.window.setInterval=()=>0;dom.window.chrome={runtime:{sendMessage:async m=>{calls.push(m);return {ok:true,state:{pending:null},sample:{time:20,paused:false,seeking:false},bindings};}}};
 try{
  for(const name of ['shortcut-keys.js','overlay.js'])dom.window.eval(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));
  for(const key of ['Home','Insert','PageDown','PageUp','End']){
   dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));
  }
  assert.deepEqual(JSON.parse(JSON.stringify(calls.filter(m=>m.type!=='sample'))),[{type:'skip',seconds:-10},{type:'playback'},{type:'skip',seconds:30},{type:'skip',seconds:-5},{type:'skip',seconds:5}]);
 }finally{dom.window.close();}
});
