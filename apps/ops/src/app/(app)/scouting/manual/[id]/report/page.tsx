import SavedScoutingReport from '../../../[id]/report/SavedScoutingReport'
export const metadata={title:'Private scouting report · PadelNachos Admin'}
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params
 return <SavedScoutingReport matchId={id} manual/>
}
