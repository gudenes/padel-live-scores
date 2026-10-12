export function confirmResume(warning){
 if(!warning)return Promise.resolve(true);
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');
  dialog.className='resume-warning';
  dialog.setAttribute('aria-labelledby','resume-warning-title');
  dialog.setAttribute('aria-describedby','resume-warning-description');
  dialog.innerHTML='<h2 id="resume-warning-title">Continue another scouter’s work?</h2><p id="resume-warning-description"></p><p>Your changes will be saved to this same session. Make sure the other scouter has stopped before continuing.</p><div><button type="button" class="ui-btn" data-cancel>Back to insights</button><button type="button" class="ui-btn" data-variant="primary" data-continue>Resume scouting</button></div>';
  dialog.querySelector('#resume-warning-description').textContent=warning.unknown?'The original scouter is unknown for this older session.':`This scouting session was started by ${warning.creator}.`;
  const done=value=>{dialog.close();dialog.remove();resolve(value)};
  dialog.querySelector('[data-cancel]').onclick=()=>done(false);
  dialog.querySelector('[data-continue]').onclick=()=>done(true);
  dialog.addEventListener('cancel',event=>{event.preventDefault();done(false)});
  document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').focus();
 });
}
