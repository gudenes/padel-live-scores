import {match} from './match.mjs';
import {shots} from './generated/shots.mjs';
import {scoreLabel} from './generated/score-label.mjs';
import {pointTeam} from './point-corrections.mjs';
const outcomes={winner:'Winner',unforced:'Unforced error',forced:'Forced error',double_fault:'Double fault'};
export function scoutingLog({act,getState}){
 const trigger=document.createElement('button');trigger.type='button';trigger.className='ui-btn';trigger.textContent='Scouting log';trigger.title='Review and correct saved points';trigger.setAttribute('aria-haspopup','dialog');
 document.querySelector('.header-actions').prepend(trigger);
 const style=document.createElement('link');style.rel='stylesheet';style.href=new URL('./scouting-log.css',import.meta.url).href;document.head.append(style);
 const dialog=document.createElement('dialog');dialog.className='scouting-log';dialog.setAttribute('aria-label','Scouting log');
 dialog.innerHTML=`<div class="section-head"><h2>Scouting log</h2><button type="button" class="ui-btn" data-close>Close</button></div><p class="hint">Review saved points. Your active rally stays open.</p><div data-list></div><form hidden data-edit><button type="button" class="ui-btn" data-back>← All points</button><h3 data-title></h3><div class="log-fields"><label>Player<select name="player"></select></label><label>Outcome<select name="outcome"></select></label><label>Shot<select name="shot"></select></label><label>Smash type<select name="smashType"><option value="">Not recorded</option><option value="power">Power</option><option value="x3">X3</option><option value="soft">Soft</option></select></label><label>Assist<select name="assistBy"></select></label><label>Forced-error creator<select name="forcedBy"></select></label></div><p class="hint">Other compatible tags and recorded rally touches are retained. Changing the player or outcome clears incompatible credits.</p><p data-preview></p><label class="checkbox-label" data-confirm hidden><input type="checkbox" name="confirm">Recalculate the score and following points</label><button class="ui-btn" data-variant="primary" type="submit">Save correction</button><details><summary>Correction history</summary><div data-history></div></details></form><p role="status" data-status></p>`;
 document.body.append(dialog);
 const q=s=>dialog.querySelector(s),form=q('form'),field=n=>form.elements.namedItem(n);
 let selected=null,original=null,busy=false,lastListKey="";
 const label=p=>`${getState().setup.names[p.player]} · ${outcomes[p.outcome]}${p.shot?' · '+shots[p.shot]:''}${p.smashType?' · '+p.smashType:''}`;
 const option=(value,text)=>new Option(text,value);
 for(const [value,text] of Object.entries(outcomes))field('outcome').add(option(value,text));
 field('shot').add(option('','Not recorded'));for(const [value,text] of Object.entries(shots))field('shot').add(option(value,text));
 function list(){
  selected=null;form.hidden=true;q('[data-list]').hidden=false;q('[data-list]').replaceChildren();
  const state=getState();if(!state)return;lastListKey=JSON.stringify([state.setup,state.rallies]);
  const entries=[];const prefix={...state,pending:null,rallies:[],setup:{...state.setup,adjustments:(state.setup.adjustments??[]).filter(a=>a.afterId===null)}};
  for(const r of state.rallies){
   if(r.point&&!r.undone){const m=match(prefix);entries.push({r,caption:`Point ${entries.length+1} · Set ${m.score.sets.length} · ${scoreLabel(m.score,'a')}–${scoreLabel(m.score,'b')}`});}
   prefix.rallies.push(r);prefix.setup.adjustments.push(...(state.setup.adjustments??[]).filter(a=>a.afterId===r.id));
  }
  for(const {r,caption} of entries.reverse()){
   const b=document.createElement('button');b.type='button';b.className='ui-btn log-entry';const title=document.createElement('strong'),info=document.createElement('span'),hint=document.createElement('small');title.textContent=caption;info.textContent=label(r.point);hint.textContent=`${r.touches?.length??0} recorded touches · ${r.corrections?.length??0} corrections · Edit →`;b.append(title,info,hint);b.onclick=()=>edit(r,caption);q('[data-list]').append(b);
  }
  if(!entries.length)q('[data-list]').textContent='No saved points yet. Record a point and it will appear here.';
 }
 function edit(r,caption){
  selected=r.id;original=structuredClone(r.point);q('[data-status]').textContent='';q('[data-list]').hidden=true;form.hidden=false;q('[data-title]').textContent=caption;
  for(const name of ['player','assistBy','forcedBy']){field(name).replaceChildren();if(name!=='player')field(name).add(option('','None / not recorded'));getState().setup.names.forEach((n,i)=>field(name).add(option(String(i),n)));}
  for(const name of ['player','outcome','shot','smashType','assistBy','forcedBy'])field(name).value=String(original[name]??'');field('confirm').checked=false;
  q('[data-history]').replaceChildren();
  for(const c of [...(r.corrections??[])].reverse()){const row=document.createElement('div'),text=document.createElement('p'),restore=document.createElement('button');text.textContent=`${new Date(c.at).toLocaleString()} · ${label(c.before)} → ${label(c.after)}`;restore.type='button';restore.className='ui-btn';restore.textContent='Restore this previous version';restore.onclick=()=>save(c.before);row.append(text,restore);q('[data-history]').append(row);}
  if(!r.corrections?.length)q('[data-history]').textContent='No corrections yet.';preview();
 }
 function point(){
  const p={...original,player:Number(field('player').value),outcome:field('outcome').value};
  for(const key of ['shot','smashType','assistBy','forcedBy']){delete p[key];const value=field(key).value;if(value!=='')p[key]=key.endsWith('By')?Number(value):value;}
  if(p.player!==original.player||p.outcome!==original.outcome){for(const key of ['previousPlayer','previousShot','smashAlreadyCounted','smashAttemptIndex','smashRecovery','recovery','x4'])delete p[key];}
  if(p.shot!=='smash'){for(const key of ['smashType','smashAlreadyCounted','smashAttemptIndex','x4'])delete p[key];}
  if(p.forcedBy!==original.forcedBy){delete p.previousPlayer;delete p.previousShot;}
  if(p.outcome!=='winner'){delete p.assistBy;delete p.recovery;delete p.smashRecovery;delete p.x4;}
  if(p.outcome!=='forced')delete p.forcedBy;
  return p;
 }
 function preview(){const p=point();q('[data-preview]').textContent=`${label(original)} → ${label(p)}`;q('[data-confirm]').hidden=pointTeam(p)===pointTeam(original);field('shot').disabled=p.outcome==='double_fault';field('smashType').disabled=p.shot!=='smash'||!!original.smashAlreadyCounted;field('smashType').title=original.smashAlreadyCounted?'Type belongs to a recorded smash attempt. Rally-touch editing is not available in this version.':'';field('assistBy').disabled=p.outcome!=='winner';field('forcedBy').disabled=p.outcome!=='forced';}
 form.addEventListener('change',e=>{if(['player','outcome'].includes(e.target.name)){field('assistBy').value='';field('forcedBy').value='';}preview()});
 async function save(p){
  if(busy)return;
  const changed=pointTeam(p)!==pointTeam(original);
  if(changed&&!field('confirm').checked){q('[data-confirm]').hidden=false;q('[data-status]').textContent='This changes who won the point. Confirm the recalculation first.';return;}
  busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const result=await act({type:'edit-point',rallyId:selected,expectedPoint:original,point:p,confirmScoreChange:changed});if(!result?.ok)throw Error(result?.error??'Could not save correction.');list();q('[data-status]').textContent='Correction saved. Score and statistics updated.';}catch(e){q('[data-status]').textContent=e.message;}finally{busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
 }
 form.onsubmit=e=>{e.preventDefault();save(point())};q('[data-back]').onclick=list;q('[data-close]').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>trigger.focus());trigger.onclick=()=>{q('[data-status]').textContent='';list();dialog.showModal()};
 // Keep scouting shortcuts from firing while browsing or editing the log.
 document.addEventListener('keydown',e=>{if(dialog.open)e.stopImmediatePropagation()},true);
 return ()=>{trigger.disabled=!getState()?.selectedMatch;if(dialog.open&&!selected&&!busy&&lastListKey!==JSON.stringify([getState()?.setup,getState()?.rallies]))list()};
}
