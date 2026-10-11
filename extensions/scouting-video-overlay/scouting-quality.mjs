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
/** Operational quality only. No inference of video-reviewed accuracy or missing-point totals. */
export function scoutingQuality({model,doc,checkpoint,officialSets}){
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
 const completeness=required?filled/required:0,consistency=checks?valid/checks:0;
 const score=points.length?Math.round(45*completeness+35*consistency+20*Number(reconciled)):null;
 const issues=[...(points.length>0&&points.length<10?['Provisional: fewer than 10 points observed']:[]),...(missingStroke?[`${missingStroke} points need a finishing stroke`]:[]),...(missingOpponent?[`${missingOpponent} errors need opponent attribution`]:[]),...(invalid?[`${invalid} consistency checks need attention`]:[]),...(!reconciled?[official?'Scouted final score differs from the official result':'Confirm the current score against the broadcast']:[])];
 return {version:'1',score,label:score===null?'Not rated':score>=90?'High':score>=70?'Medium':'Low',review:'Not reviewed',provisional:!reconciled||points.length<10,
  components:{completeness:Math.round(100*completeness),consistency:Math.round(100*consistency),reconciliation:reconciled?100:0},issues,
  coverage:{scouted:points.length,scoreOnly:timeline.filter(p=>p.outcome==='unclassified').length,unknownGap:doc.events.some(e=>e.kind==='score')},
  details:{previousStrokes:points.filter(p=>p.previousShot).length,errors:points.filter(p=>['forced','unforced'].includes(p.outcome)).length}};
}
