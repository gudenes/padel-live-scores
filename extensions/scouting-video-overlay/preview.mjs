import './shortcut-keys.js';
let mediaBindings=globalThis.__pnMediaKeys.defaults;
// Standalone UI demo only. The installed Chrome extension never imports this module.
import {engine} from './engine.mjs';
let saved=null,offset=18*60+23,base=Date.now(),epoch=0,paused=false,rate=1;
function snapshot(){return {tabId:1,documentId:'demo-document',frameId:0,videoId:'demo-video',mediaId:'demo-media',seekEpoch:epoch,time:offset+(paused?0:rate*(Date.now()-base)/1000),at:new Date().toISOString(),paused,ended:false,seeking:false,readyState:4,rate,duration:7200,seekable:[[0,7200]],page:'https://www.redbull.tv/demo',visible:true,area:100000};}
const dispatch=engine({read:async()=>saved,write:async s=>{saved=structuredClone(s)},uuid:()=>crypto.randomUUID(),catalog:async request=>{
 if(request.kind==='scouting-matches'){const names=[['Arturo Coello','Agustín Tapia','Franco Stupaczuk','Jon Sanz'],['Ariana Sánchez','Andrea Ustero','Paula Josemaría','Beatriz González'],['Demo player A','Demo player B','Demo player C','Demo player D']];return {tournaments:[{id:'demo-germany',name:'Germany P2 · Demo'}],matches:names.map((names,i)=>({id:'demo-match-'+i,tournamentId:'demo-germany',tournamentName:'Germany P2 · Demo',names,players:names.map((_,j)=>({country:i===2?null:[['ES','AR','AR','ES'],['ES','ES','ES','ES']][i][j],side:null})),category:i===1?'women':'men',round:'Demo match',scheduledAt:new Date().toISOString()})).filter(m=>!request.q||m.names.join(' ').toLowerCase().includes(request.q.toLowerCase()))};}
 if(request.kind==='search-players')return {players:[{id:'00000000-0000-0000-0000-000000000001',name:'Agustín Tapia',country:'AR'},{id:'00000000-0000-0000-0000-000000000002',name:'Arturo Coello',country:'ES'}].filter(p=>p.name.toLowerCase().includes(request.query.toLowerCase()))};
 if(request.kind==='create-manual'){const input=request.input;return {match:{id:input.id,kind:'manual',names:input.players.map(p=>p.name),players:input.players.map(()=>({})),playerIds:input.players.map((p,i)=>p.id??input.id.slice(0,-1)+i),matchDate:input.matchDate,tournamentName:input.tournamentLabel||'Private scouting',round:'Manually created',videoUrl:input.videoUrl}};}
 if(request.kind==='manual-matches')return {matches:saved?.manualMatches??[]};
 if(request.kind==='manual-session')return {session:null};
 return request.kind==='tournaments'?{tournaments:[{id:'demo-rotterdam',name:'Demo · Rotterdam P2'},{id:'demo-germany',name:'Demo · Germany P2'}],loadedAt:new Date().toISOString()}:{matches:[{id:request.tournamentId+'-men',tournamentId:request.tournamentId,names:['Arturo Coello','Agustín Tapia','Franco Stupaczuk','Jon Sanz'],players:[{country:'ES',ranking:1},{country:'AR',ranking:2},{country:'AR',ranking:5},{country:'ES',ranking:16}],category:'men',round:'Sample final · example rankings',status:'demo'},{id:request.tournamentId+'-women',tournamentId:request.tournamentId,names:['Ariana Sánchez','Andrea Ustero','Paula Josemaría','Beatriz González'],category:'women',round:'Sample final',status:'demo'}]};},discover:async()=>({tabId:1,url:'https://www.redbull.tv/demo',videos:[snapshot()]}),capture:async()=>snapshot(),setRate:async(_c,_s,value)=>{offset=snapshot().time;base=Date.now();rate=value;return snapshot()},playback:async(_c,_s,value)=>{offset=snapshot().time;base=Date.now();paused=value;},seek:async(_c,_s,time)=>{offset=time;base=Date.now();epoch++;}});
export async function send(message){if(message.type==='open-video-link')return {ok:false,error:'Video tabs are simulated in this demo. Use Connect video.'};if(message.type==='get-shortcuts')return {ok:true,bindings:mediaBindings};if(message.type==='set-shortcuts'){mediaBindings=globalThis.__pnMediaKeys.normalize(message.bindings);return {ok:true,bindings:mediaBindings};}if(message.type==='demo-pause'){offset=snapshot().time;base=Date.now();paused=!paused;return {ok:true};}if(message.type==='demo-rewind'){offset=Math.max(0,snapshot().time-10);base=Date.now();epoch++;return {ok:true};}try{return {ok:true,bindings:mediaBindings,...await dispatch(message)}}catch(error){return {ok:false,error:error.message}}}

// A ready-to-scout, isolated demo for reviewing the compact interface.
if(new URL(location.href).searchParams.has('focus')){
 await dispatch({type:'load-tournaments'});await dispatch({type:'load-matches',tournamentId:'demo-rotterdam'});
 await dispatch({type:'select-match',tournamentId:'demo-rotterdam',matchId:'demo-rotterdam-men'});
 await dispatch({type:'connect'});
 await dispatch({type:'starting-score',score:{completed:[{a:6,b:4}],games:{a:5,b:4},points:{a:30,b:40},server:0,near:'a',advantageReturns:2,elapsedSeconds:2536}});
}

// Finished-match fixture for reviewing the closing wizard; no server writes.
if(new URL(location.href).searchParams.has('finish')){
 await dispatch({type:'load-tournaments'});await dispatch({type:'load-matches',tournamentId:'demo-rotterdam'});
 await dispatch({type:'select-match',tournamentId:'demo-rotterdam',matchId:'demo-rotterdam-men'});
 await dispatch({type:'connect'});
 await dispatch({type:'starting-score',score:{completed:[{a:6,b:4}],games:{a:5,b:4},points:{a:40,b:0},server:0,near:'a',advantageReturns:0,elapsedSeconds:2536}});
 await dispatch({type:'start'});offset+=10;
 await dispatch({type:'prepare',player:0,outcome:'winner'});
 await dispatch({type:'score',details:{shot:'volley'}});
}
