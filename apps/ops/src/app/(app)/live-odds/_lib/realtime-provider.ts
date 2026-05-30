// apps/ops/src/app/(app)/live-odds/_lib/realtime-provider.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { LiveOddsSnapshot, Match } from './types'
import { mapConfidence, mapStatus, movementFromSnapshots, type SnapshotRow } from './map-odds'
import { computeKpis } from './odds-math'

function browserClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  )
}

// Shape returned by the joined select (FK alias names must match the real schema — see note).
interface JoinedRow {
  match_id: string
  pair1_win_prob: number; pair2_win_prob: number
  pair1_fair_odds: number; pair2_fair_odds: number
  confidence: string; computed_at: string
  matches: {
    status: string; court: string | null; round: string | null; scheduled_at: string | null; category: string | null
    tournament: { name: string | null } | null
    p1a: { name: string | null } | null; p1b: { name: string | null } | null
    p2a: { name: string | null } | null; p2b: { name: string | null } | null
    sets: Array<{ pair1_games: number; pair2_games: number; is_current: boolean; set_number: number }>
    games: Array<{ game_score: string | null; is_current: boolean; server_player_id: string | null }>
  } | null
}

const SELECT =
  'match_id,pair1_win_prob,pair2_win_prob,pair1_fair_odds,pair2_fair_odds,confidence,computed_at,' +
  'matches!inner(status,court,round,scheduled_at,category,' +
  'tournament:tournaments(name),' +
  'p1a:players!matches_pair1_player1_id_fkey(name),p1b:players!matches_pair1_player2_id_fkey(name),' +
  'p2a:players!matches_pair2_player1_id_fkey(name),p2b:players!matches_pair2_player2_id_fkey(name),' +
  'sets(pair1_games,pair2_games,is_current,set_number),games(game_score,is_current,server_player_id))'

function pairName(a?: { name: string | null } | null, b?: { name: string | null } | null): string {
  return [a?.name, b?.name].filter(Boolean).join(' / ') || 'TBD'
}

function mapRow(r: JoinedRow, snaps: SnapshotRow[]): Match {
  const m = r.matches
  const gender: 'men' | 'women' = m?.category === 'women' ? 'women' : 'men'
  const sets = (m?.sets ?? []).slice().sort((a, b) => a.set_number - b.set_number)
  const current = m?.games?.find((g) => g.is_current) ?? null
  return {
    id: r.match_id,
    pair1: { name: pairName(m?.p1a, m?.p1b), gender, serving: false },
    pair2: { name: pairName(m?.p2a, m?.p2b), gender, serving: false },
    tournament: m?.tournament?.name ?? '',
    tournamentShort: m?.tournament?.name ?? '',
    court: m?.court ?? '', round: m?.round ?? '',
    setScores: sets.map((s) => ({ a: s.pair1_games, b: s.pair2_games, current: s.is_current })),
    gamePoints: current?.game_score
      ? { a: current.game_score.split('-')[0] ?? '', b: current.game_score.split('-')[1] ?? '' }
      : null,
    status: mapStatus(m?.status ?? 'scheduled'),
    scheduledTime: m?.scheduled_at ? new Date(m.scheduled_at).toISOString().slice(11, 16) : undefined,
    winProbA: Math.round(r.pair1_win_prob * 100),
    fairOddsA: r.pair1_fair_odds, fairOddsB: r.pair2_fair_odds,
    movement15m: movementFromSnapshots(snaps, r.match_id),
    confidence: mapConfidence(r.confidence),
    lastUpdatedSeconds: Math.max(0, Math.round((Date.now() - +new Date(r.computed_at)) / 1000)),
    winProbHistory: [],
  }
}

export type FeedListener = (s: LiveOddsSnapshot) => void
export type ConnListener = (state: 'live' | 'reconnecting' | 'offline') => void

export function createRealtimeFeed() {
  const supabase = browserClient()
  let listeners: FeedListener[] = []
  let connListeners: ConnListener[] = []
  let channel: ReturnType<SupabaseClient['channel']> | null = null

  async function refresh() {
    const { data, error } = await supabase.from('match_odds').select(SELECT).returns<JoinedRow[]>()
    if (error) { connListeners.forEach((l) => l('offline')); return }
    const ids = data.map((r) => r.match_id)
    let snaps: SnapshotRow[] = []
    if (ids.length) {
      const since = new Date(Date.now() - 16 * 60000).toISOString()
      const { data: sd } = await supabase.from('match_odds_snapshots')
        .select('match_id,pair1_win_prob,computed_at').in('match_id', ids).gte('computed_at', since)
      snaps = (sd ?? []) as SnapshotRow[]
    }
    const matches = data.map((r) => mapRow(r, snaps))
    const snapshot: LiveOddsSnapshot = { matches, kpis: computeKpis(matches) }
    listeners.forEach((l) => l(snapshot))
  }

  return {
    subscribe(fn: FeedListener) { listeners.push(fn); refresh(); return () => { listeners = listeners.filter((l) => l !== fn) } },
    onConnection(fn: ConnListener) { connListeners.push(fn); return () => { connListeners = connListeners.filter((l) => l !== fn) } },
    start() {
      channel = supabase
        .channel('match_odds')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'match_odds' }, () => refresh())
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') connListeners.forEach((l) => l('live'))
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') connListeners.forEach((l) => l('reconnecting'))
          else if (status === 'CLOSED') connListeners.forEach((l) => l('offline'))
        })
    },
    stop() { if (channel) { supabase.removeChannel(channel); channel = null } },
    async fetchHistory(matchId: string): Promise<number[]> {
      const { data } = await supabase.from('match_odds_snapshots')
        .select('pair1_win_prob,computed_at').eq('match_id', matchId).order('computed_at', { ascending: true }).limit(60)
      return (data ?? []).map((r) => Math.round((r.pair1_win_prob as number) * 100))
    },
  }
}
