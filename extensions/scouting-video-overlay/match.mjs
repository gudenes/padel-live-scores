import {replay} from './generated/model.mjs';
import {pressure} from './generated/tracking.mjs';
import {validateStartingScore} from './starting-score.mjs';
import {createInitialState,apply} from './generated/scoring.mjs';
import {shots} from './generated/shots.mjs';
export const defaults=()=>({names:['Player A1','Player A2','Player B1','Player B2'],firstServer:0,otherServer:2,rule:'star-point'});
const slots=[0,2,1,3];
export const pair=p=>p<2?'a':'b';
export function validateSmashType(type){if(!['power','x3'].includes(type))throw Error('Choose Power or X3.');return type;}
export function validateSetup(setup){
 if(!Array.isArray(setup.names)||setup.names.length!==4||setup.names.some(n=>typeof n!=='string'||!n.trim()||n.length>80))throw Error('Enter four player names (up to 80 characters).');
 if(!Number.isInteger(setup.firstServer)||setup.firstServer<0||setup.firstServer>3||!Number.isInteger(setup.otherServer)||setup.otherServer<0||setup.otherServer>3||pair(setup.firstServer)===pair(setup.otherServer))throw Error('Choose the first server and a server from the other pair.');
 if(!['star-point','golden-point','advantage'].includes(setup.rule))throw Error('Choose a supported scoring rule.');
 return {...setup,names:setup.names.map(n=>n.trim()),...(setup.startingScore?{startingScore:validateStartingScore(setup.startingScore)}:{})};
}
export const videoAt=s=>new Date(Math.max(0,s.time)*1000).toISOString();
export function match(state){
 const setup=state.setup??defaults(),seed=setup.startingScore?validateStartingScore(setup.startingScore):null,events=[];
 const push=(id,kind,at,extra={})=>events.push({id,kind,at,...extra});
 const firstAt=videoAt(state.rallies.find(r=>r.point&&!r.undone)?.start??state.pending?.start??{time:0});
 if(seed)push('baseline','score',firstAt,{seed:{sets:[...seed.completed,seed.games],game:seed.points,phase:seed.games.a===6&&seed.games.b===6?'tiebreak':'playing',returns:seed.advantageReturns,server:seed.server}});
 for(const team of ['a','b'])if(setup.positions?.[team])push('position-'+team,'swap',firstAt,{team});
 const adjust=(afterId,at)=>{for(const [i,a] of (setup.adjustments??[]).entries())if(a.afterId===afterId)push('adjust-'+i,a.type==='server'?'server':'flip',at,a.type==='server'?{player:a.player}:{});};
 adjust(null,firstAt);
 const addRally=(r,complete)=>{
  const at=videoAt(r.start);push(r.id+'-start','rally_start',at);
  if(r.firstFault)push(r.id+'-fault','first_fault',videoAt(r.firstFault));
  for(const [i,a] of (r.attempts??[]).entries())push(r.id+'-smash-'+i,'smash',videoAt(a.snapshot),{player:a.player});
  if(!complete)return;
  const p=r.point,end=videoAt(r.end);
  if(p.outcome==='double_fault')push(r.id,'double_fault',end);
  else {const attempt=p.smashAttemptIndex??(r.attempts??[]).findLastIndex(a=>a.player===p.player);push(r.id,'point',end,{...p,smash:p.shot==='smash',...(p.smashAlreadyCounted?{smashAttemptId:r.id+'-smash-'+attempt}:{})});}
 };
 for(const r of state.rallies){if(r.point&&!r.undone)addRally(r,true);adjust(r.id,videoAt(r.end??r.start));}
 if(state.pending)addRally(state.pending,false);
 const m=replay({version:1,rule:setup.rule,firstServer:setup.firstServer,otherServer:setup.otherServer,near:seed?.near??setup.near??'a',events});
 const types=Array.from({length:4},()=>({powerSmashes:0,x3Smashes:0,x4Winners:0}));
 for(const r of [...state.rallies.filter(r=>!r.undone&&r.point),...(state.pending?[state.pending]:[])]){
  for(const a of r.attempts??[])if(a.smashType)types[a.player][a.smashType==='x3'?'x3Smashes':'powerSmashes']++;
  if(r.point?.shot==='smash'&&r.point.smashType&&!r.point.smashAlreadyCounted)types[r.point.player][r.point.smashType==='x3'?'x3Smashes':'powerSmashes']++;
  if(r.point?.x4)types[r.point.player].x4Winners++;
 }
 const stats=m.stats.map((s,i)=>({...s,...types[i],doubleFaults:m.tracking.service[i].doubleFaults}));
 return {...m,stats,situation:pressure(m.score),timeOffset:seed?.elapsedSeconds??null};
}
export function validatePoint(raw,pending,server){
 const p={player:raw.player,outcome:raw.outcome};
 if(!Number.isInteger(p.player)||p.player<0||p.player>3||!['winner','unforced','forced','double_fault'].includes(p.outcome))throw Error('Choose a player and outcome.');
 if(p.outcome==='double_fault'){
  if(!pending.firstFault||p.player!==server)throw Error('Record the first fault before a double fault.');
  return p;
 }
 if(raw.shot!==undefined){if(!Object.hasOwn(shots,raw.shot))throw Error('Invalid shot.');p.shot=raw.shot;}
 if(raw.smashType!==undefined){if(p.shot!=='smash')throw Error('Smash type applies only to smashes.');p.smashType=validateSmashType(raw.smashType);}
 if(raw.x4!==undefined){if(typeof raw.x4!=='boolean'||raw.x4&&(p.outcome!=='winner'||p.shot!=='smash'||p.smashType!=='power'))throw Error('X4 applies only to a Power smash winner.');if(raw.x4)p.x4=true;}
 if(raw.side!==undefined){if(!['forehand','backhand'].includes(raw.side))throw Error('Invalid shot side.');p.side=raw.side;}
 for(const tag of ['recovery','smashRecovery'])if(raw[tag]){if(p.outcome!=='winner')throw Error('Recovery tags apply to winners.');p[tag]=true;}
 if(raw.assistBy!==undefined){if(p.outcome!=='winner'||raw.assistBy!==(p.player^1))throw Error('Assist must credit the winner’s partner.');p.assistBy=raw.assistBy;}
 if(raw.netCord!==undefined){if(!['lucky','unlucky'].includes(raw.netCord))throw Error('Invalid net cord tag.');p.netCord=raw.netCord;}
 if(raw.smashAlreadyCounted){if(p.shot!=='smash'||!pending.attempts?.some(a=>a.player===p.player))throw Error('No smash attempt to link for this player.');p.smashAlreadyCounted=true;}
 if(raw.smashAttemptIndex!==undefined){const a=pending.attempts?.[raw.smashAttemptIndex];if(!Number.isInteger(raw.smashAttemptIndex)||!p.smashAlreadyCounted||!a||a.player!==p.player||p.smashType&&a.smashType!==p.smashType)throw Error('Choose a matching attempt in this rally.');p.smashAttemptIndex=raw.smashAttemptIndex;}
 else if(p.smashAlreadyCounted&&p.smashType){const index=pending.attempts.findLastIndex(a=>a.player===p.player&&a.smashType===p.smashType);if(index<0)throw Error('Choose a matching attempt in this rally.');p.smashAttemptIndex=index;}
 return p;
}

export function changesEnds(before,after){
 if(before.phase==='tiebreak'||before.phase==='super-tiebreak')return after.phase!==before.phase||(Number(after.currentGame.a)+Number(after.currentGame.b))%6===0;
 const i=before.sets.length-1,prev=before.sets[i],next=after.sets[i];
 return next.a+next.b!==prev.a+prev.b&&(next.a+next.b)%2===1;
}

// Camera-facing order reverses at each end change; playing roles stay fixed.
export function courtPlayers(state,m=match(state)){
 const initialNear=state.setup?.startingScore?.near??state.setup?.near??'a';
 const flipped=m.near!==initialNear;
 const order=team=>{const first=team==='a'?0:2,reverse=!!m.swapped[team]!==flipped;return reverse?[first+1,first]:[first,first+1];};
 return [...order(m.near==='a'?'b':'a'),...order(m.near)];
}
