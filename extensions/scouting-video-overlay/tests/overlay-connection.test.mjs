import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {fresh} from '../core.mjs';
import {defaults,match} from '../match.mjs';
import {scoreLabel} from '../generated/score-label.mjs';
test('disconnected overlay disables skips, offers reconnect and clears the connection warning after recovery',async()=>{
 const dom=new JSDOM('<html></html>',{runScripts:'outside-only',url:'https://www.youtube.com/watch?v=replay'});
 const state={...fresh(),setup:defaults(),connection:{tabId:7}},m=match(state),view={...m,labels:{a:scoreLabel(m.score,'a'),b:scoreLabel(m.score,'b')}};
 let connected=false;const messages=[];
 dom.window.setInterval=()=>0;
 dom.window.chrome={runtime:{sendMessage:async message=>{
  messages.push(message);if(message.type==='sample'&&!connected)return {ok:false,error:'Video connection expired. Reconnect video.'};
  if(message.type==='reconnect')connected=true;
  return {ok:true,state,view,sample:connected?{time:100,paused:false,seeking:false}:null};
 }}};
 try{
  dom.window.eval(readFileSync(new URL('../shortcut-keys.js',import.meta.url),'utf8'));
  dom.window.eval(readFileSync(new URL('../overlay.js',import.meta.url),'utf8'));
  const root=dom.window.document.querySelector('div').shadowRoot;
  const button=text=>[...root.querySelectorAll('button')].find(b=>b.firstChild?.textContent===text);
  assert.equal(button('+30s').disabled,true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(button('Reconnect video').hidden,false);assert.equal(button('+30s').disabled,true);
  assert.match(root.querySelector('.notice').textContent,/expired/);
  button('Reconnect video').click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(button('Reconnect video').hidden,true);assert.equal(button('+30s').disabled,false);assert.equal(root.querySelector('.notice').textContent,'');
  assert.equal(root.querySelectorAll('article,[role=dialog]').length,0);
  for(const key of ['j','k','l','ArrowLeft','ArrowRight']){dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));await new Promise(resolve=>setImmediate(resolve));}
  assert.deepEqual(JSON.parse(JSON.stringify(messages.filter(m=>m.type==='skip'||m.type==='playback'))),[{type:'skip',seconds:-10},{type:'playback'},{type:'skip',seconds:30},{type:'skip',seconds:-5},{type:'skip',seconds:5}]);
 }finally{dom.window.close();}
});
