import {allShotShortcuts} from './shot-shortcuts.mjs';
const action=(id,label,key,scopes)=>({id,label,key,scopes});
export const scoutingKeyActions=[
 ...['q','w','a','s'].map((key,i)=>action('player-'+i,['Far left player','Far right player','Near left player','Near right player'][i],key,['rally','opponent'])),
 ...Object.entries({winner:'w',unforced:'a',forced:'d'}).map(([name,key])=>action('outcome-'+name,name==='unforced'?'Unforced error':name==='forced'?'Forced error':'Winner',key,['outcome'])),
 ...allShotShortcuts.map(([key,shot])=>action('shot-'+shot,shot.replaceAll('_',' '),key,['shot','previous'])),
 ...Object.entries({power:'z',x3:'x',soft:'c'}).map(([name,key])=>action('smash-'+name,name+' smash',key,['rally','outcome','shot'])),
 action('first-fault','First fault','1',['rally']),action('double-fault','Double fault','2',['rally']),
 action('assist','Teammate assist','f',['shot']),action('smash-recovery','Smash recovery','r',['shot']),action('x4','X4 winner','4',['shot']),
 action('save','Start / continue / save','space',['rally','shot','previous','opponent']),action('back','Back / change outcome','escape',['shot','previous','opponent','outcome']),
 action('undo','Undo','ctrl+z',['rally','shot','previous','opponent','outcome']),
];
export const keyLabel=key=>key.split('+').map(k=>({space:'Space',escape:'Esc',ctrl:'Ctrl',meta:'⌘',shift:'Shift',alt:'Alt'}[k]??(k.length===1?k.toUpperCase():k))).join('+');
export function eventKey(e){return [e.ctrlKey?'ctrl':null,e.altKey?'alt':null,e.shiftKey?'shift':null,e.metaKey?'meta':null,e.key===' '?'space':e.key.toLowerCase()].filter(Boolean).join('+');}
export function validateKeyAssignment(bindings,id,key,media=[]){
 const a=scoutingKeyActions.find(a=>a.id===id);if(!a)throw Error('Unknown action.');
 const base=key.split('+').at(-1);
 if(id!=='undo'&&['ctrl+z','meta+z'].includes(key))throw Error('That combination is reserved for Undo.');
 if(!base||['control','meta','shift','alt','tab','dead','unidentified','capslock','enter'].includes(base))throw Error('Choose a letter, number, navigation or function key. Tab and Enter are reserved for navigation.');
 if(['ctrl+w','meta+w','ctrl+r','meta+r','ctrl+l','meta+l','ctrl+t','meta+t'].includes(key))throw Error('That combination is reserved by the browser.');
 if(media.includes(key))throw Error('That key is assigned to video controls. Change it in Video keyboard shortcuts first.');
 const conflict=scoutingKeyActions.find(b=>b.id!==id&&(bindings[b.id]??b.key)===key&&b.scopes.some(s=>a.scopes.includes(s)));
 if(conflict)throw Error('Already used by '+conflict.label+' in this step.');
 return {...bindings,[id]:key};
}
// Translate only the active stage. Existing recording handlers remain authoritative.
export function scoutingKeys({$,scope,onEditing=()=>{}}){
 let saved={};try{saved=JSON.parse(globalThis.localStorage?.getItem('pn-scouting-keys')??'{}');}catch{}
 let bindings=Object.fromEntries(scoutingKeyActions.filter(a=>typeof saved[a.id]==='string').map(a=>[a.id,saved[a.id]]));try{for(const [id,key] of Object.entries(bindings))validateKeyAssignment(bindings,id,key);}catch{bindings={};}
 let editing=false,capture=null;const forwarded=new WeakSet(),down=new Map();
 const doc=$('players').ownerDocument,dialog=doc.createElement('dialog');dialog.id='scout-key-editor';dialog.setAttribute('aria-label','Edit scouting shortcuts');
 dialog.innerHTML='<div class="section-head"><h2>Edit shortcuts</h2><button type="button" class="ui-btn" data-key-close>Done</button></div><p class="hint">Click a shortcut, then press its new key. Keys can be reused in different steps. Escape cancels a change.</p><div data-key-fields></div><p data-key-message role="status"></p><button type="button" class="ui-btn" data-key-reset>Reset scouting keys</button>';
 doc.body.append(dialog);const fields=dialog.querySelector('[data-key-fields]'),message=dialog.querySelector('[data-key-message]');
 function paint(){for(const el of doc.querySelectorAll('[data-scout-key]')){const a=scoutingKeyActions.find(a=>a.id===el.dataset.scoutKey);if(!a)continue;const prefix=scoutingKeyActions.find(a=>a.id===el.dataset.keyPrefix);const label=(prefix?keyLabel(bindings[prefix.id]??prefix.key)+' → ':'')+keyLabel(bindings[a.id]??a.key);if(el.textContent!==label)el.textContent=label;el.title='Edit '+a.label+' shortcut';}for(const b of fields.querySelectorAll('button')){const a=scoutingKeyActions.find(a=>a.id===b.dataset.action);const label=capture===a.id?'Press a new key…':keyLabel(bindings[a.id]??a.key);if(b.textContent!==label)b.textContent=label;}}
 function listen(id){capture=id;message.textContent='Press the new key for '+scoutingKeyActions.find(a=>a.id===id).label;paint();}
 for(const a of scoutingKeyActions){const label=doc.createElement('label'),button=doc.createElement('button');label.textContent=a.label;button.type='button';button.className='ui-btn';button.dataset.action=a.id;button.onclick=()=>listen(a.id);label.append(button);fields.append(label);}
 function open(){editing=true;onEditing(true);down.clear();dialog.showModal();paint();}
 function close(){capture=null;editing=false;onEditing(false);dialog.close();paint();}
 $('edit-scout-keys').onclick=open;dialog.querySelector('[data-key-close]').onclick=close;
 dialog.addEventListener('cancel',e=>{e.preventDefault();if(capture){capture=null;paint();}else close();});
 dialog.querySelector('[data-key-reset]').onclick=()=>{try{globalThis.localStorage?.removeItem('pn-scouting-keys');bindings={};capture=null;paint();message.textContent='Default scouting keys restored.';}catch{message.textContent='Could not save. Your shortcuts were not changed.';}};
 doc.addEventListener('click',e=>{const media=e.target.closest?.('[data-media-key]');if(media){e.preventDefault();e.stopImmediatePropagation();doc.querySelector('[data-menu=shortcuts]')?.click();const label=globalThis.__pnMediaKeys.actions[media.dataset.mediaKey]+' shortcut';doc.querySelector(`[aria-label="${label}"]`)?.focus();return;}const k=e.target.closest?.('[data-scout-key]');if(!k)return;e.preventDefault();e.stopImmediatePropagation();open();listen(k.dataset.scoutKey);},true);
 const mediaKeys=()=>{try{return [...doc.querySelectorAll('[data-media-key]')].map(el=>el.textContent.toLowerCase().replace('⌘','meta').replace(' ','space'));}catch{return [];}};
 function translate(e){
  if(forwarded.has(e))return;
  if(editing){e.stopImmediatePropagation();if(e.type!=='keydown')return;if(!capture)return;if(e.key==='Tab')return;e.preventDefault();e.stopImmediatePropagation();if(e.repeat||e.isComposing)return;if(e.key==='Escape'){capture=null;paint();return;}try{const next=validateKeyAssignment(bindings,capture,eventKey(e),mediaKeys());globalThis.localStorage?.setItem('pn-scouting-keys',JSON.stringify(next));bindings=next;capture=null;message.textContent='Saved on this device.';paint();}catch(error){message.textContent=error.message;}return;}
  if(e.isComposing||e.target.closest?.('input,select,textarea,[contenteditable]')||doc.querySelector('#scouting-menu[open],#onboarding-wizard[open],#closing-wizard[open]'))return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&bindings.undo&&bindings.undo!=='ctrl+z'&&eventKey(e)!==bindings.undo){e.preventDefault();e.stopImmediatePropagation();return;}
  const active=scope();if(!active)return;
  const input=eventKey(e),physical=e.code||e.key;
  let a=e.type==='keyup'?down.get(physical):scoutingKeyActions.find(a=>a.scopes.includes(active)&&(bindings[a.id]??a.key)===input);
  if(e.type==='keyup')down.delete(physical);
  if(!a){if(scoutingKeyActions.some(a=>a.scopes.includes(active)&&a.key===input&&bindings[a.id]&&bindings[a.id]!==input)){e.preventDefault();e.stopImmediatePropagation();}return;}
  if(e.type==='keydown')down.set(physical,a);
  if((bindings[a.id]??a.key)===a.key)return;
  e.preventDefault();e.stopImmediatePropagation();const parts=a.key.split('+'),base=parts.at(-1),key=base==='space'?' ':base==='escape'?'Escape':base;
  const next=new doc.defaultView.KeyboardEvent(e.type,{key,code:base==='space'?'Space':e.code,ctrlKey:parts.includes('ctrl'),altKey:parts.includes('alt'),shiftKey:parts.includes('shift'),metaKey:parts.includes('meta'),repeat:e.repeat,bubbles:true,cancelable:true});forwarded.add(next);e.target.dispatchEvent(next);
 }
 doc.addEventListener('keydown',translate,true);doc.addEventListener('keyup',translate,true);
 const observer=new doc.defaultView.MutationObserver(paint);observer.observe(doc.body,{childList:true,subtree:true});paint();
 return {isEditing:()=>editing,label:id=>keyLabel(bindings[id]??scoutingKeyActions.find(a=>a.id===id)?.key??''),paint};
}
