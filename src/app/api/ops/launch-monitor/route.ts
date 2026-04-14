// src/app/api/ops/launch-monitor/route.ts
// Returns launch readiness data for spotlighted upcoming tournaments.
// Used by the ops dashboard to surface critical events ahead of major launches.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

// Tournaments to spotlight as launch monitors. Add more here as needed.
// The Newgiza P2 2026 is the New Giza launch event for PadelNachos.
const LAUNCH_TOURNAMENT_IDS = [
  '7204f4ac-5ced-4b2f-b9c0-5fb81a497a90', // Newgiza P2 2026
]

interface LaunchMonitor {
  id: string
  name: string
  level: string | null
  externalId: string | null
  source: string | null
  startsAt: string | null
  endsAt: string | null
  daysUntilStart: number | null
  isLive: boolean
  isUpcoming: boolean
  hasFinished: boolean
  location: string | null
  country: string | null
  prizeMoney: string | null
  logoUrl: string | null
  // Counts
  totalMatches: number
  liveMatches: number
  scheduledMatches: number
  finishedMatches: number
  matchesWithAllPlayers: number
  matchesWithWinner: number
  // Draws / entry list
  drawsTotal: number
  drawsMen: number
  drawsWomen: number
  // Last sync info
  lastSyncEvent: { startedAt: string | null; status: string | null; matchesSynced: number | null } | null
  // Readiness summary (human friendly)
  readinessFlags: { ok: boolean; label: string; severity: 'info' | 'warn' | 'error' }[]
  // ── User engagement metrics ─────────────────────────
  userMetrics: {
    // Sign-ups
    signupsTotal: number
    signupsToday: number
    signupsThisWeek: number
    signupsViaReferral: number
    // Active users
    activeToday: number
    activeThisWeek: number
    // Badges
    badgesEarnedTotal: number
    badgesEarnedToday: number
    // Match ratings
    ratingsTotal: number
    ratingsToday: number
    // Feed engagement
    articleClicksToday: number
    sharesToday: number
    sharesTotal: number
    // Push & follows
    pushSubscribers: number
    playersFollowed: number
    tournamentsFollowed: number
    matchesBookmarked: number
    // Streaks
    avgLoginStreak: number
    maxLoginStreak: number
  }
}

