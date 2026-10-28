import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {liveStatsData,liveStats} from '../live-stats.mjs';
const point=(set,extra)=>({number:set,before:{config:{deuceRule:'advantage'},sets:Array.from({length:set},()=>({a:0,b:0})),phase:'playing'},winner:'a',player:0,outcome:'winner',setPoint:{a:false,b:false},matchPoint:{a:false,b:false},...extra});
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

test('impact legend precedes the chart and summary includes overview metrics',()=>{
 const dom=new JSDOM('<div id="root"></div>');globalThis.document=dom.window.document;
 try{const root=document.getElementById('root'),render=liveStats(root);render({timeline:points,names:['A','B','C','D'],identity:i=>document.createTextNode(String(i))});
 const click=text=>[...root.querySelectorAll('button')].find(b=>b.textContent===text).click();
 click('Player impact');const chart=root.querySelector('.live-impact-chart');assert.equal(chart.children[1].className,'live-impact-legend');assert.equal(chart.children[2].tagName,'svg');
 click('Match summary');for(const label of ['Forced errors committed','Smash points / attempts','Breaks / opportunities','Double faults','Longest point run'])assert.ok(root.textContent.includes(label));
 }finally{dom.window.close();delete globalThis.document;}
});

test('smash conversion includes attributed errors and counts attempts only once',()=>{
 const timeline=[point(1,{id:'smash'}),point(1,{id:'error',player:2,outcome:'forced',forcedBy:0})];
 const rallies=[{id:'smash',attempts:[{player:0}],point:{player:0,outcome:'winner',shot:'smash',smashAlreadyCounted:true}},{id:'error',attempts:[{player:0},{player:0}],point:{player:2,outcome:'forced',previousShot:'smash',previousPlayer:0}}];
 const data=liveStatsData(timeline,'all',rallies);assert.equal(data.players[0].smashPointsWon,2);assert.equal(data.players[0].smashes,3);
});

test('live conversion uses the overview replay statistics, including reused attempts',async()=>{
 const {freshDoc,replay}=await import('../generated/model.mjs');
 const doc={...freshDoc(),events:[{id:'a',kind:'smash',player:0,at:'2026-01-01T00:00:00Z'},{id:'p',kind:'point',player:0,outcome:'winner',smash:true,smashAttemptId:'a',shot:'smash',at:'2026-01-01T00:00:01Z'}]};
 const model=replay(doc),data=liveStatsData(model.tracking.timeline,'all',[],doc);
 assert.equal(data.players[0].smashes,model.stats[0].smashes);assert.equal(data.players[0].smashPointsWon,1);assert.equal(data.teams[0].smashPointsWon,1);
});
