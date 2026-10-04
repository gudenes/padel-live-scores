import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { loadTournamentSuggestions } from '@/lib/play-tournament-suggestions'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  if (!(await auth())?.user?.isOperator) return Response.json({error:'unauthorized'},{status:401})
  const id = new URL(request.url).searchParams.get('tournament')
  if (id && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return Response.json({error:'Invalid tournament ID.'},{status:400})
  try {
    return Response.json(await loadTournamentSuggestions(serviceClient(),id), {headers:{'Cache-Control':'no-store'}})
  } catch (error) {
    console.error('[play-suggestions]', error)
    return Response.json({error:'Could not load tournament suggestions. Refresh to try again.'},{status:503,headers:{'Cache-Control':'no-store'}})
  }
}
