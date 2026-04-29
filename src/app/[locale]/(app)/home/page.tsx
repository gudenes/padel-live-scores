'use client'
// src/app/(app)/home/page.tsx
// V3 Home — thin orchestrator. Sections extracted to src/components/home/.

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter, Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { Match, isWarmingUp, toShortName } from '@/types/match'
import BrandedLoader, { LOADER_HINTS } from '@/app/components/BrandedLoader'
import { withTimeout } from '@/lib/with-timeout'
import GlobalHeader from '@/components/nav/GlobalHeader'
import PadelGeniusTeaser from '@/components/PadelGeniusTeaser'
import { InviteWelcomeBanner } from '@/components/InviteWelcomeBanner'
import { ReferralToast } from '@/components/ReferralToast'
import { useAuth } from '@/components/AuthProvider'
import { useInvite } from '@/hooks/useInvite'
import TournamentSpotlightHero from '@/components/TournamentSpotlightHero'
import type { TournamentSpotlightHeroProps } from '@/components/TournamentSpotlightHero'
import { useTranslations } from 'next-intl'

// ── Extracted section components ──────────────────────────────
import {
  BG_BASE, CHUNKY, LIVE_SCORE_LEVELS, PREMIER_LEVELS, PAGE_STYLES, SectionTitle,
  Tournament, Highlight, RankedPlayer, NewsItem,
} from '@/components/home/shared'
import LiveMatchCard from '@/components/home/LiveMatchCard'
import UpcomingMatchCard from '@/components/home/UpcomingMatchCard'
import RankingsSection from '@/components/home/RankingsSection'
import ResultsSection from '@/components/home/ResultsSection'
import HighlightsPreview from '@/components/home/HighlightsPreview'
import TournamentsView from '@/components/home/TournamentsView'

// ── Match select queries ──────────────────────────────────────
const MATCH_PLAYER_JOINS = `
  tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level, logo_url, entry_list_status, source),
  pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side)`

const MATCH_SELECT_LIVE = `*, ${MATCH_PLAYER_JOINS}, sets(*, games(*))`
const MATCH_SELECT_LEAN = `*, ${MATCH_PLAYER_JOINS}, sets(set_number, set_score, pair1_games, pair2_games, is_current, score_source)`

// ════════��═══════════════════════════════════════════════════════
// ██  HOME PAGE
// ══════════════════════════════════��═════════════════════════════

export default function V3HomePage() {
  return (
    <Suspense fallback={null}>
      <V3HomePageInner />
    </Suspense>
  )
}

