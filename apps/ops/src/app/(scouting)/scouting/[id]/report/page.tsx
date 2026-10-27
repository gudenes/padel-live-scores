import MatchWorkspace from './MatchWorkspace'
import {canScout} from '@/lib/scouting-permissions'
import {reportContext} from '@/lib/scouting/report-context'
import {compactPlayerName} from '@/lib/scouting/report-view'
import {auth} from '@/lib/auth'
import {RecordRecentMatch} from '../../RecentMatches'
import SavedScoutingReport from './SavedScoutingReport'
export const metadata={title:'Scouting report & insights · PadelNachos Admin'}
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<{liveReview?:string}>}){
 const liveReview=process.env.SCOUT_LIVE_EXPERIMENT==='1'&&(await searchParams).liveReview==='1'
 const {id}=await params
 const context=await reportContext(id),user=(await auth())?.user;
 const names=(context.players??[]).map(p=>p.display_name||p.name);
 const label=names.length?names.slice(0,2).join(' / ')+' vs '+names.slice(2).join(' / '):'';
 return <>{label&&<RecordRecentMatch userId={user?.id??''} id={id} label={label} tournament={context.meta.tournament??''} players={(context.players??[]).map(p=>({name:compactPlayerName(p.display_name||p.name),avatar:p.avatar_url??null}))}/>}<MatchWorkspace matchId={id} enabled={canScout(user)} localTest={process.env.SCOUT_LIVE_EXPERIMENT==='1'}><>{liveReview&&<p role="status" style={{padding:"12px 24px",background:"#eaf5c6"}}>Local server review · Test data only; not published to production.</p>}<SavedScoutingReport liveReview={liveReview} canShare={!liveReview&&!!user?.isOperator} userId={user?.id??''} matchId={id} context={context}/></></MatchWorkspace></>
}
