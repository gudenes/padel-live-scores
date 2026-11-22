import { createClient } from '@supabase/supabase-js'
import { qualifyingPoints, type DrawRow, type MatchPoints } from '@/lib/live-race/qualifying'
export const runtime = 'nodejs'
const cache = new Map<string, { at: number; matches: Record<string, MatchPoints> }>()
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('tournament') ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return Response.json({}, { status: 400 })
  const saved = cache.get(id)
  if (saved && Date.now() - saved.at < 60_000) return Response.json({ matches: saved.matches })
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    const { data: tournament, error } = await db.from('tournaments').select('level,starts_at').eq('id', id).single()
    if (error || !tournament) throw new Error('Missing tournament')
    const rows: DrawRow[] = []
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from('matches').select('id,round,round_canonical,category').eq('tournament_id', id).order('id').range(offset, offset + 499)
      if (error) throw error
      rows.push(...(data ?? []))
      if ((data?.length ?? 0) < 500) break
    }
    const matches = qualifyingPoints(tournament.level, tournament.starts_at?.slice(0, 4), rows)
    if (cache.size >= 100) cache.clear()
    cache.set(id, { at: Date.now(), matches })
    return Response.json({ matches }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ matches: {} }, { status: 503 }) }
}
