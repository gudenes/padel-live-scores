import {adminReportUrl} from './report-link.mjs';
export function closingModel(state,score,cloud,demo=false){
 const finished=score.phase==='finished'&&!state.pending;
 const points=state.rallies.filter(r=>r.point&&!r.undone);
 return {finished,key:finished?JSON.stringify([state.selectedMatch?.id,points.at(-1)?.id,score.sets]):null,
  saved:!demo&&cloud.status==='saved',demo,points:points.length,
  reportUrl:demo?null:adminReportUrl(state.selectedMatch),
  score:score.sets.map(s=>`${s.a}–${s.b}`).join(' · ')};
}
