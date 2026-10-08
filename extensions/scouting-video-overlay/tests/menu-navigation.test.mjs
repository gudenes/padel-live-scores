import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {manualUI} from '../manual-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';

test('tools move into menu views, with Back and Close preserving the session and active-rally guards',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;
 dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
 const $=id=>document.getElementById(id),calls=[],state={...fresh(),setup:defaults(),selectedMatch:{id:'one',names:defaults().names},rallies:[]},original=structuredClone(state);
 try{
  const render=manualUI({$,act:async message=>{calls.push(message);return {ok:true};},call:async()=>({players:[]}),getState:()=>state});render(state,false);
  const menu=$('scouting-menu'),click=key=>menu.querySelector(`[data-menu="${key}"]`).click();
  assert.equal($('scouting-workspace').contains($('save-settings')),false);
  assert.equal($('menu-storage').contains($('scouting-tools')),true);
  $('scouting-menu-button').click();click('account');assert.equal(menu.open,true);assert.equal($('menu-content').contains($('save-settings')),true);assert.equal($('save-settings').open,true);
  $('menu-back').click();assert.equal($('menu-nav').hidden,false);assert.equal($('menu-storage').contains($('save-settings')),true);
  for(const [key,id] of [['progress','scouting-progress'],['tools','scouting-tools'],['shortcuts','shortcut-settings'],['stats','advanced-stats'],['bookmarks','bookmark-settings'],['finish','finish-guide'],['help','scouting-help']]){
   click(key);assert.equal($('menu-content').firstElementChild.id,id);assert.equal($(id).open,true);$('menu-back').click();
  }
  $('close-menu').click();$('header-account').click();assert.equal(menu.open,true);assert.equal($('menu-content').contains($('save-settings')),true);$('menu-back').click();
  click('create');assert.equal($('menu-content').contains($('manual-match-form')),true);assert.equal($('manual-match-form').hidden,false);
  $('close-menu').click();assert.equal(menu.open,false);assert.equal(document.body.classList.contains('creating-match'),false);assert.equal(document.activeElement,$('scouting-menu-button'));
  assert.deepEqual(state,original);assert.equal(calls.length,0);
  state.pending={id:'rally'};render(state,false);$('scouting-menu-button').click();
  assert.equal(menu.querySelector('[data-menu="find"]').disabled,true);assert.equal(menu.querySelector('[data-menu="create"]').disabled,true);assert.equal(menu.querySelector('[data-menu="saved"]').disabled,true);
  click('tools');assert.equal($('menu-content').contains($('cancel')),true);
  await new Promise(resolve=>setTimeout(resolve,120));
 }finally{dom.window.close();delete globalThis.document;}
});
