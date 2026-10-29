// Timings only: no video URLs, player names, match data or account details.
export function saveDiagnostics(document){
 const rows=[],details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('pre'),button=document.createElement('button');
 details.className='hint';details.style.cssText='margin:8px 12px;padding:8px;border:1px solid #d9dfcf;border-radius:8px';
 summary.textContent='Save timing · waiting for an action';list.style.cssText='white-space:pre-wrap;font:11px/1.6 monospace';
 button.type='button';button.className='ui-btn';button.dataset.variant='ghost';button.textContent='Download timings';
 button.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({version:globalThis.chrome?.runtime?.getManifest?.().version??'preview',measurements:rows},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='scouting-save-timings.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 details.append(summary,list,button);document.querySelector('.scout-header').after(details);
 const ms=n=>Math.round(n??0)+' ms';
 return row=>{
  rows.push({...row,at:new Date().toISOString()});if(rows.length>50)rows.shift();
  summary.textContent=`${row.action} · ${ms(row.totalMs)} total · ${ms(row.writeMs)} local write${row.ok?'':' · failed'}`;
  list.textContent=rows.slice(-6).map(r=>`${r.action}: ${ms(r.totalMs)} total\n  Worker queue ${ms(r.queueMs)} · read ${ms(r.readMs)} · video ${ms(r.videoMs)}\n  Encode ${ms(r.encodeMs)} · Chrome write ${ms(r.storageSetMs)} · cache copy ${ms(r.cacheCloneMs)}\n  Storage queue ${ms(r.storageQueueMs)} · changed data ${Math.round((r.changedChars??0)/1024)}K chars / total ${Math.round((r.totalStateChars??0)/1024)}K\n  Local write ${ms(r.writeMs)} · worker total ${ms(r.engineMs)}\n  Shortcuts ${ms(r.bindingsMs)} · sync status ${ms(r.syncStatusMs)} · response preparation ${ms(r.postEngineMs)}\n  Message round trip ${ms(r.transportMs)} · screen rendering ${ms(r.renderMs)}\n  Action completed ${ms(r.actionMs)} · next frame ${ms(r.totalMs-r.actionMs)}`).join('\n\n');
 };
}
