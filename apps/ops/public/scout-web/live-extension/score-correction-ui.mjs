import {match,defaults} from './match.mjs';
export function scoreCorrectionUI({$,act,getState}){
 const host=$('score-correction');
 host.innerHTML=`<summary>Adjust score</summary><p class="hint">Missed broadcast? Add known points or enter the score now. No player strokes or outcomes are invented.</p><button type="button" class="ui-btn" data-undo>Undo adjustment</button><details><summary>Enter current score</summary><form><label>Completed sets<select name="count"><option>0</option><option>1</option><option>2</option></select></label><div data-completed></div><div class="catalog-filters"><label>Games · Pair A<input name="games-a" type="number" min="0" max="6" required></label><label>Pair B<input name="games-b" type="number" min="0" max="6" required></label></div><div class="catalog-filters"><label>Points · Pair A<input name="points-a" required></label><label>Pair B<input name="points-b" required></label></div><p class="hint">0, 15, 30, 40 or Adv. At 6–6 use tie-break points.</p><label>Serving now<select name="server"></select></label><label>Deuce returns<select name="returns"><option value="0">0</option><option value="1">1</option><option value="2">2 · Star Point next</option></select></label><button class="ui-btn" type="submit">Apply current score</button></form></details><p data-status class="hint" role="status"></p>`;

 const form=host.querySelector('form'),field=name=>form.elements.namedItem(name),status=host.querySelector('[data-status]');
 for(let i=0;i<2;i++){const row=document.createElement('div');row.className='catalog-filters';row.dataset.set=String(i);row.innerHTML=`<label>Set ${i+1} · Pair A<input name="set-${i}-a" type="number" min="0" max="7" value="0"></label><label>Pair B<input name="set-${i}-b" type="number" min="0" max="7" value="0"></label>`;host.querySelector('[data-completed]').append(row);}
 const setRows=()=>{for(const row of host.querySelectorAll('[data-set]'))row.hidden=Number(row.dataset.set)>=Number(field('count').value);};field('count').onchange=setRows;
 let sample,busy=false,token='';
 async function send(message){if(busy)return;busy=true;for(const b of document.querySelectorAll('#score-correction button, [data-score-add]'))b.disabled=true;try{const r=await act({...message,videoTime:sample?.time});status.textContent=r?.ok===false?r.error:'Score updated. Missed play remains unclassified.';}catch(e){status.textContent=e.message;}finally{busy=false;render(getState(),sample,false);}}
 for(const b of host.querySelectorAll('[data-add]'))b.onclick=()=>send({type:'missed-point',team:b.dataset.add});
 host.querySelector('[data-undo]').onclick=()=>send({type:'undo-last'});
 form.onsubmit=e=>{e.preventDefault();const point=name=>/^adv$/i.test(field(name).value.trim())?'Adv':Number(field(name).value);send({type:'score-correction',score:{completed:Array.from({length:Number(field('count').value)},(_,i)=>({a:Number(field(`set-${i}-a`).value),b:Number(field(`set-${i}-b`).value)})),games:{a:Number(field('games-a').value),b:Number(field('games-b').value)},points:{a:point('points-a'),b:point('points-b')},server:Number(field('server').value),near:match(getState()).near,advantageReturns:Number(field('returns').value)}});};
 function render(state,nextSample,working){sample=nextSample;state={...state,setup:state.setup??defaults()};const m=match(state),blocked=working||busy||!state.selectedMatch||!!state.pending||m.score.phase==='finished';
  for(const b of document.querySelectorAll('#score-correction button, [data-score-add]'))b.disabled=blocked;
  const undo=state.history?.at(-1);host.querySelector('[data-undo]').disabled=working||busy||!['missed-point','score-correction'].includes(undo?.type);
  const key=JSON.stringify([state.selectedMatch?.id,m.score,m.server,state.setup.names]);
  if(key!==token){token=key;field('count').value=String(m.score.sets.length-1);for(let i=0;i<2;i++)for(const t of ['a','b'])field(`set-${i}-${t}`).value=m.score.sets[i]?.[t]??0;
   for(const t of ['a','b']){field('games-'+t).value=m.score.sets.at(-1)[t];field('points-'+t).value=m.score.currentGame[t];}
   field('server').replaceChildren(...state.setup.names.map((name,i)=>{const option=document.createElement('option');option.value=i;option.textContent=name;return option;}));field('server').value=m.server;field('returns').value=m.score.advantageReturns;setRows();
  }
  for(const b of host.querySelectorAll('[data-add]'))b.textContent='+1 · '+state.setup.names.slice(b.dataset.add==='a'?0:2,b.dataset.add==='a'?2:4).join(' / ');
  if(state.pending)status.textContent='Finish or cancel the unfinished rally before adjusting the score.';
 }
 render.addPoint=team=>send({type:'missed-point',team});
 return render;
}
