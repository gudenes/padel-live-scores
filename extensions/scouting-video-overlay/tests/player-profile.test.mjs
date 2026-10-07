import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {playerProfile,playerIdentity} from '../player-profile.mjs';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {defaults} from '../match.mjs';
test('identity uses real metadata, omits unknown ranks, and stays attached to player index',()=>{
 const state={setup:{names:['A','B']},selectedMatch:{names:['A','B'],players:[{country:'ARG',ranking:12},{country:null,ranking:0}]}};
 assert.deepEqual(playerProfile(state,0),{country:'AR',ranking:12});
 const doc=new JSDOM('').window.document;
 const node=playerIdentity('A',playerProfile(state,0),doc);
 assert.equal(node.textContent,'🇦🇷A#12');assert.equal(node.querySelector('[role=img]').getAttribute('aria-label'),'Argentina');
 assert.equal(playerIdentity('B',playerProfile(state,1),doc).textContent,'B');
 state.setup.names[0]='Someone else';assert.deepEqual(playerProfile(state,0),{country:null,ranking:null});
});
test('refreshing an active match enriches display without changing recorded scouting',async()=>{
 const selected={id:'m',names:['A','B','C','D'],playerIds:['a','b','c','d']};
 let state={...fresh(),setup:defaults(),selectedMatch:selected,rallies:[{id:'saved'}],pending:{id:'active'},catalog:{tournaments:[{id:'t'}],matchesByTournament:{}}};
 const before=structuredClone(state);
 const dispatch=engine({read:async()=>structuredClone(state),write:async s=>{state=s},catalog:async()=>({matches:[{...selected,players:[{country:'ES',ranking:5}]}]})});
 await dispatch({type:'load-matches',tournamentId:'t'});
 assert.equal(state.selectedMatch.players[0].ranking,5);
 for(const key of ['setup','rallies','pending','sessions','connection'])assert.deepEqual(state[key],before[key]);
});

test('court ends move player identity while scoreboard remains plain',async()=>{
 const {readFileSync}=await import('node:fs');const {scoutingUI}=await import('../scout-ui.mjs');const {defaults}=await import('../match.mjs');
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8'),{url:'https://example.test'});
 globalThis.document=dom.window.document;globalThis.Option=dom.window.Option;Object.defineProperty(globalThis,'localStorage',{value:dom.window.localStorage,configurable:true});
 const $=id=>document.getElementById(id),state={...fresh(),setup:defaults()};state.selectedMatch={id:'m',names:state.setup.names,players:[{country:'ES',ranking:7},{country:'AR',ranking:9},{country:null,ranking:null},{country:'FR',ranking:20}]};
 try{
 const render=scoutingUI({$,getState:()=>state,act:()=>{}});render(state,{time:100},false,true);
 assert.equal($('score').querySelectorAll('.player-flag,.player-ranking').length,0);
 assert.equal($('live-stats').querySelectorAll('.player-ranking').length,3);
 const card=()=>document.querySelector('[data-player="0"]');assert.equal(card().querySelector('.player-ranking').textContent,'#7');const key=card().querySelector('h3>kbd').textContent;
 state.setup.adjustments=[{afterId:null,type:'ends',at:new Date().toISOString()}];render(state,{time:100},false,true);
 assert.equal(card().querySelector('.player-ranking').textContent,'#7');assert.notEqual(card().querySelector('h3>kbd').textContent,key);
 }finally{dom.window.close();delete globalThis.document;delete globalThis.Option;delete globalThis.localStorage;}
});
