import test from 'node:test';
import assert from 'node:assert/strict';
import {closingModel} from '../closing-model.mjs';
const state={selectedMatch:{id:'match-1'},rallies:[{id:'p1',point:{}},{id:'p2',point:{},undone:true}]};
const score={phase:'finished',sets:[{a:6,b:4},{a:6,b:2}]};
test('closing report requires server confirmation; demo cannot link to production',()=>{
 for(const status of ['local','pending','error','conflict'])assert.equal(closingModel(state,score,{status}).saved,false);
 const saved=closingModel(state,score,{status:'saved'});assert.equal(saved.saved,true);assert.equal(saved.points,1);assert.equal(saved.score,'6–4 · 6–2');assert.match(saved.reportUrl,/\/scouting\/match-1\/report$/);
 const demo=closingModel(state,score,{status:'saved'},true);assert.equal(demo.saved,false);assert.equal(demo.reportUrl,null);
});
test('closing wizard is only eligible for finished matches without an open rally',()=>{
 assert.equal(closingModel(state,{...score,phase:'playing'},{}).finished,false);
 assert.equal(closingModel({...state,pending:{}},score,{}).finished,false);
 assert.equal(closingModel({...state,selectedMatch:{id:'manual-1',kind:'manual'}},score,{}).reportUrl.endsWith('/scouting/manual/manual-1/report'),true);
});
