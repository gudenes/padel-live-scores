// Leaderboard: realised net winnings from settled plays. Wallet spending is irrelevant.
import {leaderboardWeek} from '@/lib/leaderboard-week'
import { settledNetWinnings } from '@/lib/settled-net-winnings'
import { localSimulationLeaders } from '@/lib/local-simulation-leaders'
import { paginatedSelect } from '@/lib/db-paginate'
import { requirePlayAccess } from '@/lib/play-access'
import {
  getActiveSeason,
  playNotFound,
} from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'



type Period = 'week' | 'season' | 'all'

function parsePeriod(raw: string | null): Period {
  return raw === 'week' || raw === 'all' ? raw : 'season'
}

interface SettledPosition {
  user_id: string
  market_id: string
  cost_basis: number
}
interface Payout { user_id: string; market_id: string; yes_paid: number; no_paid: number }

interface ProfileRow {
  id: string
  display_name: string | null
  avatar_url: string | null
}

export async function GET(req: Request) {
  const access = await requirePlayAccess()
  if (!access) return playNotFound()
  const { supabase, userId } = access

  const period = parsePeriod(new URL(req.url).searchParams.get('period'))

  const season = await getActiveSeason(supabase)
  if (!season && period !== 'all') {
    return Response.json({ error: 'no_active_season' }, { status: 503 })
  }
  const seasonId = season?.id ?? null
  const rawWeek=Number(new URL(req.url).searchParams.get('week')??0)
  const weekOffset=Number.isInteger(rawWeek)?Math.max(0,Math.min(520,rawWeek)):0
  const week=leaderboardWeek(weekOffset)

  // Scope by result time, not purchase time. Current payouts are authoritative,
  // so corrected results replace the previous score rather than being added twice.
  const markets = await paginatedSelect<{id:string}>(
    (start,end) => {
      let q = supabase.from('markets').select('id').eq('status','settled')
        .not('settled_at','is',null).order('id').range(start,end)
      if (period === 'season') q = q.eq('season_id',seasonId!)
      if (period === 'week') q = q.gte('settled_at',week.start).lt('settled_at',week.end)
      return q
    }, {what:'settled markets (leaderboard)'})
  const winnings = new Map<string,number>()
  for (let offset=0;offset<markets.length;offset+=200) {
    const ids = markets.slice(offset,offset+200).map(m=>m.id)
    const [positions,payouts] = await Promise.all([
      paginatedSelect<SettledPosition>((start,end)=>supabase.from('market_positions')
        .select('user_id,market_id,cost_basis').in('market_id',ids).order('market_id').order('user_id').range(start,end),{what:'leaderboard settled positions'}),
      paginatedSelect<Payout>((start,end)=>supabase.from('market_payouts')
        .select('user_id,market_id,yes_paid,no_paid').in('market_id',ids).order('market_id').order('user_id').range(start,end),{what:'leaderboard payouts'}),
    ])
    for (const [id,score] of settledNetWinnings(positions,payouts)) {
      winnings.set(id,(winnings.get(id)??0)+score)
    }
  }
  const humanRanked = [...winnings].map(([userId,netWinnings])=>({userId,netWinnings}))
    .sort((a,b)=>b.netWinnings-a.netWinnings || a.userId.localeCompare(b.userId))

  let simulations: Awaited<ReturnType<typeof localSimulationLeaders>> = []
  try { simulations = await localSimulationLeaders(req, supabase, period, seasonId, weekOffset) }
  catch { return Response.json({ error: 'simulation_unavailable' }, { status: 503 }) }
  const bots = new Map(simulations.map(b => [b.userId, b]))
  const ranked = [...humanRanked, ...simulations].sort((a,b) => b.netWinnings-a.netWinnings || a.userId.localeCompare(b.userId))
  if (ranked.length === 0) return Response.json({ rows: [], me: null })

  const myIndex = ranked.findIndex((r) => r.userId === userId)
  const humanRanks = new Map(humanRanked.map((entry, index) => [entry.userId, index + 1]))

  // Return the complete ladder, including players below the caller. Batch profile
  // lookups to stay below PostgREST row and URL limits as participation grows.
  const ids = humanRanked.map(entry => entry.userId)
  const profiles = new Map<string, ProfileRow>()
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await supabase.from('profiles')
      .select('id, display_name, avatar_url').in('id', ids.slice(offset, offset + 200))
    if (error) {
      console.error('[play/leaderboard] profiles query failed:', error.message)
      return Response.json({ error: 'query_failed' }, { status: 500 })
    }
    for (const profile of (data ?? []) as ProfileRow[]) profiles.set(profile.id, profile)
  }

  const toRow = (entry: { userId: string; netWinnings: number }, index: number) => ({
    rank: index + 1,
    userId: entry.userId,
    isSimulation: bots.has(entry.userId),
    prizeEligible: !bots.has(entry.userId),
    avatarSeed: bots.get(entry.userId)?.avatarSeed ?? null,
    humanRank: bots.has(entry.userId) ? null : humanRanks.get(entry.userId) ?? null,
    displayName: bots.get(entry.userId)?.displayName || profiles.get(entry.userId)?.display_name?.trim() || null,
    avatarUrl: profiles.get(entry.userId)?.avatar_url ?? null,
    netWinnings: entry.netWinnings,
    isMe: entry.userId === userId,
  })

  return Response.json({
    period,
    hasSimulation: simulations.length > 0,
    rows: ranked.map(toRow),
    // `me` carries the caller's TRUE rank, computed over the full ranking —
    // independent of where the user has scrolled in the ladder.
    me: myIndex >= 0 ? toRow(ranked[myIndex]!, myIndex) : null,
  })
}
