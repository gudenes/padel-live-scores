import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {scoutingProgress,progressUI} from '../scouting-progress.mjs';
const point=(outcome='winner',extra={})=>({point:{outcome,...extra}});
test('coverage uses active observations, excludes double faults from stroke coverage and treats missing attribution separately',()=>{
 const state={rallies:[point('winner',{shot:'smash'}),{...point('forced',{shot:'block',forcedBy:0}),touches:[{player:1}]},point('forced'),point('double_fault'),{...point('winner',{shot:'volley'}),undone:true},{touches:[{player:0}]}],pending:point('winner',{shot:'volley'})};
 assert.deepEqual(scoutingProgress(state),{points:4,eligible:3,detailed:2,percent:67,forced:2,attributed:1,tracked:1});
 state.rallies[1].undone=true;
 assert.deepEqual(scoutingProgress(state),{points:3,eligible:2,detailed:1,percent:50,forced:1,attributed:0,tracked:0});
 assert.equal(scoutingProgress({rallies:[point('double_fault')]}).percent,0);
 assert.deepEqual(scoutingProgress({rallies:[point('winner',{smashRecovery:true}),point('winner',{shot:'volley'})]}),{points:2,eligible:1,detailed:1,percent:100,forced:0,attributed:0,tracked:0});
});
test('disclosure keeps its state, uses actual server status and recalculates milestones after Undo',()=>{
 const dom=new JSDOM(readFileSync(new URL('../panel.html',import.meta.url),'utf8')),$=id=>dom.window.document.getElementById(id),render=progressUI($);
 const model={score:{phase:'playing'},tracking:{timeline:[]}},state={selectedMatch:{id:'match'},rallies:Array.from({length:20},()=>point('winner',{shot:'volley'}))};
 render(state,{status:'local'},model);
 assert.equal($('scouting-progress').hidden,false);assert.equal($('scouting-progress').open,false);assert.equal($('progress-bar').value,100);assert.equal($('progress-bar').parentElement.tagName,'HEADER');assert.equal($('progress-bar').hidden,false);assert.equal($('progress-count').textContent,'20 / 20 strokes');assert.equal($('progress-sync').textContent,'Local copy');assert.equal($('progress-milestone').textContent,'20 points recorded');
 $('scouting-progress').open=true;render(state,{status:'pending'},model);assert.equal($('scouting-progress').open,true);assert.equal($('progress-sync').textContent,'Waiting for server');assert.doesNotMatch($('progress-save-detail').textContent,/All 20/);
 render(state,{status:'saved'},model);assert.equal($('progress-save-detail').textContent,'All 20 recorded points saved to server');
 state.rallies.at(-1).undone=true;render(state,{status:'error',error:'Disconnected'},model);assert.equal($('progress-milestone').hidden,true);assert.equal($('progress-save-detail').textContent,'Disconnected');
 model.tracking.timeline=[{before:{sets:[{}]},after:{sets:[{},{}],phase:'playing'}}];render(state,{status:'local'},model);assert.equal($('progress-milestone').textContent,'First observed set finished');
 model.score.phase='finished';render(state,{status:'pending'},model);assert.equal($('progress-milestone').textContent,'Match completed · sync pending');render(state,{status:'saved'},model);assert.equal($('progress-milestone').textContent,'Match completed and synced');
 state.selectedMatch=null;render(state,{status:'saved'},model);assert.equal($('scouting-progress').hidden,true);assert.equal($('progress-bar').hidden,true);dom.window.close();
});
