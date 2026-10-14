import {apply} from './scoring';
import type {TimelinePoint} from './tracking';
const result=(kind:string,label:string,reason:string)=>({kind,label,reason});
const scoreKey=(s:TimelinePoint['before'])=>JSON.stringify([s.phase,s.currentGame.a,s.currentGame.b,s.sets,s.advantageReturns??0]);
/** Score closeness, not physical intensity. Require a complete, continuous game. */
export function gameCloseness(points:TimelinePoint[]){
 const unknown=result('unknown','Not enough data','Incomplete game history');
 if(!points.length)return unknown;
 const first=points[0].before,last=points.at(-1)!;
 if(first.phase==='tiebreak'||first.phase==='super-tiebreak')return result('tiebreak','Tiebreak','Classified separately');
 if(first.currentGame.a!==0||first.currentGame.b!==0)return unknown;
 const set=first.sets.length-1;
 if(last.after.sets[set]?.a===first.sets[set].a&&last.after.sets[set]?.b===first.sets[set].b)return unknown;
 for(let i=0;i<points.length;i++){
  const p=points[i];
  if(i&&scoreKey(points[i-1].after)!==scoreKey(p.before))return unknown;
  if(scoreKey(apply(p.before,{kind:'point_for',team:p.winner}))!==scoreKey(p.after))return unknown;
 }
 if(points.some(p=>p.before.currentGame.a===40&&p.before.currentGame.b===40))return result('tight','Tight','Reached deuce');
 const lost=points.filter(p=>p.winner!==last.winner).length;
 if(lost<=1)return result('comfortable','Comfortable',lost===0?'Won to love':'Won to 15');
 if(lost===2)return result('contested','Contested','Won to 30');
 return unknown;
}
