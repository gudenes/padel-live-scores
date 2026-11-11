'use client';
import {useId,useState} from 'react';
import {playerSideHeat} from '@/lib/scouting/court-orientation';
import type {SpeedSample} from '@/lib/scouting/movement-series';
function heatColor(value:number){
 const colors=[[66,177,105],[249,214,72],[231,79,65]],scaled=Math.max(0,Math.min(1,value))*2,index=Math.min(1,Math.floor(scaled)),fraction=scaled-index;
 return `rgb(${colors[index].map((v,i)=>Math.round(v+(colors[index+1][i]-v)*fraction)).join(',')})`;
}
export default function CourtHeatmap({samples,loading}:{samples:SpeedSample[];loading:boolean}){
 const id=useId().replace(/:/g,'');const [hover,setHover]=useState<string|null>(null);const [selected,setSelected]=useState<string|null>(null);const active=hover??selected;
 const raw:Record<string,number>={};for(const sample of samples)for(const [key,value] of Object.entries(sample.heat??{}))raw[key]=(raw[key]??0)+value;const cells=playerSideHeat(raw);
 const max=Math.max(0,...Object.values(cells)),total=Object.values(cells).reduce((a,b)=>a+b,0);
 const tiles=Array.from({length:100},(_,i)=>({x:i%10,y:10+Math.floor(i/10),key:`${i%10},${10+Math.floor(i/10)}`}));
 const seconds=active?cells[active]??0:0;
 return <section className="mv-heatmap"><h4>Position heatmap</h4><p>Player’s half · both ends combined · facing the net</p><svg className="mv-half-court" viewBox="0 190 240 260" role="img" aria-label="Player half heatmap: green for less observed time, yellow for medium, red for most"><defs><clipPath id={id+'clip'}><rect x="20" y="220" width="200" height="200"/></clipPath><filter id={id+'soft'} x="-10%" y="-10%" width="120%" height="120%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation="5"/></filter></defs>
 <rect x="20" y="220" width="200" height="200" fill="#edf2e9"/>
 <g clipPath={`url(#${id}clip)`}><g filter={`url(#${id}soft)`}>{tiles.map(({x,y,key})=><rect key={key} x={20+x*20} y={20+y*20} width="20.5" height="20.5" fill={cells[key]?heatColor(cells[key]/max):'#edf2e9'}/>)}</g></g>
 <path d="M20 360H220 M120 220V360" fill="none" stroke="white" strokeWidth="2"/><rect x="20" y="220" width="200" height="200" fill="none" stroke="#718367"/><path d="M15 220H225" stroke="#23392f" strokeWidth="3"/><text x="120" y="208" textAnchor="middle" fontSize="11" fill="#23392f">NET</text><text x="120" y="438" textAnchor="middle" fontSize="11" fill="#526048">BACK GLASS</text>
 {tiles.map(({x,y,key})=><rect key={key} x={20+x*20} y={20+y*20} width="20" height="20" fill="transparent" stroke={active===key?'#23392f':'none'} strokeWidth="1" onPointerEnter={()=>setHover(key)} onPointerLeave={()=>setHover(null)} onClick={()=>setSelected(key)}><title>{x}–{x+1} m across · {y-10}–{y-9} m from net: {(cells[key]??0).toFixed(1)} seconds</title></rect>)}
 </svg><div className="mv-heat-key"><span>Less time</span><i/><span>Most time</span></div><p className="mv-heat-readout" aria-live="polite">{loading?'Loading saved positions…':active?`${seconds.toFixed(1)} seconds · ${total?(seconds/total*100).toFixed(1):'0'}% of observed time · ${Number(active.split(',')[1])-10}–${Number(active.split(',')[1])-9} m from net`:'Hover or tap the court to see time spent in an area.'}</p><p>{total?Math.round(total)+' seconds observed. ':''}Colors blend between 1 m cells for readability; values remain measured per cell. Pale areas have no observations. Colors are relative to this player and selection. Tracking gaps and inferred positions are excluded.</p></section>;
}
