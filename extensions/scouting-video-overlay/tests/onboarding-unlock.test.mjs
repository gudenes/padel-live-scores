import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {onboardingUI} from '../onboarding-ui.mjs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
test('loaded match cards unlock when the action queue releases busy without rebuilding or losing selection',async()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;dom.window.HTMLElement.prototype.scrollIntoView=function(){};
 const $=id=>document.getElementById(id),state={...fresh(),setup:defaults()};let resolve;
 const render=onboardingUI({$,getState:()=>state,manual:{close(){}},act:()=>new Promise(r=>{resolve=r})});
 try{
  render(state,false,false);render.open();render(state,true,false);
  resolve({ok:true,matches:[{id:'m',names:['A','B','C','D'],status:'scheduled'}]});
  await new Promise(r=>setImmediate(r));
  const card=$('wizard-matches').firstChild;assert.equal(card.disabled,true);
  render(state,false,false);assert.equal(card.disabled,false);assert.equal($('wizard-refresh').disabled,false);
  card.click();assert.equal($('wizard-select').disabled,false);
  const selected=$('wizard-matches').firstChild;selected.focus();
  render(state,true,false);assert.equal(selected.disabled,true);assert.equal($('wizard-select').disabled,true);
  render(state,false,false);assert.equal($('wizard-matches').firstChild,selected);assert.equal(selected.getAttribute('aria-pressed'),'true');assert.equal($('wizard-select').disabled,false);
 }finally{dom.window.close();delete globalThis.document;}
});