export async function GET() {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const supabase = getServiceClient()

  // ── Latest 50 sign-ups (global, outside tournament loop) ────
  const { data: recentSignupsData } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, created_at, referred_by, login_streak, last_active_at')
    .order('created_at', { ascending: false })
    .limit(50)

  const recentSignups = (recentSignupsData ?? []).map(p => ({
    id: p.id,
    displayName: p.display_name,
    avatarUrl: p.avatar_url,
    createdAt: p.created_at,
    referredBy: p.referred_by,
    loginStreak: p.login_streak,
    lastActiveAt: p.last_active_at,
  }))

  const monitors: LaunchMonitor[] = []

  for (const tournamentId of LAUNCH_TOURNAMENT_IDS) {
    const { data: t } = await supabase
      .from('tournaments')
      .select('id, name, external_id, level, source, starts_at, ends_at, location, country, prize_money, logo_url')
      .eq('id', tournamentId)
      .single()

    if (!t) continue

    // Match aggregates
    const { data: matches } = await supabase
      .from('matches')
      .select('id, status, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
      .eq('tournament_id', tournamentId)

    const matchList = matches ?? []
    const liveMatches = matchList.filter(m => m.status === 'live').length
    const scheduledMatches = matchList.filter(m => m.status === 'scheduled').length
    const finishedMatches = matchList.filter(m => ['finished', 'walkover', 'retired', 'bye', 'ended'].includes(m.status ?? '')).length
    const matchesWithAllPlayers = matchList.filter(m => m.pair1_player1_id && m.pair1_player2_id && m.pair2_player1_id && m.pair2_player2_id).length
    const matchesWithWinner = matchList.filter(m => m.winner_pair !== null).length

    // Draws / entry list
    const { data: draws } = await supabase
      .from('tournament_draws')
      .select('category')
      .eq('tournament_id', tournamentId)

    const drawList = draws ?? []
    const drawsMen = drawList.filter(d => d.category === 'men').length
    const drawsWomen = drawList.filter(d => d.category === 'women').length

    // Last sync event from ops_events
    const { data: syncEvents } = await supabase
      .from('ops_events')
      .select('started_at, status, meta')
      .or(`source.eq.cron:scores,source.eq.cron:sync-matches`)
      .order('started_at', { ascending: false })
      .limit(1)

    const lastEvent = syncEvents?.[0]
    const lastSyncEvent = lastEvent
      ? {
          startedAt: lastEvent.started_at as string | null,
          status: lastEvent.status as string | null,
          matchesSynced: ((lastEvent.meta as any) ?? {}).matches_synced ?? null,
        }
      : null

    // Time computations
    const now = new Date()
    const startsAt = t.starts_at ? new Date(t.starts_at) : null
    const endsAt = t.ends_at ? new Date(t.ends_at) : null
    const daysUntilStart = startsAt ? Math.ceil((startsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null
    const isUpcoming = startsAt ? startsAt > now : false
    const isLive = startsAt && endsAt ? now >= startsAt && now <= endsAt : false
    const hasFinished = endsAt ? now > endsAt : false

    // Readiness flags
    const flags: LaunchMonitor['readinessFlags'] = []

    if (isUpcoming) {
      if (daysUntilStart !== null && daysUntilStart <= 7 && matchList.length === 0) {
        flags.push({ ok: false, label: `No matches yet (starts in ${daysUntilStart}d)`, severity: 'warn' })
      } else if (matchList.length > 0) {
        flags.push({ ok: true, label: `${matchList.length} matches loaded`, severity: 'info' })
      }

      if (drawList.length === 0) {
        flags.push({ ok: false, label: 'No draws / entry list', severity: 'info' })
      } else {
        flags.push({ ok: true, label: `${drawsMen + drawsWomen} draws (${drawsMen}m / ${drawsWomen}w)`, severity: 'info' })
      }

      if (!t.logo_url) flags.push({ ok: false, label: 'Missing logo', severity: 'warn' })
      if (!t.location) flags.push({ ok: false, label: 'Missing location', severity: 'warn' })
      if (!t.prize_money) flags.push({ ok: false, label: 'Missing prize money', severity: 'warn' })
    } else if (isLive) {
      flags.push({ ok: true, label: 'LIVE NOW', severity: 'info' })
    }

    if (matchList.length > 0 && matchesWithAllPlayers < matchList.length) {
      flags.push({
        ok: false,
        label: `${matchList.length - matchesWithAllPlayers} matches missing players`,
        severity: 'warn',
      })
    }

    // ── User engagement metrics (global, not per-tournament) ────
    const today = new Date().toISOString().slice(0, 10) + 'T00:00:00Z'
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const [
      signupsTotalRes, signupsTodayRes, signupsWeekRes, signupsReferralRes,
      activeTodayRes, activeWeekRes,
      badgesTotalRes, badgesTodayRes,
      ratingsTotalRes, ratingsTodayRes,
      articleClicksTodayRes, sharesTodayRes, sharesTotalRes,
      pushRes, playersFollowedRes, tournamentsFollowedRes, matchesBookmarkedRes,
      streakRes,
    ] = await Promise.all([
      // Sign-ups
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', today),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', weekAgo),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).not('referred_by', 'is', null),
      // Active users
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_active_at', today),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).gte('last_active_at', weekAgo),
      // Badges
      supabase.from('user_badges').select('id', { count: 'exact', head: true }),
      supabase.from('user_badges').select('id', { count: 'exact', head: true }).gte('unlocked_at', today),
      // Ratings
      supabase.from('match_ratings').select('id', { count: 'exact', head: true }),
      supabase.from('match_ratings').select('id', { count: 'exact', head: true }).gte('created_at', today),
      // Activity log
      supabase.from('user_activity_log').select('id', { count: 'exact', head: true }).eq('action', 'article_click').gte('created_at', today),
      supabase.from('user_activity_log').select('id', { count: 'exact', head: true }).eq('action', 'share').gte('created_at', today),
      supabase.from('user_activity_log').select('id', { count: 'exact', head: true }).eq('action', 'share'),
      // Push & follows
      supabase.from('push_subscriptions').select('id', { count: 'exact', head: true }),
      supabase.from('user_bookmarks').select('id', { count: 'exact', head: true }).eq('bookmark_type', 'player'),
      supabase.from('user_bookmarks').select('id', { count: 'exact', head: true }).eq('bookmark_type', 'tournament'),
      supabase.from('user_bookmarks').select('id', { count: 'exact', head: true }).eq('bookmark_type', 'match'),
      // Streaks
      supabase.from('profiles').select('login_streak').not('login_streak', 'is', null).gt('login_streak', 0),
    ])

    // Compute average and max streak
    const streakData = (streakRes.data ?? []) as { login_streak: number }[]
    const avgStreak = streakData.length > 0
      ? Math.round((streakData.reduce((sum, p) => sum + p.login_streak, 0) / streakData.length) * 10) / 10
      : 0
    const maxStreak = streakData.length > 0
      ? Math.max(...streakData.map(p => p.login_streak))
      : 0

    const userMetrics: LaunchMonitor['userMetrics'] = {
      signupsTotal: signupsTotalRes.count ?? 0,
      signupsToday: signupsTodayRes.count ?? 0,
      signupsThisWeek: signupsWeekRes.count ?? 0,
      signupsViaReferral: signupsReferralRes.count ?? 0,
      activeToday: activeTodayRes.count ?? 0,
      activeThisWeek: activeWeekRes.count ?? 0,
      badgesEarnedTotal: badgesTotalRes.count ?? 0,
      badgesEarnedToday: badgesTodayRes.count ?? 0,
      ratingsTotal: ratingsTotalRes.count ?? 0,
      ratingsToday: ratingsTodayRes.count ?? 0,
      articleClicksToday: articleClicksTodayRes.count ?? 0,
      sharesToday: sharesTodayRes.count ?? 0,
      sharesTotal: sharesTotalRes.count ?? 0,
      pushSubscribers: pushRes.count ?? 0,
      playersFollowed: playersFollowedRes.count ?? 0,
      tournamentsFollowed: tournamentsFollowedRes.count ?? 0,
      matchesBookmarked: matchesBookmarkedRes.count ?? 0,
      avgLoginStreak: avgStreak,
      maxLoginStreak: maxStreak,
    }

    monitors.push({
      id: t.id,
      name: t.name,
      level: t.level,
      externalId: t.external_id,
      source: t.source,
      startsAt: t.starts_at,
      endsAt: t.ends_at,
      daysUntilStart,
      isLive,
      isUpcoming,
      hasFinished,
      location: t.location,
      country: t.country,
      prizeMoney: t.prize_money,
      logoUrl: t.logo_url,
      totalMatches: matchList.length,
      liveMatches,
      scheduledMatches,
      finishedMatches,
      matchesWithAllPlayers,
      matchesWithWinner,
      drawsTotal: drawList.length,
      drawsMen,
      drawsWomen,
      lastSyncEvent,
      readinessFlags: flags,
      userMetrics,
    })
  }

  return Response.json({ monitors, recentSignups })
}
