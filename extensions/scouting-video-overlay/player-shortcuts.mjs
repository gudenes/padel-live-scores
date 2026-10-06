export const positionKeys=['q','w','a','s'];
export const outcomeKeys={ArrowUp:'winner',ArrowLeft:'unforced',ArrowRight:'forced'};
export function playerShortcuts({target,context,select,prepare,tap=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let held=null,timer=null,selected=null,token='',completed=false;
 const cancelHold=()=>{if(timer!==null)clearTimer(timer);timer=null;held=null;completed=false;};
 function reset(){cancelHold();selected=null;select(null);}
 function update(){const c=context();if(c.token!==token||!c.enabled){token=c.token;reset();}return c;}
 const down=e=>{
  const c=update();if(!c.enabled||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||e.target.closest?.('input,select,textarea,[contenteditable]'))return;
  const key=e.key.toLowerCase(),slot=positionKeys.indexOf(key);
  if(slot>=0){e.preventDefault();e.stopImmediatePropagation();if(e.repeat||held===key)return;cancelHold();selected=null;select(null);held=key;
   const started=c.token;
   timer=setTimer(()=>{timer=null;const now=context();if(held!==key||!now.enabled||now.token!==started)return;completed=true;selected=now.order[slot];select(selected);},2000);return;
  }
  if(selected!==null&&outcomeKeys[e.key]){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat){const player=selected;reset();prepare(player,outcomeKeys[e.key]);}}
 };
 const up=e=>{if(e.key.toLowerCase()!==held)return;const c=context(),player=c.order[positionKeys.indexOf(held)],short=!completed&&c.enabled&&c.token===token;cancelHold();if(short)tap(player);};
 target.addEventListener('keydown',down,true);target.addEventListener('keyup',up,true);
 target.defaultView?.addEventListener('blur',reset);
 return {update,reset};
}
