import {impactChart} from './impact-chart.mjs';
import {methodologyAnalysis} from './generated/methodology.mjs';
export function liveStatsData(timeline,set='all',rallies=[]){
 const points=timeline.filter(p=>set==='all'||p.before.sets.length===Number(set));
 const players=Array.from({length:4},()=>({winners:0,unforced:0,forced:0,created:0,assists:0,doubleFaults:0,smashes:0}));
 for(const p of points){
  const player=players[p.player];
  if(player){const key={winner:'winners',unforced:'unforced',forced:'forced',double_fault:'doubleFaults'}[p.outcome];if(key)player[key]++;}
  if(p.outcome==='winner'&&p.assistBy===(p.player^1))players[p.assistBy].assists++;
  if(p.outcome==='forced'&&players[p.forcedBy])players[p.forcedBy].created++;
 }
 const ids=new Set(points.map(p=>p.id));
 for(const r of rallies){
  if(r.undone||!r.point||!ids.has(r.id))continue;
  for(const a of r.attempts??[])if(players[a.player])players[a.player].smashes++;
  const p=r.point;
  if(p.shot==='smash'&&!p.smashAlreadyCounted)players[p.player].smashes++;
  if(p.outcome!=='winner'&&p.previousShot==='smash'&&players[p.previousPlayer]&&!(r.attempts??[]).some(a=>a.player===p.previousPlayer))players[p.previousPlayer].smashes++;
 }
 const breaks=['a','b'].map(team=>points.filter(p=>p.breakConverted&&p.winner===team).length);
 return {points,players,breaks,impact:methodologyAnalysis(points)};
}
export function liveStats(root){
 let tab='live',set='all',current;
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(label,active,click)=>{const n=el('button',label,'ui-btn');n.type='button';n.dataset.size='sm';n.dataset.variant=active?'record':'default';n.setAttribute('aria-pressed',String(active));n.onclick=click;return n;};
 function draw(){
  if(!current)return;const {timeline,names,identity,rallies=[]}=current;
  const sets=[...new Set(timeline.map(p=>p.before.sets.length))];if(set!=='all'&&!sets.includes(Number(set)))set='all';
  const data=liveStatsData(timeline,set,rallies),tabs=el('div',undefined,'live-stat-tabs');tabs.setAttribute('aria-label','Live stats views');
  for(const [id,label] of [['live','Live stats'],['summary','Match summary'],['impact','Player impact']])tabs.append(button(label,tab===id,()=>{tab=id;draw();}));
  const filters=el('div',undefined,'live-stat-filters');filters.setAttribute('aria-label','Filter live stats by set');
  for(const [id,label] of [['all','Full match'],...sets.map(s=>[String(s),'Set '+s])])filters.append(button(label,set===id,()=>{set=id;draw();}));
  const content=el('div',undefined,'live-stat-content');
  if(!data.points.length)content.append(el('p','No saved points in this selection yet. Start scouting to see your stats.','hint'));
  else if(tab==='live'){
   const table=el('table'),head=el('tr');for(const label of ['Player','W','UE','FE','FE+','Assist','Smash attempts'])head.append(el('th',label));table.append(head);
   data.players.forEach((p,i)=>{const row=el('tr'),name=el('th');name.scope='row';name.append(identity(i));row.append(name);for(const key of ['winners','unforced','forced','created','assists','smashes'])row.append(el('td',String(p[key])));table.append(row);});
   content.append(table,el('p','W: winners · UE: unforced errors · FE: forced errors suffered · FE+: forced errors created · Smash attempts: all recorded attempts in saved rallies','hint'));
   content.append(el('p',`Breaks won · Pair A ${data.breaks[0]} — ${data.breaks[1]} Pair B`,'hint'));
  }else if(tab==='summary'){
   const heading=el('div',undefined,'live-summary-pairs');heading.append(el('strong',names.slice(0,2).join(' / ')),el('strong',names.slice(2).join(' / ')));content.append(heading);
   for(const [label,key] of [['Points won',null],['Winners','winners'],['Unforced errors','unforced'],['Forced errors created','created'],['Assists','assists'],['Smash attempts','smashes'],['Breaks won','breaks']]){
    const totals=key==='breaks'?data.breaks:key?[data.players.slice(0,2),data.players.slice(2)].map(pair=>pair.reduce((sum,p)=>sum+p[key],0)):['a','b'].map(team=>data.points.filter(p=>p.winner===team).length);
    const row=el('div',undefined,'live-summary-metric'),labels=el('div',undefined,'live-summary-labels');labels.append(el('strong',String(totals[0])),el('span',label),el('strong',String(totals[1])));
    const track=el('div',undefined,'live-summary-track');totals.forEach((value,i)=>{const bar=el('span');bar.style.flex=totals[0]+totals[1]?String(value):'1';bar.style.background=i?'#ff8075':'#c9f52d';track.append(bar);});row.append(labels,track);content.append(row);
   }
  }else{
   content.append(impactChart({analysis:data.impact,points:data.points,names,identity}));
   content.append(el('p','Methodology v1.5 · Pressure-weighted impact, 50/50 assists and forced errors created.','hint'));
  }
  root.replaceChildren(tabs,filters,el('p',data.points.length+' observed points · '+(set==='all'?'Full match':'Set '+set),'hint'),content);
 }
 let signature='';return data=>{current=data;const next=JSON.stringify([data.timeline,data.names,data.rallies]);if(next!==signature){signature=next;draw();}};
}
