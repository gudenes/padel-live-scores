import {test} from 'node:test';
import assert from 'node:assert/strict';
import {engine} from '../engine.mjs';
import {fresh,exported} from '../core.mjs';
import {match} from '../match.mjs';
function fixture(){
 let disk=fresh(),time=100,paused=false,epoch=0,serial=0;
 const snap=()=>({tabId:1,documentId:'d',videoId:'v',mediaId:'m',time,at:new Date().toISOString(),paused,ended:false,seeking:false,readyState:4,rate:1,seekEpoch:epoch,seekable:[[0,5000]]});
 const dispatch=engine({read:async()=>structuredClone(disk),write:async s=>{disk=structuredClone(s)},uuid:()=>String(++serial),capture:async()=>snap(),discover:async()=>({tabId:1,url:'https://example.com/video',videos:[snap()]}),playback:async(_c,_s,value)=>{paused=value},seek:async(_c,_s,t)=>{time=t;epoch++},catalog:async req=>req.kind==='tournaments'?{tournaments:[{id:'t',name:'Tournament'}]}:{matches:['one','two'].map(id=>({id,tournamentId:'t',names:['A1','A2','B1','B2']}))}});
 const choose=async(id='one')=>{await dispatch({type:'load-tournaments'});await dispatch({type:'load-matches',tournamentId:'t'});await dispatch({type:'select-match',tournamentId:'t',matchId:id});await dispatch({type:'connect'});};
 const point=async(player=0,outcome='winner',details={})=>{await dispatch({type:'start'});time+=8;await dispatch({type:'prepare',player,outcome});await dispatch({type:'score',details});};
 return {dispatch,choose,point,get:()=>disk,set:t=>{time=t},pause:()=>{paused=true},resume:()=>{paused=false},rewind:()=>{epoch++;time-=5}};
}
test('requires a selected match and fills names from its tournament catalogue',async()=>{
 const f=fixture();await f.dispatch({type:'connect'});await assert.rejects(f.dispatch({type:'start'}),/Select a tournament/);await f.choose();assert.deepEqual(f.get().setup.names,['A1','A2','B1','B2']);
 await assert.rejects(f.dispatch({type:'select-match',tournamentId:'wrong',matchId:'one'}));
});
test('pause freezes video duration, resume retains rally, shot selection time is excluded',async()=>{
 const f=fixture();await f.choose();await f.dispatch({type:'start'});f.set(108);f.pause();
 let read=await f.dispatch({type:'sample'});assert.equal(read.sample.time,108);assert.equal(read.state.pending.start.time,100);
 f.resume();f.set(114);await f.dispatch({type:'prepare',player:0,outcome:'winner'});f.set(200);
 await f.dispatch({type:'score',details:{shot:'volley',assistBy:1,recovery:true,smashRecovery:true,netCord:'lucky'}});
 assert.equal(f.get().rallies[0].videoSeconds,14);assert.equal(match(f.get()).score.currentGame.a,15);assert.equal(match(f.get()).stats[1].assists,1);
 assert.equal(exported(f.get()).selectedMatch.id,'one');
});
test('can log an outcome while paused and does not start a new rally until playback resumes',async()=>{
 const f=fixture();await f.choose();await f.dispatch({type:'start'});f.set(110);f.pause();await f.dispatch({type:'prepare',player:2,outcome:'unforced'});await f.dispatch({type:'score',details:{netCord:'unlucky'}});
 assert.equal(match(f.get()).score.currentGame.a,15);await assert.rejects(f.dispatch({type:'start'}),/Play the video/);
});
test('seeking blocks scoring until cancelled and preserves the cancelled start',async()=>{
 const f=fixture();await f.choose();await f.dispatch({type:'start'});f.rewind();await assert.rejects(f.dispatch({type:'prepare',player:0,outcome:'winner'}),/moved/);assert.equal(match(f.get()).points,0);await f.dispatch({type:'cancel'});assert.equal(f.get().cancelled.length,1);
});
test('restart after rewind is atomic, works paused, preserves scored points and pending attempts, and is undoable',async()=>{
 const f=fixture();await f.choose();await f.point();const score=match(f.get()).score;
 await f.dispatch({type:'start'});await f.dispatch({type:'smash',player:0,smashType:'power'});const original=structuredClone(f.get().pending);
 f.rewind();f.pause();await f.dispatch({type:'restart-rally'});
 assert.deepEqual(match(f.get()).score,score);assert.equal(f.get().rallies.length,1);assert.equal(f.get().cancelled[0].attempts.length,1);assert.equal(f.get().cancelled[0].id,original.id);assert.equal(f.get().pending.start.paused,true);assert.equal(f.get().pending.start.time,103);assert.equal(f.get().pending.attempts,undefined);
 await f.dispatch({type:'undo-last'});assert.deepEqual(f.get().pending,original);assert.equal(f.get().cancelled.length,0);
 await f.dispatch({type:'restart-rally'});f.resume();f.set(112);await f.dispatch({type:'prepare',player:2,outcome:'winner'});await f.dispatch({type:'score',details:{shot:'volley'}});
 assert.equal(f.get().rallies.length,2);assert.equal(match(f.get()).points,2);assert.equal(f.get().rallies[1].videoSeconds,9);
});
test('faults, smash attempts, undo and server rotation use the admin scoring engine',async()=>{
 const f=fixture();await f.choose();await f.dispatch({type:'start'});await assert.rejects(f.dispatch({type:'double-fault'}),/first fault/);await f.dispatch({type:'first-fault'});await f.dispatch({type:'double-fault'});assert.equal(match(f.get()).score.currentGame.b,15);assert.equal(match(f.get()).stats[0].doubleFaults,1);
 await f.dispatch({type:'undo'});assert.equal(match(f.get()).score.currentGame.b,0);
 await f.dispatch({type:'start'});await f.dispatch({type:'smash',player:0});await f.dispatch({type:'prepare',player:0,outcome:'winner'});await f.dispatch({type:'score',details:{shot:'smash',smashAlreadyCounted:true}});assert.equal(match(f.get()).stats[0].smashes,1);
 await f.point();await f.point();await f.point();assert.equal(match(f.get()).score.sets[0].a,1);assert.equal(match(f.get()).server,2);
 await f.dispatch({type:'replay',id:f.get().rallies.at(-1).id});assert.equal(match(f.get()).points,4);
});
test('Star Point completes the game after two lost advantages',async()=>{
 const f=fixture();await f.choose();for(const p of [0,0,0,2,2,2,0,2,2,0])await f.point(p);assert.equal(match(f.get()).score.advantageReturns,2);await f.point();assert.equal(match(f.get()).score.sets[0].a,1);
});
test('switching matches restores isolated scores and requires explicit video reconnect',async()=>{
 const f=fixture();await f.choose();await f.point();await f.dispatch({type:'select-match',tournamentId:'t',matchId:'two'});assert.equal(match(f.get()).points,0);assert.equal(f.get().connection,null);
 await f.dispatch({type:'connect'});await f.point(2);await f.dispatch({type:'select-match',tournamentId:'t',matchId:'one'});assert.equal(match(f.get()).score.currentGame.a,15);assert.equal(match(f.get()).score.currentGame.b,0);assert.equal(f.get().sessions.two.rallies.length,1);
 await f.dispatch({type:'connect'});await f.dispatch({type:'start'});await assert.rejects(f.dispatch({type:'select-match',tournamentId:'t',matchId:'two'}),/Finish or cancel/);
});
test('duplicate save cannot award a second point',async()=>{
 const f=fixture();await f.choose();await f.point();await assert.rejects(f.dispatch({type:'score',details:{}}));assert.equal(match(f.get()).points,1);
});
test('server corrections persist, rotate, and stay isolated per match',async()=>{
 const f=fixture();await f.choose();await f.point();await f.dispatch({type:'server',player:1});assert.equal(match(f.get()).server,1);
 for(let i=0;i<3;i++)await f.point();assert.equal(match(f.get()).server,2);
 await f.dispatch({type:'select-match',tournamentId:'t',matchId:'two'});assert.equal(match(f.get()).server,0);
 await f.dispatch({type:'select-match',tournamentId:'t',matchId:'one'});assert.equal(match(f.get()).server,2);
 assert.equal(exported(f.get()).setup.adjustments[0].player,1);
});
test('court ends change at odd games, restore on undo and allow manual alignment',async()=>{
 const f=fixture();await f.choose();assert.equal(match(f.get()).near,'a');for(let i=0;i<4;i++)await f.point();assert.equal(match(f.get()).near,'b');
 await f.dispatch({type:'undo'});assert.equal(match(f.get()).near,'a');await f.dispatch({type:'ends'});assert.equal(match(f.get()).near,'b');
 await f.dispatch({type:'start'});await f.dispatch({type:'ends'});assert.equal(match(f.get()).near,'a');await assert.rejects(f.dispatch({type:'server',player:2}),/Finish or cancel/);
});
test('skip advances video without changing score or paused state and blocks during rallies',async()=>{
 const f=fixture();await f.choose();f.pause();await f.dispatch({type:'skip',seconds:30});const s=await f.dispatch({type:'sample'});assert.equal(s.sample.time,130);assert.equal(s.sample.paused,true);assert.equal(match(f.get()).points,0);
 f.set(4998);await f.dispatch({type:'skip',seconds:10});assert.equal((await f.dispatch({type:'sample'})).sample.time,4999.99);
 f.set(100);f.resume();await f.dispatch({type:'start'});await assert.rejects(f.dispatch({type:'skip',seconds:5}),/Finish or cancel/);
});
test('tie-break ends change every six points and once when it finishes',async()=>{
 const {changesEnds}=await import('../match.mjs');
 const before={phase:'tiebreak',currentGame:{a:3,b:2}};
 assert.equal(changesEnds(before,{phase:'tiebreak',currentGame:{a:3,b:3}}),true);
 assert.equal(changesEnds(before,{phase:'tiebreak',currentGame:{a:4,b:3}}),false);
 assert.equal(changesEnds(before,{phase:'playing',currentGame:{a:0,b:0}}),true);
});
test('Premier default includes P1 P2 Majors and Finals but excludes FIP events',async()=>{
 const {premier}=await import('../catalog-ui.mjs');
 for(const name of ['CUPRA ROTTERDAM PREMIER PADEL P2','GERMANY P2','PARIS MAJOR','PREMIER PADEL FINALS'])assert.equal(premier({name}),true);
 for(const name of ['FIP SILVER HOUTEN','FIP BRONZE ALMEIRIM','Miami'])assert.equal(premier({name}),false);
});
test('left/right alignment persists per match without changing scores or servers',async()=>{
 const f=fixture();await f.choose();await f.dispatch({type:'positions',pair:'a'});assert.equal(f.get().setup.positions.a,true);assert.equal(match(f.get()).server,0);assert.equal(match(f.get()).points,0);
 await f.dispatch({type:'select-match',tournamentId:'t',matchId:'two'});assert.equal(f.get().setup.positions,undefined);
 await f.dispatch({type:'select-match',tournamentId:'t',matchId:'one'});assert.equal(f.get().setup.positions.a,true);await f.dispatch({type:'connect'});await f.dispatch({type:'start'});await f.dispatch({type:'positions',pair:'a'});assert.equal(match(f.get()).swapped.a,false);
});

