// Same cumulative series, colors, player line styles and set boundaries as the admin.
export function impactChart({analysis,points,names,identity}){
 const root=document.createElement('div');root.className='live-impact-chart';
 const title=document.createElement('h4');title.textContent='Impact evolution';root.append(title);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 330');svg.setAttribute('role','img');svg.setAttribute('aria-label','Cumulative weighted impact by player. Use left and right arrow keys to inspect points.');svg.setAttribute('tabindex','0');
 const add=(tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;svg.append(n);return n;};
 const series=analysis.series,values=series.flatMap(p=>p.values),min=Math.min(0,...values),max=Math.max(1,...values),left=38,right=530,top=24,bottom=287;
 const x=i=>left+(right-left)*i/Math.max(1,series.length-1),y=v=>bottom-(v-min)/(max-min)*(bottom-top),colors=['#a3cf0a','#a3cf0a','#ed7669','#ed7669'];
 for(let j=0;j<5;j++){const value=max-(max-min)*j/4;add('line',{x1:left,x2:right,y1:y(value),y2:y(value),stroke:'#dce3d8'});add('text',{x:2,y:y(value)+4,fill:'#74806f','font-size':11},value.toFixed(0));}
 points.forEach((p,i)=>{if(i===points.length-1||p.before.sets.length===points[i+1].before.sets.length)return;add('line',{x1:x(i),x2:x(i),y1:top,y2:bottom,stroke:'#a8b1a4','stroke-dasharray':'4 4'});add('text',{x:x(i),y:12,'text-anchor':'middle','font-size':10,fill:'#74806f'},'End set '+p.before.sets.length);});
 for(let k=0;k<4;k++){add('polyline',{points:series.map((p,i)=>`${x(i)},${y(p.values[k])}`).join(' '),fill:'none',stroke:colors[k],'stroke-width':2.3,'stroke-dasharray':k%2?'3 5':'none'});if(series.length===1)add('circle',{cx:x(0),cy:y(series[0].values[k]),r:3,fill:colors[k]});}
 const ends=colors.map((color,k)=>({color,value:series.at(-1)?.values[k]??0})).sort((a,b)=>y(a.value)-y(b.value));
 ends.forEach((e,i)=>e.labelY=Math.max(top+4,y(e.value),i?ends[i-1].labelY+17:top+4));const shift=Math.max(0,ends.at(-1).labelY-bottom);
 ends.forEach(e=>{const ly=e.labelY-shift;add('line',{x1:right,x2:right+7,y1:y(e.value),y2:ly,stroke:e.color});add('text',{x:right+10,y:ly+4,fill:e.color,'font-size':11,'font-weight':700},(e.value>=0?'+':'')+e.value.toFixed(2));});
 add('text',{x:left,y:316,fill:'#74806f','font-size':11},'Point '+series[0]?.number);add('text',{x:right-48,y:316,fill:'#74806f','font-size':11},'Point '+series.at(-1)?.number);
 const cursor=add('line',{x1:left,x2:left,y1:top,y2:bottom,stroke:'#97a28e','stroke-dasharray':'3 4',visibility:'hidden'}),dots=colors.map(color=>add('circle',{r:4,fill:color,visibility:'hidden'}));
 const detail=document.createElement('p');detail.className='hint';detail.textContent='Hover or tap a point to inspect impact. Arrow keys also work.';
 let selected=series.length-1;
 const inspect=i=>{selected=Math.max(0,Math.min(series.length-1,i));const row=series[selected];if(!row)return;cursor.setAttribute('x1',x(selected));cursor.setAttribute('x2',x(selected));cursor.setAttribute('visibility','visible');dots.forEach((dot,k)=>{dot.setAttribute('cx',x(selected));dot.setAttribute('cy',y(row.values[k]));dot.setAttribute('visibility','visible');});detail.textContent=`Point ${row.number} · Set ${points[selected].before.sets.length} · `+names.map((name,k)=>`${name}: ${row.values[k].toFixed(2)}`).join(' · ');};
 const pointer=e=>{const box=svg.getBoundingClientRect();inspect(Math.round(((e.clientX-box.left)/box.width*600-left)/(right-left)*Math.max(1,series.length-1)));};
 svg.onpointermove=pointer;svg.onpointerdown=pointer;svg.onfocus=()=>inspect(selected);svg.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();inspect(selected+(e.key==='ArrowRight'?1:-1));}};
 const legend=document.createElement('div');legend.className='live-impact-legend';names.forEach((name,k)=>{const item=document.createElement('div'),line=document.createElement('span');line.style.borderTop=`3px ${k%2?'dotted':'solid'} ${colors[k]}`;item.append(identity(k),line);legend.append(item);});root.append(svg,legend,detail);return root;
}
