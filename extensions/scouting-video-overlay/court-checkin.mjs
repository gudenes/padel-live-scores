// A device-local preparation checklist, separate from match observations.
export function courtCheckinUI({$,act,storage=globalThis.localStorage}){
 let token='',confirmed=[],current;
 function paint(){
  if(!current)return;
  const {state,model,busy,names}=current,finished=model.score.phase==='finished';
  $('court-checkin').hidden=!state.selectedMatch;
  $('court-confirmed').textContent=`${confirmed.filter(Boolean).length}/4 on court`;
  $('court-server').textContent=finished?'Match finished':`Serving: ${names[model.server]}`;
  $('court-checkin-note').textContent=state.pending?'Finish or cancel this rally before changing server.':'Confirm the players, then choose who is serving. Check-in stays on this device.';
  for(const card of $('players').querySelectorAll('article[data-player]')){
   const player=Number(card.dataset.player);let controls=card.querySelector('.court-controls');
   if(!controls){
    controls=document.createElement('div');controls.className='court-controls';
    const label=document.createElement('label'),input=document.createElement('input'),button=document.createElement('button');
    input.type='checkbox';input.setAttribute('aria-label',names[player]+' on court');
    input.onchange=()=>{confirmed[player]=input.checked;try{storage?.setItem(token,JSON.stringify(confirmed));}catch{}paint();};
    label.append(input,'On court');button.className='ui-btn';button.dataset.variant='ghost';button.dataset.courtServer='true';
    button.onclick=()=>act({type:'server',player});controls.append(label,button);card.prepend(controls);
   }
   const input=controls.querySelector('input'),button=controls.querySelector('button'),serving=player===model.server&&!finished;
   input.checked=!!confirmed[player];input.disabled=busy||!state.selectedMatch||finished;
   button.textContent=serving?'Serving':'Set server';button.setAttribute('aria-label',serving?names[player]+' is serving':'Set '+names[player]+' as server');button.setAttribute('aria-pressed',String(serving));
   button.disabled=busy||!!state.pending||!state.selectedMatch||finished||serving;
  }
 }
 return (state,model,busy,setup)=>{
  const names=setup.names,next='pn-court-checkin:'+JSON.stringify([state.selectedMatch?.id,names]);
  if(next!==token){token=next;confirmed=[];try{const saved=JSON.parse(storage?.getItem(token)??'[]');if(Array.isArray(saved))confirmed=[0,1,2,3].map(i=>saved[i]===true);}catch{}}
  current={state,model,busy,names};paint();
 };
}
