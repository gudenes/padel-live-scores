import {closingModel} from './closing-model.mjs';
export function closingUI({$,act,manual,onboarding,demo}){
 const dialog=$('closing-wizard');dialog.addEventListener('keydown',event=>event.stopPropagation());let current=null,busy=false,step=0;const seen=new Set();
 dialog.innerHTML=`<div class="section-head"><span class="eyebrow">MATCH COMPLETE</span><button class="ui-btn" data-variant="ghost" id="closing-close" aria-label="Close match wrap-up">Close</button></div>
 <nav class="wizard-steps" aria-label="Finish match steps"><button data-finish-step="0"><span class="wizard-step-number">1</span><span>Review</span></button><button data-finish-step="1"><span class="wizard-step-number">2</span><span>Save</span></button><button data-finish-step="2"><span class="wizard-step-number">3</span><span>Insights</span></button></nav>
 <section data-finish-page="0"><h2 id="closing-title">That’s a wrap.</h2><p class="hint">Check the final score before opening your report.</p><div class="closing-score"><strong id="closing-pair-a"></strong><span id="closing-score"></span><strong id="closing-pair-b"></strong></div><p id="closing-count" class="hint"></p><button class="ui-btn" data-variant="primary" id="closing-review">Score looks right</button><button class="ui-btn" data-variant="ghost" id="closing-correct">Back to scoring / Undo</button></section>
 <section data-finish-page="1" hidden><h2>Keep every point.</h2><p id="closing-sync-status" role="status"></p><p id="closing-sync-detail" class="hint"></p><button class="ui-btn" id="closing-sync">Sync now</button><button class="ui-btn" data-variant="ghost" id="closing-account">Account & sync help</button><button class="ui-btn" data-variant="ghost" id="closing-backup">Export local backup</button><button class="ui-btn" data-variant="primary" id="closing-next">Continue to insights</button></section>
 <section data-finish-page="2" hidden><h2>Your match, explained.</h2><p class="hint">Explore player impact, team comparisons and the breakdown by set in admin.</p><a class="ui-btn" data-variant="primary" id="closing-insights" target="_blank" rel="noopener noreferrer">Open insights in admin</a><p id="closing-insights-note" class="hint"></p><button class="ui-btn" data-variant="ghost" id="closing-new">Scout a new match</button></section>
 <button class="ui-btn" data-variant="ghost" id="closing-back">Back</button>`;
 function show(n){step=n;paint();}
 function open(){if(!current?.finished||busy)return;manual.close();seen.add(current.key);step=0;paint();if(!dialog.open)dialog.showModal();}
 function paint(){if(!current)return;
  for(const page of dialog.querySelectorAll('[data-finish-page]'))page.hidden=Number(page.dataset.finishPage)!==step;
  for(const button of dialog.querySelectorAll('[data-finish-step]')){const n=Number(button.dataset.finishStep);button.disabled=busy||n>step;button.setAttribute('aria-current',n===step?'step':'false');button.classList.toggle('complete',n<step);}
  $('closing-back').hidden=step===0;$('closing-back').disabled=busy;
  $('closing-sync').disabled=busy||current.saved;$('closing-review').disabled=busy;
  $('closing-next').disabled=busy||(!current.saved&&!demo);
  $('closing-next').textContent=demo?'Preview insights step':'Continue to insights';
  $('closing-insights').hidden=!demo&&(!current.saved||!current.reportUrl);$('closing-insights').setAttribute('aria-disabled',String(!current.saved));
  if(current.saved&&current.reportUrl)$('closing-insights').href=current.reportUrl;else $('closing-insights').removeAttribute('href');
  $('closing-insights-note').textContent=demo?'Demo preview only. A saved real match opens its own admin report.':'Your current scouting records are saved to the server. Reports cover the points you scouted.';
  $('closing-new').disabled=busy;
 }
 $('closing-close').onclick=$('closing-correct').onclick=()=>dialog.close();
 $('closing-review').onclick=()=>show(1);$('closing-next').onclick=()=>{if(current.saved||demo)show(2)};
 $('closing-back').onclick=()=>show(Math.max(0,step-1));
 for(const b of dialog.querySelectorAll('[data-finish-step]'))b.onclick=()=>show(Number(b.dataset.finishStep));
 $('closing-sync').onclick=()=>act({type:'sync-server'});
 $('closing-account').onclick=()=>{dialog.close();manual.open('account')};
 $('closing-backup').onclick=()=>$('export-backup').click();
 $('closing-new').onclick=()=>{dialog.close();onboarding.open()};
 $('finish-menu').removeAttribute('data-menu');$('finish-menu').onclick=open;
 $('open-closing-wizard').onclick=open;
 return function render(state,model,cloud,isBusy){busy=isBusy;current=closingModel(state,model.score,cloud,demo);
  $('open-closing-wizard').hidden=!current.finished;
  $('finish-menu').hidden=!current.finished;
  if(!current.finished){if(dialog.open)dialog.close();seen.clear();return}
  $('closing-pair-a').textContent=state.setup.names.slice(0,2).join(' / ');$('closing-pair-b').textContent=state.setup.names.slice(2).join(' / ');$('closing-score').textContent=current.score;
  $('closing-count').textContent=`${current.points} ${current.points===1?'point':'points'} scouted · Earlier imported scores are not observations.`;
  $('closing-sync-status').textContent=demo?'Demo · no server save':current.saved?'Saved to server':({conflict:'Sync needs attention',error:'Save failed · your local copy is safe',pending:'Waiting for server confirmation'})[cloud.status]??'Saved locally · server confirmation needed';
  $('closing-sync-detail').textContent=demo?'This preview does not upload match data.':cloud.error||(current.saved?`Last saved: ${cloud.savedAt?new Date(cloud.savedAt).toLocaleString():'confirmed'}`:'Use Sync now. If needed, open Account & sync help to sign in or resolve a conflict.');
  if(step===2&&!current.saved&&!demo)step=1;paint();
  if(!busy&&!seen.has(current.key)&&!onboarding.isOpen()&&!document.querySelector('dialog[open]'))open();
 };
}