function V3HomePageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user } = useAuth()
  const { shareNow } = useInvite()
  const tHome = useTranslations('home')
  const tFooter = useTranslations('footer')
  const initialView: 'home' | 'tournaments' = searchParams.get('view') === 'tournaments' ? 'tournaments' : 'home'

  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'home' | 'tournaments'>(initialView)

  const switchView = useCallback((next: 'home' | 'tournaments') => {
    setView(next)
    const url = next === 'tournaments' ? '/home?view=tournaments' : '/home'
    router.replace(url, { scroll: false })
  }, [router])

  // Sync state when the URL changes
  useEffect(() => {
    const next = searchParams.get('view') === 'tournaments' ? 'tournaments' : 'home'
    setView(next)
  }, [searchParams])

  const gender = 'all' as const
  const [liveMatches, setLiveMatches] = useState<Match[]>([])
  const [scheduledMatches, setScheduledMatches] = useState<Match[]>([])
  const [upcomingTournaments, setUpcomingTournaments] = useState<Tournament[]>([])
  const [topMen, setTopMen] = useState<RankedPlayer[]>([])
  const [topWomen, setTopWomen] = useState<RankedPlayer[]>([])
  const [recentMatches, setRecentMatches] = useState<Match[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [latestNews, setLatestNews] = useState<NewsItem[]>([])
  const [searchOpen, setSearchOpen] = useState(false)
  const [spotlightChampionMen, setSpotlightChampionMen] = useState<TournamentSpotlightHeroProps['defendingChampionMen']>(null)
  const [spotlightChampionWomen, setSpotlightChampionWomen] = useState<TournamentSpotlightHeroProps['defendingChampionWomen']>(null)

  // Rotating search hints
  const SEARCH_HINTS = [
    tHome('searchHint0'),
    tHome('searchHint1'),
    tHome('searchHint2'),
    tHome('searchHint3'),
    tHome('searchHint4'),
  ]
  const [hintIdx, setHintIdx] = useState(0)
  const [hintFading, setHintFading] = useState(false)
  useEffect(() => {
    const interval = setInterval(() => {
      setHintFading(true)
      setTimeout(() => {
        setHintIdx(i => (i + 1) % SEARCH_HINTS.length)
        setHintFading(false)
      }, 300)
    }, 3000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hide header on scroll down, show on scroll up
  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollY = useRef(0)
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      if (y < 10) { setHeaderVisible(true) }
      else if (y > lastScrollY.current + 4) { setHeaderVisible(false) }
      else if (y < lastScrollY.current - 4) { setHeaderVisible(true) }
      lastScrollY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Spotlight hero: defending champion, seeds, stats ───────────
  const fetchSpotlightData = useCallback(async (t: Tournament) => {
    try {
      const NOISE_TOKENS = new Set([
        'premier', 'padel', 'tour', 'open', 'the', 'by', 'presented',
        'pro', 'vip', 'official', 'season', 'championship', 'championships',
      ])
      const stripAccents = (s: string): string =>
        s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      const tokenize = (n: string): Set<string> =>
        new Set(
          stripAccents(n).toLowerCase().replace(/\b(19|20)\d{2}\b/g, '').replace(/[^a-z0-9]+/g, ' ')
            .split(/\s+/).filter(w => w.length >= 2 && !NOISE_TOKENS.has(w))
        )

      // ── 1. Defending champion ─────────────────────────────
      const currentTokens = tokenize(t.name)
      if (currentTokens.size >= 2 && t.level && t.starts_at) {
        const discriminating = [...currentTokens].filter(tk => tk.length >= 3).sort((a, b) => b.length - a.length)[0] ?? [...currentTokens][0]

        const { data: candidates } = await supabase
          .from('tournaments')
          .select('id, name, starts_at, ends_at')
          .eq('level', t.level)
          .lt('ends_at', t.starts_at)
          .ilike('name', `%${discriminating}%`)
          .order('ends_at', { ascending: false })
          .limit(50)

        if (candidates && candidates.length > 0) {
          const previous = candidates.find(c => {
            const candTokens = tokenize(c.name)
            for (const tk of currentTokens) {
              if (!candTokens.has(tk)) return false
            }
            return true
          })
          if (previous) {
            const FINALS_ROUNDS = new Set(['Final', 'Finals', 'F'])
            const { data: finalMatches } = await supabase
              .from('matches')
              .select(`
                id, round, winner_pair, status, category,
                pair1_player1:players!matches_pair1_player1_id_fkey(name, display_name, country, avatar_url),
                pair1_player2:players!matches_pair1_player2_id_fkey(name, display_name, country, avatar_url),
                pair2_player1:players!matches_pair2_player1_id_fkey(name, display_name, country, avatar_url),
                pair2_player2:players!matches_pair2_player2_id_fkey(name, display_name, country, avatar_url)
              `)
              .eq('tournament_id', previous.id)
              .in('status', ['finished', 'retired', 'walkover'])
              .not('winner_pair', 'is', null)

            if (finalMatches && finalMatches.length > 0) {
              const year = previous.ends_at ? new Date(previous.ends_at).getFullYear() : 0

              for (const category of ['men', 'women'] as const) {
                const genderFinals = finalMatches.filter((m: any) => m.category === category)
                const finalMatch = genderFinals.find(m => FINALS_ROUNDS.has((m as any).round as string))
                  ?? genderFinals.find(m => ((m as any).round as string || '').toLowerCase().includes('final'))
                if (finalMatch) {
                  const winners = (finalMatch as any).winner_pair === 1
                    ? [(finalMatch as any).pair1_player1, (finalMatch as any).pair1_player2]
                    : [(finalMatch as any).pair2_player1, (finalMatch as any).pair2_player2]
                  const winnerPlayers = winners.filter(Boolean)
                  if (winnerPlayers.length > 0) {
                    const champData = {
                      names: winnerPlayers.map((p: any) => toShortName(p.display_name ?? p.name)).join(' / '),
                      year,
                      avatar1: winnerPlayers[0]?.avatar_url ?? null,
                      avatar2: winnerPlayers[1]?.avatar_url ?? null,
                      previousEditionId: previous.id,
                    }
                    if (category === 'men') setSpotlightChampionMen(champData)
                    else setSpotlightChampionWomen(champData)
                  }
                }
              }
            }
          }
        }
      }

      // Top seeds + stats previously came from the tournament_draws (entry-list)
      // pipeline. That pipeline has been dropped — padelapi is the source of truth
      // for matches now. The spotlight hero gracefully handles empty seeds + null
      // stats, so we just leave them as their initial-state values.
    } catch (e) {
      console.warn('[V3 Home] spotlight data fetch failed:', e)
    }
  }, [])

  const fetchData = useCallback(async () => {
    const safetyTimeout = setTimeout(() => {
      console.warn('[V3 Home] fetchData safety timeout — releasing loading state')
      setLoading(false)
    }, 12_000)
    try {
      const wrap = <T,>(p: Promise<T>, label: string) =>
        withTimeout(p as Promise<T>, 10_000, label)

      const results = await Promise.allSettled([
        // Include on_court — matches in the warmup phase belong in the
        // "Live Now" section too. Padelapi owns scheduled→live; on_court
        // is a padelgod-only status the live-poller stamps when the widget
        // reports players are warming up. The `trulyLive` filter below
        // (via !isWarmingUp) keeps counters honest; we just show the card
        // early so fans see the match is about to start instead of the
        // scheduled-card fallback.
        wrap(supabase.from('matches').select(MATCH_SELECT_LIVE).in('status', ['live', 'on_court']).order('court_order', { ascending: true }) as any, 'home:live'),
        wrap(supabase.from('matches').select(MATCH_SELECT_LEAN).eq('status', 'scheduled').order('scheduled_at', { ascending: true }).limit(50) as any, 'home:scheduled'),
        wrap(supabase.from('tournaments')
          .select('id, name, starts_at, ends_at, country, level, location, prize_money, logo_url')
          .in('level', ['finals', 'major', 'p1', 'p2'])
          .gte('ends_at', new Date().toISOString())
          .order('starts_at', { ascending: true })
          .limit(2) as any, 'home:tournaments'),
        wrap(supabase.from('players').select('id, name, display_name, country, ranking, points, avatar_url, category, ranking_move').eq('category', 'men').not('ranking', 'is', null).order('ranking', { ascending: true }).limit(10) as any, 'home:topMen'),
        wrap(supabase.from('players').select('id, name, display_name, country, ranking, points, avatar_url, category, ranking_move').eq('category', 'women').not('ranking', 'is', null).order('ranking', { ascending: true }).limit(10) as any, 'home:topWomen'),
        wrap(supabase.from('matches').select(MATCH_SELECT_LEAN).in('status', ['finished', 'retired', 'walkover']).not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(20) as any, 'home:recent'),
        wrap(supabase.from('highlights').select('id, youtube_id, title, channel_name, thumbnail_url, duration, view_count, published_at, category, allowed_countries, blocked_countries').eq('status', 'active').gte('view_count', 500).order('published_at', { ascending: false }).limit(10) as any, 'home:highlights'),
        wrap(supabase.from('articles').select('id, title, title_translations, snippet, snippet_translations, source_icon, source_name, url, published_at, language, image_url').eq('status', 'active').not('image_url', 'is', null).order('published_at', { ascending: false }).limit(20) as any, 'home:articles'),
      ])

      const dataOf = (i: number) => {
        const r = results[i]
        if (r.status === 'fulfilled') return (r.value as any)?.data ?? []
        console.warn(`[V3 Home] fetch[${i}] failed:`, (r.reason as Error)?.message)
        return []
      }

      setLiveMatches(dataOf(0))
      setScheduledMatches(dataOf(1))
      const tournaments: Tournament[] = dataOf(2)
      setUpcomingTournaments(tournaments)
      setTopMen(dataOf(3))
      setTopWomen(dataOf(4))
      setRecentMatches(dataOf(5))
      setHighlights(dataOf(6))
      setLatestNews(dataOf(7))

      const spotlight = tournaments[0] ?? null
      if (spotlight) {
        void fetchSpotlightData(spotlight)
      }
    } catch (e) {
      console.error('[V3 Home] fetchData error:', e)
    } finally {
      clearTimeout(safetyTimeout)
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Realtime subscription for live matches
  useEffect(() => {
    const channel = supabase
      .channel('v3-home-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'status=eq.live' }, () => {
        fetchData()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchData])

  if (loading) {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto' }}>
        <BrandedLoader hints={[...LOADER_HINTS.home]} />
      </div>
    )
  }

  const genderFilter = (m: Match) => gender === 'all' || (m as any).category === gender

  const trulyLive = liveMatches.filter(m => !isWarmingUp(m))
  const liveScorable = trulyLive.filter(m => {
    const level = (m as any).tournament?.level
    return level && LIVE_SCORE_LEVELS.includes(level)
  }).filter(genderFilter)
  const upcoming = scheduledMatches
    .filter(m => !!(m.pair1_player1 && m.pair1_player2 && m.pair2_player1 && m.pair2_player2))
    .filter(m => PREMIER_LEVELS.includes((m as any).tournament?.level))
    .filter(genderFilter)
    .slice(0, 10)
  const filteredRecent = recentMatches.filter(genderFilter)
  const spotlightTournament = upcomingTournaments[0] ?? null

  if (view === 'tournaments') {
    return (
      <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
        <style dangerouslySetInnerHTML={{ __html: PAGE_STYLES }} />
        <TournamentsView onBack={() => switchView('home')} />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      <style dangerouslySetInnerHTML={{ __html: PAGE_STYLES }} />

      {/* ── Header — extracted to GlobalHeader so Tournaments and
              Rankings can share the same chrome. */}
      <GlobalHeader />

      <InviteWelcomeBanner />
      <ReferralToast />

      {/* ── LIVE NOW ──────���─────────────────────────────────── */}
      {liveScorable.length > 0 && (
        <>
          <SectionTitle action={tHome('allScores')} href="/matches">{tHome('liveNow')}</SectionTitle>
          <div style={{
            display: 'flex',
            gap: 12,
            padding: '0 16px',
            overflowX: liveScorable.length > 1 ? 'auto' : 'visible',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}>
            {liveScorable.map(m => (
              <div key={m.id} style={{ scrollSnapAlign: 'start', flexShrink: 0, width: liveScorable.length === 1 ? '100%' : undefined }}>
                <LiveMatchCard match={m} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── COMING UP ───────��───────────────────────────���───── */}
      {upcoming.length > 0 && (
        <>
          <SectionTitle action={tHome('allScores')} href="/matches/today">
            {tHome('comingUp')}
          </SectionTitle>
          <div style={{
            display: 'flex',
            gap: 12,
            padding: '0 16px',
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            WebkitOverflowScrolling: 'touch',
            msOverflowStyle: 'none',
            scrollbarWidth: 'none',
          }}>
            {upcoming.map(m => (
              <div key={m.id} style={{ scrollSnapAlign: 'start' }}>
                <UpcomingMatchCard match={m} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── LATEST NEWS ──────────────────────────────────────
          Highlights (videos) intentionally hidden from home — they
          live on the dedicated /feed page. Home now leads with the
          peek-style news carousel; users who want videos tap into
          the Feed bottom-nav tab. */}
      {latestNews.length > 0 && (
        <>
          <SectionTitle action={tHome('seeAll')} href="/feed">{tHome('latestNews')}</SectionTitle>
          <HighlightsPreview highlights={[]} news={latestNews} />
        </>
      )}

      {/* ── TOURNAMENT SPOTLIGHT HERO ──────────────────────── */}
      {spotlightTournament && (
        <>
          <SectionTitle action={tHome('fullEvents')} href="/tournaments">{tHome('tournamentSpotlight')}</SectionTitle>
          <TournamentSpotlightHero
            tournament={spotlightTournament}
            defendingChampionMen={spotlightChampionMen}
            defendingChampionWomen={spotlightChampionWomen}
            topSeeds={[]}
            stats={null}
            hasLiveMatches={liveMatches.some(m => (m as any).tournament_id === spotlightTournament.id || (m as any).tournament?.id === spotlightTournament.id)}
          />
        </>
      )}

      {/* ─��� RANKINGS ────────────────────────────────────────── */}
      <SectionTitle action={tHome('fullRankings')} href="/rankings">{tHome('rankings')}</SectionTitle>
      <RankingsSection men={topMen} women={topWomen} gender={gender} />

      {/* ── LATEST RESULTS ──────────────────────────────────── */}
      <SectionTitle action={tHome('allResults')} href="/matches">{tHome('latestResults')}</SectionTitle>
      <ResultsSection matches={filteredRecent} />

      {/* ── PADELGENIUS TEASER ────���─────────────────────────── */}
      <div style={{ paddingTop: 20 }}>
        <PadelGeniusTeaser />
      </div>

      {/* Footer links */}
      <div style={{ padding: '20px 16px 8px', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, rowGap: 6 }}>
        <Link href="/matches/today" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>{tFooter('todaySchedule')}</Link>
        <span style={{ color: '#333' }}>|</span>
        <Link href="/matches/yesterday" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>{tFooter('yesterdayResults')}</Link>
        <span style={{ color: '#333' }}>|</span>
        <Link href="/about" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>{tFooter('about')}</Link>
        <span style={{ color: '#333' }}>|</span>
        <Link href="/privacy" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>{tFooter('privacyPolicy')}</Link>
        <span style={{ color: '#333' }}>|</span>
        <Link href="/terms" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>{tFooter('termsOfService')}</Link>
      </div>

      <div style={{ height: 30 }} />
    </div>
  )
}
