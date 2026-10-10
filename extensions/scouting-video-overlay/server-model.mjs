import {validateStartingScore} from './starting-score.mjs';
// Shared by the extension and the operator API. No browser APIs or credentials.
import {validateSetup,validatePoint,match,validateSmashType} from './match.mjs';
import {finishRally} from './core.mjs';
const string=(v,max=160)=>{if(typeof v!=='string'||v.length>max)throw Error('Invalid scouting text.');return v;};
const at=v=>{string(v,40);if(!Number.isFinite(Date.parse(v)))throw Error('Invalid scouting timestamp.');return v;};
const player=v=>{if(!Number.isInteger(v)||v<0||v>3)throw Error('Invalid player.');return v;};
function snapshot(raw){
 if(!raw||typeof raw!=='object')throw Error('Invalid video snapshot.');
 const result={};
 for(const k of ['documentId','videoId','mediaId'])result[k]=string(raw[k],160);
 for(const k of ['tabId','seekEpoch','readyState']){if(!Number.isInteger(raw[k])||raw[k]<0)throw Error('Invalid video identity.');result[k]=raw[k];}
 if(!Number.isFinite(raw.time)||raw.time<0)throw Error('Invalid video time.');
 result.time=raw.time;result.at=at(raw.at);
 for(const k of ['paused','ended','seeking'])result[k]=Boolean(raw[k]);
 return result;
}
function rally(raw){
 if(!raw||typeof raw!=='object')throw Error('Invalid rally.');
 const result={id:string(raw.id,80),label:string(raw.label??''),start:snapshot(raw.start)};
 if(raw.varReviewed!==undefined){if(typeof raw.varReviewed!=='boolean')throw Error('Invalid VAR review flag.');if(raw.varReviewed)result.varReviewed=true;}
 if(raw.firstFault)result.firstFault=snapshot(raw.firstFault);
 if(raw.attempts){if(!Array.isArray(raw.attempts)||raw.attempts.length>100)throw Error('Too many smash attempts.');result.attempts=raw.attempts.map(a=>({player:player(a.player),snapshot:snapshot(a.snapshot),...(a.touchIndex!==undefined?{touchIndex:a.touchIndex}:{}),...(a.smashType!==undefined?{smashType:validateSmashType(a.smashType)}:{})}));}
 for(const s of [result.firstFault,...(result.attempts??[]).map(a=>a.snapshot)].filter(Boolean))finishRally(result,s);
 if(raw.touches!==undefined){
  if(!Array.isArray(raw.touches)||raw.touches.length>500)throw Error('Too many rally shots.');
  let previous=result.start.time;
  result.touches=raw.touches.map(t=>{
   if(!Array.isArray(t.order)||t.order.length!==4||new Set(t.order.map(player)).size!==4)throw Error('Invalid shot court positions.');
   const s=snapshot(t.snapshot);finishRally(result,s);
   if(s.time<previous||raw.end&&s.time>raw.end.time||raw.finish&&s.time>raw.finish.end.time)throw Error('Invalid shot sequence.');previous=s.time;
   return {player:player(t.player),order:[...t.order],snapshot:s};
  });
 }
 const linked=new Set();
 for(const a of result.attempts??[])if(a.touchIndex!==undefined){
  const t=result.touches?.[a.touchIndex];
  if(!Number.isInteger(a.touchIndex)||a.touchIndex<0||!t||t.player!==a.player||JSON.stringify(t.snapshot)!==JSON.stringify(a.snapshot)||linked.has(a.touchIndex))throw Error('Invalid smash shot link.');
  linked.add(a.touchIndex);
 }
 if(raw.end){const end=snapshot(raw.end);Object.assign(result,finishRally(result,end));}
 if(raw.undone){result.undone=true;result.undoneAt=at(raw.undoneAt);}
 if(raw.cancelledAt)result.cancelledAt=at(raw.cancelledAt);
 if(raw.finish){const end=snapshot(raw.finish.end);finishRally(result,end);result.finish={end,player:player(raw.finish.player),outcome:raw.finish.outcome};if(!['winner','unforced','forced'].includes(result.finish.outcome))throw Error('Invalid selected outcome.');}
 return result;
}
export function validateVideoState(raw){
 if(!raw||typeof raw!=='object'||raw.version!==1)throw Error('Invalid video scouting session.');
 if(!Array.isArray(raw.rallies)||raw.rallies.length>2000||!Array.isArray(raw.cancelled)||raw.cancelled.length>2000)throw Error('Session is too large.');
 const settings=raw.setup??{};
 const setup=validateSetup({names:settings.names,firstServer:settings.firstServer,otherServer:settings.otherServer,rule:settings.rule,startingScore:settings.startingScore,otherServerUnknown:settings.otherServerUnknown,onboardingComplete:settings.onboardingComplete});
 if(settings.near!==undefined){if(!['a','b'].includes(settings.near))throw Error('Invalid court end.');setup.near=settings.near;}
 if(settings.positions){if(typeof settings.positions.a!=='boolean'||typeof settings.positions.b!=='boolean')throw Error('Invalid court positions.');setup.positions={a:settings.positions.a,b:settings.positions.b};}
 let scoutingTime=null;if(raw.scoutingTime!=null){const c=raw.scoutingTime;if(!Number.isFinite(c.seconds)||c.seconds<0||c.seconds>31536000||typeof c.paused!=='boolean')throw Error('Invalid scouting time.');scoutingTime={seconds:c.seconds,paused:c.paused};}
 const ids=new Set();const rallies=raw.rallies.map(r=>{const next=rally(r);if(ids.has(next.id))throw Error('Duplicate rally.');ids.add(next.id);if(!next.end||next.finish)throw Error('A saved rally requires an end.');return next;});
 if(settings.adjustments){if(!Array.isArray(settings.adjustments)||settings.adjustments.length>2000)throw Error('Too many corrections.');setup.adjustments=settings.adjustments.map(a=>{if(!['server','ends','missed-point','score-correction'].includes(a.type)||a.afterId!==null&&!ids.has(a.afterId))throw Error('Invalid score correction.');if(a.type==='missed-point'&&!['a','b'].includes(a.team))throw Error('Invalid missed-point pair.');if(a.videoTime!==undefined&&(!Number.isFinite(a.videoTime)||a.videoTime<0))throw Error('Invalid correction video time.');return {type:a.type,...(a.type==='missed-point'?{team:a.team}:{}),...(a.type==='score-correction'?{score:validateStartingScore(a.score)}:{}),...(a.videoTime!==undefined?{videoTime:a.videoTime}:{}),...(a.type==='server'?{player:player(a.player)}:{}),afterId:a.afterId,at:at(a.at)};});}
 const result={version:1,...(scoutingTime?{scoutingTime}:{}),label:string(raw.label??''),setup,rallies:[],cancelled:raw.cancelled.map(r=>rally(r)),pending:raw.pending?rally(raw.pending):null};
 for(let i=0;i<rallies.length;i++){
  const r=rallies[i],original=raw.rallies[i];
  if(original.point){if(!r.undone&&(result.setup.otherServerUnknown===true&&Math.floor(match(result).server/2)!==Math.floor(result.setup.firstServer/2)))throw Error('Confirm the other server before recording their service game.');if(!r.undone&&match(result).score.phase==='finished')throw Error('Match has finished.');r.point=validatePoint(original.point,r,match(result).server);}
  result.rallies.push(r);
 }
 if(result.pending&&(ids.has(result.pending.id)||result.pending.end))throw Error('Invalid open rally.');
 return result;
}
export function videoPayload(state){return validateVideoState({version:1,label:state.label,setup:state.setup,rallies:state.rallies,cancelled:state.cancelled,pending:state.pending,scoutingTime:state.scoutingTime});}
export function videoSummary(payload){const m=match(payload);return {score:m.score,stats:m.stats,points:m.points,server:m.server};}
