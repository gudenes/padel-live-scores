'use client';
import React,{useRef} from 'react';

function Example({kind}){
 const lime='#c9f43b',coral='#ff8a7a';
 return <svg viewBox="0 0 280 100" role="img" aria-label={{bars:'Lime points above the baseline and coral points below',break:'A crossed ball marks a broken service game',dots:'Team-colored circles, with dotted outlines for the second player',scores:'Select a score to inspect the point'}[kind]}>
 {kind==='bars'&&<><path d="M20 50h240" stroke="#aab3a2"/>{[0,1,2,3,4].map((n)=><g key={n}><rect x={35+n*46} y={50-[22,36,16,30,40][n]} width="26" height={[22,36,16,30,40][n]} rx="2" fill={lime}/><rect x={35+n*46} y="51" width="26" height={[12,28,36,20,12][n]} rx="2" fill={coral}/></g>)}</>}
 {kind==='break'&&<><rect x="115" y="15" width="50" height="30" rx="3" fill={lime}/><path d="M60 46h160" stroke="#aab3a2"/><rect x="115" y="48" width="50" height="42" rx="3" fill={coral}/><g transform="translate(140 68)" fill="none" stroke="#652d25" strokeWidth="2"><circle r="12"/><path d="M-10-6Q2 0-10 6M10-6Q-2 0 10 6M-15 15 15-15"/></g></>}
 {kind==='dots'&&<>{[0,1,2,3].map(n=><g key={n}><circle cx={50+n*60} cy="40" r="16" fill="none" stroke={n<2?lime:coral} strokeWidth="3" strokeDasharray={n%2?'2 4':undefined}/><text x={50+n*60} y="77" textAnchor="middle" fill="currentColor" fontSize="12">Player {n%2+1}</text></g>)}</>}
 {kind==='scores'&&<>{[0,1,2,3].map(n=><g key={n}><rect x={26+n*60} y="15" width="48" height="65" rx="7" fill={n===2?'#e9f4c9':'#fff'} stroke={n===2?'#7f9c20':'#d6ddcd'} strokeWidth={n===2?2:1}/><rect x={30+n*60} y={n%2?48:20} width="40" height="25" rx="4" fill={n%2?coral:lime}/><text x={50+n*60} y="38" textAnchor="middle" fill="#20291b" fontSize="13">{[15,15,30,30][n]}</text><text x={50+n*60} y="66" textAnchor="middle" fill="#20291b" fontSize="13">{[0,15,15,30][n]}</text></g>)}</>}
 </svg>
}

export default function MomentumHelp(){
 const dialog=useRef(null);
 return <><button type="button" className="rm-help-trigger" aria-haspopup="dialog" aria-label="How to read match momentum" onClick={()=>dialog.current?.showModal()}>ⓘ <span>How to read</span></button>
 <dialog className="rm-help-dialog" ref={dialog} aria-labelledby="momentum-help-title" onClick={e=>{if(e.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.current.close()}}}>
 <div className="rm-help-heading"><div><small>YOUR VISUAL GUIDE</small><h2 id="momentum-help-title">Reading match momentum</h2><p>See how each game unfolded, then explore its points.</p></div><button type="button" className="ui-btn" data-variant="ghost" aria-label="Close momentum guide" onClick={()=>dialog.current.close()}>×</button></div>
 <div className="rm-help-grid">
 <section><Example kind="bars"/><h3>1. The bars tell the game story</h3><p>Each column is one game. Lime above the line shows points won by the first pair; coral below shows the second pair. Taller bars mean more recorded points won.</p></section>
 <section><Example kind="break"/><h3>2. Crossed ball = service broken</h3><p>The receiving pair won the game. The crossed-ball marker appears on the serving pair’s side. It marks a break of serve, not just a break point.</p></section>
 <section><Example kind="dots"/><h3>3. Dots reveal the point outcomes</h3><p>Each dot represents a point. Color identifies the responsible player’s pair; a dotted outline identifies its second player. Hover or tap a game to expand the scores.</p><p><b>W</b> Winner · <b>UE</b> Unforced error · <b>FE+</b> Forced error created. FE+ credits the creator. Faded dots are outside your filters; gray means attribution is unavailable.</p></section>
 <section><Example kind="scores"/><h3>4. Pick a score to explore</h3><p>The two rows show the score after each point. The colored block identifies the pair who won it. Below, the avatar and outcome show who was responsible. In Video review, click a timed point to replay it.</p></section>
 </div>
 <section className="rm-help-closeness"><h3>The colored line above each game: game closeness</h3><div><p><i style={{background:'#248b52'}}/><b>Comfortable</b><span>Won to love or 15.</span></p><p><i style={{background:'#d3b536'}}/><b>Contested</b><span>Won to 30, without deuce.</span></p><p><i style={{background:'#df823a'}}/><b>Tight</b><span>Reached 40–40 at any point.</span></p></div><p>Gray means incomplete game history. Tiebreaks are identified separately. This describes score closeness, not physical intensity.</p></section>
 <footer><span>Illustrative examples · Statistics reflect recorded points.</span><button type="button" className="ui-btn" data-variant="primary" onClick={()=>dialog.current.close()}>Got it</button></footer>
 </dialog></>
}
