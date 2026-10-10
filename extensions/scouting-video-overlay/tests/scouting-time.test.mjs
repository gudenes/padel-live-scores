import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scoutingTime} from '../scouting-time.mjs';
import {fresh,exported} from '../core.mjs';
import {defaults} from '../match.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
test('operator clock excludes breaks, closed-panel gaps and video seeking',()=>{
 let c=scoutingTime(null,1000);c=scoutingTime(c,16000);assert.equal(c.seconds,15);
 c=scoutingTime(c,21000,'pause');assert.equal(c.seconds,20);
 c=scoutingTime(c,100000,'resume');c=scoutingTime(c,115000);assert.equal(c.seconds,35);
 c=scoutingTime(c,125000,'suspend');c=scoutingTime(c,500000);assert.equal(c.seconds,45);
 c=scoutingTime(c,700000);assert.equal(c.seconds,45);
});
test('operator time survives server validation without a running heartbeat',()=>{
 const s={...fresh(),setup:defaults(),scoutingTime:{seconds:3725.5,paused:true,lastAt:100}};
 assert.deepEqual(exported(s).scoutingTime,{seconds:3725.5,paused:true});
 assert.deepEqual(videoPayload(s).scoutingTime,{seconds:3725.5,paused:true});
 assert.deepEqual(validateVideoState(videoPayload(s)).scoutingTime,{seconds:3725.5,paused:true});
 assert.throws(()=>videoPayload({...s,scoutingTime:{seconds:-1,paused:false}}));
});

test('clock is isolated per match, ignores stale panels and resumes saved totals',async()=>{
 const {engine}=await import('../engine.mjs');let now=1000,disk={...fresh(),setup:defaults(),selectedMatch:{id:'a'},pending:{id:'r',start:{time:100,at:'2026-10-10T10:00:00Z'}}};
 const run=engine({read:async()=>structuredClone(disk),write:async s=>{disk=structuredClone(s)},now:()=>now});
 await run({type:'scouting-clock',matchId:'a',mode:'tick'});now=16000;await run({type:'scouting-clock',matchId:'a',mode:'tick'});assert.equal(disk.scoutingTime.seconds,15);
 now=21000;await run({type:'scouting-clock',matchId:'a',mode:'pause'});assert.equal(disk.scoutingTime.seconds,20);
 disk.pending=null;await run({type:'leave-match'});assert.equal(disk.scoutingTime,null);assert.equal(disk.sessions.a.scoutingTime.seconds,20);
 await run({type:'resume-session',matchId:'a'});assert.equal(disk.scoutingTime.paused,true);assert.equal(disk.scoutingTime.lastAt,undefined);
 now=500000;await run({type:'scouting-clock',matchId:'old-match',mode:'resume'});assert.equal(disk.scoutingTime.paused,true);
 await run({type:'scouting-clock',matchId:'a',mode:'resume'});now+=10000;await run({type:'scouting-clock',matchId:'a',mode:'tick'});assert.equal(disk.scoutingTime.seconds,30);
});
