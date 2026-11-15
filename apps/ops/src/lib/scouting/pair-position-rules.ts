import {pairMetrics,positionAt,trailAt,type XY} from './tracking-overlay';
import type {TrackRow} from './movement-series';
export type PairRules={depthWarning:number;depthRed:number;spacingWarning:number;spacingRed:number};
export const DEFAULT_PAIR_RULES:PairRules={depthWarning:1.5,depthRed:3,spacingWarning:5,spacingRed:7};
export const PAIR_COLORS={green:'#60df91',yellow:'#ffd05a',red:'#ff7272',grey:'#a9b5bd'};
export type PairAssessment={level:keyof typeof PAIR_COLORS;reason:string;spacing?:number;depth?:number};
/** Experimental geometry screen, not a tactical verdict. Average 0.6s of uninterrupted observations. */
export function assessPair(rows:TrackRow[],time:number,keys:string[],rules:PairRules):PairAssessment{
 const unknown=(reason:string):PairAssessment=>({level:'grey',reason});
 if(keys.length!==2)return unknown('Select both teammates');
 for(const key of keys){const trail=trailAt(rows,time,key,.75);if(!trail.length||time-trail[0].time<.6-1e-6)return unknown('Waiting for 0.6s of continuous tracking');}
 const samples=[time-.6,time-.3,time].map(t=>keys.map(k=>positionAt(rows,t,k)));
 if(samples.some(ps=>ps.some(p=>!p)))return unknown('Tracking unavailable');
 const pairs=samples as XY[][];
 if(pairs.some(ps=>ps.some(p=>p[0]<0||p[0]>10||p[1]<0||p[1]>20)))return unknown('Outside-court recovery: not rated');
 if(pairs.some(([a,b])=>(a[1]-10)*(b[1]-10)<=0))return unknown('Court-side ambiguity: not rated');
 const metrics=pairs.map(([a,b])=>pairMetrics(a,b));
 const spacing=metrics.reduce((s,m)=>s+m.spacing,0)/3,depth=metrics.reduce((s,m)=>s+m.depth,0)/3;
 const red=depth>=rules.depthRed||spacing>=rules.spacingRed;
 const yellow=depth>=rules.depthWarning||spacing>=rules.spacingWarning||spacing<1.5;
 const level=red?'red':yellow?'yellow':'green';
 const reasons=[];
 if(depth>=(red?rules.depthRed:rules.depthWarning))reasons.push(`Depth ${depth.toFixed(1)} m ≥ ${red?rules.depthRed:rules.depthWarning} m`);
 if(spacing>=(red?rules.spacingRed:rules.spacingWarning))reasons.push(`Spacing ${spacing.toFixed(1)} m ≥ ${red?rules.spacingRed:rules.spacingWarning} m`);
 if(!red&&spacing<1.5)reasons.push(`Close pair: ${spacing.toFixed(1)} m < 1.5 m`);
 return {level,spacing,depth,reason:reasons.join(' · ')||`Within trial limits · spacing ${spacing.toFixed(1)} m · depth ${depth.toFixed(1)} m`};
}
