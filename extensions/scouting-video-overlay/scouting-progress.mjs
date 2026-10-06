// Completeness of active observations, never an assessment of scout accuracy.
export function scoutingProgress(state){
 const rallies=state.rallies.filter(r=>r.point&&!r.undone);
 const strokes=rallies.filter(r=>['winner','unforced','forced'].includes(r.point.outcome));
 const detailed=strokes.filter(r=>!!r.point.shot).length;
 const forced=rallies.filter(r=>r.point.outcome==='forced');
 return {points:rallies.length,eligible:strokes.length,detailed,
  percent:strokes.length?Math.round(detailed/strokes.length*100):0,
  forced:forced.length,attributed:forced.filter(r=>r.point.forcedBy!==undefined).length,
  tracked:rallies.filter(r=>r.touches?.length>0).length};
}

export function progressUI($){
 return (state,cloud,model)=>{
  const card=$('scouting-progress');card.hidden=!state.selectedMatch;
  if(card.hidden)return;
  const p=scoutingProgress(state),saved=cloud.status==='saved';
  $('progress-count').textContent=p.eligible?`${p.detailed} / ${p.eligible} strokes`:p.points?'No strokes to tag':'No points yet';
  $('progress-bar').value=p.percent;
  $('progress-bar').setAttribute('aria-valuetext',p.eligible?`${p.detailed} of ${p.eligible} finishing strokes recorded`:'No eligible points recorded');
  const status=({saved:'Saved to server',pending:'Waiting for server',error:'Retry needed',conflict:'Needs attention',local:'Local copy'})[cloud.status]??'Local copy';
  $('progress-sync').textContent=status;card.dataset.sync=cloud.status??'local';
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
