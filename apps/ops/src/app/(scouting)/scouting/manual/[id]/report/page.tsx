import {auth} from '@/lib/auth'
import {reportContext} from '@/lib/scouting/report-context'
import SavedScoutingReport from '../../../[id]/report/SavedScoutingReport'
export const metadata={title:'Private scouting report · PadelNachos Admin'}
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params
 const user=(await auth())?.user
 return <SavedScoutingReport userId={user?.id??''} matchId={id} manual context={await reportContext(id,true)}/>
}
