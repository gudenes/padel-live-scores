import {shots} from './generated/shots.mjs';
const player=v=>Number.isInteger(v)&&v>=0&&v<4;
const opposite=(a,b)=>player(a)&&player(b)&&Math.floor(a/2)!==Math.floor(b/2);
export function qualityScoreKey(model){return JSON.stringify({sets:model.score.sets,game:model.score.currentGame,phase:model.score.phase,points:model.points,last:model.tracking.timeline.at(-1)?.id??null});}
export function qualityCheckpoint(model,at=new Date().toISOString()){return {version:1,key:qualityScoreKey(model),at};}
export function validateQualityCheckpoint(value){
 if(value==null)return undefined;
 if(value.version!==1||typeof value.key!=='string'||value.key.length>3000||!Number.isFinite(Date.parse(value.at)))throw Error('Invalid score confirmation.');
 return {version:1,key:value.key,at:value.at};
}

// Score whole rallies equally: one invalid transition makes that rally inconsistent.
export function rallySequenceQuality(points,rallies=[]){
 const active=new Map(rallies.filter(r=>r.point&&!r.undone).map(r=>[r.id,r]));
 const modes=new Set();let inferred=false,expert=0,eligible=0,assessed=0,consistent=0,transitions=0,validTransitions=0;
 const flagged=[];
 for(const p of points){
  const r=active.get(p.id),touches=r?.touches??[];
  const mode=r?.mode??(touches.length?'expert':'unknown');modes.add(mode);
  if(!r?.mode&&touches.length)inferred=true;
  if(mode!=='expert')continue;
  expert++;
  if(p.outcome==='double_fault')continue;
  eligible++;
  // A return error can legitimately end with only the receiver's tap.
  const singleReturn=touches.length===1&&['forced','unforced'].includes(p.outcome)&&p.shot==='return'&&touches[0].player===p.player;
  if(singleReturn){assessed++;consistent++;continue;}
  if(touches.length<2)continue;
  assessed++;let good=touches.every(t=>player(t.player)),failures=0;
  for(let i=1;i<touches.length;i++){
   transitions++;
   if(opposite(touches[i-1].player,touches[i].player))validTransitions++;
   else{good=false;failures++;}
  }
  if(good)consistent++;else flagged.push({id:p.id,number:p.number??points.indexOf(p)+1,invalidTransitions:failures});
 }
 const mode=modes.size===0?'Unknown':modes.size>1?'Mixed':({pro:'Pro',expert:'Expert',unknown:'Unknown'})[[...modes][0]];
 return {mode,inferred,expert,eligible,assessed,consistent,missing:eligible-assessed,transitions,invalidTransitions:transitions-validTransitions,
  percent:eligible?100*consistent/eligible:null,transitionPercent:transitions?100*validTransitions/transitions:null,flagged};
}

/** Operational quality only. No inference of video-reviewed accuracy or missing-point totals. */
export function scoutingQuality({model,doc,checkpoint,officialSets,rallies=[]}){
 const timeline=model.tracking.timeline,points=timeline.filter(p=>p.outcome!=='unclassified');
 let filled=0,required=0,valid=0,checks=0,missingStroke=0,missingOpponent=0,invalid=0;
 const check=value=>{checks++;if(value)valid++;else invalid++;};
 const ids=new Set();
 for(const p of points){
  const error=['forced','unforced'].includes(p.outcome),previous=p.previousPlayer??p.forcedBy;
  const fields=[player(p.player),['winner','forced','unforced','double_fault'].includes(p.outcome)];
  if(p.outcome!=='double_fault'&&!p.smashRecovery){const has=typeof p.shot==='string'&&Object.hasOwn(shots,p.shot);fields.push(has);if(!has)missingStroke++;}
  if(error){const has=opposite(p.player,previous);fields.push(has);if(!has)missingOpponent++;}
  required+=fields.length;filled+=fields.filter(Boolean).length;
  check(!ids.has(p.id));ids.add(p.id);
  check(Number.isFinite(Date.parse(p.at)));
  check(player(p.player));
  check(['winner','forced','unforced','double_fault'].includes(p.outcome));
  if(player(p.player))check(p.winner===(p.outcome==='winner'?(p.player<2?'a':'b'):(p.player<2?'b':'a')));
  if(p.shot!==undefined)check(Object.hasOwn(shots,p.shot));
  if(previous!==undefined)check(error&&opposite(p.player,previous));
  if(p.forcedBy!==undefined)check(p.outcome==='forced'&&opposite(p.player,p.forcedBy)&&(p.previousPlayer===undefined||p.previousPlayer===p.forcedBy));
  if(p.assistBy!==undefined)check(p.outcome==='winner'&&p.assistBy===(p.player^1));
  if(p.rallyStartedAt!==null&&p.rallyStartedAt!==undefined)check(Number.isFinite(p.durationMs)&&p.durationMs>=0);
 }
 const official=Array.isArray(officialSets)&&officialSets.length>0&&model.score.phase==='finished';
 const reconciled=official?JSON.stringify(officialSets.map(s=>({a:s.a,b:s.b})))===JSON.stringify(model.score.sets.map(s=>({a:s.a,b:s.b}))):checkpoint?.key===qualityScoreKey(model);
 const sequences=rallySequenceQuality(points,rallies);
 const completeness=required?filled/required:0,recordConsistency=checks?valid/checks:0;
 const expertShare=points.length?sequences.eligible/points.length:0;
 const consistency=recordConsistency*(1-expertShare/2)+(sequences.percent??0)/100*expertShare/2;
 const score=points.length?Math.round(10*(45*completeness+35*consistency+20*Number(reconciled)))/10:null;
 const issues=[...(points.length>0&&points.length<10?['Provisional: fewer than 10 points observed']:[]),...(missingStroke?[`${missingStroke} points need a finishing stroke`]:[]),...(missingOpponent?[`${missingOpponent} errors need opponent attribution`]:[]),...(invalid?[`${invalid} consistency checks need attention`]:[]),...(sequences.flagged.length?[`${sequences.flagged.length} Expert rallies contain same-team or invalid-player transitions`]:[]),...(sequences.missing?[`${sequences.missing} Expert rallies lack enough taps to assess`]:[]),...(!reconciled?[official?'Scouted final score differs from the official result':'Confirm the current score against the broadcast']:[])];
 return {version:'1.1',mode:sequences.mode,modeInferred:sequences.inferred,sequences,score,label:score===null?'Not rated':score>=90?'High':score>=70?'Medium':'Low',review:'Not reviewed',provisional:!reconciled||points.length<10||sequences.missing>0,
  components:{completeness:Math.round(1000*completeness)/10,consistency:Math.round(1000*consistency)/10,recordConsistency:Math.round(1000*recordConsistency)/10,sequenceConsistency:sequences.percent===null?null:Math.round(sequences.percent*10)/10,reconciliation:reconciled?100:0},issues,
  coverage:{scouted:points.length,scoreOnly:timeline.filter(p=>p.outcome==='unclassified').length,unknownGap:doc.events.some(e=>e.kind==='score')},
  details:{previousStrokes:points.filter(p=>p.previousShot).length,errors:points.filter(p=>['forced','unforced'].includes(p.outcome)).length}};
}
