import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {scoutingUI} from '../scout-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
test('court preparation survives reload by match and player, with safe server controls and moving smash key hints',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 const $=id=>document.getElementById(id),actions=[],state={...fresh(),setup:defaults(),selectedMatch:{id:'one'}};
 try{
  const render=scoutingUI({$,act:action=>actions.push(action),getState:()=>state});
  render(state,null,false,false);
  const card=i=>$('players').querySelector(`article[data-player="${i}"]`);
  assert.equal($('court-confirmed').textContent,'0/4 on court');
  card(2).querySelector('input').click();assert.equal($('court-confirmed').textContent,'1/4 on court');
  $('change-server').click();$('quick-server').value='2';await $('quick-server').onchange();assert.deepEqual(actions.at(-1),{type:'server',player:2});
  assert.match(card(2).querySelector('.attempts').textContent,/Q → End.*Q → Delete.*Q → Page Down/);
  state.setup.adjustments=[{type:'ends',afterId:null,at:'2026-10-07T00:00:00Z'}];render(state,null,false,false);
  assert.equal(card(2).querySelector('input').checked,true);assert.match(card(2).querySelector('.attempts').textContent,/S → End.*S → Delete.*S → Page Down/);
  state.selectedMatch.id='two';render(state,null,false,false);assert.equal($('court-confirmed').textContent,'0/4 on court');
  state.selectedMatch.id='one';render(state,null,false,false);assert.equal(card(2).querySelector('input').checked,true);
  state.pending={id:'pending',start:{time:10,at:'2026-10-07T00:00:00Z'}};render(state,null,false,false);
  assert.equal($('change-server').disabled,true);assert.equal($('quick-server').disabled,true);
  state.pending=null;render(state,null,false,false);
  for(const i of [0,1,3])card(i).querySelector('input').click();
  assert.equal($('court-checkin').hidden,true);assert.equal($('undo-checkin').hidden,false);assert.equal(card(2).querySelector('.court-controls').hidden,true);
  render(state,null,false,false);assert.equal($('court-checkin').hidden,true);
  $('undo-checkin').click();assert.equal($('court-checkin').hidden,false);assert.equal($('court-confirmed').textContent,'3/4 on court');assert.equal(card(3).querySelector('input').checked,false);assert.equal(actions.length,1);
  render(state,null,true,false);assert.equal(card(2).querySelector('input').disabled,true);
  render({...fresh()},null,false,false);assert.equal($('court-checkin').hidden,true);
 }finally{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});
