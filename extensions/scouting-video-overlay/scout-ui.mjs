import {match,defaults} from './match.mjs';
import {scoreLabel} from './generated/score-label.mjs';
import {shots} from './generated/shots.mjs';
import {quickShots} from './shot-shortcuts.mjs';
import {finishRally} from './core.mjs';
export function scoutingUI({$,act,getState}){
 let setupKey='',playerKey='',openId='',shot,serverKey='';
 $('apply-server').onclick=()=>act({type:'server',player:Number($('current-server').value)});
 $('swap-ends').onclick=()=>act({type:'ends'});
 for(const seconds of [-30,-10,-5,5,10,30])$(`skip-${seconds}`).onclick=()=>act({type:'skip',seconds});
 const names=$('names');
 for(let i=0;i<4;i++){const label=document.createElement('label'),input=document.createElement('input');label.textContent=`${i<2?'Pair A':'Pair B'} · player ${i%2+1}`;input.id=`name-${i}`;input.required=true;input.maxLength=80;label.append(input);names.append(label);}
 $('setup-form').addEventListener('submit',e=>{e.preventDefault();act({type:'setup',setup:{names:[0,1,2,3].map(i=>$(`name-${i}`).value),firstServer:Number($('first-server').value),otherServer:Number($('other-server').value),rule:$('rule').value}})});
 for(const type of ['first-fault','double-fault','undo'])$(type).addEventListener('click',()=>act({type}));
 let quickSave=globalThis.localStorage?.getItem('pn-quick-save')!=='false';
 $('quick-save').checked=quickSave;
 function setQuick(value){quickSave=value;$('quick-save').checked=value;globalThis.localStorage?.setItem('pn-quick-save',String(value));}
 $('quick-save').addEventListener('change',()=>setQuick($('quick-save').checked));
 $('shot-details').addEventListener('toggle',()=>{if($('shot-details').open)setQuick(false)});
 function chooseShot(key){if($('save-point').disabled)return;shot=key;syncShot();if($('quick-save').checked)savePoint();}
 function shotButton(key,shortcut){
  const b=document.createElement('button');b.type='button';b.className='ui-btn';b.textContent=shots[key];b.dataset.shot=key;b.setAttribute('aria-pressed','false');
  if(shortcut){b.dataset.shortcut=shortcut;b.setAttribute('aria-keyshortcuts',shortcut);const kbd=document.createElement('kbd');kbd.textContent=shortcut.toUpperCase();b.append(kbd);}
  b.addEventListener('click',()=>chooseShot(key));return b;
 }
 const common=document.createElement('div');common.className='shot-grid';common.setAttribute('aria-label','Common shots');
 for(const [shortcut,key] of quickShots)common.append(shotButton(key,shortcut));
 const more=document.createElement('details'),summary=document.createElement('summary');summary.textContent='More shots';more.append(summary);
 const commonKeys=new Set(quickShots.map(([,key])=>key));
 const groups={'Overheads':['bajada','rulo','gancho'],'Net':['drop','block','half_volley'],'Ground & defence':['contrapared'],'Serve & other':['serve','other']};
 for(const [name,keys] of Object.entries(groups)){
  const section=document.createElement('section'),heading=document.createElement('h3'),grid=document.createElement('div');heading.textContent=name;grid.className='shot-grid';
  for(const key of keys.filter(key=>!commonKeys.has(key)))grid.append(shotButton(key));
  section.append(heading,grid);more.append(section);
 }
 $('shot-options').append(common,more);
 function syncShot(){for(const b of $('shot-options').querySelectorAll('button')){b.setAttribute('aria-pressed',String(b.dataset.shot===shot));b.dataset.variant=b.dataset.shot===shot?'primary':'default';}const p=getState()?.pending;const canLink=shot==='smash'&&p?.attempts?.some(a=>a.player===p.finish?.player);$('counted-label').hidden=!canLink;if(!canLink)$('counted').checked=false;}
 const cancel=()=>act({type:'clear-outcome'});
 $('dismiss-shot').addEventListener('click',cancel);
 $('shot-dialog').addEventListener('cancel',e=>{e.preventDefault();cancel()});
 function savePoint(){
  const p=getState()?.pending?.finish;if(!p||$('save-point').disabled)return;
  act({type:'score',details:{...(shot?{shot}:{}),...($('shot-side').value?{side:$('shot-side').value}:{}),...($('net').value?{netCord:$('net').value}:{}),...(p.outcome==='winner'?{...($('assist').checked?{assistBy:p.player^1}:{}),...($('outside').checked?{recovery:true}:{}),...($('smash-recovery').checked?{smashRecovery:true}:{})}:{}),...($('counted').checked?{smashAlreadyCounted:true}:{})}});
 }
 $('shot-form').addEventListener('submit',e=>{e.preventDefault();savePoint();});
 $('shot-form').addEventListener('keydown',e=>{
  if(e.repeat||e.isComposing||e.altKey)return;
  if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();savePoint();return;}
  if(e.ctrlKey||e.metaKey||e.target.closest('input,select,textarea,[contenteditable]'))return;
  const choice=[...$('shot-options').querySelectorAll('button')].find(b=>b.dataset.shortcut===e.key.toLowerCase());
  if(choice){e.preventDefault();if(!choice.disabled)choice.click();}
 });
 return function render(state,sample,busy,healthy){
  const setup=state.setup??defaults(),m=match(state),locked=!!state.pending||state.rallies.some(r=>r.point);
  const key=JSON.stringify(setup);
  if(key!==setupKey){setupKey=key;setup.names.forEach((n,i)=>{$(`name-${i}`).value=n});for(const id of ['first-server','other-server']){$(id).replaceChildren(...setup.names.map((n,i)=>{const o=document.createElement('option');o.value=i;o.textContent=n;return o;}));} $('first-server').value=setup.firstServer;$('other-server').value=setup.otherServer;$('rule').value=setup.rule;}
  for(const input of $('setup-form').elements)input.disabled=locked||busy;
  $('score').replaceChildren(...['a','b'].map((team,i)=>{const row=document.createElement('div'),name=document.createElement('span'),sets=document.createElement('em'),points=document.createElement('strong');row.className='score-row';name.textContent=setup.names.slice(i*2,i*2+2).join(' / ');sets.textContent=m.score.sets.map(s=>s[team]).join('  ');points.textContent=scoreLabel(m.score,team);row.append(name,sets,points);return row;}));
  $('server').textContent=m.score.phase==='finished'?`Match finished · Pair ${m.score.winner.toUpperCase()} wins`:`Serving: ${setup.names[m.server]} · ${m.points} points recorded`;
  let issue='';if(state.pending&&sample&&!state.pending.finish){try{finishRally(state.pending,sample)}catch(e){issue=e.message;}}
  const enabled=!!state.pending&&!state.pending.finish&&!busy&&healthy&&!sample?.seeking&&!issue;
  $('rally').textContent=state.pending?sample?.paused?'Rally paused with video':'Rally in progress':'Start rally';
  $('rally').disabled=busy||!healthy||!state.selectedMatch||!!state.pending||sample?.paused||sample?.seeking||m.score.phase==='finished';
  $('rally-status').textContent=issue|| (state.pending?state.pending.finish?'Outcome selected · save the shot details':`${Math.max(0,(sample?.time??state.pending.start.time)-state.pending.start.time).toFixed(1)}s video time · ${sample?.paused?'paused':'recording'}`:'Start at the first serve');
  $('first-fault').disabled=!enabled||!!state.pending?.firstFault;$('double-fault').disabled=!enabled||!state.pending?.firstFault;$('undo').disabled=busy||!!state.pending||!m.points;
  const sk=JSON.stringify([setup.names,m.server]);
  if(sk!==serverKey){serverKey=sk;$('current-server').replaceChildren(...setup.names.map((n,i)=>new Option(n,i)));$('current-server').value=m.server;}
  for(const id of ['current-server','apply-server','swap-ends'])$(id).disabled=busy||!!state.pending||!state.selectedMatch||m.score.phase==='finished';
  $('video-playback').disabled=busy||!healthy||!!sample?.seeking;
  $('video-playback').textContent=sample?.paused?'Play':'Pause';
  for(const seconds of [-30,-10,-5,5,10,30])$(`skip-${seconds}`).disabled=busy||!!state.pending||!healthy||!!sample?.seeking;
  $('court-ends').textContent=`Far end: Pair ${m.near==='a'?'B':'A'} · Near end: Pair ${m.near.toUpperCase()} · automatic changeovers`;
  const next=JSON.stringify([setup.names,m.server,m.stats,m.near]);
  if(next!==playerKey){playerKey=next;$('players').replaceChildren(...setup.names.map((name,i)=>{
   const card=document.createElement('article'),h=document.createElement('h3'),stats=document.createElement('small');card.className=`player-card${i===m.server?' serving':''}`;card.style.order=String((i<2?'a':'b')===m.near?i%2+2:i%2);card.setAttribute('aria-label',name);h.textContent=`${i===m.server?'● ':''}${name}`;const st=m.stats[i];stats.textContent=`${st.winners} W · ${st.unforced} UE · ${st.forced} FE · ${st.assists} assists`;
   card.append(h,stats);
   for(const [outcome,label] of [['winner','Winner'],['unforced','Unforced error'],['forced','Forced error'],['smash','Smash attempt +1']]){const b=document.createElement('button');b.className='ui-btn';b.dataset.variant=outcome==='winner'?'primary':'default';b.textContent=label;b.addEventListener('click',()=>act({type:outcome==='smash'?'smash':'prepare',player:i,outcome}));card.append(b);}return card;
  }));}
  for(const b of $('players').querySelectorAll('button'))b.disabled=!enabled;
  const pending=state.pending,finish=pending?.finish;
  if(finish){
   if(openId!==pending.id){openId=pending.id;shot=undefined;$('shot-form').reset();$('quick-save').checked=quickSave;$('shot-details').open=false;more.open=false;syncShot();$('shot-error').textContent='';}
   $('shot-title').textContent=`${setup.names[finish.player]} · ${finish.outcome.replace('_',' ')}`;$('winner-tags').hidden=finish.outcome!=='winner';$('save-point').disabled=busy;$('dismiss-shot').disabled=busy;
   for(const b of $('shot-options').querySelectorAll('button'))b.disabled=busy;
   if(!$('shot-dialog').open){$('shot-dialog').showModal();common.querySelector('button')?.focus();}
  }else{openId='';if($('shot-dialog').open)$('shot-dialog').close();}
 };
}
