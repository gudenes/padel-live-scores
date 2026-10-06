// Shared by the panel, worker and isolated video remote.
(()=>{
 if(globalThis.__pnMediaKeys)return;
 const defaults={back10:{key:'j'},pause:{key:'k'},forward30:{key:'l'},back5:{key:'ArrowLeft'},forward5:{key:'ArrowRight'}};
 const actions={back10:'Back 10 seconds',pause:'Play / pause',forward30:'Forward 30 seconds',back5:'Back 5 seconds',forward5:'Forward 5 seconds'};
 function normalize(raw){
  const out={};
  for(const action of Object.keys(actions)){
   const value=raw?.[action]===undefined?defaults[action]:raw[action];
   if(value===null){out[action]=null;continue;}
   if(!value||typeof value.key!=='string'||!value.key.length||value.key.length>32||['Control','Meta','Alt','Shift','Tab','Escape','Backspace','Delete','Dead','Unidentified'].includes(value.key))throw Error('Choose a letter, number, arrow, navigation or function key.');
   out[action]={key:value.key.length===1?value.key.toLowerCase():value.key,ctrl:!!value.ctrl,alt:!!value.alt,shift:!!value.shift,meta:!!value.meta};
  }
  const keys=Object.values(out).filter(Boolean).map(b=>JSON.stringify(b));
  if(new Set(keys).size!==keys.length)throw Error('That shortcut is already assigned to another action.');
  return out;
 }
 function label(binding){if(!binding)return 'Unassigned';return [binding.ctrl?'Ctrl':null,binding.alt?'Alt':null,binding.shift?'Shift':null,binding.meta?'⌘':null,binding.key===' '?'Space':binding.key==='ArrowLeft'?'←':binding.key==='ArrowRight'?'→':binding.key.length===1?binding.key.toUpperCase():binding.key].filter(Boolean).join('+');}
 function matches(event,binding){return !!binding&&(event.key.length===1?event.key.toLowerCase():event.key)===binding.key&&!!event.ctrlKey===!!binding.ctrl&&!!event.altKey===!!binding.alt&&!!event.shiftKey===!!binding.shift&&!!event.metaKey===!!binding.meta;}
 function attach({target,controls,getBindings,isActive=()=>true}){
  const handler=event=>{
   if(!isActive()||event.repeat||event.isComposing)return;
   const focused=event.composedPath()[0];if(focused?.matches?.('input,textarea,select,[contenteditable]')||focused?.isContentEditable)return;
   // Keep letter/number shot shortcuts available inside the scoring dialog.
   if(target.querySelector?.('dialog[open]')&&/^[a-z0-9]$/i.test(event.key)&&!event.ctrlKey&&!event.altKey&&!event.metaKey)return;
   const action=Object.keys(controls).find(name=>matches(event,getBindings()[name]));
   if(!action)return;event.preventDefault();event.stopImmediatePropagation();if(!controls[action].disabled)controls[action].click();
  };
  target.addEventListener('keydown',handler,true);return ()=>target.removeEventListener('keydown',handler,true);
 }
 globalThis.__pnMediaKeys={defaults:normalize(defaults),actions,normalize,label,attach};
})();
