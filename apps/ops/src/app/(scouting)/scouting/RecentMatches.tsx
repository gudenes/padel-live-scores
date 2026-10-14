'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import styles from './library.module.css';
type RecentPlayer={name:string;avatar:string|null};
type Recent={id:string;label:string;tournament:string;accessedAt:number;players?:RecentPlayer[]};
const key=(userId:string)=>'pn-admin-recent-matches:'+userId;
function read(userId:string):Recent[]{
 try{const raw=JSON.parse(localStorage.getItem(key(userId))||'[]');return Array.isArray(raw)?raw.filter(v=>/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v?.id)&&typeof v.label==='string'&&typeof v.tournament==='string'&&Number.isFinite(v.accessedAt)).sort((a,b)=>b.accessedAt-a.accessedAt).filter((v,i,a)=>a.findIndex(r=>r.id===v.id)===i).slice(0,5):[]}catch{return []}
}
export function RecordRecentMatch({userId,id,label,tournament,players=[]}:{userId:string;id:string;label:string;tournament:string;players?:RecentPlayer[]}){
 const playerData=JSON.stringify(players);
 useEffect(()=>{if(!userId||!label)return;try{localStorage.setItem(key(userId),JSON.stringify([{id,label,tournament,players:JSON.parse(playerData),accessedAt:Date.now()},...read(userId).filter(m=>m.id!==id)].slice(0,5)));window.dispatchEvent(new Event('pn-recent-matches-changed'))}catch{/* Browsing must remain available when storage is disabled. */}},[userId,id,label,tournament,playerData]);
 return null;
}
export default function RecentMatches({userId}:{userId:string}){
 const [matches,setMatches]=useState<Recent[]>([]),[ready,setReady]=useState(false);
 useEffect(()=>{const sync=()=>{setMatches(read(userId));setReady(true)};sync();window.addEventListener('storage',sync);window.addEventListener('pn-recent-matches-changed',sync);window.addEventListener('focus',sync);return()=>{window.removeEventListener('storage',sync);window.removeEventListener('pn-recent-matches-changed',sync);window.removeEventListener('focus',sync)}},[userId]);
 return <section className={styles.recentMatches} aria-label="Recent matches"><h2>RECENT MATCHES</h2><p>Last 5 opened · This browser</p>{!ready?<p>Loading recent matches…</p>:!matches.length?<p>Open a match to find it here next time.</p>:<ol>{matches.map(m=><li key={m.id}><Link className={styles.recentCard} href={'/scouting/'+m.id+'/report'} aria-label={'Open '+m.label}><span className={styles.recentTournament}>{m.tournament||'Match report'}<span aria-hidden="true">↗</span></span>{[0,1].map(team=>{const pair=Array.isArray(m.players)?m.players.slice(team*2,team*2+2):[];return <span key={team} className={styles.recentTeam} data-team={team}><span className={styles.recentAvatars}>{pair.length?pair.map((p,i)=><span key={i}>{p.avatar?<img src={p.avatar} alt=""/>:p.name?.charAt(0)}</span>):<span aria-hidden="true">{team+1}</span>}</span><span>{pair.length?pair.map(p=>p.name).join(' / '):m.label.split(' vs ')[team]||'Team'}</span></span>})}<small className={styles.recentFooter}>Open insights <span aria-hidden="true">→</span></small></Link></li>)}</ol>}</section>;
}
