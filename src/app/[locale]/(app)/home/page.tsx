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
import SearchOverlay from '@/components/nav/SearchOverlay'
import ProfileButton from '@/components/ProfileButton'
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
  BG_BASE, CHUNKY, LIVE_SCORE_LEVELS, PAGE_STYLES, SectionTitle,
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
  const [spotlightSeeds, setSpotlightSeeds] = useState<TournamentSpotlightHeroProps['topSeeds']>([])
  const [spotlightStats, setSpotlightStats] = useState<TournamentSpotlightHeroProps['stats']>(null)

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

      // ── 2 + 3. Seeds + stats (parallel) ─
      const [seedsRes, statsRes] = await Promise.all([
        supabase
          .from('tournament_draws')
          .select('seed, player1_name, player1_country, player1_id, player2_name, player2_country')
          .eq('tournament_id', t.id)
          .not('seed', 'is', null)
          .order('seed', { ascending: true })
          .limit(8),
        supabase
          .from('tournament_draws')
          .select('category, player1_country, player2_country')
          .eq('tournament_id', t.id),
      ])

      const drawEntries = seedsRes.data
      if (drawEntries && drawEntries.length > 0) {
        const seenSeeds = new Set<number>()
        const topSeedEntries: typeof drawEntries = []
        for (const entry of drawEntries) {
          if (entry.seed != null && !seenSeeds.has(entry.seed) && seenSeeds.size < 4) {
            seenSeeds.add(entry.seed)
            topSeedEntries.push(entry)
          }
        }

        const playerIds = topSeedEntries.map(e => e.player1_id).filter(Boolean)
        let playerMap: Record<string, { avatar_url: string | null; display_name: string | null }> = {}
        if (playerIds.length > 0) {
          const { data: players } = await supabase
            .from('players')
            .select('id, avatar_url, display_name')
            .in('id', playerIds)
          if (players) {
            playerMap = Object.fromEntries(players.map(p => [p.id, { avatar_url: p.avatar_url, display_name: p.display_name }]))
          }
        }

        setSpotlightSeeds(topSeedEntries.map(e => {
          const playerInfo = e.player1_id ? playerMap[e.player1_id] : null
          return {
            name: playerInfo?.display_name || e.player1_name || 'TBD',
            avatarUrl: playerInfo?.avatar_url ?? null,
            seed: e.seed!,
          }
        }))
      }

      const allEntries = statsRes.data
      if (allEntries && allEntries.length > 0) {
        const countries = new Set<string>()
        let menPairs = 0
        let womenPairs = 0
        for (const e of allEntries) {
          if (e.player1_country) countries.add(e.player1_country)
          if (e.player2_country) countries.add(e.player2_country)
          if ((e as any).category === 'men') menPairs++
          else if ((e as any).category === 'women') womenPairs++
        }
        const matchesCount = Math.max(0, menPairs - 1) + Math.max(0, womenPairs - 1)
        setSpotlightStats({
          pairsCount: allEntries.length,
          countriesCount: countries.size,
          matchesCount,
        })
      }
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
        wrap(supabase.from('matches').select(MATCH_SELECT_LIVE).eq('status', 'live').order('court_order', { ascending: true }) as any, 'home:live'),
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
        wrap(supabase.from('articles').select('id, title, source_icon, source_name, url, published_at, language, image_url').eq('status', 'active').not('image_url', 'is', null).order('published_at', { ascending: false }).limit(10) as any, 'home:articles'),
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
  const upcoming = scheduledMatches.filter(m => !!(m.pair1_player1 && m.pair1_player2 && m.pair2_player1 && m.pair2_player2)).filter(genderFilter).slice(0, 10)
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

      {/* ── Header ────��─────────────────────────────────────── */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: '#0A0A0A',
        borderBottom: 'none',
        boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        height: 62,
        transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.3s ease',
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/padelnachos-logo-v2.png"
          alt="PadelNachos"
          style={{ height: 52, objectFit: 'contain', flexShrink: 0 }}
        />

        <div
          data-coachmark="search"
          onClick={() => setSearchOpen(true)}
          style={{
            flex: 1,
            height: 34,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            clipPath: CHUNKY.button,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 12px',
            cursor: 'pointer',
            marginLeft: 10,
            marginRight: 6,
            maxWidth: 260,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <span style={{
            color: 'rgba(255,255,255,0.7)',
            fontSize: 11,
            fontWeight: 500,
            opacity: hintFading ? 0 : 1,
            transform: hintFading ? 'translateY(-4px)' : 'translateY(0)',
            transition: 'opacity 0.3s, transform 0.3s',
          }}>
            {SEARCH_HINTS[hintIdx]}
          </span>
        </div>

        <button
          onClick={() => { void shareNow() }}
          aria-label="Share PadelNachos"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            clipPath: CHUNKY.button,
            width: 34, height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            marginRight: 8,
            padding: 0,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>

        <ProfileButton />
      </header>

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
          <SectionTitle action={tHome('allScores')} href="/matches">
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

      {/* ── HIGHLIGHTS & NEWS ───────────────────────────────── */}
      {(highlights.length > 0 || latestNews.length > 0) && (
        <>
          <SectionTitle action={tHome('seeAll')} href="/feed">{tHome('highlightsAndNews')}</SectionTitle>
          <HighlightsPreview highlights={highlights} news={latestNews} />
        </>
      )}

      {/* ── TOURNAMENT SPOTLIGHT HERO ──────────────────────── */}
      {spotlightTournament && (
        <>
          <SectionTitle action={tHome('fullEvents')} onAction={() => { switchView('tournaments'); window.scrollTo(0, 0) }}>{tHome('tournamentSpotlight')}</SectionTitle>
          <TournamentSpotlightHero
            tournament={spotlightTournament}
            defendingChampionMen={spotlightChampionMen}
            defendingChampionWomen={spotlightChampionWomen}
            topSeeds={spotlightSeeds}
            stats={spotlightStats}
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
      <div style={{ padding: '20px 16px 8px', display: 'flex', justifyContent: 'center', gap: 16 }}>
        <Link href="/about" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>{tFooter('about')}</Link>
        <span style={{ color: '#333' }}>|</span>
        <Link href="/privacy" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>{tFooter('privacyPolicy')}</Link>
        <span style={{ color: '#333' }}>|</span>
        <Link href="/terms" style={{ fontSize: 11, color: '#6B7280', textDecoration: 'none' }}>{tFooter('termsOfService')}</Link>
      </div>

      <div style={{ height: 30 }} />

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
