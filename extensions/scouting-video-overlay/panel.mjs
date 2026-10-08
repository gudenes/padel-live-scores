import {adminReportUrl} from './report-link.mjs';
import {manualUI} from './manual-ui.mjs';
import {shortcutSettings} from './shortcut-settings.mjs';
import {mediaShortcuts} from './media-shortcuts.mjs';
import {catalogUI} from './catalog-ui.mjs';
import {scoutingUI} from './scout-ui.mjs';
import {match} from './match.mjs';
import {exported} from './core.mjs';
import {progressUI} from './scouting-progress.mjs';
const $=id=>document.getElementById(id);
const demo=new URL(location.href).searchParams.has('demo')&&!globalThis.chrome?.runtime?.id;
const transport=demo?(await import('./preview.mjs')).send:message=>chrome.runtime.sendMessage(message);
let state=null,sample=null,busy=false,healthy=false,lastList='',selection='',polling=false,revision=0,videoKey='',cloud={status:'local'},account={status:demo?'demo':'checking'},accountPoll=0,accountChecking=false;
const renderCatalog=catalogUI({$,act,getState:()=>state});
const renderScouting=scoutingUI({$,act,getState:()=>state});
const renderProgress=progressUI($);
const renderManual=manualUI({$,act,call,getState:()=>state});
function time(seconds){if(!Number.isFinite(seconds))return '—:—';const s=Math.floor(seconds);return `${Math.floor(s/3600)?`${Math.floor(s/3600)}:`:''}${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function render(){
  if(!state)return;
  const connection=state.connection;
  $('scouting-workspace').hidden=!state.selectedMatch;$('video-panel').hidden=!state.selectedMatch;$('empty-match-start').hidden=!!state.selectedMatch;

  $('account-status').textContent=({checking:'Checking account…',connected:account.email?'Connected · '+account.email:'Connected',offline:'Offline · saved locally','signed-out':'Sign in again · changes saved locally','not-authorized':'Operator account required','update-required':'Admin sign-in update required','signing-in':'Complete sign-in in the opened tab',demo:'Demo account'})[account.status]??'Sign in to Padel Nachos';
  $('header-account').dataset.status=account.status;
  $('header-account').title=$('account-status').textContent+' · Account and sync';
  $('header-account').setAttribute('aria-label',$('header-account').title);
  $('sign-in').hidden=['connected','demo'].includes(account.status);
  $('sign-in').disabled=busy;$('menu-account-status').textContent=$('account-status').textContent;$('menu-sign-in').hidden=$('sign-in').hidden;$('menu-sign-in').disabled=busy;

  const reportUrl=adminReportUrl(state.selectedMatch);$('open-admin-report').hidden=!reportUrl;
  if(reportUrl)$('open-admin-report').href=reportUrl;else $('open-admin-report').removeAttribute('href');
  $('report-link-note').textContent=reportUrl?'Report shows the latest server save. Sync local changes first.':'Choose a match to open its report.';
  $('match-identity').textContent=state.selectedMatch?[state.selectedMatch.tournamentName,state.selectedMatch.category,state.selectedMatch.round].filter(Boolean).join(' · '):'Select a match to begin';
  $('save-settings').dataset.sync=cloud.status;
  const recent=state.history?.at(-1),lastPoint=state.rallies.findLast(r=>r.point&&!r.undone),attempt=state.pending?.attempts?.at(-1);
  $('last-action').textContent=state.pending?.varReviewed?'VAR review · current point':recent?.type==='smash'&&attempt?`${state.setup.names[attempt.player]} · ${attempt.smashType==='x3'?'X3':attempt.smashType==='power'?'Power':attempt.smashType==='soft'?'Soft smash':'Smash'} attempt recorded`:lastPoint?`${state.setup.names[lastPoint.point.player]} · ${lastPoint.point.outcome.replace('_',' ')}${lastPoint.point.shot?' · '+lastPoint.point.shot:''}${lastPoint.point.smashType?' '+lastPoint.point.smashType:''}${lastPoint.point.x4?' · X4 winner':''}${lastPoint.varReviewed?' · VAR reviewed':''}`:'Ready to record';
  $('cloud-status').textContent=({local:'Local copy',pending:'Waiting to save',saved:'Saved to server',error:'Local copy · retry needed',conflict:'Needs attention'})[cloud.status]??'Local copy';
  const model=match(state),finished=model.score.phase==='finished';
  renderProgress(state,cloud,model);
  $('finish-status').textContent=finished?(cloud.status==='saved'?'Match finished · all current scouting records saved to server.':'Match finished · server confirmation still pending. Follow the steps below.'):'Still scouting · save every point through the end of the match.';
  if(finished)$('finish-guide').open=true;$('review-sync').hidden=!['error','conflict'].includes(cloud.status);$('finish-menu').hidden=!finished||!$('review-sync').hidden;
  $('cloud-message').textContent=cloud.error||(!state.selectedMatch?'Choose a match to enable server saves.':cloud.status==='saved'?`Last server save: ${cloud.savedAt?new Date(cloud.savedAt).toLocaleString():'confirmed'}`:'Changes stay on this device until the server confirms. Reconnection retries automatically.');
  $('export-backup').disabled=busy||!state.selectedMatch;
  $('sync-server').disabled=busy||!state.selectedMatch;$('load-server').disabled=busy||!state.selectedMatch||!!state.pending;
  const connectedKey=connection?.selected?.videoId??'';if(healthy&&connectedKey&&connectedKey!==videoKey){videoKey=connectedKey;$('video-panel').open=false;$('connection-settings').open=false;}
  $('status').textContent=healthy?'Connected':connection?'Check connection':'Not connected';
  $('source').textContent=connection?.page??'Open the match video in Chrome, then click this extension’s toolbar icon.';
  $('clock').textContent=time(sample?.time);
  $('video-speed').disabled=busy||!!state.pending||!healthy||!!sample?.seeking;
  const rate=sample?.rate??1;let custom=$('video-speed').querySelector('[data-custom-rate]');if(![1,2,4].includes(rate)){if(!custom){custom=document.createElement('option');custom.dataset.customRate='true';$('video-speed').append(custom)}custom.value=rate;custom.textContent=rate+'×';}else custom?.remove();$('video-speed').value=String(rate);
  $('speed-note').textContent=state.pending?`Rally active · ${sample?.rate??1}×`:sample?.rate>1?`Playing at ${sample.rate}× · Start rally returns to 1×`:'Start rally returns to 1×';
  $('playback').textContent=sample?`${sample.seeking?'Seeking':sample.paused?'Paused':'Playing'} · ${sample.rate}× · ${sample.duration===null?'live / duration unknown':'video'}`:'Waiting for the video';
  $('rally-status').textContent=state.pending?`Rally started at ${time(state.pending.start.time)}`:'Ready when you are';
  $('rally').textContent=state.pending?'End rally & save':'Start rally';
  $('rally').disabled=busy||!healthy||(!state.pending&&(sample?.paused||sample?.ended))||sample?.seeking;
  $('connect').disabled=busy||!!state.pending;
  $('cancel').hidden=!state.pending;$('cancel').disabled=busy;
  $('count').textContent=state.rallies.length;
  if(document.activeElement!==$('label'))$('label').value=state.label;
  const choices=connection?.candidates??[];
  $('player-label').hidden=choices.length<2;
  $('player').disabled=busy||!!state.pending;
  const nextSelection=choices.map(v=>v.videoId).join(',');
  if(selection!==nextSelection){
    selection=nextSelection;$('player').replaceChildren(...choices.map((v,i)=>{const o=document.createElement('option');o.value=v.videoId;o.textContent=`Player ${i+1} · ${v.visible?'visible':'hidden'} · ${time(v.time)}`;return o;}));
  }
  $('player').value=connection?.selected.videoId??'';
  const key=JSON.stringify([state.rallies.map(r=>[r.id,r.undone]),busy,!!state.pending,healthy]);
  if(key!==lastList){lastList=key;
    if(!state.rallies.length){const li=document.createElement('li');li.className='empty';li.textContent='Your first rally will appear here.';$('rallies').replaceChildren(li);}
    else $('rallies').replaceChildren(...state.rallies.slice().reverse().map((r,i)=>{
      const li=document.createElement('li'),info=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small'),button=document.createElement('button');
      title.textContent=`${r.undone?'Undone · ':''}Rally ${state.rallies.length-i} · ${r.videoSeconds.toFixed(1)}s`;if(r.point)title.textContent+=` · ${state.setup.names[r.point.player]} ${r.point.outcome.replace('_',' ')}`;
      meta.textContent=`${r.point?.shot?`${r.point.shot}${r.point.smashType?' '+r.point.smashType:''}${r.point.x4?' · X4 winner':''} · `:''}${r.varReviewed?'VAR reviewed · ':''}${time(r.start.time)} → ${time(r.end.time)}${r.label?` · ${r.label}`:''}`;
      button.className='ui-btn';button.dataset.size='sm';button.textContent='Replay';button.disabled=busy||!!state.pending||!healthy;
      button.addEventListener('click',()=>act({type:'replay',id:r.id}));
      info.append(title,meta);li.append(info,button);return li;
    }));
  }
  document.body.classList.toggle('scouting',!!state.selectedMatch);
  renderScouting(state,sample,busy,healthy);renderCatalog(state,busy);renderManual(state,busy);
}
async function call(message){const result=await transport(message);if(!result?.ok)throw Error(result?.error??'The companion is unavailable. Reopen its panel.');return result;}
async function refresh(){
  if(busy||polling)return;
  polling=true;const before=revision;
  if(!demo&&!accountChecking&&Date.now()-accountPoll>30000){accountPoll=Date.now();accountChecking=true;call({type:'account-status'}).then(result=>{account=result.auth??account;},()=>{account={status:'offline'};}).finally(()=>{accountChecking=false;render();});}
  try{const result=await call({type:'sample'});if(before!==revision||busy)return;state=result.state;cloud=result.sync??cloud;sample=result.sample;healthy=!!sample;}
  catch(error){if(before!==revision||busy)return;healthy=false;sample=null;$('message').textContent=error.message;}
  finally{polling=false;render();}
}
async function act(message){
  if(busy)return {ok:false,error:'Another action is being saved. Try again.'};let actionResult;if(message.type==='starting-score')$('seed-error').textContent='';const catalogAction=['load-tournaments','load-matches','clear-catalog','leave-match','select-match','create-manual','resume-session'].includes(message.type);if(catalogAction)$('catalog-feedback').textContent='';revision++;busy=true;if(message.type==='connect')$('connection-feedback').textContent='Connecting to the current video tab…';render();
  try{const result=await call({...message,...(message.type==='start'?{label:$('label').value}:{})});actionResult={ok:true};state=result.state;cloud=result.sync??cloud;if(message.type==='leave-match'){renderManual.find();$('catalog-feedback').textContent='Previous match saved on this device. Choose another match.';}if(message.type==='clear-catalog')$('catalog-feedback').textContent='Search cache cleared. Load tournaments to refresh the list.';if(message.type==='connect'){$('connection-feedback').textContent='Video connected. The clock below follows playback.';document.dispatchEvent(new Event('pn-video-connected'));}$('message').textContent=message.type==='end'?'Video timing saved on this device.':message.type==='cancel'?'Rally cancelled; its start remains in your export.':message.type==='undo-last'?'Last action undone.':'';}
  catch(error){actionResult={ok:false,error:error.message};$('message').textContent=error.message;if(message.type==='starting-score')$('seed-error').textContent=error.message;if(catalogAction){renderManual.open('setup');$('catalog-feedback').textContent=error.message;$('connection-settings').open=true;$('catalog-panel').open=true;}if(message.type==='connect'){renderManual.open('setup');$('connection-feedback').textContent=error.message;$('video-panel').open=true;$('connection-settings').open=true;}if($('shot-dialog').open)$('shot-error').textContent=error.message;}
  finally{busy=false;render();await refresh();}
  return actionResult;
}
$('export-backup').onclick=async()=>{try{const {state:current}=await call({type:'state'});const backup=exported(current);const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='scouting-local-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){$('message').textContent=error.message;}};
$('sign-in').onclick=async()=>{try{const result=await call({type:'sign-in'});account=result.auth;accountPoll=0;render();}catch(error){$('message').textContent=error.message;}};
$('sync-server').onclick=()=>act({type:'sync-server'});
$('load-server').onclick=()=>act({type:'load-server'});
$('video-playback').onclick=()=>act({type:'playback'});
function paintMediaKeys(bindings){for(const badge of document.querySelectorAll('[data-media-key]')){const binding=bindings[badge.dataset.mediaKey];badge.textContent=globalThis.__pnMediaKeys.label(binding);const control=badge.closest('button, label');control.title=globalThis.__pnMediaKeys.actions[badge.dataset.mediaKey]+' · '+badge.textContent;if(binding)control.setAttribute('aria-keyshortcuts',badge.textContent);else control.removeAttribute('aria-keyshortcuts');}}
const getBindings=shortcutSettings({$,send:transport,onChange:paintMediaKeys});
$('video-speed').onchange=()=>act({type:'speed',rate:Number($('video-speed').value)});
const cycleSpeed={get disabled(){return $('video-speed').disabled},click:()=>act({type:'cycle-speed'})};
mediaShortcuts({target:document,back:$('skip--10'),pause:$('video-playback'),forward:$('skip-30'),back5:$('skip--5'),forward5:$('skip-5'),forward10:$('skip-10'),speed:cycleSpeed,getBindings});
$('connect').addEventListener('click',()=>act({type:'connect'}));
$('player').addEventListener('change',()=>act({type:'select',videoId:$('player').value}));
$('rally').addEventListener('click',()=>act({type:'start'}));
$('cancel').addEventListener('click',()=>act({type:'cancel'}));
$('label').addEventListener('change',async()=>{
  revision++;
  try{await call({type:'label',label:$('label').value});}catch(error){$('message').textContent=error.message;}
});
document.addEventListener('keydown',event=>{
  if($('scouting-menu').open)return;
  if(event.code!=='Space'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.target.closest('input,textarea,select,button,summary,[contenteditable="true"]'))return;
  event.preventDefault();if(!$('rally').disabled)$('rally').click();
});
if(demo){$('demo-controls').hidden=false;$('demo-pause').onclick=async()=>{await transport({type:'demo-pause'});await refresh();$('demo-pause').textContent=sample?.paused?'Resume demo video':'Pause demo video';};$('demo-rewind').onclick=async()=>{await transport({type:'demo-rewind'});await refresh();};document.body.classList.add('demo');document.querySelector('h1').textContent='Match scouting · Demo';document.querySelector('.eyebrow span').textContent='SIMULATED PREVIEW';}
try{state=(await call({type:'state'})).state;render();await refresh();}catch(error){$('message').textContent=error.message;}
setInterval(refresh,1500);

$('show-overlay').onclick=()=>act({type:'show-overlay'});
