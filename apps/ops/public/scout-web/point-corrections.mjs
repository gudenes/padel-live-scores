import {match,validatePoint} from './match.mjs';
import {validateVideoState} from './server-model.mjs';
export const pointTeam=p=>Math.floor(p.player/2)^(p.outcome==='winner'?0:1);
export function correctPoint(state,message,now=Date.now){
 const index=state.rallies.findIndex(r=>r.id===message.rallyId&&!r.undone&&r.point);
 if(index<0)throw Error('This point is no longer available. Reopen the log.');
 const rally=state.rallies[index];
 if(JSON.stringify(message.expectedPoint)!==JSON.stringify(rally.point))throw Error('This point changed. Reopen it before editing.');
 const before=structuredClone(rally.point);
 const earlier={...state,pending:null,rallies:state.rallies.slice(0,index),setup:{...state.setup,adjustments:(state.setup.adjustments??[]).filter(a=>a.afterId===null||state.rallies.slice(0,index).some(r=>r.id===a.afterId))}};
 const after=validatePoint(message.point,rally,match(earlier).server);
 if(JSON.stringify(before)===JSON.stringify(after))return;
 if(pointTeam(before)!==pointTeam(after)){
  if(state.pending)throw Error('Finish or cancel the active rally before changing which team won a saved point.');
  if(!message.confirmScoreChange)throw Error('Confirm the score recalculation before saving.');
 }
 const next=structuredClone(state);
 const edited=next.rallies[index];edited.point=after;
 if((edited.corrections?.length??0)>=100)throw Error('This point has reached its correction history limit.');
 (edited.corrections??=[]).push({at:new Date(now()).toISOString(),before,after:structuredClone(after)});
 // Validate the entire replay, including later double faults and match completion.
 validateVideoState(next);
 state.rallies[index]=edited;
 // Keep existing undo snapshots from silently reverting a correction.
 for(const entry of state.history??[])for(const change of entry.rallies??[])if(change.value?.id===edited.id)change.value=structuredClone(edited);
}
