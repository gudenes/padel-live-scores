import {test} from 'node:test';
import assert from 'node:assert/strict';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {defaults,match,scoutingDocument} from '../match.mjs';
import {videoPayload} from '../server-model.mjs';
function fixture(){let disk={...fresh(),selectedMatch:{id:'m'},setup:defaults()};return {get:()=>disk,send:engine({read:async()=>structuredClone(disk),write:async s=>{disk=s;}})};}
const score={completed:[],games:{a:3,b:2},points:{a:30,b:15},server:2,near:'a',advantageReturns:0};
test('missed points update score, remain unclassified, roundtrip and undo repeatedly',async()=>{
 const f=fixture();await f.send({type:'missed-point',team:'a',videoTime:110});await f.send({type:'missed-point',team:'b',videoTime:130});
 const restored=videoPayload(f.get()),m=match(restored);assert.deepEqual(m.score.currentGame,{a:15,b:15});assert.equal(m.unclassified,2);assert.equal(m.stats.reduce((n,s)=>n+s.winners+s.unforced+s.forced,0),0);
 assert.equal(scoutingDocument(restored).events[0].at,new Date(110000).toISOString());
 await f.send({type:'undo-last'});assert.equal(match(f.get()).score.currentGame.b,0);await f.send({type:'undo-last'});assert.equal(match(f.get()).score.currentGame.a,0);
});
test('current-score correction replaces scoreboard only, preserves recorded stats and is undoable',async()=>{
 const f=fixture();await f.send({type:'missed-point',team:'b'});await f.send({type:'score-correction',score});const restored=videoPayload(f.get());
 assert.deepEqual(match(restored).score.sets,[score.games]);assert.equal(match(restored).server,2);assert.deepEqual(match(restored).score.currentGame,score.points);assert.equal(match(restored).stats[0].winners,0);
 await f.send({type:'undo-last'});assert.deepEqual(match(f.get()).score.currentGame,{a:0,b:15});
});
test('missed points can complete games, sets and match without inventing player winners',async()=>{
 const f=fixture();await f.send({type:'score-correction',score:{...score,completed:[{a:6,b:3}],games:{a:5,b:0},points:{a:40,b:0},server:0}});await f.send({type:'missed-point',team:'a'});
 const m=match(videoPayload(f.get()));assert.equal(m.score.phase,'finished');assert.equal(m.score.winner,'a');assert.equal(m.stats[0].winners,0);await f.send({type:'undo-last'});assert.equal(match(f.get()).score.phase,'playing');
});
test('correction blocks an open rally and rejects malformed scores, teams and anchors',async()=>{
 const f=fixture();f.get().pending={id:'active'};await assert.rejects(f.send({type:'missed-point',team:'a'}),/unfinished rally/);f.get().pending=null;
 await assert.rejects(f.send({type:'missed-point',team:'c'}),/Choose a pair/);await assert.rejects(f.send({type:'score-correction',score:{...score,points:{a:12,b:0}}}));
 f.get().setup.adjustments=[{type:'missed-point',team:'a',afterId:'missing',at:new Date().toISOString()}];assert.throws(()=>videoPayload(f.get()),/correction/);
});
