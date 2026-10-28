import './shortcut-keys.js';
export function mediaShortcuts({target,hostTarget,back,pause,forward,back5,forward5,forward10,forward90,speed,getBindings}){
 const controls={back10:back,pause,forward30:forward,...(back5?{back5}:{}),...(forward5?{forward5}:{}),...(forward10?{forward10}:{}),...(forward90?{forward90}:{}),...(speed?{speed}:{})};
 const bindings=getBindings??(()=>globalThis.__pnMediaKeys.defaults);
 const detach=globalThis.__pnMediaKeys.attach({target,controls,getBindings:bindings});
 const detachHost=hostTarget&&hostTarget!==target?globalThis.__pnMediaKeys.attach({target:hostTarget,controls,getBindings:bindings,isActive:()=>!target.querySelector('dialog[open]')}):()=>{};
 const cleanup=()=>{detach();detachHost();};
 target.defaultView?.addEventListener('pagehide',cleanup,{once:true});
 return cleanup;
}
