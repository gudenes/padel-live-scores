import {scoreCorrectionUI} from './score-correction-ui.mjs';
import {scoutingKeys} from './scouting-keys.mjs';
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
 const renderCourtCheckin=courtCheckinUI({$,act});
 let keyboardContext={enabled:false,token:'',order:[]};
 let selectedPlayer=null,holdingPlayer=null;
 let direct=globalThis.localStorage?.getItem('pn-rally-taps')==='off';
 $('rally-taps').checked=!direct;
 const modeHint=()=>{$('entry-mode-hint').textContent=direct?'Player key → choose action':'Tap: shot · Hold: outcome';};modeHint();
 $('rally-taps').onchange=()=>{direct=!$('rally-taps').checked;globalThis.localStorage?.setItem('pn-rally-taps',direct?'off':'on');keyboard.reset();keyboardContext.direct=direct;modeHint();$('rally-taps').blur();};
 const keyEditor=scoutingKeys({$,scope:()=> $('shot-dialog').open?step:getState()?.selectedMatch?(selectedPlayer===null?'rally':'outcome'):null,onEditing:()=>keyboard?.reset()});
 const feedback=new Map();
 let recordQueue=Promise.resolve(),recording=0;
 function paintFeedback(){for(const card of $('players').querySelectorAll('[data-player]')){const player=Number(card.dataset.player),f=feedback.get(player);card.classList.toggle('keyboard-selected',player===selectedPlayer);for(const button of card.querySelectorAll('[data-outcome-key]')){if(player===selectedPlayer)button.setAttribute('aria-keyshortcuts',button.dataset.outcomeKey.toUpperCase());else button.removeAttribute('aria-keyshortcuts');}card.classList.toggle('holding',player===holdingPlayer);card.dataset.feedback=f?.phase??'';let status=card.querySelector('.tap-feedback');if(!status){status=document.createElement('span');status.className='tap-feedback';status.setAttribute('role','status');card.append(status);}status.textContent=player===selectedPlayer?'Choose outcome · '+['winner','unforced','forced'].map(o=>keyEditor.label('outcome-'+o)).join(' / '):f?.label??(player===holdingPlayer?'Hold 1.3s to select…':'');}}
 async function record(player,message,label){const f={phase:'recording',label:'Recording '+label+'…'};feedback.set(player,f);paintFeedback();recording++;const resultPromise=recordQueue.then(()=>act(message));recordQueue=resultPromise.catch(()=>{});let result;try{result=await resultPromise;}catch(error){result={ok:false,error:error.message};}finally{recording--;}if(feedback.get(player)!==f)return;f.phase=result?.ok?'recorded':'error';f.label=result?.ok?'✓ '+label+' saved locally':result?.error??'Could not record. Try again.';paintFeedback();setTimeout(()=>{if(feedback.get(player)===f){feedback.delete(player);paintFeedback();}},result?.ok?1000:3500);}
 const keyboard=playerShortcuts({target:document,context:()=>(keyEditor.isEditing()||$('scouting-menu')?.open||document.body.classList.contains('onboarding-active'))?{...keyboardContext,enabled:false,recording:false}:keyboardContext,select:player=>{selectedPlayer=player;paintFeedback();},hold:player=>{holdingPlayer=player;paintFeedback();},fault:type=>act({type}),tap:player=>record(player,{type:'touch',player},'Shot'),smash:(player,smashType,latestTouch=false)=>record(player,{type:'smash',player,smashType,latestTouch},smashType==='x3'?'X3 attempt':smashType==='soft'?'Soft smash attempt':'Power attempt'),prepare:(player,outcome)=>act({type:'prepare',player,outcome})});
 let setupKey='',playerKey='',openId='',shot,smashType,serverKey='',seedKey='',forcedBy,attributionReady=false,attributionKey='',previousShot,step='shot';
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
 const undo=()=>act({type:'undo-last'});
 $('undo').onclick=undo;$('shot-undo').onclick=undo;
 const undoKey=keyEditor.label('undo');
 for(const badge of document.querySelectorAll('[data-undo-key]'))badge.textContent=undoKey;
 globalThis.__pnMediaKeys.attachUndo({target:document,control:()=> $('shot-dialog').open?$('shot-undo'):$('undo')});
 for(const type of ['first-fault','double-fault'])$(type).addEventListener('click',()=>act({type}));
 let quickSave=globalThis.localStorage?.getItem('pn-quick-save')==='true';
 $('quick-save').checked=quickSave;
 function setQuick(value){quickSave=value;$('quick-save').checked=value;globalThis.localStorage?.setItem('pn-quick-save',String(value));}
 $('quick-save').addEventListener('change',()=>setQuick($('quick-save').checked));
 $('shot-details').addEventListener('toggle',()=>{if($('shot-details').open)setQuick(false)});
 function chooseShot(key,fromKeyboard=false){if($('save-point').disabled)return;if(step==='previous'){previousShot=key;syncShot();return;}shot=key;attributionReady=true;if(key!=='smash')$('x4').checked=false;syncShot();$('shot-error').textContent='';if(!fromKeyboard&&$('quick-save').checked&&shot!=='smash')savePoint();}
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
 function matchingAttempt(){const p=getState()?.pending;return p?.attempts?.findLastIndex(a=>a.player===p.finish?.player&&a.smashType===smashType)??-1;}
 function returnServer(){
  const state=getState(),finish=state?.pending?.finish;if(finish?.outcome!=='unforced'||shot!=='return')return undefined;
  const model=match(state);if(needsServerConfirmation(state,model)||Math.floor(model.server/2)===Math.floor(finish.player/2))return undefined;
  return model.server;
 }
 function syncShot(){
  const autoServer=returnServer();
  for(const b of $('shot-options').querySelectorAll('[data-shot]')){b.setAttribute('aria-pressed',String(b.dataset.shot===(step==='previous'?previousShot:shot)));b.dataset.variant=b.dataset.shot===(step==='previous'?previousShot:shot)?'primary':'default';}
  const p=getState()?.pending,smash=shot==='smash',canLink=smash&&!!smashType&&matchingAttempt()>=0;
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
  $('smash-options').hidden=step!=='shot'||!smash;
  for(const id of ['net-touch','shot-var'])$(id).closest('label').hidden=step!=='shot';
  $('shot-details').hidden=step!=='shot';
  $('previous-shot-context').hidden=step!=='previous'&&!(step==='shot'&&autoServer!==undefined);
  $('previous-shot-context').textContent=step==='shot'&&autoServer!==undefined?`Previous shot: Serve · ${getState().setup.names[autoServer]} · Auto-filled`:forcedBy===undefined?'':`Previous player: ${getState().setup.names[forcedBy]} · ${previousShot?shots[previousShot]:'Stroke not recorded'}`;
  $('save-point').textContent=step==='opponent'?'Select the previous opponent':step==='outcome'?'Choose an outcome':step==='previous'?previousShot?'Save point · Space':'Save without previous stroke · Space':p?.finish?.outcome!=='winner'&&autoServer===undefined?'Next: previous opponent · Enter':'Save point · Space';
  $('save-point').setAttribute('aria-disabled',String(step==='opponent'||step==='outcome'));
  if(step==='previous')$('shot-title').textContent=getState().setup.names[forcedBy]+' · previous stroke';
  else if(step==='opponent')$('shot-title').textContent='Previous opponent';
  $('shot-instruction').textContent=step==='opponent'?'Select the opponent using their player key. Required before saving.':step==='previous'?'Optional: choose their stroke, or Space to save without it.':step==='outcome'?'Choose Winner, UE or FE.':recovery?'Smash recovery winner · Space to save. No stroke needed.':'Choose the stroke, then Space. Esc changes the outcome.';
  for(const b of $('forced-opponents').querySelectorAll('button')){b.setAttribute('aria-pressed',String(Number(b.dataset.player)===forcedBy));b.disabled=$('save-point').disabled;}
  $('forced-unknown').textContent='Back to error stroke';
  for(const b of $('smash-options').querySelectorAll('[data-smash-type]'))b.setAttribute('aria-pressed',String(b.dataset.smashType===smashType));
  $('counted-label').hidden=!canLink;
  const label=!shot?(recovery?`${getState()?.setup?.names[p?.finish?.player]??'Player'} · winner`:'Choose a stroke'):smash&&!smashType?'Choose Power, X3 or Soft smash before saving':`${getState()?.setup?.names[p?.finish?.player]??'Player'} · ${p?.finish?.outcome??''} · ${shots[shot]}${smash?' '+(smashType==='x3'?'X3':smashType==='soft'?'Soft':'Power'):''}${smash&&$('x4').checked?' · X4 winner':''}${smash&&smashType?' · '+(canLink&&$('counted').checked?'Attempt already counted':'Adds one attempt'):''}`;
  $('save-point').textContent=$('save-point').textContent.replace('Space',keyEditor.label('save'));
  $('shot-instruction').textContent=$('shot-instruction').textContent.replaceAll('Space',keyEditor.label('save')).replaceAll('Esc',keyEditor.label('back'));
  $('shot-summary').textContent=label+(forcedBy!==undefined?' · Previous opponent: '+getState().setup.names[forcedBy]:'')+($('assist').checked?' · Assist: '+getState().setup.names[p.finish.player^1]:'')+($('smash-recovery').checked?' · Smash recovery':'')+($('outside').checked?' · Outside-court recovery':'')+($('net-touch').checked?' · Net touch':'');
  for(const input of ['assist','smash-recovery','x4','outside'])$(input).closest('label').classList.toggle('selected',$(input).checked);
 }
 function chooseType(type){smashType=type;if(type!=='power')$('x4').checked=false;syncShot();}
 for(const b of $('smash-options').querySelectorAll('[data-smash-type]'))b.onclick=()=>chooseType(b.dataset.smashType);
 $('x4').onchange=()=>{if($('x4').checked){shot='smash';smashType='power';}else if($('smash-recovery').checked){shot=undefined;smashType=undefined;}syncShot();$('save-point').focus();};$('counted').onchange=syncShot;
 $('smash-recovery').onchange=()=>{if($('smash-recovery').checked&&!$('x4').checked){shot=undefined;smashType=undefined;}syncShot();$('shot-error').textContent='';$('save-point').focus();};
 for(const id of ['assist','net-touch','outside'])$(id).onchange=()=>{syncShot();$('save-point').focus();};
 function credit(player){if(forcedBy!==player)previousShot=undefined;forcedBy=player;step='previous';attributionReady=true;syncShot();$('save-point').focus();}
 $('forced-unknown').onclick=()=>{step='shot';syncShot();common.querySelector('button')?.focus();};
 const goBack=()=>{if($('save-point').disabled)return;if(step==='previous')step='opponent';else if(step==='opponent')step='shot';else if(step==='shot')step='outcome';else {cancel();return;}syncShot();(step==='outcome'?$('outcome-picker'):step==='opponent'?$('forced-opponents'):common).querySelector('button')?.focus();};
 $('point-back').onclick=goBack;
 for(const button of $('outcome-picker').querySelectorAll('button'))button.onclick=()=>{const finish=getState()?.pending?.finish;if(finish?.outcome===button.dataset.chooseOutcome){step='shot';syncShot();common.querySelector('button')?.focus();}else if(finish)act({type:'prepare',player:finish.player,outcome:button.dataset.chooseOutcome,changeOutcome:true});};
 const cancel=()=>act({type:'clear-outcome'});
 $('dismiss-shot').addEventListener('click',cancel);
 $('shot-dialog').addEventListener('cancel',e=>{e.preventDefault();goBack()});
 function savePoint(){
  const p=getState()?.pending?.finish;if(!p||$('save-point').disabled)return;if(step==='outcome')return;if(step==='opponent'){ $('shot-error').textContent='Choose the previous opponent before saving.';return;}const recovery=p.outcome==='winner'&&$('smash-recovery').checked;if((!shot&&!recovery)||shot==='smash'&&!smashType){$('shot-error').textContent='Choose a shot'+(shot==='smash'?' and smash type':'')+', then press Space to save.';return;}
  const autoServer=returnServer(),previousPlayer=autoServer??forcedBy,priorShot=autoServer!==undefined?'serve':previousShot;
  if(p.outcome!=='winner'&&step==='shot'&&autoServer===undefined){step='opponent';syncShot();$('forced-opponents').querySelector('button')?.focus();return;}
  if(p.outcome!=='winner'&&previousPlayer===undefined){$('shot-error').textContent='Choose the previous opponent before saving.';return;}
  act({type:'score',details:{...(shot?{shot}:{}),...(shot==='smash'?{smashType,...(p.outcome==='winner'&&$('x4').checked?{x4:true}:{})}:{}),...($('shot-side').value?{side:$('shot-side').value}:{}),...($('net-touch').checked?{netTouch:true}:{}),...(p.outcome!=='winner'&&previousPlayer!==undefined?{previousPlayer,...(priorShot?{previousShot:priorShot}:{}),...(p.outcome==='forced'?{forcedBy}:{})}:{}),...(p.outcome==='winner'?{...($('assist').checked?{assistBy:p.player^1}:{}),...($('outside').checked?{recovery:true}:{}),...($('smash-recovery').checked?{smashRecovery:true}:{})}:{}),...(shot==='smash'&&matchingAttempt()>=0&&$('counted').checked?{smashAlreadyCounted:true,smashAttemptIndex:matchingAttempt()}:{} )}});
 }
 $('shot-form').addEventListener('submit',e=>{e.preventDefault();savePoint();});
 $('shot-form').addEventListener('keydown',e=>{
  if(e.key==='Backspace'&&e.shiftKey){e.preventDefault();e.stopPropagation();if(!e.repeat)cancel();return;}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!e.repeat)goBack();return;}
  if(e.repeat){if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();}return;}if(e.isComposing||e.altKey)return;
  if((e.key==='Enter'||e.key===' ')&&!e.target.closest('input,select,textarea,[contenteditable]')){e.preventDefault();e.stopPropagation();if(shot||getState()?.pending?.finish?.outcome==='winner'&&$('smash-recovery').checked||e.ctrlKey||e.metaKey)savePoint();else $('shot-error').textContent='Choose a shot, then press Space to save.';return;}
  if(e.ctrlKey||e.metaKey||e.target.closest('input,select,textarea,[contenteditable]'))return;
  const key=e.key.toLowerCase(),finish=getState()?.pending?.finish;if($('save-point').disabled)return;
  if(step==='outcome'){const outcome={w:'winner',a:'unforced',d:'forced'}[key];if(outcome&&!e.shiftKey){e.preventDefault();$('outcome-picker').querySelector(`[data-choose-outcome="${outcome}"]`).click();}return;}
  if(step==='opponent'){const b=[...$('forced-opponents').querySelectorAll('button')].find(b=>b.dataset.shortcut===key);if(b&&!e.shiftKey){e.preventDefault();credit(Number(b.dataset.player));}return;}
  if(step==='shot'&&!e.shiftKey&&key==='n'){e.preventDefault();$('net-touch').checked=!$('net-touch').checked;$('net-touch').onchange();return;}
  if(step==='shot'&&!e.shiftKey&&finish?.outcome==='winner'&&['f','r','4','7'].includes(key)){e.preventDefault();const id={f:'assist',r:'smash-recovery',4:'x4',7:'outside'}[key];$(id).checked=!$(id).checked;$(id).onchange();return;}
  if(finish?.outcome==='winner'&&$('smash-recovery').checked&&!$('x4').checked)return;
  if(step==='shot'&&!e.shiftKey&&shot==='smash'&&['z','x','c'].includes(key)){e.preventDefault();chooseType(key==='z'?'power':key==='x'?'x3':'soft');return;}
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
  const scoreTable=document.createElement('table');scoreTable.className='score-table';const heading=document.createElement('tr');for(const text of ['Pair',...m.score.sets.map((_,i)=>`Set ${i+1}`),'Points','']){const th=document.createElement('th');th.textContent=text;heading.append(th);}scoreTable.append(heading);
  for(const [i,team] of ['a','b'].entries()){
   const row=document.createElement('tr'),name=document.createElement('td');
   setup.names.slice(i*2,i*2+2).forEach((n,j)=>{if(j)name.append(' / ');const text=document.createElement(i*2+j===m.server&&!needsServerConfirmation(state,m)&&m.score.phase!=='finished'?'strong':'span');text.textContent=n;if(text.tagName==='STRONG')text.setAttribute('aria-label',n+', serving');name.append(text);});row.append(name);
   for(const text of [...m.score.sets.map(s=>s[team]),scoreLabel(m.score,team)]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}const plusCell=document.createElement('td'),plus=document.createElement('button');plus.type='button';plus.className='ui-btn score-add';plus.dataset.scoreAdd=team;plus.textContent='+';plus.setAttribute('aria-label','Add missed point to '+setup.names.slice(i*2,i*2+2).join(' / '));plus.title='Add one missed point';plus.onclick=()=>renderScoreCorrection.addPoint(team);plusCell.append(plus);row.append(plusCell);scoreTable.append(row);
  }
  $('score').replaceChildren(scoreTable);renderScoreCorrection(state,sample,busy);
  $('score-baseline').textContent=setup.startingScore?`Starting score included · scouting from set ${setup.startingScore.completed.length+1}`:'';
  $('server').textContent=m.score.phase==='finished'?`Match finished · Pair ${m.score.winner.toUpperCase()} wins`:`Serving: ${setup.names[m.server]} · ${m.points} points recorded`;
  let issue='';if(state.pending&&sample&&!state.pending.finish){try{finishRally(state.pending,sample)}catch(e){issue=e.message;}}
  $('rally-recovery').hidden=!issue;$('restart-rally').disabled=busy||!healthy||!!sample?.seeking||!!sample?.ended;
  const enabled=!!state.pending&&!state.pending.finish&&!busy&&healthy&&!sample?.seeking&&!issue;
  $('rally').textContent=m.score.phase==='finished'?'Match complete':state.pending?sample?.paused?'Rally paused with video':'Rally in progress':m.points?'Start next rally':'Start rally';
  $('rally').disabled=busy||!healthy||!state.selectedMatch||!!state.pending||sample?.paused||sample?.seeking||m.score.phase==='finished';
  $('touch-status').textContent=state.pending?.touches?.length?`${state.pending.touches.length} shot${state.pending.touches.length===1?'':'s'} tapped · last: ${setup.names[state.pending.touches.at(-1).player]}`:'';
  $('rally-status').textContent=issue|| (state.pending?state.pending.finish?'Outcome selected · save the shot details':`${Math.max(0,(sample?.time??state.pending.start.time)-state.pending.start.time).toFixed(1)}s video time · ${sample?.paused?'paused':'recording'}`:m.score.phase==='finished'?'Review the score and sync below':'Start at the first serve');
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
  const next=JSON.stringify([setup.names,m.server,m.score.phase,m.stats,m.near,m.swapped,courtPlayers(state,m),state.selectedMatch?.players,setup.otherServerUnknown]);
  if(next!==playerKey){playerKey=next;const cards=setup.names.map((name,i)=>{
   const card=document.createElement('article'),h=document.createElement('h3'),stats=document.createElement('small');card.className=`player-card${i===m.server&&!needsServerConfirmation(state,m)&&m.score.phase!=='finished'?' serving':''}`;card.dataset.player=i;card.setAttribute('aria-label',name);h.append(playerIdentity(name,playerProfile(state,i)));card.append(h);card.querySelector('.player-country')?.remove();
   const errors=document.createElement('div');errors.className='errors';
   for(const [outcome,label] of [['winner','Winner'],['unforced','Unforced'],['forced','Forced']]){const b=document.createElement('button');b.className='ui-btn';b.dataset.variant=outcome==='winner'?'record':'default';b.textContent=label;b.dataset.outcomeKey={winner:'w',unforced:'a',forced:'d'}[outcome];const hint=document.createElement('kbd');hint.className='outcome-key';hint.dataset.scoutKey='outcome-'+outcome;hint.textContent=b.dataset.outcomeKey.toUpperCase();hint.setAttribute('aria-hidden','true');b.append(hint);b.setAttribute('aria-label',name+' '+outcome);b.addEventListener('click',()=>act({type:'prepare',player:i,outcome}));(outcome==='winner'?card:errors).append(b);}card.append(errors);
   const attempts=document.createElement('div');attempts.className='attempts';for(const [type,label] of [['power','Power +1'],['x3','X3 +1'],['soft','Soft +1']]){const b=document.createElement('button');b.className='ui-btn';b.textContent=label;b.setAttribute('aria-label',name+' '+type+' smash attempt');b.onclick=()=>record(i,{type:'smash',player:i,smashType:type},type==='x3'?'X3 attempt':type==='soft'?'Soft smash attempt':'Power attempt');attempts.append(b);}card.append(attempts);return card;
  });
  const order=courtPlayers(state,m);
  order.forEach((player,slot)=>{const badge=document.createElement('kbd');badge.textContent=positionKeys[slot].toUpperCase();badge.dataset.scoutKey='player-'+slot;badge.title='Tap to record a shot; hold 1.3 seconds to select outcome';cards[player].querySelector('h3').prepend(badge,' ');});
  const divider=document.createElement('div');divider.className='court-divider';divider.append('Far end · Net · Near end');const flip=document.createElement('button');flip.className='ui-btn';flip.dataset.variant='ghost';flip.dataset.ends='true';flip.textContent='Switch ends';flip.onclick=()=>act({type:'ends'});divider.append(flip);
  $('players').replaceChildren(...order.slice(0,2).map(i=>cards[i]),divider,...order.slice(2).map(i=>cards[i]));}
  for(const card of $('players').querySelectorAll('article[data-player]')){const player=Number(card.dataset.player),key=positionKeys[courtPlayers(state,m).indexOf(player)].toUpperCase();for(const [index,type] of ['power','x3','soft'].entries()){const b=card.querySelector('.attempts').children[index];let hint=b.querySelector('kbd');if(!hint){hint=document.createElement('kbd');b.append(hint);}hint.dataset.scoutKey='smash-'+type;hint.textContent=keyEditor.label('smash-'+type);b.title=`Tap ${key}, then press ${keyEditor.label('smash-'+type)} to count one ${type==='x3'?'X3':type==='soft'?'Soft':'Power'} smash attempt`;}}
  for(const b of $('players').querySelectorAll('button:not([data-court-server])'))b.disabled=b.dataset.ends?busy||!state.selectedMatch||m.score.phase==='finished':!enabled;
  renderCourtCheckin(state,m,busy,setup);
  keyboardContext={enabled,direct,recording:busy&&recording>0&&!!state.pending&&!state.pending.finish&&healthy&&!issue&&!sample?.seeking,firstFault:!!state.pending?.firstFault,token:JSON.stringify([state.selectedMatch?.id,state.pending?.id,courtPlayers(state,m)]),order:courtPlayers(state,m)};keyboard.update();paintFeedback();
  const insights=touchInsights(state.rallies);for(const t of touchDirections(state.pending?.touches)){const p=insights.players[t.player];p.shots++;p[t.direction==='cross-court'?'crossCourt':t.direction==='down-the-line'?'downTheLine':'unknown']++;}
  $('live-stats').replaceChildren(table(['Player','Assists','W','UE','FE','Smash W'],setup.names.map((name,i)=>[playerIdentity(name,playerProfile(state,i)),m.stats[i].assists,m.stats[i].winners,m.stats[i].unforced,m.stats[i].forced,m.stats[i].smashWinners])));
  const detail=document.createElement('div');detail.className='stats-detail';for(const [i,name] of setup.names.entries()){const row=document.createElement('p'),p=insights.players[i],st=m.stats[i];row.textContent=`${name}: Power ${st.powerSmashes} · Soft ${st.softSmashes} (${st.softSmashWinners} winners) · X3 ${st.x3Smashes} · X4 ${st.x4Winners} | Assist ${st.assists} · Forced errors created ${st.forcedErrorsCreated} · Smash recovery ${st.smashRecoveryWinners} · Net touch ${st.netTouches} | Cross ${p.crossCourt} · Line ${p.downTheLine} · Unknown ${p.unknown}`;detail.append(row);}$('live-stats').append(detail);
  const sequence=state.pending?.touches??[];$('rally-sequence').textContent=sequence.length?sequence.slice(-12).map(t=>setup.names[t.player]).join(' → '):'No shots tapped in this rally';
  const pending=state.pending,finish=pending?.finish;
  $('var-review').disabled=busy||!pending;$('var-review').setAttribute('aria-pressed',String(!!pending?.varReviewed));$('var-review').textContent=pending?.varReviewed?'VAR flagged':'VAR review';
  if(finish){
   if(openId!==pending.id+':'+finish.player+':'+finish.outcome){const samePlayer=openId.startsWith(pending.id+':'+finish.player+':');openId=pending.id+':'+finish.player+':'+finish.outcome;step='shot';previousShot=undefined;if(!samePlayer){shot=undefined;smashType=undefined;}forcedBy=undefined;attributionReady=finish.outcome!=='forced';$('shot-form').reset();$('quick-save').checked=quickSave;$('counted').checked=true;$('shot-details').open=false;syncShot();$('shot-error').textContent='';}
   const order=courtPlayers(state,m),creditKey=JSON.stringify([pending.id,finish.player,order,setup.names]);if(creditKey!==attributionKey){attributionKey=creditKey;$('forced-opponents').replaceChildren(...order.filter(player=>(player<2)!==(finish.player<2)).map(player=>{const b=document.createElement('button'),kbd=document.createElement('kbd');b.type='button';b.className='ui-btn';b.dataset.player=player;b.dataset.shortcut=positionKeys[order.indexOf(player)];b.setAttribute('aria-keyshortcuts',b.dataset.shortcut.toUpperCase());b.append(setup.names[player]+' ');kbd.textContent=b.dataset.shortcut.toUpperCase();kbd.dataset.scoutKey='player-'+order.indexOf(player);b.append(kbd);b.onclick=()=>credit(player);return b;}));}
   $('assist-name').textContent='By '+setup.names[finish.player^1];$('recovery-name').textContent='By '+setup.names[finish.player];$('outside-label').hidden=finish.outcome!=='winner';
   $('shot-var').checked=!!pending.varReviewed;$('shot-var').disabled=busy;
   $('save-point').disabled=busy;syncShot();for(const b of $('smash-options').querySelectorAll('button,input'))b.disabled=busy;
   for(const id of ['assist','smash-recovery','x4','outside','net-touch','forced-unknown'])$(id).disabled=busy;
   $('shot-title').textContent=step==='previous'?setup.names[forcedBy]+' · previous stroke':step==='opponent'?'Previous opponent':`${setup.names[finish.player]} · ${finish.outcome.replace('_',' ')}`;$('save-point').disabled=busy;$('dismiss-shot').disabled=busy;
   syncShot();
   if(!$('shot-dialog').open){$('shot-dialog').showModal();common.querySelector('button')?.focus();}
  }else{openId='';if($('shot-dialog').open)$('shot-dialog').close();}
 };
}
