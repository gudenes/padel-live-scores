import Link from 'next/link'
import {canViewReports} from '@/lib/scouting-permissions'
import {auth} from '@/lib/auth'
import {serviceClient} from '@/lib/supabase'
import styles from '../methodology/methodology.module.css'
export const metadata={title:'Private scouting matches · PadelNachos Admin'}
export const dynamic='force-dynamic'
export default async function Page(){
 if(!canViewReports((await auth())?.user))return <p>Sign in with an operator account to view private scouting.</p>
 const result=await serviceClient().from('operator_manual_scouting_matches').select('id,players,match_date,tournament_label,created_at').order('created_at',{ascending:false}).limit(200)
 return <main className={styles.page}><header><Link href="/scouting">← All scouted matches</Link><h1>Private scouting matches</h1><p>Create a match from the extension’s ☰ menu. These matches and typed player names are kept in scouting only.</p></header>
 {result.error?<p role="alert">Private match storage is unavailable. The admin update may be pending.</p>:!result.data?.length?<section className="ui-panel"><h2>No private matches yet</h2><p>In the extension, choose Create private match, enter four names, then connect your video.</p></section>:<section className="ui-panel"><h2>Saved matches</h2>{result.data.map(match=><article key={match.id} style={{padding:'16px 0',borderBottom:'1px solid var(--border)'}}><h3>{match.players.slice(0,2).map((p:{name:string})=>p.name).join(' / ')} vs {match.players.slice(2).map((p:{name:string})=>p.name).join(' / ')}</h3><p>Private · manually created{match.match_date?' · '+match.match_date:''}{match.tournament_label?' · '+match.tournament_label:''}</p><Link className="ui-btn" href={`/scouting/manual/${match.id}/report`}>View scouting report</Link></article>)}</section>}
 </main>
}
