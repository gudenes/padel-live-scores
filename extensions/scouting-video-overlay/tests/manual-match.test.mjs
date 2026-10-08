import {test} from 'node:test';
import assert from 'node:assert/strict';
import {manualInput} from '../manual-match.mjs';
import {engine} from '../engine.mjs';
import {fresh} from '../core.mjs';
import {cloudSync,adminVideoSync} from '../cloud.mjs';
const id='00000000-0000-0000-0000-000000000010';
const input={players:['A1','A2','B1','B2'].map(name=>({name})),matchDate:'2018-10-08',videoUrl:'https://www.youtube.com/watch?v=old'};
const selected={id,kind:'manual',names:input.players.map(p=>p.name),tournamentName:'Private scouting'};
const setup={names:['Old1','Old2','Old3','Old4'],firstServer:0,otherServer:2,rule:'star-point'};
test('manual names and optional metadata validate without public player IDs',()=>{
 const out=manualInput(input);assert.deepEqual(out.players.map(p=>p.id),[null,null,null,null]);assert.equal(out.matchDate,'2018-10-08');
 for(const bad of [{...input,players:[{name:'A'}]},{...input,players:['A','A','B','C'].map(name=>({name}))},{...input,matchDate:'2018-02-30'},{...input,videoUrl:'javascript:alert(1)'},{...input,videoUrl:'https://user:password@test.com'}])assert.throws(()=>manualInput(bad));
});
test('safe creation retry keeps its ID and archives the previous session intact',async()=>{
 let disk={...fresh(),setup,selectedMatch:{id:'old',names:setup.names},rallies:[{id:'saved',point:{player:0,outcome:'winner',shot:'volley'}}],sessions:{earlier:{label:'Preserved'}}},attempt=0,ids=[];
 const before=structuredClone(disk);const dispatch=engine({read:async()=>structuredClone(disk),write:async s=>disk=structuredClone(s),uuid:()=>id,catalog:async request=>{ids.push(request.input.id);if(++attempt===1)throw Error('Lost response');return {match:selected};}});
 await assert.rejects(dispatch({type:'create-manual',input}),/Lost response/);assert.equal(disk.manualDraft.id,id);assert.deepEqual(disk.rallies,before.rallies);
 await dispatch({type:'create-manual',input});assert.deepEqual(ids,[id,id]);assert.deepEqual(disk.sessions.old.rallies,before.rallies);assert.equal(disk.sessions.earlier.label,'Preserved');assert.equal(disk.selectedMatch.kind,'manual');assert.equal(disk.connection,null);
 await dispatch({type:'resume-session',matchId:'old'});assert.deepEqual(disk.rallies,before.rallies);assert.equal(disk.sessions[id].selectedMatch.kind,'manual');
 disk.pending={id:'live'};await assert.rejects(dispatch({type:'create-manual',input}),/Save or cancel/);await assert.rejects(dispatch({type:'resume-session',matchId:id}),/Save or cancel/);
});
test('manual outbox uses private endpoints and keeps routing after acknowledgement',async()=>{
 let store,requests=[];
 const sync=cloudSync({read:async()=>store,write:async s=>store=structuredClone(s),uuid:()=>id,request:async req=>{requests.push(req);return req.method==='GET'?{ok:true,session:null}:{ok:true,revision:1,savedAt:'saved'};}});
 const state={...fresh(),setup,selectedMatch:selected};await sync.track(state);await sync.flush();assert.equal((await sync.status(id)).status,'saved');assert.ok(requests.every(r=>r.kind==='manual'));
 await sync.acknowledge(id,{payload:store.entries[id].payload,revision:1,savedAt:'saved'});assert.equal(store.entries[id].kind,'manual');
 const previous=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(url,'https://admin.padelnachos.com/api/internal/manual-video-scouting/'+id);return {ok:true,status:200,json:async()=>({session:null})};};
 try{assert.equal((await adminVideoSync({kind:'manual',method:'GET',matchId:id},{origin:'https://admin.padelnachos.com',token:'proof'})).ok,true);}finally{globalThis.fetch=previous;}
});
test('opening a private server match restores its observations and revision without replacing another local session',async()=>{
 const snapshot={tabId:1,documentId:'d',videoId:'v',mediaId:'m',time:10,at:'2026-10-08T08:00:00Z',readyState:4,seekEpoch:0,paused:false};
 const document={version:1,label:'Historical',setup:{...setup,names:selected.names},rallies:[{id:'remote-point',start:snapshot,end:{...snapshot,time:20},point:{player:2,outcome:'winner',shot:'volley'}}],cancelled:[],pending:null};
 let disk={...fresh(),setup,selectedMatch:{id:'old',names:setup.names},manualMatches:[selected],sessions:{}},context;
 const dispatch=engine({read:async()=>structuredClone(disk),write:async(s,c)=>{disk=structuredClone(s);context=c;},uuid:()=>id,catalog:async req=>{assert.equal(req.kind,'manual-session');return {session:{document,revision:7,updated_at:'saved'}};}});
 await dispatch({type:'resume-session',matchId:id});assert.equal(disk.rallies.length,1);assert.deepEqual(disk.rallies[0].point,document.rallies[0].point);assert.equal(disk.rallies[0].start.time,10);assert.equal(disk.rallies[0].end.time,20);assert.equal(disk.rallies[0].videoSeconds,10);assert.equal(disk.sessions.old.selectedMatch.id,'old');assert.equal(context.remote.revision,7);assert.equal(context.remote.kind,'manual');assert.equal(disk.connection,null);
});
test('the open menu suspends playback shortcuts and closing it restores them',async()=>{
 await import('../shortcut-keys.js');let open=true,handler,clicks=0;
 const target={querySelector:selector=>open&&selector==='#scouting-menu[open]'?{}:null,addEventListener:(_event,fn)=>handler=fn,removeEventListener(){}};
 globalThis.__pnMediaKeys.attach({target,controls:{pause:{disabled:false,click:()=>clicks++}},getBindings:()=>globalThis.__pnMediaKeys.defaults});
 const event={key:'Home',repeat:false,composedPath:()=>[{matches:()=>false}],preventDefault(){},stopImmediatePropagation(){}};
 handler(event);assert.equal(clicks,0);open=false;handler(event);assert.equal(clicks,1);
});
