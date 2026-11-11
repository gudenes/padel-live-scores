const clockLabel=(s:number)=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const names=['Attack','Transition','Defence'],colors=['#c5ef63','#e8bd5c','#83b4a5'];
export default function CourtZoneMap({seconds}:{seconds:number[]}){
 const total=seconds.reduce((a,b)=>a+b,0),percentage=(i:number)=>total?`${Math.round(seconds[i]/total*100)}%`:'—';
 return <div className="mv-zone-layout"><svg className="mv-court" viewBox="0 0 260 460" role="img" aria-label={`Court zone distribution: ${names.map((n,i)=>`${n} ${percentage(i)}`).join(', ')}`}>
 <rect x="25" y="22" width="210" height="420" rx="5" fill="#eff2ec" stroke="#b7c2b2" strokeWidth="2"/>
 <text x="130" y="95" textAnchor="middle" fill="#788573" fontSize="12">Opponent half</text>
 <text x="130" y="112" textAnchor="middle" fill="#788573" fontSize="10">court context</text>
 {[{y:232,h:105},{y:337,h:42},{y:379,h:63}].map((z,i)=><g key={i}><rect x="26" y={z.y} width="208" height={z.h} fill={colors[i]} opacity={total?1:.25}/><text x="130" y={i===0?270:z.y+z.h/2-1} textAnchor="middle" fontWeight="700" fontSize="17" fill="#223322">{percentage(i)}</text><text x="130" y={i===0?285:z.y+z.h/2+15} textAnchor="middle" fontSize="10" fill="#223322">{names[i]}</text></g>)}
 <path d="M25 169H235 M130 169V232 M25 295H235 M130 232V295" stroke="white" strokeWidth="2" fill="none"/>
 <path d="M17 232H243" stroke="#253b32" strokeWidth="4"/><rect x="108" y="222" width="44" height="20" rx="4" fill="#253b32"/><text x="130" y="236" textAnchor="middle" fill="white" fontSize="10">NET</text>
 </svg><div className="mv-zone-legend"><p>Player’s half, normalized across changes of ends.</p>{names.map((n,i)=><div key={n}><span style={{background:colors[i]}}/><section><strong>{n} · {['0–5','5–7','7–10'][i]} m</strong><small>from the net</small></section><b>{percentage(i)}<small>{clockLabel(seconds[i])}</small></b></div>)}<p>{total?`${clockLabel(total)} known zone time`:'No valid zone observations in this selection.'}</p><small>Zone boundaries are not service lines.</small></div></div>;
}
