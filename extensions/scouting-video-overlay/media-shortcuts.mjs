// Page / side-panel shortcuts, active only when that surface has keyboard focus.
export function mediaShortcuts({target,back,pause,forward}) {
 const handler=event=>{
  if(event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  const button=({F9:back,F10:pause,F11:forward})[event.key];
  if(!button)return;
  const focused=event.composedPath()[0];
  if(focused?.matches?.('input,textarea,select,[contenteditable]')||focused?.isContentEditable)return;
  event.preventDefault();event.stopImmediatePropagation();
  if(!button.disabled)button.click();
 };
 target.addEventListener('keydown',handler,true);
 return ()=>target.removeEventListener('keydown',handler,true);
}
