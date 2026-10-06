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
  press(field('Forward 5 seconds'),'j');await new Promise(resolve=>setImmediate(resolve));assert.match($('shortcut-error').textContent,/already assigned/);assert.equal(get().forward5.key,'ArrowRight');
  press(field('Play / pause'),'Backspace');await new Promise(resolve=>setImmediate(resolve));assert.equal(get().pause,null);
  $('reset-shortcuts').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(get().pause.key,'k');
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