test('rewind supports all three steps, clamps at the start and preserves playback and score',async()=>{
 const f=fixture();await f.choose();await f.point();f.pause();
 for(const seconds of [-5,-10,-30]){
  f.set(100);await f.dispatch({type:'skip',seconds});
  const result=await f.dispatch({type:'sample'});
  assert.equal(result.sample.time,100+seconds);assert.equal(result.sample.paused,true);
  assert.equal(match(f.get()).points,1);
 }
 f.set(2);await f.dispatch({type:'skip',seconds:-30});assert.equal((await f.dispatch({type:'sample'})).sample.time,0);
 f.resume();f.set(100);await f.dispatch({type:'skip',seconds:-5});assert.equal((await f.dispatch({type:'sample'})).sample.paused,false);
 await assert.rejects(f.dispatch({type:'skip',seconds:-20}),/choose/);
 await f.dispatch({type:'start'});await assert.rejects(f.dispatch({type:'skip',seconds:-5}),/Finish or cancel/);
});

test('overlay playback toggles during a rally without ending or scoring it',async()=>{
 const f=fixture();await f.choose();await f.dispatch({type:'start'});f.set(105);
 await f.dispatch({type:'playback'});assert.equal((await f.dispatch({type:'sample'})).sample.paused,true);
 assert.ok(f.get().pending);assert.equal(match(f.get()).points,0);
 await f.dispatch({type:'playback'});assert.equal((await f.dispatch({type:'sample'})).sample.paused,false);
});
test('quadrant layout survives end changes and match changes',async()=>{
 const f=fixture();await f.choose();await f.dispatch({type:'overlay-layout',corner:'near-left',x:.1,y:.8});
 await f.dispatch({type:'ends'});await f.choose('two');
 assert.deepEqual(f.get().overlayLayout['near-left'],{x:.1,y:.8});
 await assert.rejects(f.dispatch({type:'overlay-layout',corner:'near-left',x:2,y:0}),/Invalid/);
});

