import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suggestedCourt,courtSetup,localDayWindow,needsServerConfirmation} from '../onboarding-model.mjs';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {match,courtPlayers} from '../match.mjs';
import {videoPayload,validateVideoState} from '../server-model.mjs';
test('profile suggestions mirror far-end players and flag missing/conflicting preferences',()=>{
 const p=[{side:'right'},{side:'left'},{side:'left'},{side:'right'}];const s=suggestedCourt(p);assert.deepEqual(s,{order:[0,1,2,3],unresolved:[]});assert.deepEqual(suggestedCourt([{side:'left'},{side:'left'}]).unresolved,[0,1]);assert.throws(()=>courtSetup([0,2,1,3]));
 const rotated=[...s.order].reverse();assert.deepEqual(courtSetup(rotated),{near:'a',positions:{a:true,b:true}});
});
test('day window uses local midnight and an exclusive next-day boundary',()=>{const now=new Date(2026,9,8,15);const w=localDayWindow(now);assert.equal(w.date,'2026-10-08');assert.equal(new Date(w.start).getHours(),0);assert.equal(new Date(w.end).getDate(),9)});
function fixture(){let disk=fresh(),time=100,serial=0;const snap=()=>({tabId:1,documentId:'d',videoId:'v',mediaId:'m',time,at:new Date().toISOString(),paused:false,ended:false,seeking:false,readyState:4,rate:1,seekEpoch:0});const dispatch=engine({read:async()=>structuredClone(disk),write:async s=>{disk=structuredClone(s)},uuid:()=>String(++serial),capture:async()=>snap(),discover:async()=>({tabId:1,url:'https://youtube.com/watch?v=demo',videos:[snap()]}),catalog:async()=>({tournaments:[{id:'t',name:'Tournament'}],matches:[{id:'m',tournamentId:'t',names:['A','B','C','D']} ]})});return {dispatch,get:()=>disk,point:async()=>{await dispatch({type:'start'});time+=5;await dispatch({type:'prepare',player:0,outcome:'winner'});await dispatch({type:'score',details:{shot:'volley'}})}}}
async function setup(f){await f.dispatch({type:'scouting-matches'});await f.dispatch({type:'select-match',wizard:true,tournamentId:'t',matchId:'m'});await f.dispatch({type:'connect'});await assert.rejects(f.dispatch({type:'start'}),/Complete match setup/);await f.dispatch({type:'complete-onboarding',setup:{firstServer:0,otherServer:2,otherServerUnknown:true,...courtSetup([1,0,2,3]),rule:'star-point'},score:{completed:[{a:6,b:4}],games:{a:0,b:0},points:{a:40,b:0},server:0,near:'b',advantageReturns:0}})}
test('unknown server persists, blocks the next service game, resolves and undoes without losing points',async()=>{const f=fixture();await setup(f);assert.deepEqual(courtPlayers(f.get()),[1,0,2,3]);assert.equal(videoPayload(f.get()).setup.otherServerUnknown,true);assert.equal(validateVideoState(videoPayload(f.get())).setup.otherServerUnknown,true);await f.point();assert.equal(needsServerConfirmation(f.get(),match(f.get())),true);await assert.rejects(f.dispatch({type:'start'}),/Confirm/);await assert.rejects(f.dispatch({type:'restart-rally'}),/Confirm/);await assert.rejects(f.dispatch({type:'confirm-other-server',player:0}),/other pair/);const before=match(f.get()).score;await f.dispatch({type:'confirm-other-server',player:3});assert.equal(match(f.get()).server,3);assert.equal(f.get().rallies.length,1);assert.equal(needsServerConfirmation(f.get(),match(f.get())),false);await f.dispatch({type:'undo-last'});assert.equal(f.get().setup.otherServerUnknown,true);assert.equal(f.get().rallies.length,1);assert.deepEqual(match(f.get()).score,before)});
test('invalid starting score leaves setup and saved score unchanged',async()=>{const f=fixture();await setup(f);const old=f.get();await assert.rejects(f.dispatch({type:'complete-onboarding',setup:{firstServer:0,otherServer:2},score:{completed:[{a:0,b:0}],games:{a:0,b:0},points:{a:0,b:0},server:0,near:'a'}}));assert.deepEqual(f.get(),old);await f.point();await assert.rejects(f.dispatch({type:'complete-onboarding',setup:{firstServer:0,otherServer:2}}),/recorded points/);assert.equal(f.get().rallies.length,1)});
test('new set asks separately before games one and two, preserves order, sync and undo',async()=>{
 for(const tie of [false,true])for(const fslot of [0,1])for(const sslot of [0,1]){
  const f=fixture();await setup(f);await f.dispatch({type:'confirm-other-server',player:2});
  await f.dispatch({type:'starting-score',score:{completed:[],games:tie?{a:6,b:6}:{a:5,b:0},points:tie?{a:6,b:0}:{a:40,b:0},server:0,near:'b',advantageReturns:0}});
  await f.point();const before=match(f.get());assert.equal(before.setServers.set,2);const base=before.setServers.team==='a'?0:2,first=base+fslot,second=(2-base)+sslot;assert.equal(before.setServers.team,before.score.servingTeam);
  await assert.rejects(f.dispatch({type:'start'}),/Confirm/);await assert.rejects(f.dispatch({type:'restart-rally'}),/Confirm/);
  await assert.rejects(f.dispatch({type:'confirm-set-servers',player:second}),/serving team/);
  await f.dispatch({type:'confirm-set-servers',player:first});assert.equal(match(f.get()).server,first);assert.equal(match(f.get()).setServers,null);assert.deepEqual(match(f.get()).stats,before.stats);
  const restored=validateVideoState(videoPayload(f.get()));assert.equal(match(restored).server,first);assert.equal(match(restored).setServers,null);
  await f.dispatch({type:'undo-last'});assert.equal(match(f.get()).setServers.set,2);
  await f.dispatch({type:'confirm-set-servers',player:first});
  for(let i=0;i<4;i++)await f.point();assert.equal(match(f.get()).setServers.game,2);
  await assert.rejects(f.dispatch({type:'start'}),/Confirm/);
  await f.dispatch({type:'confirm-set-servers',player:second});assert.equal(match(f.get()).server,second);
  assert.equal(match(validateVideoState(videoPayload(f.get()))).setServers,null);
  await f.dispatch({type:'undo-last'});assert.equal(match(f.get()).setServers.game,2);
  await f.dispatch({type:'confirm-set-servers',player:second});
  for(let i=0;i<4;i++)await f.point();assert.equal(match(f.get()).server,first^1);
  const legacy=structuredClone(f.get());legacy.setup.adjustments=[];assert.doesNotThrow(()=>videoPayload(legacy),'older sessions without confirmation events remain exportable');
 }
});
test('undo set-winning point clears gate; finishing the match needs no confirmation',async()=>{
 const f=fixture();await setup(f);await f.dispatch({type:'confirm-other-server',player:2});
 await f.dispatch({type:'starting-score',score:{completed:[],games:{a:5,b:0},points:{a:40,b:0},server:0,near:'b',advantageReturns:0}});
 await f.point();await f.dispatch({type:'undo-last'});assert.equal(match(f.get()).setServers,null);
 const g=fixture();await setup(g);await g.dispatch({type:'confirm-other-server',player:2});await g.dispatch({type:'starting-score',score:{completed:[{a:6,b:0}],games:{a:5,b:0},points:{a:40,b:0},server:0,near:'b',advantageReturns:0}});await g.point();assert.equal(match(g.get()).score.phase,'finished');assert.equal(match(g.get()).setServers,null);
});
test('court-only onboarding defers service choice to scoring, then asks other pair on its turn',async()=>{
 const f=fixture();await f.dispatch({type:'scouting-matches'});await f.dispatch({type:'select-match',wizard:true,tournamentId:'t',matchId:'m'});await f.dispatch({type:'connect'});
 await f.dispatch({type:'complete-onboarding',setup:{firstServer:0,otherServer:2,firstServerUnknown:true,otherServerUnknown:true}});
 assert.equal(validateVideoState(videoPayload(f.get())).setup.firstServerUnknown,true);
 await assert.rejects(f.dispatch({type:'start'}),/Confirm/);await assert.rejects(f.dispatch({type:'missed-point',team:'a'}),/Confirm/);
 await f.dispatch({type:'confirm-first-server',player:3});assert.equal(match(f.get()).server,3);
 await f.dispatch({type:'undo-last'});assert.equal(needsServerConfirmation(f.get(),match(f.get())),true);
 await f.dispatch({type:'confirm-first-server',player:3});for(let i=0;i<4;i++)await f.point();
 await assert.rejects(f.dispatch({type:'start'}),/Confirm/);await f.dispatch({type:'confirm-other-server',player:1});assert.equal(match(f.get()).server,1);
});
test('optional coach confirmations persist one coach per team and unknown, without affecting match data',async()=>{
 const f=fixture();await setup(f);const original=match(f.get());const coach=i=>({id:'00000000-0000-0000-0000-00000000000'+i,name:'Coach '+i});
 const coaches=[{status:'confirmed',coaches:[coach(1)]},{status:'unknown',coaches:[]}];
 await f.dispatch({type:'confirm-coaches',matchId:'m',coaches});assert.deepEqual(videoPayload(f.get()).setup.coaches,coaches);assert.deepEqual(match(f.get()),original);
 await assert.rejects(f.dispatch({type:'confirm-coaches',matchId:'other',coaches}),/current match/);
 await assert.rejects(f.dispatch({type:'confirm-coaches',matchId:'m',coaches:[{status:'confirmed',coaches:[]},null]}),/Choose a coach/);
 await assert.rejects(f.dispatch({type:'confirm-coaches',matchId:'m',coaches:[{status:'confirmed',coaches:[coach(1),coach(2)]},null]}),/Invalid coach/);
 await f.dispatch({type:'undo-last'});assert.equal(f.get().setup.coaches,undefined);
});
test('older admin cannot silently strip coach observations or deferred first-server status',async()=>{
 const {adminVideoSync}=await import('../cloud.mjs');const original=globalThis.fetch;let writes=0;
 globalThis.fetch=async(_url,options)=>{if(options.method==='POST')writes++;return {ok:true,json:async()=>({features:['optional-server-v1']})}};
 try{const result=await adminVideoSync({method:'POST',matchId:'00000000-0000-0000-0000-000000000001',document:{setup:{coaches:[null,null],firstServerUnknown:true},rallies:[]}},{origin:'https://admin.padelnachos.com'});assert.equal(result.ok,false);assert.match(result.error,/pending/);assert.equal(writes,0);}finally{globalThis.fetch=original}
});
