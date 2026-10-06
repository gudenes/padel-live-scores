import {validateStartingScore} from './starting-score.mjs';
import {createInitialState,apply} from './generated/scoring.mjs';
import {shots} from './generated/shots.mjs';
export const defaults=()=>({names:['Player A1','Player A2','Player B1','Player B2'],firstServer:0,otherServer:2,rule:'star-point'});
const slots=[0,2,1,3];
export const pair=p=>p<2?'a':'b';
export function validateSetup(setup){
 if(!Array.isArray(setup.names)||setup.names.length!==4||setup.names.some(n=>typeof n!=='string'||!n.trim()||n.length>80))throw Error('Enter four player names (up to 80 characters).');
 if(!Number.isInteger(setup.firstServer)||setup.firstServer<0||setup.firstServer>3||!Number.isInteger(setup.otherServer)||setup.otherServer<0||setup.otherServer>3||pair(setup.firstServer)===pair(setup.otherServer))throw Error('Choose the first server and a server from the other pair.');
 if(!['star-point','golden-point','advantage'].includes(setup.rule))throw Error('Choose a supported scoring rule.');
 return {...setup,names:setup.names.map(n=>n.trim()),...(setup.startingScore?{startingScore:validateStartingScore(setup.startingScore)}:{})};
}
export function match(state){
 const setup=state.setup??defaults();
 let score=createInitialState({format:'bo3',goldenPoint:false,deuceRule:setup.rule,superTiebreak:false,setTiebreakAt:6});
 const first=slots[setup.firstServer],other=slots[setup.otherServer];
 score={...score,servingTeam:pair(setup.firstServer),servingPlayer:first,servingOrder:[first,other,(first+2)%4,(other+2)%4]};
 let near=setup.near??'a';
 if(setup.startingScore){const seed=validateStartingScore(setup.startingScore);score={...score,sets:[...seed.completed.map(s=>({...s})),{...seed.games}],currentGame:{...seed.points},phase:seed.games.a===6&&seed.games.b===6?'tiebreak':'playing',advantageReturns:seed.advantageReturns};score=apply(score,{kind:'set_server',team:pair(seed.server),player:seed.server%2});near=seed.near;}
 const adjust=afterId=>{for(const a of setup.adjustments??[]){if(a.afterId!==afterId)continue;if(a.type==='server')score=apply(score,{kind:'set_server',team:pair(a.player),player:a.player%2});else if(a.type==='ends')near=near==='a'?'b':'a';}};
 adjust(null);
 const stats=setup.names.map(()=>({winners:0,unforced:0,forced:0,doubleFaults:0,smashes:0,smashWinners:0,assists:0}));
 for(const rally of state.rallies){
  if(!rally.point||rally.undone){adjust(rally.id);continue;}
  const p=rally.point,s=stats[p.player];
  if(p.outcome==='double_fault')s.doubleFaults++;else if(p.outcome==='winner')s.winners++;else s[p.outcome]++;
  for(const attempt of rally.attempts??[])stats[attempt.player].smashes++;
  if(p.shot==='smash'){
   if(!p.smashAlreadyCounted)s.smashes++;
   if(p.outcome==='winner')s.smashWinners++;
  }
  if(p.assistBy!==undefined)stats[p.assistBy].assists++;
  const before=score;
  score=apply(score,{kind:'point_for',team:p.outcome==='winner'?pair(p.player):pair(p.player)==='a'?'b':'a'});
  if(changesEnds(before,score))near=near==='a'?'b':'a';
  adjust(rally.id);
 }
 return {score,stats,near,server:slots[score.servingPlayer],points:state.rallies.filter(r=>r.point&&!r.undone).length};
}
export function validatePoint(raw,pending,server){
 const p={player:raw.player,outcome:raw.outcome};
 if(!Number.isInteger(p.player)||p.player<0||p.player>3||!['winner','unforced','forced','double_fault'].includes(p.outcome))throw Error('Choose a player and outcome.');
 if(p.outcome==='double_fault'){
  if(!pending.firstFault||p.player!==server)throw Error('Record the first fault before a double fault.');
  return p;
 }
 if(raw.shot!==undefined){if(!Object.hasOwn(shots,raw.shot))throw Error('Invalid shot.');p.shot=raw.shot;}
 if(raw.side!==undefined){if(!['forehand','backhand'].includes(raw.side))throw Error('Invalid shot side.');p.side=raw.side;}
 for(const tag of ['recovery','smashRecovery'])if(raw[tag]){if(p.outcome!=='winner')throw Error('Recovery tags apply to winners.');p[tag]=true;}
 if(raw.assistBy!==undefined){if(p.outcome!=='winner'||raw.assistBy!==(p.player^1))throw Error('Assist must credit the winner’s partner.');p.assistBy=raw.assistBy;}
 if(raw.netCord!==undefined){if(!['lucky','unlucky'].includes(raw.netCord))throw Error('Invalid net cord tag.');p.netCord=raw.netCord;}
 if(raw.smashAlreadyCounted){if(p.shot!=='smash'||!pending.attempts?.some(a=>a.player===p.player))throw Error('No smash attempt to link for this player.');p.smashAlreadyCounted=true;}
 return p;
}

export function changesEnds(before,after){
 if(before.phase==='tiebreak'||before.phase==='super-tiebreak')return after.phase!==before.phase||(Number(after.currentGame.a)+Number(after.currentGame.b))%6===0;
 const i=before.sets.length-1,prev=before.sets[i],next=after.sets[i];
 return next.a+next.b!==prev.a+prev.b&&(next.a+next.b)%2===1;
}
