export const positionKeys=['q','w','a','s'];
export const outcomeKeys={w:'winner',a:'unforced',d:'forced'};
export const holdDuration=1300;
export function playerShortcuts({target,context,select,prepare,tap=()=>{},smash=()=>{},hold=()=>{},fault=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let held=null,timer=null,selected=null,token='',completed=false,lastTapped=null;
 const cancelHold=()=>{if(timer!==null)clearTimer(timer);timer=null;held=null;completed=false;hold(null);};
 function reset(){lastTapped=null;cancelHold();selected=null;select(null);}
 function update(){const c=context();if(c.token!==token||(!c.enabled&&!c.recording)){token=c.token;reset();}return c;}
 const consume=e=>{e.preventDefault();e.stopImmediatePropagation();};
 const down=e=>{
  const c=update();if((!c.enabled&&!c.recording)||e.isComposing||e.ctrlKey||e.metaKey||e.altKey||e.shiftKey||e.target.closest?.('input,select,textarea,[contenteditable]'))return;
  const key=e.key.toLowerCase();
  if(!c.enabled){if(held===null&&selected===null&&lastTapped!==null&&['z','x','c'].includes(key)){consume(e);if(!e.repeat)smash(lastTapped,key==='z'?'power':key==='x'?'x3':'soft',true);}return;}
  if(key==='1'||key==='2'){consume(e);if(!e.repeat&&((key==='1'&&!c.firstFault)||(key==='2'&&c.firstFault))){reset();fault(key==='1'?'first-fault':'double-fault');}return;}
  if(selected!==null&&held===null&&outcomeKeys[key]){consume(e);if(!e.repeat){const player=selected;reset();prepare(player,outcomeKeys[key]);}return;}
  if(held!==null&&['z','x','c'].includes(key)){consume(e);if(!e.repeat&&!completed){const player=c.order[positionKeys.indexOf(held)];if(timer!==null)clearTimer(timer);timer=null;completed=true;hold(null);selected=null;select(null);lastTapped=null;smash(player,key==='z'?'power':key==='x'?'x3':'soft');}return;}
  if(held===null&&selected===null&&lastTapped!==null&&['z','x','c'].includes(key)){consume(e);if(!e.repeat)smash(lastTapped,key==='z'?'power':key==='x'?'x3':'soft',true);return;}
  if(key==='escape'){reset();return;}
  const slot=positionKeys.indexOf(key);
  if(slot>=0){consume(e);if(e.repeat||held===key)return;cancelHold();lastTapped=null;selected=null;select(null);held=key;hold(c.order[slot]);
   const started=c.token;
   timer=setTimer(()=>{timer=null;const now=context();if(held!==key||!now.enabled||now.token!==started)return;completed=true;hold(null);selected=now.order[slot];select(selected);},holdDuration);
  }
 };
 const up=e=>{if(e.key.toLowerCase()!==held)return;consume(e);const c=context(),player=c.order[positionKeys.indexOf(held)],short=!completed&&c.enabled&&c.token===token;cancelHold();if(short){lastTapped=player;tap(player);}};
 target.addEventListener('keydown',down,true);target.addEventListener('keyup',up,true);
 target.defaultView?.addEventListener('blur',reset);
 return {update,reset};
}
