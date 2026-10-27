export function syncLabel(cloud,points){
 const labels={local:'Saved on this device · not on server',pending:'Saved on this device · waiting to sync',syncing:'Syncing to server…',error:'Saved on this device · sync failed',conflict:'Sync conflict · review copies'};
 return cloud.status==='saved'?`${points} points saved to server`:labels[cloud.status]??labels.local;
}
export function syncUI({$,act}){
 let review=null,currentId=null,locked=false;
 const score=copy=>`${copy.points} points · ${copy.sets.map(s=>`${s.a}–${s.b}`).join(', ')} · ${copy.finished?'Finished':'In progress'}`;
 async function compare(){
  review=null;$('sync-comparison').hidden=true;$('sync-review-error').textContent='';
  const result=await act({type:'review-conflict'});
  if(result?.ok&&result.review.matchId===currentId){review=result.review;paint();}
  else if(!result?.ok)$('sync-review-error').textContent=result?.error??'Could not compare copies. Try again.';
 }
 function paint(){
  $('sync-comparison').hidden=!review;
  if(!review)return;
  $('sync-local-summary').textContent=score(review.local);
  $('sync-remote-summary').textContent=score(review.remote)+(review.remote.savedAt?' · Saved '+new Date(review.remote.savedAt).toLocaleString():'');
  $('sync-keep-local').disabled=locked;$('sync-use-server').disabled=locked;
 }
 async function choose(type){
  if(!review)return;
  const token=review.token;$('sync-review-error').textContent='';
  const result=await act({type,token});
  // A failed save requires a fresh comparison, including after another writer wins.
  review=null;paint();
  if(!result?.ok){$('sync-review').hidden=false;$('sync-review-error').textContent=result?.error??'Could not replace the copy. Review again.';}
 }
 $('sync-review').onclick=$('load-server').onclick=compare;
 $('sync-keep-local').onclick=()=>choose('keep-local');
 $('sync-use-server').onclick=()=>choose('load-server');
 $('sync-cancel-review').onclick=()=>{review=null;paint();};
 return (state,cloud,busy,points)=>{
  const id=state.selectedMatch?.id;if(id!==currentId){review=null;currentId=id;$('sync-review-error').textContent='';}
  locked=busy||!!state.pending;
  $('save-status-bar').hidden=!id;
  $('save-status-text').textContent=syncLabel(cloud,points);
  $('save-status-text').title=cloud.status==='saved'&&cloud.savedAt?'Confirmed '+new Date(cloud.savedAt).toLocaleString():cloud.error||'Your local records remain on this device until the server confirms.';
  $('save-status-details').textContent=cloud.status==='conflict'?'Resolve':'Details';
  $('sync-review').hidden=cloud.status!=='conflict';$('sync-review').disabled=locked;
  $('load-server').disabled=locked||!id;
  $('sync-server').textContent=cloud.status==='conflict'?'Recheck server copy':'Sync now';
  paint();
 };
}
