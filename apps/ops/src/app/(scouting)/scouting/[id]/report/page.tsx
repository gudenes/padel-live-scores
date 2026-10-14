import {reportContext} from '@/lib/scouting/report-context'
import {compactPlayerName} from '@/lib/scouting/report-view'
import {auth} from '@/lib/auth'
import {RecordRecentMatch} from '../../RecentMatches'
import SavedScoutingReport from './SavedScoutingReport'
export const metadata={title:'Scouting report & insights · PadelNachos Admin'}
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params
 const context=await reportContext(id),user=(await auth())?.user;
 const names=(context.players??[]).map(p=>p.display_name||p.name);
 const label=names.length?names.slice(0,2).join(' / ')+' vs '+names.slice(2).join(' / '):'';
 return <>{label&&<RecordRecentMatch userId={user?.id??''} id={id} label={label} tournament={context.meta.tournament??''} players={(context.players??[]).map(p=>({name:compactPlayerName(p.display_name||p.name),avatar:p.avatar_url??null}))}/>}<SavedScoutingReport canShare={!!user?.isOperator} userId={user?.id??''} matchId={id} context={context}/></>
}
