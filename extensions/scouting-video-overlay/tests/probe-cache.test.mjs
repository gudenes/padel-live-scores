import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {videoProbe} from '../probe.mjs';

test('cached shadow video avoids scans but reconnects safely after element replacement',async()=>{
 const dom=new JSDOM('<div id="host"></div>',{url:'https://www.youtube.com/watch?v=abcdefghijk'});
 const shadow=dom.window.document.getElementById('host').attachShadow({mode:'open'});
 shadow.innerHTML='<video></video>';
 globalThis.window=dom.window;globalThis.document=dom.window.document;
 globalThis.location=dom.window.location;globalThis.getComputedStyle=dom.window.getComputedStyle;
 let scans=0;const query=document.querySelectorAll.bind(document);
 document.querySelectorAll=(...args)=>{scans++;return query(...args);};
 try{
  const [first]=await videoProbe();
  await videoProbe({kind:'sample',videoId:first.videoId});
  const initialScans=scans;
  assert.equal((await videoProbe({kind:'sample',videoId:first.videoId})).videoId,first.videoId);
  assert.equal(scans,initialScans);
  shadow.querySelector('video').remove();shadow.innerHTML='<video></video>';
  await assert.rejects(videoProbe({kind:'sample',videoId:first.videoId}),/disappeared/);
  assert.ok(scans>initialScans);
  const [replacement]=await videoProbe();
  assert.notEqual(replacement.videoId,first.videoId);
  assert.equal((await videoProbe({kind:'sample',videoId:replacement.videoId})).videoId,replacement.videoId);
 }finally{
  dom.window.close();delete globalThis.window;delete globalThis.document;delete globalThis.location;delete globalThis.getComputedStyle;
 }
});
