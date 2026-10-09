import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Scout from './Scout'
export const metadata={title:'Match scouting · PadelNachos Admin'}
export default async function ScoutingPage({params}:{params:Promise<{id:string}>}){
  if(!(await auth())?.user?.isOperator)redirect('/scouting')
  const {id}=await params
  return <Scout matchId={id} landscapeOnly/>
}
