export function manualUI({$,act,call,getState}){
 const chosen=Array(4).fill(null),timers=Array(4).fill(null),versions=Array(4).fill(0);
 let restoredDraft='',listKey='',mode='find';
 const menu=$('scouting-menu'),toggle=$('scouting-menu-button');
 function closeMenu(){menu.close();toggle.setAttribute('aria-expanded','false');}
 toggle.onclick=()=>{menu.showModal();toggle.setAttribute('aria-expanded','true');};
 $('close-menu').onclick=closeMenu;menu.addEventListener('close',()=>toggle.setAttribute('aria-expanded','false'));
 menu.addEventListener('click',event=>{if(event.target===menu){const box=menu.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)closeMenu();}});
 function reveal(node){for(let p=node;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;node.scrollIntoView({block:'start',behavior:'smooth'});}
 function showMode(value){mode=value;document.body.classList.toggle('creating-match',value==='create');$('find-match-view').hidden=value!=='find';$('manual-match-form').hidden=value!=='create';$('mode-find').setAttribute('aria-pressed',String(value==='find'));$('mode-create').setAttribute('aria-pressed',String(value==='create'));reveal($('catalog-panel'));if(value==='create')$('manual-player-0').focus();}
 $('catalog-panel').addEventListener('toggle',()=>document.body.classList.toggle('creating-match',mode==='create'&&$('catalog-panel').open));
 $('manual-cancel').onclick=()=>{showMode('find');$('catalog-panel').open=false;reveal($('scouting-workspace'));};
 $('mode-find').onclick=()=>showMode('find');$('mode-create').onclick=()=>showMode('create');
 for(const button of menu.querySelectorAll('[data-menu]'))button.onclick=()=>{
  closeMenu();const target=button.dataset.menu;
  if(target==='find'||target==='create')showMode(target);
  else if(target==='saved'){$('saved-sessions-panel').hidden=false;reveal($('saved-sessions-panel'));act({type:'manual-matches'});}
  else if(target==='shortcuts')reveal($('shortcut-settings'));
  else{reveal($('save-settings'));$('account-panel').scrollIntoView({block:'start',behavior:'smooth'});}
 };
 $('close-sessions').onclick=()=>{$('saved-sessions-panel').hidden=true;toggle.focus();};
 $('refresh-private').onclick=async()=>{const result=await act({type:'manual-matches'});$('saved-error').textContent=result.ok?'':result.error;};
 $('open-saved-video').onclick=()=>act({type:'open-video'});
 for(let i=0;i<4;i++){
  const input=$('manual-player-'+i),results=$('manual-player-results-'+i),hint=$('manual-player-hint-'+i);
  input.addEventListener('keydown',event=>{if(event.key==='ArrowDown'&&results.firstElementChild){event.preventDefault();results.firstElementChild.focus();}if(event.key==='Escape')results.replaceChildren();});
  input.addEventListener('input',()=>{
   chosen[i]=null;versions[i]++;const version=versions[i],query=input.value.trim();clearTimeout(timers[i]);results.replaceChildren();hint.textContent=query?'Name only · private scouting':'Type a name or choose an existing player.';$('manual-error').textContent='';
   if(query.length<2)return;
   timers[i]=setTimeout(async()=>{
    try{const data=await call({type:'search-players',query});if(version!==versions[i])return;
     results.replaceChildren(...(data.players??[]).map(person=>{
      const button=document.createElement('button');button.type='button';button.className='ui-btn';button.dataset.variant='ghost';button.textContent=person.name+(person.country?' · '+person.country:'');
      button.onclick=()=>{chosen[i]=person.id;input.value=person.name;versions[i]++;results.replaceChildren();hint.textContent='Existing player';input.focus();};
      button.onkeydown=event=>{if(event.key==='Escape'){results.replaceChildren();input.focus();}if(event.key==='ArrowDown'){event.preventDefault();button.nextElementSibling?.focus();}if(event.key==='ArrowUp'){event.preventDefault();(button.previousElementSibling??input).focus();}};return button;
     }));
    }catch{if(version===versions[i])hint.textContent='Suggestions unavailable · you can still use this name.';}
   },250);
  });
  input.addEventListener('blur',()=>setTimeout(()=>{if(!results.contains(document.activeElement))results.replaceChildren();},100));
 }
 $('manual-match-form').onsubmit=async event=>{
  event.preventDefault();$('manual-error').textContent='';
  for(let i=0;i<4;i++){$('manual-player-results-'+i).replaceChildren();versions[i]++;clearTimeout(timers[i]);}
  const input={players:chosen.map((id,i)=>({id,name:$('manual-player-'+i).value})),matchDate:$('manual-date').value,tournamentLabel:$('manual-tournament').value,videoUrl:$('manual-video').value};
  const result=await act({type:'create-manual',input});
  if(result.ok){$('manual-match-form').reset();chosen.fill(null);for(let i=0;i<4;i++)$('manual-player-hint-'+i).textContent='Type a name or choose an existing player.';restoredDraft='';showMode('find');$('catalog-panel').open=false;reveal($('video-panel'));$('connection-feedback').textContent='Private match created. Open your video, click the extension icon there, then Connect video.';}
  else{$('manual-error').textContent=result.error;reveal($('manual-error'));}
 };
 function render(state,busy){
  const locked=busy||!!state.pending;
  $('manual-cancel').hidden=!state.selectedMatch;$('manual-cancel').disabled=busy;
  for(const button of menu.querySelectorAll('[data-menu]'))button.disabled=locked&&['find','create','saved'].includes(button.dataset.menu);
  $('menu-note').textContent=state.pending?'Save or cancel the current rally before switching matches.':busy?'Saving your action…':'';
  for(const id of ['mode-find','mode-create','create-manual','refresh-private'])$(id).disabled=locked;
  for(const input of $('manual-match-form').querySelectorAll('input'))input.disabled=locked;
  $('create-manual').textContent=busy&&mode==='create'?'Creating match…':'Create match';
  $('open-saved-video').hidden=!state.selectedMatch?.videoUrl;$('open-saved-video').disabled=locked;
  if(state.manualDraft?.id&&restoredDraft!==state.manualDraft.id){restoredDraft=state.manualDraft.id;state.manualDraft.players.forEach((p,i)=>{chosen[i]=p.id;$('manual-player-'+i).value=p.name;$('manual-player-hint-'+i).textContent=p.id?'Existing player':'Name only · private scouting';});$('manual-date').value=state.manualDraft.matchDate??'';$('manual-tournament').value=state.manualDraft.tournamentLabel;$('manual-video').value=state.manualDraft.videoUrl;}
  const sessions=new Map((state.manualMatches??[]).map(m=>[m.id,{selectedMatch:m,rallies:[]}]));
  for(const saved of Object.values(state.sessions??{}))if(saved.selectedMatch)sessions.set(saved.selectedMatch.id,saved);
  if(state.selectedMatch)sessions.set(state.selectedMatch.id,{selectedMatch:state.selectedMatch,rallies:state.rallies});
  const key=JSON.stringify([[...sessions],locked]);if(key===listKey)return;listKey=key;
  const rows=[...sessions.values()].map(saved=>{
   const selected=saved.selectedMatch,row=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('small'),actions=document.createElement('div'),button=document.createElement('button'),report=document.createElement('a');
   row.className='saved-session';name.textContent=selected.names.slice(0,2).join(' / ')+' vs '+selected.names.slice(2).join(' / ');meta.textContent=[selected.kind==='manual'?'Private · manually created':selected.tournamentName,selected.matchDate,`${saved.rallies?.filter(r=>r.point&&!r.undone).length??0} points on this device`].filter(Boolean).join(' · ');
   actions.className='catalog-filters';button.className='ui-btn';button.textContent=selected.id===state.selectedMatch?.id?'Current match':'Open session';button.disabled=locked||selected.id===state.selectedMatch?.id;button.onclick=async()=>{const result=await act({type:'resume-session',matchId:selected.id});if(result.ok){$('saved-sessions-panel').hidden=true;reveal($('video-panel'));}else $('saved-error').textContent=result.error;};
   report.href='https://admin.padelnachos.com/scouting/'+(selected.kind==='manual'?'manual/':'')+encodeURIComponent(selected.id)+'/report';report.target='_blank';report.rel='noopener';report.textContent='View report';actions.append(button,report);row.append(name,meta,actions);return row;
  });
  if(!rows.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='No sessions yet. Find a match or create a private match to begin.';rows.push(empty);}$('saved-sessions-list').replaceChildren(...rows);
 }
 return render;
}