test('typed smash attempts link by subtype, survive server validation and undo without counting twice',async()=>{
 const {videoPayload,videoSummary}=await import('../server-model.mjs');
 const f=fixture();await f.choose();await f.dispatch({type:'start'});
 await f.dispatch({type:'smash',player:0,smashType:'power'});await f.dispatch({type:'smash',player:0,smashType:'x3'});
 await f.dispatch({type:'prepare',player:0,outcome:'winner'});
 await assert.rejects(f.dispatch({type:'score',details:{shot:'smash',smashType:'power',smashAlreadyCounted:true,smashAttemptIndex:1}}),/matching attempt/);
 await f.dispatch({type:'score',details:{shot:'smash',smashType:'power',x4:true,smashAlreadyCounted:true,smashAttemptIndex:0}});
 const payload=videoPayload(f.get()),summary=videoSummary(payload);assert.equal(summary.stats[0].smashes,2);assert.equal(summary.stats[0].powerSmashes,1);assert.equal(summary.stats[0].x3Smashes,1);assert.equal(summary.stats[0].x4Winners,1);assert.equal(summary.score.currentGame.a,15);
 await f.dispatch({type:'undo-last'});assert.equal(match(f.get()).points,0);assert.equal(match(f.get()).stats[0].smashes,2);assert.equal(match(f.get()).stats[0].x4Winners,0);
 await assert.rejects(f.dispatch({type:'score',details:{shot:'smash',smashType:'x3',x4:true}}),/Power smash winner/);
 await assert.rejects(f.dispatch({type:'score',details:{shot:'volley',smashType:'power'}}),/only to smashes/);
});
test('legacy smash records stay unclassified rather than gaining invented types',async()=>{
 const f=fixture();await f.choose();await f.point(0,'winner',{shot:'smash'});const s=match(f.get()).stats[0];assert.equal(s.smashes,1);assert.equal(s.powerSmashes,0);assert.equal(s.x3Smashes,0);
});

