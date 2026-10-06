import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {catalogUI} from '../catalog-ui.mjs';
test('filtering and browsing never switches sessions; selection is explicit and blocked during rallies',()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'));
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;
 const $=id=>document.getElementById(id),actions=[];
 const m={id:'m',tournamentId:'t',names:['Agustín Tapia','Arturo Coello','Jon Sanz','Franco Stupaczuk'],category:'men',round:'Final'};
 const state={catalog:{tournaments:[{id:'t',name:'Premier Padel Rotterdam P2'},{id:'u',name:'Premier Padel Germany P2'}],matchesByTournament:{t:[m],u:[]}}};
 const render=catalogUI({$,act:msg=>actions.push(msg)});render(state,false);
 $('tournament-results').children[0].click();render(state,false);
 assert.equal(actions[0].type,'load-matches');assert.equal($('select-match').disabled,true);
 $('match-search').value='coello agustin';$('match-search').dispatchEvent(new dom.window.Event('input'));
 assert.equal($('match-results').children.length,1);assert.equal(actions.length,1);
 $('match-results').children[0].click();assert.equal($('select-match').disabled,false);
 $('select-match').click();assert.deepEqual(actions[1],{type:'select-match',tournamentId:'t',matchId:'m'});
 $('match-category').value='women';$('match-category').dispatchEvent(new dom.window.Event('change'));
 assert.equal($('match-results').children.length,0);assert.equal($('select-match').disabled,true);
 $('match-category').value='';render({...state,pending:{start:{}}},false);
 assert.equal($('match-results').children[0].disabled,true);assert.equal($('catalog-year').disabled,true);
 render(state,false);$('tournament-results').children[1].click();render(state,false);
 assert.equal($('match-select').value,'');assert.equal($('select-match').disabled,true);
 assert.match($('match-count').textContent,/No linked matches/);
 $('catalog-year').value='2025';$('load-tournaments').click();assert.equal(actions.at(-1).year,'2025');
 dom.window.close();delete globalThis.document;delete globalThis.Option;
});
test('search reset and switching are explicit actions with a retry control',()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'));globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;
 try{
  const $=id=>document.getElementById(id),actions=[];
  const state={selectedMatch:{id:'m',tournamentId:'t',tournamentName:'Rotterdam',names:['A','B','C','D']},catalog:{tournaments:[{id:'t',name:'Rotterdam P2'},{id:'u',name:'Germany P2'}],matchesByTournament:{}}};
  const render=catalogUI({$,act:m=>actions.push(m)});render(state,false);
  $('tournament-results').children[1].click();render(state,false);$('reload-matches').click();assert.deepEqual(actions.at(-1),{type:'load-matches',tournamentId:'u'});
  $('switch-match').click();assert.equal(actions.at(-1).type,'leave-match');
  render({...state,selectedMatch:null},false);assert.equal($('catalog-panel').open,true);assert.equal($('connection-settings').open,true);
  $('tournament-search').value='ge';$('clear-catalog').click();assert.equal(actions.at(-1).type,'clear-catalog');assert.equal($('tournament-search').value,'');
 }finally{dom.window.close();delete globalThis.document;delete globalThis.Option;}
});
