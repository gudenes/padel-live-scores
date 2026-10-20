import {getDeuceRule,isStarPoint,type DeuceRule} from './scoring';
import type {TimelinePoint} from './tracking';

/** Count played deciding points from their pre-point score, never from the result alone. */
export function decidingPoints(points:TimelinePoint[],fallback?:DeuceRule){
 const rules=new Set(points.map(p=>getDeuceRule(p.before.config)));
 if(!rules.size&&fallback)rules.add(fallback);
 return (['golden-point','star-point'] as const).filter(rule=>rules.has(rule)).map(rule=>{
  const selected=points.filter(p=>getDeuceRule(p.before.config)===rule&&p.before.phase==='playing'&&
   (rule==='star-point'?isStarPoint(p.before):p.before.currentGame.a===40&&p.before.currentGame.b===40));
  return {rule,label:rule==='golden-point'?'Golden points':'Star points',total:selected.length,a:selected.filter(p=>p.winner==='a').length,b:selected.filter(p=>p.winner==='b').length};
 });
}
