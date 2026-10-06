(()=>{
 const key='__pnCornerOverlay';if(window[key]){window[key].hidden=!window[key].hidden;return;}
 const host=document.createElement('div');window[key]=host;host.style.cssText='position:fixed;inset:0;z-index:2147483646;pointer-events:none';document.documentElement.append(host);
 const root=host.attachShadow({mode:'open'});let state,sample,busy=false,polling=false,revision=0,closed=false,connectionError='',bindings=globalThis.__pnMediaKeys.defaults;
 const style=document.createElement('style');style.textContent=`
 :host{font-family:Arial,sans-serif;color:#fff;font-size:13px}*{box-sizing:border-box}button{font:inherit;cursor:pointer;border:1px solid #ffffff55;border-radius:7px;padding:8px 10px;color:#fff;background:#ffffff12}button:hover{background:#ffffff25}button:focus-visible{outline:2px solid #a5df74;outline-offset:2px}button:disabled{opacity:.4;cursor:default}button.primary{background:#78b748;color:#112209;border-color:#78b748}kbd{font:10px Arial,sans-serif;color:inherit;opacity:.7;margin-left:5px}.bar{position:absolute;top:12px;left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100vw - 24px);background:rgba(15,23,31,.82);border:1px solid #ffffff55;border-radius:12px;padding:8px;box-shadow:0 4px 16px #0003;pointer-events:auto;backdrop-filter:blur(5px);display:flex;flex-wrap:wrap;gap:6px;align-items:center}.clock{font-size:11px;min-width:40px;font-variant-numeric:tabular-nums}.drag{cursor:grab;touch-action:none;padding:5px}.notice{flex-basis:100%;font-size:12px;color:#ffdc99;max-width:420px}.notice:empty,[hidden]{display:none!important}.extra{flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px}.hint{flex-basis:100%;font-size:10px;opacity:.7}
 `;root.append(style);
 function el(tag,text,cls){const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;}
 function button(text,fn,key,cls){const b=el('button',text,cls);b.type='button';b.onclick=fn;if(key){b.append(el('kbd',key));b.setAttribute('aria-keyshortcuts',key);}return b;}
 const bar=el('div',null,'bar'),grip=el('span','⠿','drag'),clock=el('span','—:—','clock'),notice=el('div',null,'notice');bar.setAttribute('role','toolbar');bar.setAttribute('aria-label','Video remote');notice.setAttribute('role','status');
 const back=button('−10s',()=>act({type:'skip',seconds:-10}),'J');
 const playback=button('Play / pause',()=>act({type:'playback'}),'K','primary');
 const forward=button('+30s',()=>act({type:'skip',seconds:30}),'L');
 const back5=button('−5s',()=>act({type:'skip',seconds:-5}),'←');
 const forward5=button('+5s',()=>act({type:'skip',seconds:5}),'→');
 const controls={back10:back,pause:playback,forward30:forward,back5,forward5};
 const extra=el('div',null,'extra');extra.hidden=true;
 const more=button('⋯',()=>{extra.hidden=!extra.hidden;more.setAttribute('aria-expanded',String(!extra.hidden));});more.setAttribute('aria-label','More video controls');more.setAttribute('aria-expanded','false');
 const skips=[back,forward,back5,forward5,...[-30,10].map(seconds=>{const b=button(`${seconds>0?'+':'−'}${Math.abs(seconds)}s`,()=>act({type:'skip',seconds}));extra.append(b);return b;})];
 const reconnect=button('Reconnect video',()=>act({type:'reconnect'}),null,'primary');
 const close=button('×',()=>{host.hidden=true;});close.setAttribute('aria-label','Hide video remote');
 extra.append(el('span','Skipping is available between rallies.','hint'));
 bar.append(grip,clock,back,back5,playback,forward5,forward,more,close,reconnect,extra,notice);root.append(bar);
 function render(){
  for(const [action,b] of Object.entries(controls)){const key=globalThis.__pnMediaKeys.label(bindings[action]);b.querySelector('kbd').textContent=key==='Unassigned'?'':key;if(bindings[action])b.setAttribute('aria-keyshortcuts',key);else b.removeAttribute('aria-keyshortcuts');}
  clock.textContent=sample?`${Math.floor(sample.time/60)}:${String(Math.floor(sample.time%60)).padStart(2,'0')}`:'—:—';
  playback.firstChild.textContent=sample?.paused?'Play':'Pause';playback.disabled=busy||!sample||sample.seeking;
  for(const b of skips)b.disabled=busy||!!state?.pending||!sample||sample.seeking;
  reconnect.hidden=!!sample;reconnect.disabled=busy||!!state?.pending;
 }
 async function send(message){const r=await chrome.runtime.sendMessage(message);if(!r?.ok)throw Error(r?.error||'Reopen the video remote from the side panel.');return r;}
 async function act(message){if(busy)return;busy=true;revision++;render();notice.textContent='';try{const r=await send(message);state=r.state;}catch(e){notice.textContent=e.message;}finally{busy=false;await refresh();render();}}
 async function refresh(){
  if(busy||polling||closed)return;polling=true;const rev=revision;
  try{const r=await send({type:'sample'});if(rev!==revision)return;state=r.state;bindings=globalThis.__pnMediaKeys.normalize(r.bindings??bindings);sample=r.sample;if(notice.textContent===connectionError)notice.textContent='';connectionError='';render();}
  catch(e){sample=null;if(!state){try{state=(await send({type:'state'})).state;}catch{}}connectionError=e.message;notice.textContent=connectionError;render();}
  finally{polling=false;}
 }
 globalThis.__pnMediaKeys.attach({target:document,controls,getBindings:()=>bindings,isActive:()=>!host.hidden&&host.isConnected});
 grip.onpointerdown=e=>{if(e.button!==0)return;const rect=bar.getBoundingClientRect(),x=e.clientX,y=e.clientY;grip.setPointerCapture(e.pointerId);grip.onpointermove=ev=>{bar.style.transform='none';bar.style.left=Math.max(0,Math.min(innerWidth-rect.width,rect.left+ev.clientX-x))+'px';bar.style.top=Math.max(0,Math.min(innerHeight-rect.height,rect.top+ev.clientY-y))+'px';};grip.onpointerup=()=>{grip.onpointermove=null;};};
 document.addEventListener('fullscreenchange',()=>{const target=document.fullscreenElement;if(target?.tagName==='VIDEO'){notice.textContent='Use theatre mode for the video remote.';return;}(target||document.documentElement).append(host);});
 const timer=setInterval(()=>{if(!host.isConnected){closed=true;clearInterval(timer);return;}refresh();},1000);render();refresh();
})();
