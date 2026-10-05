import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { loadTournamentSuggestions } from '@/lib/play-tournament-suggestions'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  if (!(await auth())?.user?.isOperator) return Response.json({error:'unauthorized'},{status:401})
  const query = new URL(request.url).searchParams
  const id = query.get('tournament')
  const locksAt = query.get('locksAt') ?? ''
  if (locksAt && (!/^\d{4}-\d{2}-\d{2}T/.test(locksAt) || !Number.isFinite(Date.parse(locksAt)))) return Response.json({error:'Invalid closing deadline.'},{status:400})
  if (id && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return Response.json({error:'Invalid tournament ID.'},{status:400})
  try {
    return Response.json(await loadTournamentSuggestions(serviceClient(),id,new Date(),locksAt), {headers:{'Cache-Control':'no-store'}})
  } catch (error) {
    console.error('[play-suggestions]', error)
    return Response.json({error:'Could not load tournament suggestions. Refresh to try again.'},{status:503,headers:{'Cache-Control':'no-store'}})
  }
}