test('VAR marking survives save and validation without awarding a point; undo restores it',async()=>{
 const {videoPayload}=await import('../server-model.mjs'),f=fixture();await f.choose();
 await assert.rejects(f.dispatch({type:'var-review',reviewed:true}),/Start a rally/);
 await f.dispatch({type:'start'});await f.dispatch({type:'var-review',reviewed:true});
 assert.equal(match(f.get()).points,0);assert.equal(videoPayload(f.get()).pending.varReviewed,true);
 await f.dispatch({type:'undo-last'});assert.equal(f.get().pending.varReviewed,undefined);
 await f.dispatch({type:'prepare',player:0,outcome:'winner'});await f.dispatch({type:'var-review',reviewed:true});
 await f.dispatch({type:'score',details:{shot:'volley'}});assert.equal(videoPayload(f.get()).rallies[0].varReviewed,true);assert.equal(match(f.get()).points,1);
 await f.dispatch({type:'undo-last'});assert.equal(f.get().pending.varReviewed,true);assert.equal(match(f.get()).points,0);
 await f.dispatch({type:'var-review',reviewed:false});assert.equal(f.get().pending.varReviewed,undefined);
 await assert.rejects(f.dispatch({type:'var-review',reviewed:'yes'}),/whether/);
});
test('manual and automatic end changes rotate all players diagonally and preserve pair overrides',async()=>{
 const {courtPlayers}=await import('../match.mjs'),f=fixture();await f.choose();
 assert.deepEqual(courtPlayers(f.get()),[2,3,0,1]);
 await f.dispatch({type:'ends'});assert.deepEqual(courtPlayers(f.get()),[1,0,3,2]);
 await f.dispatch({type:'undo-last'});assert.deepEqual(courtPlayers(f.get()),[2,3,0,1]);
 for(let i=0;i<4;i++)await f.point();assert.deepEqual(courtPlayers(f.get()),[1,0,3,2]);
 await f.dispatch({type:'positions',pair:'a'});assert.deepEqual(courtPlayers(f.get()),[0,1,3,2]);
 await f.dispatch({type:'ends'});assert.deepEqual(courtPlayers(f.get()),[2,3,1,0]);
 await f.choose('two');await f.dispatch({type:'starting-score',score:{completed:[],games:{a:6,b:6},points:{a:0,b:0},server:0,near:'b',advantageReturns:0}});
 const initial=courtPlayers(f.get());for(let i=0;i<6;i++)await f.point(i%2?2:0);
 assert.deepEqual(courtPlayers(f.get()),initial.slice().reverse());
});

