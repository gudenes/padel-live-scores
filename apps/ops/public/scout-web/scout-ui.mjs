import {liveStats} from './live-stats.mjs';
import {preferences} from './practice-mode.mjs';
import {previousTapOpponent,firstTapReturn,suggestedAssist,finalSmashAttempt,recoverySmashAttempt} from './tap-selection.mjs';
import {scoreCorrectionUI} from './score-correction-ui.mjs';
import {scoutingKeys} from './scouting-keys.mjs?v=smash-home-insert';
import {needsServerConfirmation} from './onboarding-model.mjs';
import './shortcut-keys.js';
import {playerProfile,playerIdentity} from './player-profile.mjs';
import {match,defaults,courtPlayers} from './match.mjs';
import {scoreLabel} from './generated/score-label.mjs';
import {shots} from './generated/shots.mjs';
import {playerShortcuts,positionKeys} from './player-shortcuts.mjs';
import {quickShots,extraShots,shotShortcut,shortcutLabel} from './shot-shortcuts.mjs';
import {formatDuration} from './generated/tracking.mjs';
import {touchInsights,touchDirections} from './touch-insights.mjs';
import {finishRally} from './core.mjs';
import {courtCheckinUI} from './court-checkin.mjs';
export function scoutingUI({$,act,getState}){
 const renderScoreCorrection=scoreCorrectionUI({$,act,getState});
 const renderCourtCheckin=courtCheckinUI({$,act,storage:preferences});
 let keyboardContext={enabled:false,token:'',order:[]};
 let selectedPlayer=null,holdingPlayer=null;
 // Expert is opt-in; fresh users start in Pro while saved choices are preserved.
 let direct=preferences?.getItem('pn-rally-taps')!=='on';
 $('rally-taps').checked=!direct;
 const modeHint=()=>{$('entry-mode-hint').textContent=direct?'Pro · Player key → choose action · no previous-stroke step':'Expert · Tap player · W winner · A unforced · D forced';for(const mode of ['pro','expert']){const active=(mode==='pro')===direct;$('mode-'+mode).setAttribute('aria-pressed',String(active));$('mode-'+mode).dataset.variant=active?'primary':'ghost';}};modeHint();
 function setMode(pro){if(getState()?.pending){$('rally-taps').checked=!direct;return;}direct=pro;selectedPlayer=null;preferences?.setItem('pn-rally-taps',direct?'off':'on');$('rally-taps').checked=!direct;keyboard.reset();keyboardContext.direct=direct;modeHint();paintFeedback();}
 const expertDialog=$('expert-confirm');
 function requestMode(pro){if(!pro&&direct&&!getState()?.pending){$('rally-taps').checked=false;expertDialog.showModal();$('expert-cancel').focus();return;}setMode(pro);}
 $('rally-taps').onchange=()=>{requestMode(!$('rally-taps').checked);$('rally-taps').blur();};
 $('mode-pro').onclick=()=>{requestMode(true);$('mode-pro').blur();};$('mode-expert').onclick=()=>requestMode(false);
 $('expert-cancel').onclick=()=>expertDialog.close();
 $('expert-confirm-button').onclick=()=>{setMode(false);expertDialog.close();$('mode-expert').focus();};
 document.addEventListener('keydown',event=>{if(expertDialog.open)event.stopImmediatePropagation();},true);
 const keyEditor=scoutingKeys({$,scope:()=> $('expert-confirm').open?null:$('shot-dialog').open?step:getState()?.selectedMatch?(selectedPlayer===null?'rally':'outcome'):null,onEditing:()=>keyboard?.reset()});
 const feedback=new Map(),queuedTaps=[];
 const latestPlayer=()=>{const p=getState()?.pending;if(direct||!p||p.finish)return null;return queuedTaps.filter(t=>t.rally===p.id).at(-1)?.player??p.touches?.at(-1)?.player??null;};
 let recording=0;
 function paintFeedback(){for(const b of $('players').querySelectorAll('.mobile-tap'))b.hidden=direct;for(const card of $('players').querySelectorAll('[data-player]')){const player=Number(card.dataset.player),f=feedback.get(player);card.classList.toggle('keyboard-selected',player===(selectedPlayer??latestPlayer()));for(const button of card.querySelectorAll('[data-outcome-key]')){if(player===(selectedPlayer??latestPlayer()))button.setAttribute('aria-keyshortcuts',button.dataset.outcomeKey.toUpperCase());else button.removeAttribute('aria-keyshortcuts');}card.classList.toggle('holding',player===holdingPlayer);card.dataset.feedback=f?.phase??'';let status=card.querySelector('.tap-feedback');if(!status){status=document.createElement('span');status.className='tap-feedback';status.setAttribute('role','status');card.append(status);}status.textContent=player===(selectedPlayer??latestPlayer())?'Choose outcome · '+['winner','unforced','forced'].map(o=>keyEditor.label('outcome-'+o)).join(' / '):f?.label??(player===holdingPlayer?'Hold 1.3s to select…':'');}}
 async function record(player,message,label){const queued=message.type==='touch'?{player,rally:getState()?.pending?.id}:null;if(queued)queuedTaps.push(queued);const f={phase:'recorded',label:'✓ '+label+' · saving locally'};feedback.set(player,f);paintFeedback();recording++;const resultPromise=act(message);let result;try{result=await resultPromise;}catch(error){result={ok:false,error:error.message};}finally{recording--;if(queued)queuedTaps.splice(queuedTaps.indexOf(queued),1);}if(feedback.get(player)!==f)return;f.phase=result?.ok?'recorded':'error';f.label=result?.ok?'✓ '+label+' saved locally':result?.error??'Could not record. Try again.';paintFeedback();setTimeout(()=>{if(feedback.get(player)===f){feedback.delete(player);paintFeedback();}},result?.ok?1000:3500);}
 const keyboard=playerShortcuts({target:document,context:()=>(keyEditor.isEditing()||$('expert-confirm').open||$('scouting-menu')?.open||document.body.classList.contains('onboarding-active'))?{...keyboardContext,enabled:false,recording:false}:{...keyboardContext,lastPlayer:latestPlayer()},select:player=>{selectedPlayer=player;paintFeedback();},hold:player=>{holdingPlayer=player;paintFeedback();},fault:type=>act({type}),tap:player=>record(player,{type:'touch',player},'Shot'),smash:(player,smashType,latestTouch=false)=>record(player,{type:'smash',player,smashType,latestTouch},smashType==='x3'?'X3 attempt':smashType==='soft'?'Soft smash attempt':'Power attempt'),prepare:(player,outcome)=>act({type:'prepare',player,outcome})});
 const renderLiveStats=liveStats($('live-stats'));
 let scoreKey='',setupKey='',playerKey='',openId='',shot,smashType,serverKey='',seedKey='',forcedBy,attributionReady=false,attributionKey='',previousShot,previousSmashType,previousReuse=false,step='shot';
 $('apply-server').onclick=()=>act({type:'server',player:Number($('current-server').value)});
 $('restart-rally').onclick=()=>act({type:'restart-rally'});
 for(const team of ['a','b'])$('swap-pair-'+team).onclick=()=>act({type:'positions',pair:team});
 $('swap-ends').onclick=()=>act({type:'ends'});
 for(const seconds of [-30,-10,-5,5,10,30])$(`skip-${seconds}`).onclick=()=>act({type:'skip',seconds});
 const seedRows=()=>{for(const i of [1,2])$('seed-set-'+i).hidden=Number($('seed-count').value)<i;};
 $('seed-count').onchange=seedRows;seedRows();
 $('starting-score-form').onsubmit=e=>{e.preventDefault();const points=team=>{const v=$('seed-points-'+team).value.trim();return /^adv$/i.test(v)?'Adv':Number(v);};act({type:'starting-score',score:{completed:Array.from({length:Number($('seed-count').value)},(_,i)=>({a:Number($(`seed-${i+1}-a`).value),b:Number($(`seed-${i+1}-b`).value)})),games:{a:Number($('seed-games-a').value),b:Number($('seed-games-b').value)},points:{a:points('a'),b:points('b')},server:Number($('seed-server').value),near:$('seed-near').value,advantageReturns:Number($('seed-deuce').value),...($('seed-elapsed').value.trim()?{elapsedSeconds:Number($('seed-elapsed').value)*60}:{})}});};
 const names=$('names');
 for(let i=0;i<4;i++){const label=document.createElement('label'),input=document.createElement('input');label.textContent=`${i<2?'Pair A':'Pair B'} · player ${i%2+1}`;input.id=`name-${i}`;input.required=true;input.maxLength=80;label.append(input);names.append(label);}
 $('setup-form').addEventListener('submit',e=>{e.preventDefault();act({type:'setup',setup:{names:[0,1,2,3].map(i=>$(`name-${i}`).value),firstServer:Number($('first-server').value),otherServer:Number($('other-server').value),rule:$('rule').value}})});
 $('var-review').onclick=()=>act({type:'var-review',reviewed:!getState()?.pending?.varReviewed});
 $('shot-var').onchange=()=>act({type:'var-review',reviewed:$('shot-var').checked});
 let draftHistory=[],lastDraft=null;
 const draftFlags=['assist','smash-recovery','x4','outside','net-touch','counted'];
 function readDraft(){return {shot,smashType,forcedBy,attributionReady,previousShot,previousSmashType,previousReuse,step,flags: Object.fromEntries(draftFlags.map(id=>[id,$(id).checked])),recovery:$('recovery-smash').value,outsideAttempts:[...$('outside-attempts').querySelectorAll('input:checked')].map(input=>input.value)};}
 function rememberDraft(){const next=readDraft();if(lastDraft&&JSON.stringify(next)!==JSON.stringify(lastDraft)){draftHistory.push(lastDraft);draftHistory=draftHistory.slice(-50);}lastDraft=next;}
 const undo=()=>{
  if($('shot-dialog').open&&draftHistory.length){
   const prior=draftHistory.pop();({shot,smashType,forcedBy,attributionReady,previousShot,previousSmashType,previousReuse,step}=prior);
   for(const id of draftFlags)$(id).checked=prior.flags[id];
   $('recovery-smash').value=prior.recovery;
   for(const input of $('outside-attempts').querySelectorAll('input'))input.checked=prior.outsideAttempts.includes(input.value);
   lastDraft=readDraft();syncShot();$('shot-error').textContent='Last selection undone.';return;
  }
  return act({type:'undo-last'});
 };
 $('undo').onclick=undo;$('shot-undo').onclick=undo;
 const undoKey=keyEditor.label('undo');
 for(const badge of document.querySelectorAll('[data-undo-key]'))badge.textContent=undoKey;
 globalThis.__pnMediaKeys.attachUndo({target:document,control:()=> $('shot-dialog').open?$('shot-undo'):$('undo')});
 for(const type of ['first-fault','double-fault'])$(type).addEventListener('click',()=>act({type}));
 let quickSave=preferences?.getItem('pn-quick-save')==='true';
 $('quick-save').checked=quickSave;
 function setQuick(value){quickSave=value;$('quick-save').checked=value;preferences?.setItem('pn-quick-save',String(value));}
 $('quick-save').addEventListener('change',()=>setQuick($('quick-save').checked));
 $('shot-details').addEventListener('toggle',()=>{if($('shot-details').open)setQuick(false)});
 function chooseShot(key,fromKeyboard=false){if($('save-point').disabled)return;if(step==='previous'){if(previousShot!==key){previousReuse=false;previousSmashType=key==='smash'?getState()?.pending?.attempts?.[previousAttempt()]?.smashType:undefined;}previousShot=key;syncShot();return;}if(key==='smash'&&shot!=='smash'){const p=getState()?.pending,a=p?.attempts?.[matchingAttempt()];smashType=a?.smashType;$('counted').checked=false;}shot=key;attributionReady=true;if(key!=='smash')$('x4').checked=false;syncShot();$('shot-error').textContent='';if(!fromKeyboard&&$('quick-save').checked&&shot!=='smash')savePoint();}
 const shotGroups={overhead:['smash','vibora','bandeja','rulo','gancho'],defense:['groundstroke','lob','block','bajada','wall','return','contrapared'],net:['volley','chiquita','drop','half_volley']};
 function shotButton(key,shortcut){
  const b=document.createElement('button');b.type='button';b.className='ui-btn';b.dataset.size='sm';const label=document.createElement('span');label.className='shot-label';label.textContent=key==='bajada'?'Bajada de pared':shots[key];const group=Object.keys(shotGroups).find(g=>shotGroups[g].includes(key))??'other';label.dataset.group=group;b.append(label);b.dataset.shot=key;b.dataset.group=group;b.setAttribute('aria-pressed','false');
  if(shortcut){b.dataset.shortcut=shortcut;b.setAttribute('aria-keyshortcuts',shortcut);b.title=(key==='bajada'?'Bajada de pared':shots[key])+' · '+({overhead:'Overheads',defense:'Defense',net:'Net shots',other:'Other'}[group])+' · '+shortcutLabel(shortcut);const kbd=document.createElement('kbd');kbd.textContent=shortcutLabel(shortcut);b.append(kbd);}
  b.addEventListener('click',()=>chooseShot(key));return b;
 }
 const common=document.createElement('div');common.className='shot-keyboard';common.setAttribute('aria-label','Stroke keyboard');
 const shotKeys=Object.fromEntries([...quickShots,...extraShots].map(([key,shot])=>[shot,key]));
 const tagNames={x4:'X4 winner',outside:'Outside','smash-recovery':'Recovery',assist:'Assist','net-touch':'Net touch'};
 const rows=[['chiquita','block','bajada','@x4','wall','return','@outside','other'],['smash','volley','vibora','@smash-recovery','rulo'],['bandeja','groundstroke','lob','@assist','gancho'],['drop','@net-touch']];
 for(const [i,keys] of rows.entries()){
  const row=document.createElement('div');row.className='keyboard-row keyboard-row-'+i;row.setAttribute('role','group');row.setAttribute('aria-label',['Number keys','QWERT row','ASDFG row','Bottom row'][i]);
  for(const key of keys){
   if(key.startsWith('@')){const id=key.slice(1),b=document.createElement('button');b.type='button';b.className='ui-btn keyboard-tag';b.dataset.tag=id;b.innerHTML='<kbd></kbd><span class="shot-label"></span>';b.querySelector('span').textContent=tagNames[id];b.onclick=()=>{if($('save-point').disabled)return;$(id).checked=!$(id).checked;$(id).onchange();};row.append(b);}
   else {const b=shotButton(key,shotKeys[key]);if(key==='bajada')b.querySelector('.shot-label').textContent='Bajada';row.append(b);if(key==='lob'){const wrapper=document.createElement('div');wrapper.className='keyboard-dual';b.replaceWith(wrapper);wrapper.append(b);const shifted=shotButton('contrapared','shift+d');shifted.classList.add('shifted-shot');wrapper.append(shifted);}}
  }
  common.append(row);
 }
 $('shot-options').append(common);
 function previousAttempt(){const p=getState()?.pending;return p?.attempts?.findLastIndex(a=>a.player===forcedBy)??-1;}
 function matchingAttempt(){const p=getState()?.pending;return p?.attempts?.findLastIndex(a=>a.player===p.finish?.player)??-1;}
 function returnServer(){
  const state=getState(),finish=state?.pending?.finish;if(finish?.outcome!=='unforced'||shot!=='return')return undefined;
  const model=match(state);if(needsServerConfirmation(state,model)||Math.floor(model.server/2)===Math.floor(finish.player/2))return undefined;
  return model.server;
 }
 function syncShot(){
  rememberDraft();
  const autoServer=returnServer();
  for(const b of $('shot-options').querySelectorAll('[data-shot]')){b.setAttribute('aria-pressed',String(b.dataset.shot===(step==='previous'?previousShot:shot)));b.dataset.variant=b.dataset.shot===(step==='previous'?previousShot:shot)?'primary':'default';}
  const p=getState()?.pending,smash=shot==='smash',canLink=smash&&matchingAttempt()>=0;
  const x4=p?.finish?.outcome==='winner'&&$('x4').checked,recovery=p?.finish?.outcome==='winner'&&$('smash-recovery').checked;
  $('smash-options').hidden=!smash;$('x4-label').hidden=p?.finish?.outcome!=='winner';$('shot-options').hidden=x4||recovery;$('x4-action').hidden=!x4;$('smash-type-picker').hidden=x4;
  $('forced-credit').hidden=step!=='opponent';
  $('outcome-picker').hidden=step!=='outcome';
  $('point-back').querySelector('kbd').dataset.scoutKey='back';
  $('point-step').textContent={shot:'Finishing stroke',outcome:'Choose outcome',opponent:'Previous opponent · required',previous:'Previous stroke · optional'}[step];
  $('shot-form').dataset.step=step;
  $('shot-options').hidden=!(step==='previous'||step==='shot');
  for(const b of common.querySelectorAll('[data-tag]')){const id=b.dataset.tag;b.hidden=step!=='shot'||id!=='net-touch'&&p?.finish?.outcome!=='winner';b.disabled=$('save-point').disabled;b.setAttribute('aria-pressed',String($(id).checked));b.querySelector('kbd').textContent=keyEditor.label(id);}
  for(const b of common.querySelectorAll('[data-shot]')){b.disabled=$('save-point').disabled||(step==='shot'&&(x4||recovery));b.querySelector('kbd').textContent=keyEditor.label('shot-'+b.dataset.shot);}
  $('winner-tags').hidden=step!=='shot'||p?.finish?.outcome!=='winner';
  $('smash-options').hidden=!(step==='shot'&&smash||step==='previous'&&previousShot==='smash');$('smash-type-picker').hidden=step==='shot'&&x4;
  for(const id of ['net-touch','shot-var'])$(id).closest('label').hidden=step!=='shot';
  $('shot-details').hidden=step!=='shot';$('outside-attempt-details').hidden=step!=='shot';
  $('previous-shot-context').hidden=step!=='previous'&&!(step==='shot'&&(autoServer!==undefined||forcedBy!==undefined));
  $('previous-shot-context').textContent=step==='shot'&&autoServer!==undefined?`Previous shot: Serve · ${getState().setup.names[autoServer]} · Auto-filled`:forcedBy===undefined?'':`Previous player: ${getState().setup.names[forcedBy]} · ${previousShot?shots[previousShot]:'Stroke not recorded'}`;
  $('save-point').textContent=step==='opponent'?'Select the previous opponent':step==='outcome'?'Choose an outcome':step==='previous'?previousShot?'Save point · Space':'Save without previous stroke · Space':p?.finish?.outcome!=='winner'&&autoServer===undefined?(forcedBy===undefined?'Next: previous opponent · Enter':direct?'Save point · Space':'Next: previous stroke · Enter'):'Save point · Space';
  $('save-point').setAttribute('aria-disabled',String(step==='opponent'||step==='outcome'));
  if(step==='previous')$('shot-title').textContent=getState().setup.names[forcedBy]+' · previous stroke';
  else if(step==='opponent')$('shot-title').textContent='Previous opponent';
  $('shot-instruction').textContent=step==='opponent'?'Select the opponent using their player key. Required before saving.':step==='previous'?'Optional: choose their stroke, or save without it.':step==='outcome'?'Choose Winner, UE or FE.':recovery?'Smash recovery winner. No stroke needed.':'Choose the stroke, then save below. Esc changes the outcome.';
  if(matchMedia('(max-width:600px),(pointer:coarse)').matches)$('shot-instruction').textContent=step==='opponent'?'Select the opponent before continuing.':step==='previous'?'Choose their stroke, or save without it.':step==='outcome'?'Choose Winner, UE or FE.':recovery?'Smash recovery winner. Tap Save point.':'Choose the stroke, then tap Save point.';
  for(const b of $('forced-opponents').querySelectorAll('button')){b.setAttribute('aria-pressed',String(Number(b.dataset.player)===forcedBy));b.disabled=$('save-point').disabled;}
  $('forced-unknown').textContent='Back to error stroke';
  for(const b of $('smash-options').querySelectorAll('[data-smash-type]'))b.setAttribute('aria-pressed',String(b.dataset.smashType===(step==='previous'?previousSmashType:smashType)));
  const previousSmash=step==='previous'&&previousShot==='smash',reuse=previousSmash?previousReuse:$('counted').checked;
  const index=previousSmash?previousAttempt():matchingAttempt(),prior=getState()?.pending?.attempts?.[index];
  $('counted-label').hidden=!(previousSmash||step==='shot'&&smash);$('reuse-smash').hidden=index<0;$('reuse-smash').disabled=index<0;
  $('reuse-smash').querySelector('span').textContent='Use last smash · '+({power:'Power',x3:'X3',soft:'Soft'}[prior?.smashType]??'Recorded');
  for(const [id,selected] of [['reuse-smash',reuse],['new-smash',!reuse]]){$(id).setAttribute('aria-pressed',String(selected));$(id).dataset.variant=selected?'primary':'default';}
  $('attempt-choice-note').textContent=previousSmash?'Link the smash that caused this error. New smash adds a separate attempt.':'Use the recorded attempt, or count a new smash.';

  const label=!shot?(recovery?`${getState()?.setup?.names[p?.finish?.player]??'Player'} · winner`:'Choose a stroke'):`${getState()?.setup?.names[p?.finish?.player]??'Player'} · ${p?.finish?.outcome??''} · ${shots[shot]}${smash&&$('x4').checked?' · X4 winner':''}${smash?' · '+(canLink&&$('counted').checked?'Updates the recorded attempt · No extra attempt':'Adds one new attempt'):''}`;
  if($('save-point').textContent.endsWith(' · Space')){
   $('save-point').textContent=$('save-point').textContent.slice(0,-8);
   const hint=document.createElement('kbd');hint.dataset.scoutKey='save';hint.textContent=keyEditor.label('save');hint.title='Edit Start / continue / save shortcut';
   $('save-point').append(' ',hint);
  }
  $('shot-instruction').textContent=$('shot-instruction').textContent.replaceAll('Space',keyEditor.label('save')).replaceAll('Esc',keyEditor.label('back'));
  $('shot-summary').textContent=(previousSmash?getState().setup.names[forcedBy]+' · Smash'+(previousSmashType?' '+({power:'Power',x3:'X3',soft:'Soft'}[previousSmashType]):'')+' → opponent error · '+(index>=0&&previousReuse?'Uses recorded attempt · No extra attempt':'Adds one new attempt'):label)+(forcedBy!==undefined?' · Previous opponent: '+getState().setup.names[forcedBy]:'')+($('assist').checked?' · Assist: '+getState().setup.names[p.finish.player^1]:'')+($('smash-recovery').checked?' · Smash recovery':'')+($('outside').checked?' · Outside-court recovery':'')+($('net-touch').checked?' · Net touch':'');
  $('recovery-smash-label').hidden=!$('smash-recovery').checked||getState()?.pending?.finish?.outcome!=='winner';
  for(const input of ['assist','smash-recovery','x4','outside'])$(input).closest('label').classList.toggle('selected',$(input).checked);
 }
 function chooseType(type){if(step==='previous'){previousShot='smash';previousSmashType=type;syncShot();return;}smashType=type;if(type!=='power')$('x4').checked=false;syncShot();}
 for(const b of $('smash-options').querySelectorAll('[data-smash-type]'))b.onclick=()=>chooseType(b.dataset.smashType);
 $('x4').onchange=()=>{if($('x4').checked){shot='smash';smashType='power';}else if($('smash-recovery').checked){shot=undefined;smashType=undefined;}syncShot();$('save-point').focus();};$('counted').onchange=syncShot;for(const id of ['reuse-smash','new-smash'])$(id).onclick=()=>{if(id==='reuse-smash'&&(step==='previous'?previousAttempt():matchingAttempt())<0)return;if(step==='previous')previousReuse=id==='reuse-smash';else $('counted').checked=id==='reuse-smash';syncShot();};
 $('recovery-smash').onchange=()=>{syncShot();$('shot-error').textContent='';};
 $('outside-attempts').addEventListener('change',()=>syncShot());
 $('smash-recovery').onchange=()=>{if($('smash-recovery').checked&&!$('x4').checked){shot=undefined;smashType=undefined;}syncShot();$('shot-error').textContent='';$('save-point').focus();};
 for(const id of ['assist','net-touch','outside'])$(id).onchange=()=>{syncShot();$('save-point').focus();};
 function credit(player){if(forcedBy!==player){previousShot=undefined;previousSmashType=undefined;previousReuse=false;}forcedBy=player;step=direct?'shot':'previous';attributionReady=true;syncShot();$('save-point').focus();}
 $('forced-unknown').onclick=()=>{step='shot';syncShot();common.querySelector('button')?.focus();};
 const goBack=()=>{if($('save-point').disabled)return;if(step==='previous')step='opponent';else if(step==='opponent')step='shot';else if(step==='shot')step='outcome';else {cancel();return;}syncShot();(step==='outcome'?$('outcome-picker'):step==='opponent'?$('forced-opponents'):common).querySelector('button')?.focus();};
 $('point-back').onclick=goBack;
 for(const button of $('outcome-picker').querySelectorAll('button'))button.onclick=()=>{const finish=getState()?.pending?.finish;if(finish?.outcome===button.dataset.chooseOutcome){step='shot';syncShot();common.querySelector('button')?.focus();}else if(finish)act({type:'prepare',player:finish.player,outcome:button.dataset.chooseOutcome,changeOutcome:true});};
 const cancel=()=>act({type:'clear-outcome'});
 $('dismiss-shot').addEventListener('click',cancel);
 $('shot-dialog').addEventListener('cancel',e=>{e.preventDefault();goBack()});
 function savePoint(){
  const p=getState()?.pending?.finish;if(!p||$('save-point').disabled)return;if(step==='outcome')return;if(step==='opponent'){ $('shot-error').textContent='Choose the previous opponent before saving.';return;}const recovery=p.outcome==='winner'&&$('smash-recovery').checked;if((!shot&&!recovery)){$('shot-error').textContent='Choose a shot'+', then press Space to save.';return;}
  if(recovery&&!$('recovery-smash').value){$('shot-error').textContent='Choose the opponent’s smash: reuse a recorded attempt or add the missing attempt.';$('recovery-smash').focus();return;}
  const [recoveryPlayer,recoveryAttempt]=($('recovery-smash').value||'').split(':');
  const autoServer=returnServer(),previousPlayer=autoServer??forcedBy,priorShot=autoServer!==undefined?'serve':previousShot;
  if(p.outcome!=='winner'&&step==='shot'&&autoServer===undefined&&(!direct||forcedBy===undefined)){step=forcedBy===undefined?'opponent':'previous';syncShot();(step==='opponent'?$('forced-opponents'):common).querySelector('button')?.focus();return;}
  if(p.outcome!=='winner'&&previousPlayer===undefined){$('shot-error').textContent='Choose the previous opponent before saving.';return;}
  act({type:'score',details:{...(shot?{shot}:{}),...(shot==='smash'?{smashType,...(p.outcome==='winner'&&$('x4').checked?{x4:true}:{})}:{}),...($('shot-side').value?{side:$('shot-side').value}:{}),...($('net-touch').checked?{netTouch:true}:{}),...($('outside-attempts').querySelector('input:checked')?{outsideRecoveryBy:[...$('outside-attempts').querySelectorAll('input:checked')].map(input=>Number(input.value))}:{}),...(p.outcome!=='winner'&&previousPlayer!==undefined?{previousPlayer,...(priorShot?{previousShot:priorShot}:{}),...(priorShot==='smash'&&previousSmashType?{previousSmashType}:{}),...(priorShot==='smash'&&previousAttempt()>=0&&!previousReuse?{previousSmashNew:true}:{}),...(p.outcome==='forced'?{forcedBy}:{})}:{}),...(p.outcome==='winner'?{...($('assist').checked?{assistBy:p.player^1}:{}),...($('outside').checked?{recovery:true}:{}),...($('smash-recovery').checked?{smashRecovery:true,recoverySmashPlayer:Number(recoveryPlayer),...(recoveryAttempt!=='new'?{recoverySmashAttemptIndex:Number(recoveryAttempt)}:{})}:{})}:{}),...(shot==='smash'&&matchingAttempt()>=0&&$('counted').checked?{smashAlreadyCounted:true,smashAttemptIndex:matchingAttempt()}:{} )}});
 }
 $('shot-form').addEventListener('submit',e=>{e.preventDefault();savePoint();});
 $('shot-form').addEventListener('keydown',e=>{
  if(e.key==='Backspace'&&e.shiftKey){e.preventDefault();e.stopPropagation();if(!e.repeat)cancel();return;}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!e.repeat)goBack();return;}
  if(e.repeat){if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();}return;}if(e.isComposing||e.altKey)return;
  if((e.key==='Enter'||e.key===' ')&&!e.target.closest('input,select,textarea,[contenteditable]')){e.preventDefault();e.stopPropagation();if(shot||getState()?.pending?.finish?.outcome==='winner'&&$('smash-recovery').checked||e.ctrlKey||e.metaKey)savePoint();else $('shot-error').textContent='Choose a shot, then press Space to save.';return;}
  if(e.ctrlKey||e.metaKey||e.target.closest('input,select,textarea,[contenteditable]'))return;
  const key=e.key.toLowerCase(),finish=getState()?.pending?.finish;if($('save-point').disabled)return;
  if(!e.shiftKey&&['b','h'].includes(key)&&!$('counted-label').hidden){e.preventDefault();$(key==='b'?'reuse-smash':'new-smash').click();return;}
  if(step==='outcome'){const outcome={w:'winner',a:'unforced',d:'forced'}[key];if(outcome&&!e.shiftKey){e.preventDefault();$('outcome-picker').querySelector(`[data-choose-outcome="${outcome}"]`).click();}return;}
  if(step==='opponent'){const b=[...$('forced-opponents').querySelectorAll('button')].find(b=>b.dataset.shortcut===key);if(b&&!e.shiftKey){e.preventDefault();credit(Number(b.dataset.player));}return;}
  if(step==='shot'&&!e.shiftKey&&key==='n'){e.preventDefault();$('net-touch').checked=!$('net-touch').checked;$('net-touch').onchange();return;}
  if(step==='shot'&&!e.shiftKey&&finish?.outcome==='winner'&&['f','r','4','7'].includes(key)){e.preventDefault();const id={f:'assist',r:'smash-recovery',4:'x4',7:'outside'}[key];$(id).checked=!$(id).checked;$(id).onchange();return;}
  if(finish?.outcome==='winner'&&$('smash-recovery').checked&&!$('x4').checked)return;

  if(!e.shiftKey&&(step==='shot'&&shot==='smash'||step==='previous'&&previousShot==='smash')&&['z','x','c'].includes(key)){e.preventDefault();chooseType(key==='z'?'power':key==='x'?'x3':'soft');return;}
  const choice=[...$('shot-options').querySelectorAll('button')].find(b=>b.dataset.shortcut===shotShortcut(e));
  if(choice){e.preventDefault();if(!choice.disabled)chooseShot(choice.dataset.shot,true);}
 });
 return function render(state,sample,busy,healthy){
  const setup=state.setup??defaults(),m=match(state),locked=!!state.pending||state.rallies.some(r=>r.point);
  const seedToken=JSON.stringify([state.selectedMatch?.id,setup.startingScore,setup.names]);
  if(seedToken!==seedKey){seedKey=seedToken;const seed=setup.startingScore; $('seed-count').value=seed?.completed.length??0;for(const i of [1,2])for(const team of ['a','b'])$(`seed-${i}-${team}`).value=seed?.completed[i-1]?.[team]??0;for(const team of ['a','b']){$('seed-games-'+team).value=seed?.games[team]??0;$('seed-points-'+team).value=seed?.points[team]??0;}$('seed-server').replaceChildren(...setup.names.map((n,i)=>new Option(n,i)));$('seed-server').value=seed?.server??setup.firstServer;$('seed-near').value=seed?.near??setup.near??'a';$('seed-deuce').value=seed?.advantageReturns??0;$('seed-elapsed').value=seed?.elapsedSeconds===undefined?'':seed.elapsedSeconds/60;seedRows();}
  keyEditor.paint();
  for(const input of $('starting-score-form').elements)input.disabled=locked||busy||!state.selectedMatch;
  $('seed-note').textContent=locked?'Starting score locks after your first recorded point.':setup.startingScore?'Starting score saved. New scouting points continue from here.':'Set this before recording your first point.';
  const key=JSON.stringify(setup);
  if(key!==setupKey){setupKey=key;setup.names.forEach((n,i)=>{$(`name-${i}`).value=n});for(const id of ['first-server','other-server']){$(id).replaceChildren(...setup.names.map((n,i)=>{const o=document.createElement('option');o.value=i;o.textContent=n;return o;}));} $('first-server').value=setup.firstServer;$('other-server').value=setup.otherServer;$('rule').value=setup.rule;}
  for(const input of $('setup-form').elements)input.disabled=locked||busy;
  const nextScoreKey=JSON.stringify([state.selectedMatch?.id,setup.names,setup.coaches,m.score,m.server,needsServerConfirmation(state,m),busy]);
  if(nextScoreKey!==scoreKey){scoreKey=nextScoreKey;
  const scoreTable=document.createElement('table');scoreTable.className='score-table';const heading=document.createElement('tr');for(const text of ['Pair',...m.score.sets.map((_,i)=>`Set ${i+1}`),'Points','']){const th=document.createElement('th');th.textContent=text;heading.append(th);}scoreTable.append(heading);
  for(const [i,team] of ['a','b'].entries()){
   const row=document.createElement('tr'),name=document.createElement('td');
   setup.names.slice(i*2,i*2+2).forEach((n,j)=>{if(j)name.append(' / ');const text=document.createElement(i*2+j===m.server&&!needsServerConfirmation(state,m)&&m.score.phase!=='finished'?'strong':'span');text.textContent=n;if(text.tagName==='STRONG')text.setAttribute('aria-label',n+', serving');name.append(text);});
   const coach=setup.coaches?.[i],nudge=document.createElement('button');nudge.type='button';nudge.className='ui-btn coach-nudge';nudge.dataset.variant=coach?'ghost':'record';nudge.dataset.size='sm';nudge.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="7" r="3"/><path d="M5 20v-2a7 7 0 0 1 14 0v2M9 14l3 4 3-4"/></svg>';const cue=document.createElement('span');cue.className='coach-cue';cue.setAttribute('aria-hidden','true');cue.textContent=coach?'✓':'!';nudge.append(cue);nudge.title=coach?.status==='confirmed'?'Coach: '+coach.coaches[0].name+' · Change':coach?.status==='unknown'?'Coach unknown · Update':'Confirm coach · Action needed';nudge.setAttribute('aria-label',nudge.title+' · '+setup.names.slice(i*2,i*2+2).join(' / '));nudge.disabled=busy;nudge.onclick=()=>document.dispatchEvent(new CustomEvent('pn-coach-request',{detail:{team:i}}));name.append(nudge);row.append(name);
   for(const text of [...m.score.sets.map(s=>s[team]),scoreLabel(m.score,team)]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}const plusCell=document.createElement('td'),plus=document.createElement('button');plus.type='button';plus.className='ui-btn score-add';plus.dataset.scoreAdd=team;plus.textContent='+';plus.setAttribute('aria-label','Add missed point to '+setup.names.slice(i*2,i*2+2).join(' / '));plus.title='Add one missed point';plus.onclick=()=>renderScoreCorrection.addPoint(team);plusCell.append(plus);row.append(plusCell);scoreTable.append(row);
  }
  $('score').replaceChildren(scoreTable);}
  renderScoreCorrection(state,sample,busy);
  $('score-baseline').textContent=setup.startingScore?`Starting score included · scouting from set ${setup.startingScore.completed.length+1}`:'';
  $('server').textContent=m.score.phase==='finished'?`Match finished · Pair ${m.score.winner.toUpperCase()} wins`:`Serving: ${setup.names[m.server]} · ${m.points} points recorded`;
  let issue='';if(state.pending&&sample&&!state.pending.finish){try{finishRally(state.pending,sample)}catch(e){issue=e.message;}}
  $('rally-recovery').hidden=!issue;$('restart-rally').disabled=busy||!healthy||!!sample?.seeking||!!sample?.ended;
  const enabled=!!state.pending&&!state.pending.finish&&!busy&&healthy&&!sample?.seeking&&!issue;
  $('rally').textContent=m.score.phase==='finished'?'Match complete':state.pending?sample?.paused?'Rally paused with video':'Rally in progress':m.points?'Start next rally':'Start rally';
  if(!state.pending&&m.score.phase!=='finished'){const hint=document.createElement('kbd');hint.dataset.scoutKey='save';hint.textContent=keyEditor.label('save');$('rally').append(' ',hint);}
  $('rally').disabled=busy||!healthy||!state.selectedMatch||!!state.pending||sample?.paused||sample?.seeking||m.score.phase==='finished';
  $('touch-status').textContent=state.pending?.touches?.length?`${state.pending.touches.length} shot${state.pending.touches.length===1?'':'s'} tapped · last: ${setup.names[state.pending.touches.at(-1).player]}`:'';
  $('rally-status').textContent=issue|| (state.pending?state.pending.finish?'Outcome selected · save the shot details':`${Math.max(0,(sample?.time??state.pending.start.time)-state.pending.start.time).toFixed(1)}s · ${sample?.paused?'paused':'recording'}`:m.score.phase==='finished'?'Review the final score':'Start at the first serve');
  document.body.classList.toggle('mobile-second-serve',!!state.pending?.firstFault);
  $('first-fault').disabled=!enabled||!!state.pending?.firstFault;$('double-fault').disabled=!enabled||!state.pending?.firstFault;const noUndo=busy||(!state.history?.length&&(!m.points||!!state.pending));
  for(const id of ['undo','shot-undo']){$(id).disabled=noUndo;$(id).title=noUndo?'No action to undo':`Undo last action · ${state.history?.length??0} recent actions · ${undoKey}`;}
  const sk=JSON.stringify([setup.names,m.server]);
  if(sk!==serverKey){serverKey=sk;$('current-server').replaceChildren(...setup.names.map((n,i)=>new Option(n,i)));$('current-server').value=m.server;}
  for(const id of ['current-server','apply-server'])$(id).disabled=busy||!!state.pending||!state.selectedMatch||m.score.phase==='finished';
  for(const id of ['swap-ends','swap-pair-a','swap-pair-b'])$(id).disabled=busy||!state.selectedMatch||m.score.phase==='finished';
  $('video-playback').disabled=busy||!healthy||!!sample?.seeking;
  ($('video-playback-label')??$('video-playback')).textContent=sample?.paused?'Play':'Pause';
  for(const seconds of [-30,-10,-5,5,10,30])$(`skip-${seconds}`).disabled=busy||!!state.pending||!healthy||!!sample?.seeking;
  $('court-ends').textContent=`Far end: Pair ${m.near==='a'?'B':'A'} · Near end: Pair ${m.near.toUpperCase()} · automatic changeovers`;
  const clock=m.tracking,now=sample?sample.time*1000:clock.timeline.at(-1)?Date.parse(clock.timeline.at(-1).at):null;
  const elapsed=at=>at&&now!==null?Math.max(0,(clock.endedAt?Date.parse(clock.endedAt):now)-Date.parse(at)):null;
  const duration=elapsed(clock.startedAt);
  $('timing-title').textContent=clock.scope==='observation'&&m.timeOffset===null?'Observed':'Match';
  $('match-time').textContent=formatDuration(duration===null?(m.timeOffset===null?null:m.timeOffset*1000):duration+(m.timeOffset??0)*1000);
  $('game-time').textContent=clock.gamePartial?'Game — (start missed)':`Game ${formatDuration(elapsed(clock.gameStartedAt))}`;
  const situation=m.situation;
  $('pressure').textContent=m.score.phase==='finished'?'Match finished':[situation.star?'Star Point':null,situation.breakPoint?`Break point · Pair ${situation.breakPoint.toUpperCase()}`:null,...['a','b'].map(t=>situation.matchPoint[t]?`Match point · Pair ${t.toUpperCase()}`:situation.setPoint[t]?`Set point · Pair ${t.toUpperCase()}`:null)].filter(Boolean).join(' · ');
  const table=(headers,rows)=>{const t=document.createElement('table'),head=document.createElement('tr');for(const h of headers){const cell=document.createElement('th');cell.textContent=h;head.append(cell);}t.append(head);for(const row of rows){const tr=document.createElement('tr');for(const text of row){const cell=document.createElement('td');if(text instanceof document.defaultView.Node)cell.append(text);else cell.textContent=text;tr.append(cell);}t.append(tr);}return t;};
  $('pressure-stats').replaceChildren(table(['Pair','Breaks / chances','Saved / faced','Holds','Star won / played','Set points won / chances','Match points won / chances'],['a','b'].map(t=>{const s=clock.pairs[t];return [t.toUpperCase(),`${s.breaks} / ${s.breakPoints}`,`${s.breakPointsSaved} / ${s.breakPointsFaced}`,s.holds,`${s.starPointsWon} / ${s.starPoints}`,`${s.setPointsWon} / ${s.setPoints}`,`${s.matchPointsWon} / ${s.matchPoints}`];})));
  $('service-stats').replaceChildren(table(['Server','Won / points','First faults','Double faults'],setup.names.map((n,i)=>{const s=clock.service[i];return [n,`${s.won} / ${s.points}`,s.firstFaults,s.doubleFaults];})));
  const next=JSON.stringify([setup.names,m.server,m.score.phase,m.stats,m.near,m.swapped,courtPlayers(state,m),state.selectedMatch?.players,setup.otherServerUnknown,setup.firstServerUnknown,!!m.setServers]);
  if(next!==playerKey){playerKey=next;const cards=setup.names.map((name,i)=>{
   const card=document.createElement('article'),h=document.createElement('h3'),stats=document.createElement('small');card.className=`player-card${i===m.server&&!needsServerConfirmation(state,m)&&m.score.phase!=='finished'?' serving':''}`;card.dataset.player=i;card.setAttribute('aria-label',name);h.append(playerIdentity(name,playerProfile(state,i)));card.append(h);card.querySelector('.player-country')?.remove();
   const tap=document.createElement('button');tap.type='button';tap.className='ui-btn mobile-tap';tap.dataset.tapPlayer=i;tap.setAttribute('aria-label',name+' tap shot');tap.textContent='Tap shot';tap.onclick=()=>{if(direct){selectedPlayer=i;paintFeedback()}else record(i,{type:'touch',player:i},'Shot')};card.append(tap);
   const errors=document.createElement('div');errors.className='errors';
   for(const [outcome,label] of [['winner','Winner'],['unforced','Unforced'],['forced','Forced']]){const b=document.createElement('button');b.className='ui-btn';b.dataset.variant=outcome==='winner'?'record':'default';b.textContent=label;b.dataset.outcomeKey={winner:'w',unforced:'a',forced:'d'}[outcome];const hint=document.createElement('kbd');hint.className='outcome-key';hint.dataset.scoutKey='outcome-'+outcome;hint.textContent=b.dataset.outcomeKey.toUpperCase();hint.setAttribute('aria-hidden','true');b.append(hint);b.setAttribute('aria-label',name+' '+outcome);b.addEventListener('click',()=>act({type:'prepare',player:i,outcome}));(outcome==='winner'?card:errors).append(b);}card.append(errors);
   const attempts=document.createElement('div');attempts.className='attempts';for(const [type,label] of [['power','Power +1'],['x3','X3 +1'],['soft','Soft +1']]){const b=document.createElement('button');b.className='ui-btn';b.textContent=label;b.setAttribute('aria-label',name+' '+type+' smash attempt');b.onclick=()=>record(i,{type:'smash',player:i,smashType:type,latestTouch:!direct&&getState()?.pending?.touches?.at(-1)?.player===i},type==='x3'?'X3 attempt':type==='soft'?'Soft smash attempt':'Power attempt');attempts.append(b);}card.append(attempts);return card;
  });
  const order=courtPlayers(state,m);
  order.forEach((player,slot)=>{const badge=document.createElement('kbd');badge.textContent=positionKeys[slot].toUpperCase();badge.dataset.scoutKey='player-'+slot;badge.title='Tap to record a shot; hold 1.3 seconds to select outcome';cards[player].querySelector('h3').prepend(badge,' ');});
  const divider=document.createElement('div');divider.className='court-divider';divider.append('Far end · Net · Near end');const flip=document.createElement('button');flip.className='ui-btn';flip.dataset.variant='ghost';flip.dataset.ends='true';flip.textContent='Switch ends';flip.onclick=()=>act({type:'ends'});divider.append(flip);
  const servingTools=$('serving-tools');if(servingTools&&$('players').contains(servingTools))document.querySelector('.rally-bar').append(servingTools);
  $('players').replaceChildren(...order.slice(0,2).map(i=>cards[i]),divider,...order.slice(2).map(i=>cards[i]));}
  for(const card of $('players').querySelectorAll('article[data-player]')){const player=Number(card.dataset.player),key=keyEditor.label('player-'+courtPlayers(state,m).indexOf(player));for(const [index,type] of ['power','x3','soft'].entries()){const b=card.querySelector('.attempts').children[index];let hint=b.querySelector('kbd');if(!hint){hint=document.createElement('kbd');b.append(hint);}hint.dataset.scoutKey='smash-'+type;hint.textContent=keyEditor.label('smash-'+type);b.title=`Tap ${key}, then press ${keyEditor.label('smash-'+type)} to count one ${type==='x3'?'X3':type==='soft'?'Soft':'Power'} smash attempt`;}}
  for(const b of $('players').querySelectorAll('button:not([data-court-server]):not(#serving-tools button)'))b.disabled=b.dataset.ends?busy||!state.selectedMatch||m.score.phase==='finished':!enabled;
  renderCourtCheckin(state,m,busy,setup);
  keyboardContext={enabled,direct,mappedPlayers:true,tapOutcomes:!direct,recording:busy&&recording>0&&!!state.pending&&!state.pending.finish&&healthy&&!issue&&!sample?.seeking,firstFault:!!state.pending?.firstFault,token:JSON.stringify([state.selectedMatch?.id,state.pending?.id,courtPlayers(state,m)]),order:courtPlayers(state,m)};keyboard.update();paintFeedback();
  const insights=touchInsights(state.rallies);for(const t of touchDirections(state.pending?.touches)){const p=insights.players[t.player];p.shots++;p[t.direction==='cross-court'?'crossCourt':t.direction==='down-the-line'?'downTheLine':'unknown']++;}
  renderLiveStats({rallies:state.rallies,timeline:m.tracking.timeline,names:setup.names,identity:i=>playerIdentity(setup.names[i],playerProfile(state,i))});
  const sequence=state.pending?.touches??[];$('rally-sequence').textContent=sequence.length?sequence.slice(-12).map(t=>setup.names[t.player]).join(' → '):'';$('rally-sequence').hidden=sequence.length===0;
  const pending=state.pending,finish=pending?.finish;
  for(const mode of ['pro','expert']){$('mode-'+mode).disabled=busy||!!pending;$('mode-'+mode).title=pending?'Finish or cancel this rally before changing mode':mode==='pro'?'Pro: no taps or previous-stroke step':'Expert: with rally taps';}$('rally-taps').disabled=busy||!!pending;
  $('var-review').disabled=busy||!pending;$('var-review').setAttribute('aria-pressed',String(!!pending?.varReviewed));$('var-review').textContent=pending?.varReviewed?'VAR flagged':'VAR review';
  if(finish){
   if(openId!==pending.id+':'+finish.player+':'+finish.outcome){const samePlayer=openId.startsWith(pending.id+':'+finish.player+':');openId=pending.id+':'+finish.player+':'+finish.outcome;draftHistory=[];lastDraft=null;step='shot';previousShot=undefined;previousSmashType=undefined;previousReuse=false;if(!samePlayer){shot=undefined;smashType=undefined;}if(!direct&&firstTapReturn(pending,finish.player,finish.outcome,m.server,!needsServerConfirmation(state,m))){shot='return';smashType=undefined;}forcedBy=!direct&&finish.outcome!=='winner'?previousTapOpponent(pending,finish.player):undefined;attributionReady=forcedBy!==undefined||finish.outcome!=='forced';$('shot-form').reset();$('quick-save').checked=quickSave;$('counted').checked=false;
   if(!direct)$('assist').checked=suggestedAssist(pending,finish.player,finish.outcome,m.server,!needsServerConfirmation(state,m))!==undefined;
   const recoverySelect=$('recovery-smash');recoverySelect.replaceChildren(new Option('Choose the opponent’s smash',''));
   for(let opponent=0;opponent<4;opponent++)if(Math.floor(opponent/2)!==Math.floor(finish.player/2)){
    recoverySelect.add(new Option(getState().setup.names[opponent]+' · Add missing attempt',opponent+':new'));
    (pending.attempts??[]).forEach((a,i)=>{if(a.player===opponent)recoverySelect.add(new Option(getState().setup.names[opponent]+' · Reuse smash '+(i+1),opponent+':'+i));});
   }
   const recoveryOpponent=previousTapOpponent(pending,finish.player),recoveryIndex=recoverySmashAttempt(pending,finish.player);
   if(recoveryOpponent!==undefined)recoverySelect.value=recoveryOpponent+':'+(recoveryIndex>=0?recoveryIndex:'new');
   const finalAttempt=finalSmashAttempt(pending,finish.player);
   if(finalAttempt>=0){shot='smash';smashType=pending.attempts[finalAttempt].smashType;$('counted').checked=true;}
   $('outside-attempts').replaceChildren(...setup.names.map((name,player)=>{const label=document.createElement('label');label.className='quick-tag';const check=document.createElement('input');check.type='checkbox';check.value=player;check.name='outside-attempt';label.append(check,document.createTextNode(name));return label;}));
   $('shot-details').open=false;syncShot();$('shot-error').textContent='';}
   const order=courtPlayers(state,m),creditKey=JSON.stringify([pending.id,finish.player,order,setup.names]);if(creditKey!==attributionKey){attributionKey=creditKey;$('forced-opponents').replaceChildren(...order.filter(player=>(player<2)!==(finish.player<2)).map(player=>{const b=document.createElement('button'),kbd=document.createElement('kbd');b.type='button';b.className='ui-btn';b.dataset.player=player;b.dataset.shortcut=positionKeys[order.indexOf(player)];b.setAttribute('aria-keyshortcuts',b.dataset.shortcut.toUpperCase());b.append(setup.names[player]+' ');kbd.textContent=b.dataset.shortcut.toUpperCase();kbd.dataset.scoutKey='player-'+order.indexOf(player);b.append(kbd);b.onclick=()=>credit(player);return b;}));}
   $('assist-name').textContent='By '+setup.names[finish.player^1];$('recovery-name').textContent='By '+setup.names[finish.player];$('outside-label').hidden=finish.outcome!=='winner';
   $('shot-var').checked=!!pending.varReviewed;$('shot-var').disabled=busy;
   $('save-point').disabled=busy;for(const input of $('outside-attempts').querySelectorAll('input'))input.disabled=busy;syncShot();for(const b of $('smash-options').querySelectorAll('button,input'))b.disabled=busy;
   for(const id of ['assist','smash-recovery','x4','outside','net-touch','forced-unknown'])$(id).disabled=busy;
   $('shot-title').textContent=step==='previous'?setup.names[forcedBy]+' · previous stroke':step==='opponent'?'Previous opponent':`${setup.names[finish.player]} · ${finish.outcome.replace('_',' ')}`;$('save-point').disabled=busy;$('dismiss-shot').disabled=busy;
   syncShot();
   if(!$('shot-dialog').open){$('shot-dialog').showModal();common.querySelector('button')?.focus();}
  }else{openId='';draftHistory=[];lastDraft=null;if($('shot-dialog').open)$('shot-dialog').close();}
 };
}
