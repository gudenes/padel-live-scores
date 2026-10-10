export function coachUI({$,act,call,getState}){
 let team=null,id=null,draft=[null,null],suggestions=[],loading=false,version=0;
 function paint(){
  const state=getState();if(!state?.selectedMatch)return;
  $('coach-players').replaceChildren(...[state.setup.names.slice(0,2).join(' / '),state.setup.names.slice(2).join(' / ')].map((name,i)=>{
   const box=document.createElement('fieldset');box.hidden=team!==null&&team!==i;const title=document.createElement('legend');title.textContent=name;box.append(title);
   const selected=draft[i]?.coaches??[],options=new Map([...suggestions.filter(c=>state.selectedMatch.playerIds?.slice(i*2,i*2+2).includes(c.playerId)),...selected].map(c=>[c.id,c]));
   if(!options.size){const note=document.createElement('p');note.className='hint';note.textContent=loading?'Loading suggestions…':'No suggested coaches available.';box.append(note);}
   for(const c of options.values()){
    const label=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name='team-coach-'+i;input.checked=selected.some(x=>x.id===c.id);input.disabled=loading;
    input.onchange=()=>{const coaches=input.checked?[{id:c.id,name:c.name}]:[];draft[i]=coaches.length?{status:'confirmed',coaches}:null;paint();};label.append(input,c.name);box.append(label);
   }
   const unknown=document.createElement('button');unknown.className='ui-btn';unknown.textContent='I don’t know';unknown.setAttribute('aria-pressed',String(draft[i]?.status==='unknown'));unknown.onclick=()=>{draft[i]=draft[i]?.status==='unknown'?null:{status:'unknown',coaches:[]};paint()};box.append(unknown);return box;
  }));
  $('save-coaches').disabled=loading;$('refresh-coaches').disabled=loading;
 }
 async function load(){
  const state=getState();if(!state?.selectedMatch){$('coach-note').textContent='Choose a match first.';return;}
  const token=++version,matchId=state.selectedMatch.id;loading=true;$('coach-note').textContent='Loading coaches from player profiles…';paint();
  try{const result=await call({type:'coach-suggestions'});if(token!==version||getState().selectedMatch?.id!==matchId)return;suggestions=result.coaches??[];$('coach-note').textContent='Suggestions are not confirmations. Choose one coach per team.';}
  catch(error){if(token===version)$('coach-note').textContent=error.message;}
  finally{if(token===version){loading=false;paint()}}
 }
 document.addEventListener('pn-open-coaches',event=>{team=[0,1].includes(event.detail?.team)?event.detail.team:null;const state=getState();id=state?.selectedMatch?.id;draft=structuredClone(state?.setup.coaches??[null,null]);suggestions=[];load()});
 $('refresh-coaches').onclick=load;
 $('save-coaches').onclick=async()=>{const result=await act({type:'confirm-coaches',matchId:id,coaches:draft});$('coach-note').textContent=result.ok?'Confirmations saved locally. Server save status is in Sync & backup.':result.error;};
}
