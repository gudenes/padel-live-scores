// A device-local preparation checklist, separate from scored actions.
export function courtCheckinUI({$,act,storage=globalThis.localStorage}){
 let token='',confirmed=[],lastPlayer=3,current,serverKey='';
 const persist=()=>{try{storage?.setItem(token,JSON.stringify({confirmed,lastPlayer}));}catch{}};
 $('undo-checkin').onclick=()=>{confirmed[lastPlayer]=false;persist();paint();};
 const picker=visible=>{$('quick-server-picker').hidden=!visible;$('change-server').setAttribute('aria-expanded',String(visible));};
 $('change-server').onclick=()=>{picker($('quick-server-picker').hidden);if(!$('quick-server-picker').hidden)$('quick-server').focus();};
 $('close-server-picker').onclick=()=>{picker(false);$('change-server').focus();};
 $('quick-server').onchange=async()=>{const result=await act({type:'server',player:Number($('quick-server').value)});if(result?.ok!==false){picker(false);$('change-server').focus();}};
 function paint(){
  if(!current)return;
  const {state,model,busy,names}=current,finished=model.score.phase==='finished',complete=confirmed.filter(Boolean).length===4,locked=busy||!!state.pending||!state.selectedMatch||finished;
  $('court-checkin').hidden=!state.selectedMatch||complete||finished;
  $('court-confirmed').textContent=`${confirmed.filter(Boolean).length}/4 on court`;
  $('court-server').textContent=finished?'Match finished':`Serving: ${names[model.server]}`;
  $('court-checkin-note').textContent='';
  $('serving-tools').hidden=!state.selectedMatch||finished;
  $('serving-name').textContent=names[model.server];
  $('change-server').disabled=locked;$('quick-server').disabled=locked;
  $('change-server').title=`Serving: ${names[model.server]}${state.pending?' · Finish or cancel the rally before changing server.':''}`;
  $('undo-checkin').hidden=!state.selectedMatch||!complete||finished;$('undo-checkin').disabled=busy;
  const sk=JSON.stringify([names,model.server]);
  if(sk!==serverKey){serverKey=sk;$('quick-server').replaceChildren(...names.map((name,i)=>new Option(name,i)));$('quick-server').value=model.server;}
  if(locked)picker(false);
  for(const card of $('players').querySelectorAll('article[data-player]')){
   const player=Number(card.dataset.player);let controls=card.querySelector('.court-controls');
   if(!controls){
    controls=document.createElement('div');controls.className='court-controls';
    const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.setAttribute('aria-label',names[player]+' on court');
    input.onchange=()=>{confirmed[player]=input.checked;lastPlayer=player;persist();paint();};
    label.append(input,'On court');controls.append(label);card.prepend(controls);
   }
   controls.hidden=complete||finished||!state.selectedMatch;
   const input=controls.querySelector('input');input.checked=!!confirmed[player];input.disabled=busy||!state.selectedMatch||finished;
  }
 }
 return (state,model,busy,setup)=>{
  const names=setup.names,next='pn-court-checkin:'+JSON.stringify([state.selectedMatch?.id,names]);
  if(next!==token){token=next;confirmed=[];lastPlayer=3;picker(false);try{const saved=JSON.parse(storage?.getItem(token)??'[]'),list=Array.isArray(saved)?saved:saved.confirmed;if(Array.isArray(list))confirmed=[0,1,2,3].map(i=>list[i]===true);if(Number.isInteger(saved?.lastPlayer)&&saved.lastPlayer>=0&&saved.lastPlayer<4)lastPlayer=saved.lastPlayer;}catch{}}
  current={state,model,busy,names};paint();
 };
}
