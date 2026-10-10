import SavedScoutingReport from './SavedScoutingReport'
export const metadata={title:'Scouting report & insights · PadelNachos Admin'}
export default async function Page({params}:{params:Promise<{id:string}>}){
 const {id}=await params
 return <SavedScoutingReport matchId={id}/>
}
