import Link from 'next/link'
import {playerProfileHref,tournamentMatchesHref} from '@/lib/scouting/navigation'
import {librarySummary} from '@/lib/scouting/library-summary'
import {canScout,type StaffUser} from '@/lib/scouting-permissions'
import type {MatchCardRow} from './MatchCard'
import NavigationProgress from './NavigationProgress'
import styles from './library.module.css'
export default function CompactMatchCard({row:r,user}:{row:MatchCardRow;user?:StaffUser|null}){
 const official=(r.official_sets??[]).filter(s=>Number.isInteger(s.a)&&Number.isInteger(s.b))
 const summary=r.has_scouting?librarySummary(r,r.source,official):null,sets=official.length?official:summary?.sets??[]
 const finished=['finished','walkover','retired'].includes(r.match_status??'')||r.phase==='finished'
 const status=r.match_status==='live'?'Live':finished?(r.match_status==='walkover'?'Walkover':r.match_status==='retired'?'Retired':'Finished'):r.match_status==='scheduled'?'Scheduled':'Match available'
 const href=`/scouting/${r.kind==='private'?'manual/':''}${r.match_id}/report`
 const tournamentHref=tournamentMatchesHref(r.tournament_id,r.kind==='private'?r.tournament_name:null)
 const date=r.match_date?new Date(r.match_date):null
 const dateText=date&&!Number.isNaN(date.getTime())?date.toLocaleDateString('en-GB',{timeZone:'Europe/Madrid',day:'numeric',month:'short',year:'numeric'}):'Date unavailable'
 const scheduledTime=r.kind==='match'&&date&&!Number.isNaN(date.getTime())?date.toLocaleTimeString('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hour12:false}):null
 const scoutLabel=!summary?'Not scouted':summary.failed?'Needs review':summary.completed?'Scouted':'In progress'
 return <article className={styles.compactCard}>
 <header className={styles.compactHeading}><div><h2>{tournamentHref?<Link className={styles.tournamentLink} href={tournamentHref} prefetch={false} aria-label={`All matches from ${r.tournament_name}`}>{r.tournament_name} <span aria-hidden="true">↗</span></Link>:r.tournament_name}</h2><p>{[r.round,r.category,r.kind==='private'?'Private match':'Tournament match'].filter(Boolean).join(' · ')}</p></div><span className={styles.badge} data-state={r.match_status==='live'?'live':finished?'finished':'scheduled'}>{status}</span></header>
 <div className={styles.compactDate}>{dateText}{scheduledTime&&<> · Scheduled {scheduledTime} <span title="Europe/Madrid">(Madrid)</span></>}</div>
 <div className={styles.compactTeams}>{[0,1].map(team=>{const players=r.players.slice(team*2,team*2+2),pairHref=players.length===2?playerProfileHref(players.map(p=>r.kind==='private'?p.existingPlayerId:p.id)):null;return <div className={styles.connectedTeam} key={team} data-team={team}><div className={styles.connectedPlayers}>{players.map((p,i)=>{const avatar=r.avatars?.[p.id]??p.avatar_url??p.photo_url,profileHref=playerProfileHref([r.kind==='private'?p.existingPlayerId:p.id]);const content=<>{avatar?<img src={avatar} alt="" width={28} height={28} loading="lazy"/>:<span className={styles.playerInitial} aria-hidden="true">{p.name?.[0]??'?'}</span>}<span>{p.name}</span></>;return profileHref?<Link key={p.id??i} className={styles.connectedPlayer} href={profileHref} prefetch={false} aria-label={`View player profile: ${p.name}`}>{content}</Link>:<span key={i} className={styles.connectedPlayer}>{content}</span>})}{pairHref&&<Link className={styles.pairLink} href={pairHref} prefetch={false} aria-label={`View pair: ${players.map(p=>p.name).join(' / ')}`}>View pair ↗</Link>}</div><span className={styles.compactScore}>{sets.length?sets.map((s,i)=><b key={i} aria-label={`Set ${i+1}: ${team===0?s.a:s.b}`}>{team===0?s.a:s.b}</b>):'—'}</span></div>})}</div>
 <footer className={styles.compactFooter}><span className={styles.scoutBadge} data-scouted={!!summary?.completed}>{scoutLabel}</span><div className={styles.compactActions}>{canScout(user)&&r.kind==='match'&&(!r.has_scouting||r.source==='video')&&<Link prefetch={false} className="ui-btn" data-variant="primary" href={`${href}?tab=live`}>Scout</Link>}<Link prefetch={false} href={href} className={styles.compactLink} aria-label={`View match: ${r.players.map(p=>p.name).join(' / ')}`}>View match <span aria-hidden="true">→</span><NavigationProgress/></Link></div></footer>
 </article>
}
