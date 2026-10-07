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
 const renderCourtCheckin=courtCheckinUI({$,act});
 let keyboardContext={enabled:false,token:'',order:[]};
 let selectedPlayer=null,holdingPlayer=null;
 const feedback=new Map();
 let recordQueue=Promise.resolve(),recording=0;
 function paintFeedback(){for(const card of $('players').querySelectorAll('[data-player]')){const player=Number(card.dataset.player),f=feedback.get(player);card.classList.toggle('keyboard-selected',player===selectedPlayer);for(const button of card.querySelectorAll('[data-outcome-key]')){if(player===selectedPlayer)button.setAttribute('aria-keyshortcuts',button.dataset.outcomeKey.toUpperCase());else button.removeAttribute('aria-keyshortcuts');}card.classList.toggle('holding',player===holdingPlayer);card.dataset.feedback=f?.phase??'';let status=card.querySelector('.tap-feedback');if(!status){status=document.createElement('span');status.className='tap-feedback';status.setAttribute('role','status');card.append(status);}status.textContent=player===selectedPlayer?'Choose outcome · W / A / D':f?.label??(player===holdingPlayer?'Hold 1.3s to select…':'');}}
 async function record(player,message,label){const f={phase:'recording',label:'Recording '+label+'…'};feedback.set(player,f);paintFeedback();recording++;const resultPromise=recordQueue.then(()=>act(message));recordQueue=resultPromise.catch(()=>{});let result;try{result=await resultPromise;}catch(error){result={ok:false,error:error.message};}finally{recording--;}if(feedback.get(player)!==f)return;f.phase=result?.ok?'recorded':'error';f.label=result?.ok?'✓ '+label+' saved locally':result?.error??'Could not record. Try again.';paintFeedback();setTimeout(()=>{if(feedback.get(player)===f){feedback.delete(player);paintFeedback();}},result?.ok?1000:3500);}
 const keyboard=playerShortcuts({target:document,context:()=>keyboardContext,select:player=>{selectedPlayer=player;paintFeedback();},hold:player=>{holdingPlayer=player;paintFeedback();},fault:type=>act({type}),tap:player=>record(player,{type:'touch',player},'Shot'),smash:(player,smashType,latestTouch=false)=>record(player,{type:'smash',player,smashType,latestTouch},smashType==='x3'?'X3 attempt':smashType==='soft'?'Soft smash attempt':'Power attempt'),prepare:(player,outcome)=>act({type:'prepare',player,outcome})});
 let setupKey='',playerKey='',openId='',shot,smashType,serverKey='',seedKey='',forcedBy,attributionReady=false,attributionKey='';
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
 $('undo').onclick=()=>act({type:'undo-last'});
 for(const type of ['first-fault','double-fault'])$(type).addEventListener('click',()=>act({type}));
 let quickSave=globalThis.localStorage?.getItem('pn-quick-save')==='true';
 $('quick-save').checked=quickSave;
 function setQuick(value){quickSave=value;$('quick-save').checked=value;globalThis.localStorage?.setItem('pn-quick-save',String(value));}
 $('quick-save').addEventListener('change',()=>setQuick($('quick-save').checked));
 $('shot-details').addEventListener('toggle',()=>{if($('shot-details').open)setQuick(false)});
 function chooseShot(key,fromKeyboard=false){if($('save-point').disabled)return;shot=key;attributionReady=true;if(key!=='smash')$('x4').checked=false;syncShot();$('shot-error').textContent='';if(!fromKeyboard&&$('quick-save').checked&&shot!=='smash')savePoint();}
 function shotButton(key,shortcut){
  const b=document.createElement('button');b.type='button';b.className='ui-btn';b.dataset.size='sm';b.textContent=key==='bajada'?'Bajada de pared':shots[key];b.dataset.shot=key;b.setAttribute('aria-pressed','false');
  if(shortcut){b.dataset.shortcut=shortcut;b.setAttribute('aria-keyshortcuts',shortcut);b.title=(key==='bajada'?'Bajada de pared':shots[key])+' · '+shortcutLabel(shortcut);const kbd=document.createElement('kbd');kbd.textContent=shortcutLabel(shortcut);b.append(kbd);}
  b.addEventListener('click',()=>chooseShot(key));return b;
 }
 const common=document.createElement('div');common.className='shot-grid';common.setAttribute('aria-label','Common shots');
 for(const [shortcut,key] of quickShots)common.append(shotButton(key,shortcut));
 const more=document.createElement('section'),heading=document.createElement('h3'),extra=document.createElement('div');
 heading.textContent='Other strokes';extra.className='shot-grid';extra.setAttribute('aria-label','Other strokes');
 for(const [shortcut,key] of extraShots)extra.append(shotButton(key,shortcut));
 more.append(heading,extra);
 $('shot-options').append(common,more);
 function matchingAttempt(){const p=getState()?.pending;return p?.attempts?.findLastIndex(a=>a.player===p.finish?.player&&a.smashType===smashType)??-1;}
 function syncShot(){
  for(const b of $('shot-options').querySelectorAll('button')){b.setAttribute('aria-pressed',String(b.dataset.shot===shot));b.dataset.variant=b.dataset.shot===shot?'primary':'default';}
  const p=getState()?.pending,smash=shot==='smash',canLink=smash&&!!smashType&&matchingAttempt()>=0;
  const x4=p?.finish?.outcome==='winner'&&$('x4').checked,recovery=p?.finish?.outcome==='winner'&&$('smash-recovery').checked;
  $('smash-options').hidden=!smash;$('x4-label').hidden=p?.finish?.outcome!=='winner';$('shot-options').hidden=x4||recovery;$('x4-action').hidden=!x4;$('smash-type-picker').hidden=x4;
  $('forced-credit').hidden=p?.finish?.outcome!=='forced';
  $('shot-instruction').textContent=p?.finish?.outcome==='forced'&&!attributionReady?'Tap the opponent’s player key, or continue without credit. Then choose the stroke and Space.':recovery?'Smash recovery winner · Space to save. No stroke needed.':'Choose the stroke, then Space to save.';
  for(const b of $('forced-opponents').querySelectorAll('button')){b.setAttribute('aria-pressed',String(Number(b.dataset.player)===forcedBy));b.disabled=$('save-point').disabled;}
  $('forced-unknown').textContent=forcedBy===undefined?'Not recorded · continue':'Clear attribution';
  for(const b of $('smash-options').querySelectorAll('[data-smash-type]'))b.setAttribute('aria-pressed',String(b.dataset.smashType===smashType));
  $('counted-label').hidden=!canLink;
  const label=!shot?(recovery?`${getState()?.setup?.names[p?.finish?.player]??'Player'} · winner`:'Choose a stroke'):smash&&!smashType?'Choose Power, X3 or Soft smash before saving':`${getState()?.setup?.names[p?.finish?.player]??'Player'} · ${p?.finish?.outcome??''} · ${shots[shot]}${smash?' '+(smashType==='x3'?'X3':smashType==='soft'?'Soft':'Power'):''}${smash&&$('x4').checked?' · X4 winner':''}${smash&&smashType?' · '+(canLink&&$('counted').checked?'Attempt already counted':'Adds one attempt'):''}`;
  $('shot-summary').textContent=label+(forcedBy!==undefined?' · Forced by '+getState().setup.names[forcedBy]:'')+($('assist').checked?' · Assist: '+getState().setup.names[p.finish.player^1]:'')+($('smash-recovery').checked?' · Smash recovery':'')+($('net-touch').checked?' · Net touch':'');
  for(const input of ['assist','smash-recovery','x4'])$(input).closest('label').classList.toggle('selected',$(input).checked);
 }
 function chooseType(type){smashType=type;if(type!=='power')$('x4').checked=false;syncShot();}
 for(const b of $('smash-options').querySelectorAll('[data-smash-type]'))b.onclick=()=>chooseType(b.dataset.smashType);
 $('x4').onchange=()=>{if($('x4').checked){shot='smash';smashType='power';}else if($('smash-recovery').checked){shot=undefined;smashType=undefined;}syncShot();$('save-point').focus();};$('counted').onchange=syncShot;
 $('smash-recovery').onchange=()=>{if($('smash-recovery').checked&&!$('x4').checked){shot=undefined;smashType=undefined;}syncShot();$('shot-error').textContent='';$('save-point').focus();};
 for(const id of ['assist','net-touch'])$(id).onchange=()=>{syncShot();$('save-point').focus();};
 function credit(player){forcedBy=player;attributionReady=true;syncShot();common.querySelector('button')?.focus();}
 $('forced-unknown').onclick=()=>credit(undefined);
 const cancel=()=>act({type:'clear-outcome'});
 $('dismiss-shot').addEventListener('click',cancel);
 $('shot-dialog').addEventListener('cancel',e=>{e.preventDefault();cancel()});
 function savePoint(){
  const p=getState()?.pending?.finish;if(!p||$('save-point').disabled)return;const recovery=p.outcome==='winner'&&$('smash-recovery').checked;if((!shot&&!recovery)||shot==='smash'&&!smashType){$('shot-error').textContent='Choose a shot'+(shot==='smash'?' and smash type':'')+', then press Space to save.';return;}
  act({type:'score',details:{...(shot?{shot}:{}),...(shot==='smash'?{smashType,...(p.outcome==='winner'&&$('x4').checked?{x4:true}:{})}:{}),...($('shot-side').value?{side:$('shot-side').value}:{}),...($('net-touch').checked?{netTouch:true}:{}),...(p.outcome==='forced'&&forcedBy!==undefined?{forcedBy}:{}),...(p.outcome==='winner'?{...($('assist').checked?{assistBy:p.player^1}:{}),...($('outside').checked?{recovery:true}:{}),...($('smash-recovery').checked?{smashRecovery:true}:{})}:{}),...(shot==='smash'&&matchingAttempt()>=0&&$('counted').checked?{smashAlreadyCounted:true,smashAttemptIndex:matchingAttempt()}:{} )}});
 }
 $('shot-form').addEventListener('submit',e=>{e.preventDefault();savePoint();});
 $('shot-form').addEventListener('keydown',e=>{
  if(e.repeat){if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();}return;}if(e.isComposing||e.altKey)return;
  if((e.key==='Enter'||e.key===' ')&&!e.target.closest('input,select,textarea,[contenteditable]')){e.preventDefault();e.stopPropagation();if(shot||getState()?.pending?.finish?.outcome==='winner'&&$('smash-recovery').checked||e.ctrlKey||e.metaKey)savePoint();else $('shot-error').textContent='Choose a shot, then press Space to save.';return;}
  if(e.ctrlKey||e.metaKey||e.target.closest('input,select,textarea,[contenteditable]'))return;
  const key=e.key.toLowerCase(),finish=getState()?.pending?.finish;if($('save-point').disabled)return;
  if(!e.shiftKey&&finish?.outcome==='forced'&&(!attributionReady||e.target.closest('#forced-credit'))){const b=[...$('forced-opponents').querySelectorAll('button')].find(b=>b.dataset.shortcut===key);if(b){e.preventDefault();credit(Number(b.dataset.player));return;}}
  if(!e.shiftKey&&finish?.outcome==='winner'&&['f','r','4'].includes(key)){e.preventDefault();const id={f:'assist',r:'smash-recovery',4:'x4'}[key];$(id).checked=!$(id).checked;$(id).onchange();return;}
  if(finish?.outcome==='winner'&&$('smash-recovery').checked&&!$('x4').checked)return;
  if(!e.shiftKey&&shot==='smash'&&['z','x','c'].includes(key)){e.preventDefault();chooseType(key==='z'?'power':key==='x'?'x3':'soft');return;}
  const choice=[...$('shot-options').querySelectorAll('button')].find(b=>b.dataset.shortcut===shotShortcut(e));
  if(choice){e.preventDefault();if(!choice.disabled)chooseShot(choice.dataset.shot,true);}
 });
 return function render(state,sample,busy,healthy){
  const setup=state.setup??defaults(),m=match(state),locked=!!state.pending||state.rallies.some(r=>r.point);
  const seedToken=JSON.stringify([state.selectedMatch?.id,setup.startingScore,setup.names]);
  if(seedToken!==seedKey){seedKey=seedToken;const seed=setup.startingScore; $('seed-count').value=seed?.completed.length??0;for(const i of [1,2])for(const team of ['a','b'])$(`seed-${i}-${team}`).value=seed?.completed[i-1]?.[team]??0;for(const team of ['a','b']){$('seed-games-'+team).value=seed?.games[team]??0;$('seed-points-'+team).value=seed?.points[team]??0;}$('seed-server').replaceChildren(...setup.names.map((n,i)=>new Option(n,i)));$('seed-server').value=seed?.server??setup.firstServer;$('seed-near').value=seed?.near??setup.near??'a';$('seed-deuce').value=seed?.advantageReturns??0;$('seed-elapsed').value=seed?.elapsedSeconds===undefined?'':seed.elapsedSeconds/60;seedRows();}
  for(const input of $('starting-score-form').elements)input.disabled=locked||busy||!state.selectedMatch;
  $('seed-note').textContent=locked?'Starting score locks after your first recorded point.':setup.startingScore?'Starting score saved. New scouting points continue from here.':'Set this before recording your first point.';
  const key=JSON.stringify(setup);
  if(key!==setupKey){setupKey=key;setup.names.forEach((n,i)=>{$(`name-${i}`).value=n});for(const id of ['first-server','other-server']){$(id).replaceChildren(...setup.names.map((n,i)=>{const o=document.createElement('option');o.value=i;o.textContent=n;return o;}));} $('first-server').value=setup.firstServer;$('other-server').value=setup.otherServer;$('rule').value=setup.rule;}
  for(const input of $('setup-form').elements)input.disabled=locked||busy;
  const scoreTable=document.createElement('table');scoreTable.className='score-table';const heading=document.createElement('tr');for(const text of ['Pair',...m.score.sets.map((_,i)=>`Set ${i+1}`),'Points']){const th=document.createElement('th');th.textContent=text;heading.append(th);}scoreTable.append(heading);
  for(const [i,team] of ['a','b'].entries()){
   const row=document.createElement('tr'),name=document.createElement('td');
   setup.names.slice(i*2,i*2+2).forEach((n,j)=>{if(j)name.append(' / ');const text=document.createElement(i*2+j===m.server&&m.score.phase!=='finished'?'strong':'span');text.textContent=n;if(text.tagName==='STRONG')text.setAttribute('aria-label',n+', serving');name.append(text);});row.append(name);
   for(const text of [...m.score.sets.map(s=>s[team]),scoreLabel(m.score,team)]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}scoreTable.append(row);
  }
  $('score').replaceChildren(scoreTable);
  $('score-baseline').textContent=setup.startingScore?`Starting score included · scouting from set ${setup.startingScore.completed.length+1}`:'';
  $('server').textContent=m.score.phase==='finished'?`Match finished · Pair ${m.score.winner.toUpperCase()} wins`:`Serving: ${setup.names[m.server]} · ${m.points} points recorded`;
  let issue='';if(state.pending&&sample&&!state.pending.finish){try{finishRally(state.pending,sample)}catch(e){issue=e.message;}}
  $('rally-recovery').hidden=!issue;$('restart-rally').disabled=busy||!healthy||!!sample?.seeking||!!sample?.ended;
  const enabled=!!state.pending&&!state.pending.finish&&!busy&&healthy&&!sample?.seeking&&!issue;
  $('rally').textContent=m.score.phase==='finished'?'Match complete':state.pending?sample?.paused?'Rally paused with video':'Rally in progress':m.points?'Start next rally':'Start rally';
  $('rally').disabled=busy||!healthy||!state.selectedMatch||!!state.pending||sample?.paused||sample?.seeking||m.score.phase==='finished';
  $('touch-status').textContent=state.pending?.touches?.length?`${state.pending.touches.length} shot${state.pending.touches.length===1?'':'s'} tapped · last: ${setup.names[state.pending.touches.at(-1).player]}`:'';
  $('rally-status').textContent=issue|| (state.pending?state.pending.finish?'Outcome selected · save the shot details':`${Math.max(0,(sample?.time??state.pending.start.time)-state.pending.start.time).toFixed(1)}s video time · ${sample?.paused?'paused':'recording'}`:m.score.phase==='finished'?'Review the score and sync below':'Start at the first serve');
  $('first-fault').disabled=!enabled||!!state.pending?.firstFault;$('double-fault').disabled=!enabled||!state.pending?.firstFault;$('undo').disabled=busy||(!state.history?.length&&(!m.points||!!state.pending));
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
  const next=JSON.stringify([setup.names,m.server,m.score.phase,m.stats,m.near,m.swapped,courtPlayers(state,m),state.selectedMatch?.players]);
  if(next!==playerKey){playerKey=next;const cards=setup.names.map((name,i)=>{
   const card=document.createElement('article'),h=document.createElement('h3'),stats=document.createElement('small');card.className=`player-card${i===m.server&&m.score.phase!=='finished'?' serving':''}`;card.dataset.player=i;card.setAttribute('aria-label',name);h.append(playerIdentity(name,playerProfile(state,i)));const st=m.stats[i];stats.textContent=`W ${st.winners} · X3 ${st.x3Smashes} · Power ${st.powerSmashes} · Soft ${st.softSmashes}${st.x4Winners?' · X4 '+st.x4Winners:''}`;stats.setAttribute('aria-label',`${st.winners} winners, ${st.unforced} unforced errors, ${st.forced} forced errors, ${st.smashes} smash attempts, ${st.x4Winners} X4 winners`);card.append(h,stats);
   const errors=document.createElement('div');errors.className='errors';
   for(const [outcome,label] of [['winner','Winner'],['unforced','Unforced'],['forced','Forced']]){const b=document.createElement('button');b.className='ui-btn';b.dataset.variant=outcome==='winner'?'record':'default';b.textContent=label;b.dataset.outcomeKey={winner:'w',unforced:'a',forced:'d'}[outcome];const hint=document.createElement('kbd');hint.className='outcome-key';hint.textContent=b.dataset.outcomeKey.toUpperCase();hint.setAttribute('aria-hidden','true');b.append(hint);b.setAttribute('aria-label',name+' '+outcome);b.addEventListener('click',()=>act({type:'prepare',player:i,outcome}));(outcome==='winner'?card:errors).append(b);}card.append(errors);
   const attempts=document.createElement('div');attempts.className='attempts';for(const [type,label] of [['x3','X3 +1'],['power','Power +1'],['soft','Soft +1']]){const b=document.createElement('button');b.className='ui-btn';b.textContent=label;b.setAttribute('aria-label',name+' '+type+' smash attempt');b.onclick=()=>record(i,{type:'smash',player:i,smashType:type},type==='x3'?'X3 attempt':type==='soft'?'Soft smash attempt':'Power attempt');attempts.append(b);}card.append(attempts);return card;
  });
  const order=courtPlayers(state,m);
  order.forEach((player,slot)=>{const badge=document.createElement('kbd');badge.textContent=positionKeys[slot].toUpperCase();badge.title='Tap to record a shot; hold 1.3 seconds to select outcome';cards[player].querySelector('h3').prepend(badge,' ');});
  const divider=document.createElement('div');divider.className='court-divider';divider.append('Far end · Net · Near end');const flip=document.createElement('button');flip.className='ui-btn';flip.dataset.variant='ghost';flip.dataset.ends='true';flip.textContent='Switch ends';flip.onclick=()=>act({type:'ends'});divider.append(flip);
  $('players').replaceChildren(...order.slice(0,2).map(i=>cards[i]),divider,...order.slice(2).map(i=>cards[i]));}
  for(const card of $('players').querySelectorAll('article[data-player]')){const player=Number(card.dataset.player),key=positionKeys[courtPlayers(state,m).indexOf(player)].toUpperCase();for(const [index,type] of ['x3','power','soft'].entries()){const b=card.querySelector('.attempts').children[index];let hint=b.querySelector('kbd');if(!hint){hint=document.createElement('kbd');b.append(hint);}hint.textContent=`${key} → ${type==='x3'?'X':type==='soft'?'C':'Z'}`;b.title=`Tap ${key}, then press ${type==='x3'?'X':type==='soft'?'C':'Z'} to count one ${type==='x3'?'X3':type==='soft'?'Soft':'Power'} smash attempt`;}}
  for(const b of $('players').querySelectorAll('button:not([data-court-server])'))b.disabled=b.dataset.ends?busy||!state.selectedMatch||m.score.phase==='finished':!enabled;
  renderCourtCheckin(state,m,busy,setup);
  keyboardContext={enabled,recording:busy&&recording>0&&!!state.pending&&!state.pending.finish&&healthy&&!issue&&!sample?.seeking,firstFault:!!state.pending?.firstFault,token:JSON.stringify([state.selectedMatch?.id,state.pending?.id,courtPlayers(state,m)]),order:courtPlayers(state,m)};keyboard.update();paintFeedback();
  const insights=touchInsights(state.rallies);for(const t of touchDirections(state.pending?.touches)){const p=insights.players[t.player];p.shots++;p[t.direction==='cross-court'?'crossCourt':t.direction==='down-the-line'?'downTheLine':'unknown']++;}
  $('live-stats').replaceChildren(table(['Player','Assists','W','UE','FE'],setup.names.map((name,i)=>[playerIdentity(name,playerProfile(state,i)),m.stats[i].assists,m.stats[i].winners,m.stats[i].unforced,m.stats[i].forced])));
  const detail=document.createElement('div');detail.className='stats-detail';for(const [i,name] of setup.names.entries()){const row=document.createElement('p'),p=insights.players[i],st=m.stats[i];row.textContent=`${name}: Power ${st.powerSmashes} · Soft ${st.softSmashes} (${st.softSmashWinners} winners) · X3 ${st.x3Smashes} · X4 ${st.x4Winners} | Assist ${st.assists} · Forced errors created ${st.forcedErrorsCreated} · Smash recovery ${st.smashRecoveryWinners} · Net touch ${st.netTouches} | Cross ${p.crossCourt} · Line ${p.downTheLine} · Unknown ${p.unknown}`;detail.append(row);}$('live-stats').append(detail);
  const sequence=state.pending?.touches??[];$('rally-sequence').textContent=sequence.length?sequence.slice(-12).map(t=>setup.names[t.player]).join(' → '):'No shots tapped in this rally';
  const pending=state.pending,finish=pending?.finish;
  $('var-review').disabled=busy||!pending;$('var-review').setAttribute('aria-pressed',String(!!pending?.varReviewed));$('var-review').textContent=pending?.varReviewed?'VAR flagged':'VAR review';
  if(finish){
   if(openId!==pending.id){openId=pending.id;shot=undefined;smashType=undefined;forcedBy=undefined;attributionReady=finish.outcome!=='forced';$('shot-form').reset();$('quick-save').checked=quickSave;$('counted').checked=true;$('shot-details').open=false;more.open=false;syncShot();$('shot-error').textContent='';}
   const order=courtPlayers(state,m),creditKey=JSON.stringify([pending.id,finish.player,order,setup.names]);if(creditKey!==attributionKey){attributionKey=creditKey;$('forced-opponents').replaceChildren(...order.filter(player=>(player<2)!==(finish.player<2)).map(player=>{const b=document.createElement('button'),kbd=document.createElement('kbd');b.type='button';b.className='ui-btn';b.dataset.player=player;b.dataset.shortcut=positionKeys[order.indexOf(player)];b.setAttribute('aria-keyshortcuts',b.dataset.shortcut.toUpperCase());b.append(setup.names[player]+' ');kbd.textContent=b.dataset.shortcut.toUpperCase();b.append(kbd);b.onclick=()=>credit(player);return b;}));}
   $('assist-name').textContent='By '+setup.names[finish.player^1];$('recovery-name').textContent='By '+setup.names[finish.player];$('outside-label').hidden=finish.outcome!=='winner';
   $('shot-var').checked=!!pending.varReviewed;$('shot-var').disabled=busy;
   $('save-point').disabled=busy;syncShot();for(const b of $('smash-options').querySelectorAll('button,input'))b.disabled=busy;
   for(const id of ['assist','smash-recovery','x4','net-touch','forced-unknown'])$(id).disabled=busy;
   $('shot-title').textContent=`${setup.names[finish.player]} · ${finish.outcome.replace('_',' ')}`;$('winner-tags').hidden=finish.outcome!=='winner';$('save-point').disabled=busy;$('dismiss-shot').disabled=busy;
   for(const b of $('shot-options').querySelectorAll('button'))b.disabled=busy;
   if(!$('shot-dialog').open){$('shot-dialog').showModal();(finish.outcome==='forced'?$('forced-opponents'):common).querySelector('button')?.focus();}
  }else{openId='';if($('shot-dialog').open)$('shot-dialog').close();}
 };
}
