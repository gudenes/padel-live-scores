import Scout from './Scout'
export const metadata={title:'Match scouting · PadelNachos Admin'}
export default async function ScoutingPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params
  return <Scout matchId={id}/>
}
