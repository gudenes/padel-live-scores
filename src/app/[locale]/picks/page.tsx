import { getTranslations } from 'next-intl/server'
import { auth } from '@/auth'
import { redirect } from '@/i18n/navigation'
import { createServiceClient } from '@/lib/supabase'
import { ClientPicks } from './ClientPicks'

export default async function PicksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'prediction.myPicks' })
  const session = await auth()
  if (!session?.user) redirect({ href: '/home', locale })

  const supabase = createServiceClient()

  // Most recent active season — use the largest season_external_id present on any tournament
  const { data: latestSeason } = await supabase
    .from('tournaments')
    .select('season_external_id')
    .not('season_external_id', 'is', null)
    .order('season_external_id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const seasonId: number = latestSeason?.season_external_id ?? new Date().getFullYear()

  // Tournament options — show tournaments with at least one finished match in the last 90 days,
  // ordered most-recent-first
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentMatches } = await supabase
    .from('matches')
    .select('tournament_id, status, scheduled_at, tournament:tournaments(id, name, level, starts_at)')
    .in('status', ['finished', 'retired', 'walkover'])
    .gte('scheduled_at', ninetyDaysAgo)
    .order('scheduled_at', { ascending: false })
    .limit(500)

  const seenIds = new Set<string>()
  type TOpt = { id: string; name: string; level: string | null; starts_at: string | null }
  const tournaments: TOpt[] = []
  for (const m of recentMatches ?? []) {
    const tArr = m.tournament as unknown as TOpt | TOpt[] | null
    const tournament = Array.isArray(tArr) ? tArr[0] : tArr
    if (!tournament) continue
    if (seenIds.has(tournament.id)) continue
    seenIds.add(tournament.id)
    tournaments.push({
      id: tournament.id,
      name: tournament.name,
      level: tournament.level,
      starts_at: tournament.starts_at,
    })
  }

  // Default tournament: the user's most-picked, otherwise the most-recent finished
  const userId = session.user.id!
  const { data: userPicks } = await supabase
    .from('predictions')
    .select('match_id')
    .eq('user_id', userId)
    .limit(1000)

  let defaultTournamentId: string | null = tournaments[0]?.id ?? null
  if (userPicks && userPicks.length > 0) {
    const matchIds = userPicks.map(p => p.match_id)
    const { data: pickedMatches } = await supabase
      .from('matches')
      .select('tournament_id')
      .in('id', matchIds)
    const counts = new Map<string, number>()
    for (const m of pickedMatches ?? []) {
      if (!m.tournament_id) continue
      counts.set(m.tournament_id, (counts.get(m.tournament_id) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    if (top && tournaments.some(t => t.id === top[0])) defaultTournamentId = top[0]
  }

  return (
    <main style={{ background: '#0a0a0a', minHeight: '100vh', padding: '16px 14px', color: '#fff' }}>
      <h1 style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>{t('title')}</h1>
      <ClientPicks
        displayName={session.user.name ?? 'You'}
        seasonId={seasonId}
        tournaments={tournaments.map(t => ({ id: t.id, name: t.name, level: t.level }))}
        defaultTournamentId={defaultTournamentId}
      />
    </main>
  )
}
