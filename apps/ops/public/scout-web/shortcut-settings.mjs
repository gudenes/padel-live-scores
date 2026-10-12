import {scoutingKeyActions,eventKey} from './scouting-keys.mjs';
import './shortcut-keys.js';
const keys=globalThis.__pnMediaKeys;
export function shortcutSettings({$,send,onChange}){
 let bindings=keys.defaults,saving=false;
 const inputs={};
 const show=()=>{for(const [action,input] of Object.entries(inputs))input.value=keys.label(bindings[action]);onChange(bindings);};
 async function save(next,input){if(saving)return;saving=true;$('shortcut-error').textContent='Saving shortcuts…';
  try{const valid=keys.normalize(next);let custom={};try{custom=JSON.parse(globalThis.localStorage?.getItem('pn-scouting-keys')??'{}');}catch{}for(const binding of Object.values(valid).filter(Boolean)){const key=eventKey({key:binding.key,ctrlKey:binding.ctrl,altKey:binding.alt,shiftKey:binding.shift,metaKey:binding.meta});const conflict=scoutingKeyActions.find(a=>!['reuse-smash','new-smash'].includes(a.id)&&(custom[a.id]??a.defaultKey??a.key)===key);if(conflict)throw Error('That key is used by '+conflict.label+' in scouting.');}const result=await send({type:'set-shortcuts',bindings:valid});if(!result?.ok)throw Error(result?.error||'Could not save shortcuts.');bindings=keys.normalize(result.bindings);show();$('shortcut-error').textContent='Shortcuts saved on this device. Ready to use.';if(document.activeElement===input)input.blur();}
  catch(error){$('shortcut-error').textContent=error.message;show();}finally{saving=false;}
 }
 for(const [action,name] of Object.entries(keys.actions)){
  const label=document.createElement('label'),input=document.createElement('input');label.textContent=name;input.type='text';input.readOnly=true;input.setAttribute('aria-label',name+' shortcut');input.title='Click and press a shortcut. Backspace clears it.';inputs[action]=input;
  input.addEventListener('focus',()=>{input.value='Press a key…';});input.addEventListener('blur',show);
  input.addEventListener('keydown',event=>{
   if(event.key==='Tab')return;event.preventDefault();event.stopImmediatePropagation();if(event.repeat||event.isComposing||saving)return;
   if(event.key==='Escape'){show();input.blur();return;}
   if(['Control','Meta','Alt','Shift'].includes(event.key))return;
   save({...bindings,[action]:['Backspace','Delete'].includes(event.key)?null:{key:event.key,ctrl:event.ctrlKey,alt:event.altKey,shift:event.shiftKey,meta:event.metaKey}},input);
  });
  label.append(input);$('shortcut-fields').append(label);
 }
 $('reset-shortcuts').onclick=()=>save(keys.defaults);show();
 send({type:'get-shortcuts'}).then(result=>{if(result?.ok){bindings=keys.normalize(result.bindings);show();}}).catch(error=>{$('shortcut-error').textContent=error.message;});
 return ()=>bindings;
}
