// Only the embedded, memory-only Playground accepts academy messages.
export const academy = new URL(location.href).searchParams.has('academy') && new URL(location.href).searchParams.has('playground') && parent !== window;
export let academyTime=0;
let cue='none',touchPlayer=0;
export function notifyAcademy(data){if(academy)parent.postMessage({channel:'scout-academy',...data},location.origin)}
if(academy){
 const style=document.createElement('style');style.textContent=`body{margin:0!important;padding:10px!important}html body.playground #practice-banner:not([hidden]),.standalone-notice,#scout-loading,#header-new-match,#header-account,#header-playground,#mobile-stats-panel,.mobile-tap,#court-checkin,.court-controls{display:none!important}.academy-spotlight{position:fixed;pointer-events:none;border:3px solid #c8f52c;border-radius:8px;box-shadow:0 0 0 9999px rgba(13,23,18,.68);z-index:2147483647;transition:top .18s,left .18s,width .18s,height .18s} .academy-wash{position:fixed;inset:0;background:rgba(13,23,18,.60);pointer-events:none;z-index:2147483646}@media(prefers-reduced-motion:reduce){.academy-spotlight{transition:none}}`;
 document.head.append(style);
 const spot=document.createElement('div');spot.className='academy-spotlight';const wash=document.createElement('div');wash.className='academy-wash';
 const targets={serve:'#rally',fault:'#first-fault',player:'[data-player="2"] [data-outcome-key="w"]',shot:'[data-shot="volley"]',confirm:'#save-point'};
 let lastTarget=null;
 function paint(){
  const host=document.querySelector('dialog[open]')||document.body;
  if(spot.parentNode!==host)host.append(spot,wash);
  const target=cue==='touch'?document.querySelector(`[data-player="${touchPlayer}"] h3>kbd`):targets[cue]?document.querySelector(targets[cue]):null;
  if(target&&target!==lastTarget){target.scrollIntoView({block:'center',behavior:'instant'});lastTarget=target;if(cue==='touch'||cue==='confirm'){if(cue==='touch')target.tabIndex=-1;target.focus({preventScroll:true});window.focus();}}
  const box=target?.getBoundingClientRect();const visible=box&&box.width>0&&box.height>0;
  spot.hidden=!visible||cue==='none';wash.hidden=cue==='none'||!!visible;
  if(visible)Object.assign(spot.style,{top:box.top-4+'px',left:box.left-4+'px',width:box.width+8+'px',height:box.height+8+'px'});
  // Keyboard shot selection does not dispatch a click; observe the real selected state.
  if(cue==='shot'&&document.querySelector('[data-shot="volley"][aria-pressed="true"]'))notifyAcademy({type:'shot-chosen'});
  requestAnimationFrame(paint);
 }
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||event.data?.channel!=='scout-academy')return;if(event.data.type==='media'&&Number.isFinite(event.data.time))academyTime=event.data.time;if(event.data.type==='cue'){cue=event.data.cue;if(Number.isInteger(event.data.player)&&event.data.player>=0&&event.data.player<4)touchPlayer=event.data.player;}});
 document.addEventListener('click',event=>{if(cue==='none')return;const target=cue==='touch'?document.querySelector(`[data-player="${touchPlayer}"] h3>kbd`):targets[cue]?document.querySelector(targets[cue]):null;if(!target?.contains(event.target)){event.preventDefault();event.stopImmediatePropagation();}},true);
 document.addEventListener('click',event=>{if(event.target.closest('[data-shot="volley"]'))notifyAcademy({type:'shot-chosen'});});
 requestAnimationFrame(paint);notifyAcademy({type:'ready'});
}