test('tapped shot sequence survives scoring, export, undo and server validation',async()=>{
 const {videoPayload}=await import('../server-model.mjs');const {touchInsights}=await import('../touch-insights.mjs');
 const f=fixture();await f.choose();await f.dispatch({type:'start'});
 for(const [t,player] of [[101,0],[102,2],[103,1]]){f.set(t);await f.dispatch({type:'touch',player});}
 assert.equal(f.get().pending.touches.length,3);assert.equal(match(f.get()).points,0);
 await f.dispatch({type:'undo-last'});assert.equal(f.get().pending.touches.length,2);
 f.set(104);await f.dispatch({type:'prepare',player:0,outcome:'winner'});await f.dispatch({type:'score',details:{shot:'volley'}});
 const payload=videoPayload(f.get());assert.equal(payload.rallies[0].touches.length,2);assert.equal(exported(f.get()).rallies[0].touches.length,2);assert.equal(touchInsights(payload.rallies).shots,2);
 await assert.rejects(f.dispatch({type:'touch',player:1}),/Start a rally/);
 await f.dispatch({type:'undo-last'});assert.equal(f.get().pending.touches.length,2);
});
test('sequential smash classification preserves one shot, corrects one attempt, round-trips and undoes',async()=>{
 const {videoPayload,validateVideoState,videoSummary}=await import('../server-model.mjs');
 const f=fixture();await f.choose();await f.dispatch({type:'start'});
 await assert.rejects(f.dispatch({type:'smash',player:0,smashType:'soft',latestTouch:true}),/Tap this player/);
 await f.dispatch({type:'touch',player:0});
 await f.dispatch({type:'smash',player:0,smashType:'power',latestTouch:true});
 await f.dispatch({type:'smash',player:0,smashType:'soft',latestTouch:true});
 assert.equal(f.get().pending.touches.length,1);assert.equal(f.get().pending.attempts.length,1);assert.equal(match(f.get()).stats[0].softSmashes,1);assert.equal(match(f.get()).stats[0].powerSmashes,0);
 await f.dispatch({type:'undo-last'});assert.equal(match(f.get()).stats[0].powerSmashes,1);
 await f.dispatch({type:'smash',player:0,smashType:'soft',latestTouch:true});
 await f.dispatch({type:'smash',player:0,smashType:'soft',latestTouch:true});assert.equal(f.get().pending.attempts.length,1);
 f.set(108);await f.dispatch({type:'prepare',player:0,outcome:'winner'});await f.dispatch({type:'score',details:{shot:'smash',smashType:'soft',smashAlreadyCounted:true,smashAttemptIndex:0}});
 const payload=videoPayload(f.get()),copy=validateVideoState(JSON.parse(JSON.stringify(payload))),stats=videoSummary(copy).stats[0];
 assert.equal(copy.rallies[0].attempts[0].touchIndex,0);assert.equal(copy.rallies[0].touches.length,1);assert.equal(stats.smashes,1);assert.equal(stats.softSmashes,1);assert.equal(stats.softSmashWinners,1);
 const bad=structuredClone(payload);bad.rallies[0].attempts[0].touchIndex=9;assert.throws(()=>validateVideoState(bad),/Invalid smash shot link/);
 await f.dispatch({type:'undo-last'});assert.equal(match(f.get()).stats[0].softSmashWinners,0);
 await f.dispatch({type:'clear-outcome'});await f.dispatch({type:'touch',player:2});await assert.rejects(f.dispatch({type:'smash',player:0,smashType:'soft',latestTouch:true}),/Tap this player/);
});
