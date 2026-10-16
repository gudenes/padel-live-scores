import type {TimelinePoint} from './tracking';
import {shots} from './shots';
export const endingFilters = {all:'All endings',winner:'Winners',unforced:'Unforced errors',forced:'Forced errors committed',created:'Forced errors created'};
export type EndingFilter = keyof typeof endingFilters;
export function shotDistribution(points:TimelinePoint[],outcome:EndingFilter){
 const rows=Array.from({length:4},()=>({total:0,counts:{} as Record<string,number>}));
 for(const p of points){
  if(!['winner','unforced','forced','double_fault'].includes(p.outcome))continue;
  if(outcome!=='all'&&p.outcome!==(outcome==='created'?'forced':outcome))continue;
  const player=outcome==='created'?p.forcedBy:p.player;
  if(player==null||!rows[player])continue;
  // The ending shot belongs to the defender, not the forced-error creator.
  const shot=outcome==='created'?(p.previousPlayer===player?p.previousShot:undefined):p.outcome==='double_fault'?'serve':p.shot;
  const key=shot&&shot in shots?shot:'unknown';
  rows[player].total++;rows[player].counts[key]=(rows[player].counts[key]??0)+1;
 }
 const keys=[...Object.keys(shots),'unknown'].filter(k=>rows.some(r=>r.counts[k]));
 return {rows,keys};
}
