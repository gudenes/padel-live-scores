import {shortLivedLoader} from '@/lib/short-lived-loader'
import {parseMemberAppearance,type MemberAppearance} from '@/lib/member-appearance'
// Leaderboard: realised net winnings from settled plays. Wallet spending is irrelevant.
import {leaderboardWeek, activeLeaderboardWeeks, selectLeaderboardWeek} from '@/lib/leaderboard-week'
import { settledNetWinnings } from '@/lib/settled-net-winnings'
import { loadSimulationLeaderboard } from '@/lib/local-simulation-leaders'
import { paginatedSelect } from '@/lib/db-paginate'
import { requirePlayAccess } from '@/lib/play-access'
import {
  getActiveSeason,
  playNotFound,
} from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'



const simulationSnapshot=shortLivedLoader<Awaited<ReturnType<typeof loadSimulationLeaderboard>>>(30_000)
const historySnapshot=shortLivedLoader<string[]>(30_000)

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
  const started=performance.now()
  let previous=started
  const timings:string[]=[]
  const mark=(name:string)=>{const now=performance.now();timings.push(`${name};dur=${(now-previous).toFixed(1)}`);previous=now}

  const access = await requirePlayAccess()
  if (!access) return playNotFound()
  const { supabase, userId } = access
  mark('auth')

  const period = parsePeriod(new URL(req.url).searchParams.get('period'))

  const rawWeek=Number(new URL(req.url).searchParams.get('week')??0)
  const requestedWeek=Number.isInteger(rawWeek)?Math.max(0,Math.min(520,rawWeek)):0
  const weekKey=leaderboardWeek().start
  const history=async()=>{
    if(period!=='week')return [] as string[]
    const [played,trades]=await Promise.all([
      paginatedSelect<{settled_at:string}>((start,end)=>supabase.from('markets')
        .select('settled_at,market_positions!inner(),market_payouts!inner()')
        .eq('status','settled').not('settled_at','is',null)
        .gte('settled_at',leaderboardWeek(520).start).order('id').range(start,end),{what:'active leaderboard weeks'}),
      paginatedSelect<{created_at:string}>((start,end)=>supabase.from('market_trades')
        .select('created_at').eq('direction','buy').gte('created_at',leaderboardWeek(520).start)
        .order('id').range(start,end),{what:'leaderboard participation history'}),
    ])
    return [...played.map(row=>row.settled_at),...trades.map(row=>row.created_at)]
  }
  // Start independent reads together. Only shared history/simulation data is
  // reused, for at most 30s; authentication, follows and personal rows stay fresh.
  const [season,following,simulationResult,activityDates]=await Promise.all([
    getActiveSeason(supabase),
    paginatedSelect<{following_id:string}>((start,end)=>supabase.from('play_member_follows').select('following_id').eq('follower_id',userId).order('following_id').range(start,end),{what:'leaderboard friends'}),
    (process.env.NODE_ENV==='production'
      ?simulationSnapshot(`${weekKey}:${period==='week'}`,()=>loadSimulationLeaderboard(req,supabase,period==='week'))
      :loadSimulationLeaderboard(req,supabase,period==='week')).then(data=>({data}),()=>({data:null})),
    period==='week'&&process.env.NODE_ENV==='production'?historySnapshot(weekKey,history):history(),
  ])
  mark('history_and_simulation')
  if(!season&&period!=='all')return Response.json({error:'no_active_season'},{status:503})
  const seasonId=season?.id??null
  if(!simulationResult.data)return Response.json({error:'simulation_unavailable'},{status:503})
  const simulationData=simulationResult.data
  const weekNavigation=period==='week'
    ?selectLeaderboardWeek(activeLeaderboardWeeks([...activityDates,...simulationData.activityDates]),requestedWeek)
    :{weekOffset:requestedWeek,previousWeek:null as number|null,nextWeek:null as number|null}
  const { weekOffset } = weekNavigation
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
  // Weekly participation starts with the first buy, even before settlement.
  // Keep result-time scoring so older predictions settling this week still count.
  if (period === 'week') {
    const participants = await paginatedSelect<{user_id:string}>(
      (start,end) => supabase.from('market_trades').select('user_id')
        .eq('direction','buy').gte('created_at',week.start).lt('created_at',week.end)
        .order('id').range(start,end), {what:'weekly leaderboard participants'})
    for (const {user_id} of participants) {
      if (!winnings.has(user_id)) winnings.set(user_id,0)
    }
  }
  mark('scores')
  const humanRanked = [...winnings].map(([userId,netWinnings])=>({userId,netWinnings}))
    .sort((a,b)=>b.netWinnings-a.netWinnings || a.userId.localeCompare(b.userId))

  const simulations = simulationData.leaders(period, seasonId, weekOffset)
  const bots = new Map(simulations.map(b => [b.userId, b]))
  const ranked = [...humanRanked, ...simulations].sort((a,b) => b.netWinnings-a.netWinnings || a.userId.localeCompare(b.userId))


  const myIndex = ranked.findIndex((r) => r.userId === userId)
  const humanRanks = new Map(humanRanked.map((entry, index) => [entry.userId, index + 1]))

  // Return the complete ladder, including players below the caller. Batch profile
  // lookups to stay below PostgREST row and URL limits as participation grows.
  const friendIds = new Set([userId,...following.map(row=>row.following_id)])
  const ids = [...new Set([...humanRanked.map(entry => entry.userId),...friendIds])]
  const appearances = new Map<string,MemberAppearance>()
  const profiles = new Map<string, ProfileRow>()
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch=ids.slice(offset,offset+200)
    const [{data,error},members] = await Promise.all([
      supabase.from('profiles').select('id, display_name, avatar_url').in('id',batch),
      supabase.from('play_access').select('user_id').in('user_id',batch),
    ])
    // Batch public appearances; no one-request-per-avatar waterfall.
    if(!members.error && members.data?.length){
      const wardrobe=await supabase.from('play_wardrobes').select('user_id,avatar,equipped').in('user_id',members.data.map(m=>m.user_id))
      if(!wardrobe.error)for(const row of wardrobe.data??[]){const appearance=parseMemberAppearance(row);if(appearance)appearances.set(row.user_id,appearance)}
    }
    if (error) {
      console.error('[play/leaderboard] profiles query failed:', error.message)
      return Response.json({ error: 'query_failed' }, { status: 500 })
    }
    for (const profile of (data ?? []) as ProfileRow[]) profiles.set(profile.id, profile)
  }

  mark('profiles_and_avatars')
  const serverTiming=[...timings,`total;dur=${(performance.now()-started).toFixed(1)}`].join(', ')
  if(process.env.NODE_ENV!=='production')console.info('[play/leaderboard timing]',serverTiming)

  const toRow = (entry: { userId: string; netWinnings: number }, index: number) => ({
    rank: index + 1,
    userId: entry.userId,
    isSimulation: bots.has(entry.userId),
    prizeEligible: !bots.has(entry.userId),
    avatarSeed: bots.get(entry.userId)?.avatarSeed ?? null,
    humanRank: bots.has(entry.userId) ? null : humanRanks.get(entry.userId) ?? null,
    displayName: bots.get(entry.userId)?.displayName || profiles.get(entry.userId)?.display_name?.trim() || null,
    avatarUrl: profiles.get(entry.userId)?.avatar_url ?? null,
    appearance: appearances.get(entry.userId) ?? null,
    netWinnings: entry.netWinnings,
    isMe: entry.userId === userId,
  })

  return Response.json({
    period,
    ...weekNavigation,
    hasSimulation: simulations.length > 0,
    rows: ranked.map(toRow),
    // Social standings include inactive friends, without awarding global ranks.
    friendRows: [...friendIds].filter(id=>id===userId||profiles.has(id))
      .map(id=>({userId:id,netWinnings:winnings.get(id)??0}))
      .sort((a,b)=>b.netWinnings-a.netWinnings||a.userId.localeCompare(b.userId))
      .map((entry,index)=>({...toRow(entry,index),prizeEligible:winnings.has(entry.userId)})),
    // `me` carries the caller's TRUE rank, computed over the full ranking —
    // independent of where the user has scrolled in the ladder.
    me: myIndex >= 0 ? toRow(ranked[myIndex]!, myIndex) : null,
  }, {headers:{'Cache-Control':'private, no-store','Server-Timing':serverTiming}})
}
