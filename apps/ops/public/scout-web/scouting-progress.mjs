import {scoutingQuality} from './scouting-quality.mjs';
// Completeness of active observations, never an assessment of scout accuracy.
export function scoutingProgress(state){
 const rallies=state.rallies.filter(r=>r.point&&!r.undone);
 const strokes=rallies.filter(r=>['winner','unforced','forced'].includes(r.point.outcome)&&!(r.point.outcome==='winner'&&r.point.smashRecovery));
 const detailed=strokes.filter(r=>!!r.point.shot).length;
 const forced=rallies.filter(r=>r.point.outcome==='forced');
 return {points:rallies.length,eligible:strokes.length,detailed,
  percent:strokes.length?Math.round(detailed/strokes.length*100):0,
  forced:forced.length,attributed:forced.filter(r=>r.point.forcedBy!==undefined).length,
  tracked:rallies.filter(r=>r.touches?.length>0).length};
}

export function progressUI($,act){
 if(act)$('quality-confirm').onclick=()=>act({type:'confirm-quality-score'});
 return (state,cloud,model)=>{
  const card=$('scouting-progress');card.hidden=!state.selectedMatch;$('progress-bar').hidden=card.hidden;
  if(card.hidden)return;
  const p=scoutingProgress(state),saved=cloud.status==='saved';
  const quality=scoutingQuality({model,doc:{events:[...(state.setup?.startingScore?[{kind:'score'}]:[]),...(state.setup?.adjustments??[]).filter(a=>a.type==='score-correction').map(()=>({kind:'score'}))]},checkpoint:state.setup?.qualityCheckpoint,rallies:state.rallies});
  $('quality-label').textContent=quality.score===null?'Not rated':`${['Unknown','Pro'].includes(quality.mode)?'':quality.mode+' · '}${quality.label} · ${quality.score}/100${quality.provisional?' · Provisional':''}`;
  $('quality-label').dataset.quality=quality.label.toLowerCase();
  $('quality-breakdown').textContent=`Complete records ${quality.components.completeness}% · Consistency ${quality.components.consistency}% · Score checked ${quality.components.reconciliation}%`;
  $('quality-sequences').textContent=quality.sequences.eligible?`Expert sequences: ${quality.sequences.consistent}/${quality.sequences.eligible} consistent rallies · ${quality.components.sequenceConsistency}%${quality.modeInferred?' · mode inferred from taps':''}. ${quality.sequences.invalidTransitions} invalid transitions; ${quality.sequences.missing} rallies need more taps.${quality.sequences.flagged.length?' Review points '+quality.sequences.flagged.slice(0,8).map(p=>p.number).join(', ')+(quality.sequences.flagged.length>8?'…':''):''}`:'No Expert sequences to assess; record checks only.';
  $('quality-coverage').textContent=`${quality.coverage.scouted} ${quality.coverage.scouted===1?'point':'points'} scouted · ${quality.coverage.scoreOnly} score-only points${quality.coverage.unknownGap?' · Partial coverage: gap size unknown':''}`;
  $('quality-issues').replaceChildren(...quality.issues.map(text=>{const li=$('quality-issues').ownerDocument.createElement('li');li.textContent=text;return li;}));
  $('quality-confirm').disabled=!!state.pending||!quality.coverage.scouted;
  $('quality-confirm').textContent=quality.components.reconciliation?'Score confirmed':'Score matches the broadcast';

  $('progress-count').textContent=p.eligible?`${p.detailed} / ${p.eligible} strokes`:p.points?'No strokes to tag':'No points yet';
  $('progress-bar').value=quality.score??0;
  $('progress-bar').setAttribute('aria-valuetext',quality.score===null?'Scouting quality not rated':`${quality.label}: ${quality.score} out of 100${quality.provisional?', provisional':''}`);
  const status=({saved:'Saved to server',pending:'Waiting for server',error:'Retry needed',conflict:'Needs attention',local:'Local copy'})[cloud.status]??'Local copy';
  $('progress-sync').textContent=status;card.dataset.sync=cloud.status??'local';
  $('progress-bar').title=`Scouting quality · ${quality.label}${quality.score===null?'':' · '+quality.score+'/100'}${quality.provisional?' · Provisional':''} · ${status}`;
  $('progress-strokes').textContent=`${p.detailed} / ${p.eligible}`;
  $('progress-attribution').textContent=p.forced?`${p.attributed} / ${p.forced}`:'No forced errors yet';
  $('progress-tracked').textContent=`${p.tracked} / ${p.points}`;
  $('progress-save-detail').textContent=saved?`All ${p.points} recorded points saved to server${cloud.savedAt?' · '+new Date(cloud.savedAt).toLocaleString():''}`:cloud.error||'Your local records remain on this device until the server confirms the save.';
  const firstSet=model.tracking.timeline.some(t=>t.after.sets.length>t.before.sets.length||t.after.phase==='finished');
  const milestone=model.score.phase==='finished'?(saved?'Match completed and synced':'Match completed · sync pending'):firstSet?'First observed set finished':[100,50,20].find(n=>p.points>=n);
  $('progress-milestone').hidden=!milestone;
  $('progress-milestone').textContent=typeof milestone==='number'?`${milestone} points recorded`:milestone||'';
 };
}
