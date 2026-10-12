import './shortcut-keys.js';
export function mediaShortcuts({target,back,pause,forward,back5,forward5,forward10,speed,getBindings}){
 const controls={back10:back,pause,forward30:forward,...(back5?{back5}:{}),...(forward5?{forward5}:{}),...(forward10?{forward10}:{}),...(speed?{speed}:{})};
 return globalThis.__pnMediaKeys.attach({target,controls,getBindings:getBindings??(()=>globalThis.__pnMediaKeys.defaults)});
}
