import {test} from 'node:test';
import assert from 'node:assert/strict';
import {match,defaults} from '../match.mjs';
import {engine} from '../engine.mjs';
import {fresh,exported} from '../core.mjs';
import {validateStartingScore} from '../starting-score.mjs';
import {validateVideoState,videoSummary} from '../server-model.mjs';
const seed=(extra={})=>({completed:[{a:6,b:4}],games:{a:0,b:0},points:{a:0,b:0},server:2,near:'b',...extra});
const rally=(id,player=0)=>({id,start:{time:100+Number(id||0)*10},end:{time:105+Number(id||0)*10},point:{player,outcome:'winner'}});
const state=score=>({...fresh(),selectedMatch:{id:'m'},setup:{...defaults(),startingScore:score}});
test('set-two baseline scores only newly scouted points, survives export and undo, and finishes best of three',()=>{
 const s=state(seed());let m=match(s);assert.deepEqual(m.score.sets,[{a:6,b:4},{a:0,b:0}]);assert.equal(m.server,2);assert.equal(m.points,0);assert.equal(m.near,'b');assert.equal(m.stats[0].winners,0);
 s.rallies.push(rally('0'));m=match(s);assert.equal(m.score.currentGame.a,15);assert.equal(m.stats[0].winners,1);assert.equal(m.points,1);assert.deepEqual(exported(s).setup.startingScore,seed());
 s.rallies[0].undone=true;assert.equal(match(s).score.currentGame.a,0);assert.deepEqual(match(s).score.sets[0],{a:6,b:4});
 s.rallies=[];for(let i=0;i<24;i++)s.rallies.push(rally(String(i)));m=match(s);assert.equal(m.score.phase,'finished');assert.equal(m.score.winner,'a');
});
test('mid-game and tie-break starts continue with the selected server',()=>{
 const s=state(seed({games:{a:3,b:2},points:{a:40,b:30},server:1}));s.rallies.push(rally('0'));const m=match(s);assert.deepEqual(m.score.sets[1],{a:4,b:2});assert.equal(m.score.currentGame.a,0);assert.equal(m.points,1);
 const tb=state(seed({games:{a:6,b:6},points:{a:6,b:5},server:3}));assert.equal(match(tb).server,3);tb.rallies.push(rally('0'));assert.equal(match(tb).score.phase,'finished');assert.deepEqual(match(tb).score.sets[1],{a:7,b:6});
});
test('starting baseline survives server validation and is recomputed without fabricated statistics',()=>{
 const clean=validateVideoState(state(seed()));assert.deepEqual(clean.setup.startingScore,seed({advantageReturns:0}));const summary=videoSummary(clean);assert.deepEqual(summary.score.sets,[{a:6,b:4},{a:0,b:0}]);assert.equal(summary.points,0);assert.equal(summary.stats[0].winners,0);
});
test('invalid prior sets, finished matches and invalid points are rejected',()=>{
 for(const extra of [{completed:[{a:5,b:4}]},{completed:[{a:6,b:4},{a:7,b:5}]},{games:{a:6,b:2}},{points:{a:20,b:0}},{points:{a:'Adv',b:30}},{games:{a:6,b:6},points:{a:7,b:4}}])assert.throws(()=>validateStartingScore(seed(extra)));
 assert.equal(validateStartingScore(seed({completed:[{a:4,b:6},{a:7,b:6}]})).completed.length,2);
});
test('starting-score action persists before scouting and refuses to alter existing points or an open rally',async()=>{
 let disk={...fresh(),selectedMatch:{id:'m'},setup:defaults()};const send=engine({read:async()=>structuredClone(disk),write:async s=>{disk=s;}});
 await send({type:'starting-score',score:seed()});assert.deepEqual(disk.setup.startingScore,seed({advantageReturns:0}));disk.pending={id:'open'};await assert.rejects(send({type:'starting-score',score:seed()}),/before recording/);disk.pending=null;disk.rallies=[{point:{player:0,outcome:'winner'}}];await assert.rejects(send({type:'starting-score',score:seed()}),/before recording/);
});
