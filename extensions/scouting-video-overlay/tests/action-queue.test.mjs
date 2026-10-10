import test from 'node:test';
import assert from 'node:assert/strict';
import {actionQueue} from '../action-queue.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('rapid taps remain unlocked and preserve their order before an outcome',async()=>{
 const seen=[],gates=[],states=[];
 const queue=actionQueue(message=>new Promise(resolve=>{seen.push(message);gates.push(resolve);}),s=>states.push(s));
 const one=queue.push({type:'touch',player:0}),two=queue.push({type:'touch',player:2});
 assert.equal(queue.pending,2);assert.ok(states.every(s=>!s.busy));
 const outcome=queue.push({type:'prepare',player:2});assert.equal(states.at(-1).busy,true);
 await turn();assert.equal(seen.length,1);gates.shift()({ok:true});await one;await turn();
 assert.deepEqual(seen.map(s=>s.type),['touch','touch']);gates.shift()({ok:true});await two;await turn();
 assert.deepEqual(seen.map(s=>s.type),['touch','touch','prepare']);gates.shift()({ok:true});await outcome;await turn();
 assert.equal(queue.pending,0);assert.equal(states.at(-1).busy,false);
});
test('failed local write is reported and does not deadlock subsequent actions',async()=>{
 let n=0;const queue=actionQueue(async()=>{if(n++===0)throw Error('Disk full');return {ok:true};});
 const bad=queue.push({type:'touch'}),good=queue.push({type:'undo-last'});
 await assert.rejects(bad,/Disk full/);assert.equal((await good).ok,true);await turn();assert.equal(queue.pending,0);
});
