import { readRace, refreshRace } from '@/lib/live-race/service'
export const runtime = 'nodejs'
export async function GET(request:Request) {
  const gender=new URL(request.url).searchParams.get('gender')??'men'
  if(gender!=='men' && gender!=='women') return Response.json({error:'Invalid gender'},{status:400})
  try {
    const snapshot=await readRace(gender) ?? await refreshRace(gender,0)
    if(!snapshot) return Response.json({error:'Race is initializing'},{status:503})
    const stale=Date.now()-Date.parse(snapshot.computedAt)>5*60_000
    return Response.json({...snapshot,status:stale?'stale':snapshot.status},{headers:{'Cache-Control':'no-store'}})
  }catch {return Response.json({error:'Official Race source unavailable'},{status:503})}
}
