import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {liveStatsData,liveStats} from '../live-stats.mjs';
const point=(set,extra)=>({number:set,before:{sets:Array.from({length:set},()=>({a:0,b:0})),phase:'playing'},winner:'a',player:0,outcome:'winner',setPoint:{a:false,b:false},matchPoint:{a:false,b:false},...extra});
const points=[point(1,{assistBy:1}),point(2,{player:2,outcome:'forced',forcedBy:0,breakPoint:'a'})];
test('set filters preserve pressure and assists from report methodology',()=>{
 const first=liveStatsData(points,'1');assert.equal(first.points.length,1);assert.equal(first.players[1].assists,1);assert.equal(first.impact.players[0].impact,.5);assert.equal(first.impact.players[1].impact,.5);
 const second=liveStatsData(points,'2');assert.equal(second.players[0].created,1);assert.equal(second.impact.players[0].impact,.75);assert.equal(second.impact.players[2].impact,-.75);
 assert.equal(liveStatsData(points).points.length,2);assert.equal(liveStatsData(points,'3').points.length,0);
});
test('tabs and set controls update in place and survive live updates',()=>{
 const dom=new JSDOM('<div id="root"></div>');globalThis.document=dom.window.document;
 try{const root=document.getElementById('root'),render=liveStats(root),data={timeline:points,names:['A','B','C','D'],identity:i=>document.createTextNode(['A','B','C','D'][i])};render(data);
 const click=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text).click();click('Player impact');click('Set 2');assert.equal(root.querySelectorAll('[role=img]').length,1);assert.match(root.textContent,/1 observed points/);
 render({...data,timeline:[...points,point(2,{})]});assert.match(root.textContent,/2 observed points/);assert.equal(root.querySelectorAll('[role=img]').length,1);
 click('Match summary');assert.match(root.textContent,/Points won/);click('Live stats');assert.match(root.textContent,/FE\+/);assert.equal(root.querySelectorAll('table').length,1);
 }finally{dom.window.close();delete globalThis.document;}
});
test('smash attempts reuse recorded shots and breaks stay team-level within selected set',()=>{
 const timeline=[point(1,{id:'one',breakConverted:true}),point(2,{id:'two',breakConverted:true,winner:'b'})];
 const rallies=[{id:'one',attempts:[{player:0},{player:2}],point:{player:0,outcome:'winner',shot:'smash',smashAlreadyCounted:true}},{id:'two',attempts:[],point:{player:2,outcome:'winner',shot:'smash'}}];
 const first=liveStatsData(timeline,'1',rallies);assert.equal(first.players[0].smashes,1);assert.equal(first.players[2].smashes,1);assert.deepEqual(first.breaks,[1,0]);
 const full=liveStatsData(timeline,'all',rallies);assert.equal(full.players[2].smashes,2);assert.deepEqual(full.breaks,[1,1]);
});
