import {playerProfile} from './live-extension/player-profile.mjs';
// Project the existing panel controls into the host; never duplicate scoring or media logic.
export function liveWorkspace({document:doc=document,host=window.parent}={}) {
 const bridge=host.__pnLiveScout;
 if(!bridge)return ()=>{};
 // The surrounding workspace can own focus after a mouse click. Keep point
 // selection on the panel's existing shortcut path, including custom bindings.
 const forwardShotKey=event=>{
  const dialog=doc.getElementById('shot-dialog');
  if(!dialog?.open||doc.querySelector('dialog[open]:not(#shot-dialog)')||host.document.querySelector('dialog[open]')||event.defaultPrevented||event.isComposing||event.target.closest?.('input,select,textarea,[contenteditable]'))return;
  const forwarded=new doc.defaultView.KeyboardEvent(event.type,{key:event.key,code:event.code,ctrlKey:event.ctrlKey,altKey:event.altKey,shiftKey:event.shiftKey,metaKey:event.metaKey,repeat:event.repeat,bubbles:true,cancelable:true});
  if(!dialog.dispatchEvent(forwarded)){event.preventDefault();event.stopPropagation();}
 };
 for(const type of ['keydown','keyup'])host.document.addEventListener(type,forwardShotKey);
 const mediaIds=['skip--5','video-playback','skip-5','skip-90','skip--30','skip--10','skip-10','skip-30'];
 let previous='',targets=new Map();
 bridge.workspaceAction=(key,value)=>{
  const node=targets.get(key);
  if(!node||node.disabled||doc.querySelector('dialog[open]'))return false;
  if(node.tagName==='SELECT'){
   if(!Array.from(node.options).some(option=>option.value===String(value)))return false;
   node.value=String(value);node.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
  }else node.click();
  // Return keyboard ownership to the scout after a host playback/score action.
  host.document.querySelector('iframe[title="Live video scouting controls"]')?.focus();
  if(!doc.querySelector('dialog[open]')){doc.activeElement?.blur();doc.defaultView.focus();}
  return true;
 };
 const control=(node,key)=>{
  if(!node)return null;targets.set(key,node);
  return {key,label:node.getAttribute('aria-label')||node.title||node.textContent.trim(),text:Array.from(node.childNodes).filter(child=>child.nodeName!=='KBD').map(child=>child.textContent).join('').trim(),shortcut:node.querySelector('kbd')?.textContent||'',disabled:!!node.disabled,variant:node.dataset.variant,pressed:node.getAttribute('aria-pressed'),expanded:node.getAttribute('aria-expanded')};
 };
 const read=()=>{
  targets=new Map();
  // Attach presentation to each original card, keyed by player slot (not court position).
  for(const card of doc.querySelectorAll('#players .player-card')){
   const index=Number(card.dataset.player),player=bridge.matchPlayers?.[index];
   const identity=card.querySelector('.player-identity');
   if(!player||!identity||identity.querySelector('.workspace-avatar'))continue;
   const name=player.display_name||player.name||'',names=bridge.matchPlayers.map(p=>p.display_name||p.name||'');
   const profile=playerProfile({selectedMatch:{names,players:bridge.matchPlayers},setup:{names}},index);
   const avatar=doc.createElement('span');avatar.className='workspace-avatar';avatar.dataset.pair=index<2?'lime':'coral';
   const initials=doc.createElement('span');initials.className='workspace-avatar-initials';initials.textContent=name.split(/\s+/).filter(Boolean).map(part=>part[0]).slice(0,2).join('');initials.setAttribute('aria-hidden','true');avatar.append(initials);
   if(player.avatar_url){
    const photo=doc.createElement('img');photo.alt='';photo.src=player.avatar_url;photo.decoding='async';photo.addEventListener('error',()=>photo.remove(),{once:true});avatar.append(photo);
   }
   if(profile.country){
    const flag=doc.createElement('span');flag.className='workspace-avatar-flag';flag.textContent=String.fromCodePoint(...[...profile.country].map(c=>127397+c.charCodeAt(0)));flag.setAttribute('role','img');flag.setAttribute('aria-label',profile.country);flag.title=profile.country;avatar.append(flag);
   }
   identity.querySelector('.player-flag')?.remove();identity.prepend(avatar);
  }
  const rows=Array.from(doc.querySelectorAll('#score tr'),row=>Array.from(row.children,cell=>{
   const copy=cell.cloneNode(true);copy.querySelectorAll('button').forEach(button=>button.remove());
   return {text:copy.textContent.trim(),serving:cell.querySelector('strong[aria-label]')?.textContent||'',buttons:Array.from(cell.querySelectorAll('button'),(button,index)=>control(button,`score-${row.rowIndex}-${cell.cellIndex}-${index}`))};
  }));
  const commands=['scouting-menu-button','mode-pro','mode-expert','header-account'].map(id=>control(doc.getElementById(id),id)).filter(Boolean);
  const log=doc.querySelector('.header-actions > button:not([id])');if(log)commands.splice(1,0,control(log,'scouting-log'));
  const media=mediaIds.map(id=>control(doc.getElementById(id),id)).filter(Boolean);
  const speed=doc.getElementById('video-speed');control(speed,'video-speed');
  const menu=doc.getElementById('scouting-menu'),coachPanel=menu?.querySelector('#coach-panel');
  const coachOverlay=!!menu?.open&&!!coachPanel&&!coachPanel.hidden;
  doc.body.classList.toggle('workspace-coach-overlay',coachOverlay);doc.documentElement.classList.toggle('workspace-coach-overlay',coachOverlay);
  const data={matchInfo:bridge.matchInfo,coachOverlay,commands,rows,identity:doc.getElementById('match-identity')?.textContent||'',pressure:doc.getElementById('pressure')?.textContent||'',media,speed:speed?{value:speed.value,disabled:speed.disabled,options:Array.from(speed.options,option=>({value:option.value,label:option.textContent}))}:null};
  const next=JSON.stringify(data);
  if(next!==previous){previous=next;bridge.workspace=data;host.dispatchEvent(new host.CustomEvent('pn-scout-workspace'));}
  doc.body.classList.add('workspace-integrated');
 };
 const menu=doc.getElementById('scouting-menu');
 const observer=menu?new doc.defaultView.MutationObserver(read):null;
 observer?.observe(menu,{attributes:true,attributeFilter:['open','hidden'],childList:true,subtree:true});
 doc.defaultView.addEventListener('pagehide',()=>{for(const type of ['keydown','keyup'])host.document.removeEventListener(type,forwardShotKey);observer?.disconnect();delete bridge.workspaceAction;delete bridge.workspace;host.dispatchEvent(new host.CustomEvent('pn-scout-workspace'));},{once:true});
 return read;
}
