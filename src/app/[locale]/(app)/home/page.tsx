'use client'
// src/app/(app)/home/page.tsx
// V3 Home — thin orchestrator. Sections extracted to src/components/home/.

import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useRouter, Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { Match, isWarmingUp, toShortName } from '@/types/match'
import BrandedLoader, { LOADER_HINTS } from '@/app/components/BrandedLoader'
import SocialLinks from '@/app/components/SocialLinks'
import { withTimeout } from '@/lib/with-timeout'
import GlobalHeader from '@/components/nav/GlobalHeader'
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
  Tournament, Highlight, RankedPlayer, NewsItem, isHiddenLevel,
} from '@/components/home/shared'
import LiveMatchCard from '@/components/home/LiveMatchCard'
import UpcomingMatchCard from '@/components/home/UpcomingMatchCard'
import RankingsSection from '@/components/home/RankingsSection'
import ResultsSection from '@/components/home/ResultsSection'
import HighlightsPreview from '@/components/home/HighlightsPreview'
import TournamentsView from '@/components/home/TournamentsView'
import LiveTournamentsCarousel, { TournamentWithMatchInfo } from '@/components/home/LiveTournamentsCarousel'
import {
  buildMatchInfoMap,
  compareTournamentsForCarousel,
  getLocalDayBoundaryUTC,
  hasStarted,
  insertManagedCardsByDate,
} from '@/lib/live-tournaments-carousel'
import { FLAG_KEYS, resolveFlag } from '@/lib/feature-flags'
import { fetchClusteredNews, type ClusteredArticle } from '@/lib/news-feed-queries'
import { WelcomeStrip } from '@/components/home/WelcomeStrip'
import { LoginCtaSheet } from '@/components/LoginCtaSheet'
import { useScrollMemory } from '@/hooks/useScrollMemory'
import { getActiveManagedEvents } from '@/lib/managed-events-server'
import { managedEventToCarouselCard } from '@/lib/managed-events'

// ── Match select queries ──────────────────────────────────────
const MATCH_PLAYER_JOINS = `
  tournament:tournaments(id, name, starts_at, ends_at, country, timezone, level, logo_url, entry_list_status, source),
  pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
  pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side)`

const MATCH_SELECT_LIVE = `*, ${MATCH_PLAYER_JOINS}, sets(*, games(*))`
const MATCH_SELECT_LEAN = `*, ${MATCH_PLAYER_JOINS}, sets(set_number, set_score, pair1_games, pair2_games, is_current, score_source)`
// Variant of MATCH_SELECT_LEAN that uses !inner on tournaments so a
// .in('tournament.level', …) filter actually drops rows (instead of
// just nulling the embed). Used for the "Coming Up" query which must
// be Premier-only at the DB layer — there are enough FIP-tier matches
// scheduled earlier in the day to consume a global limit(50) and
// starve Premier matches out before client-side filtering runs.
const MATCH_SELECT_LEAN_PREMIER = MATCH_SELECT_LEAN.replace(
  'tournament:tournaments(',
  'tournament:tournaments!inner(',
)

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

  // Persist scroll position across in-tab navigation so router.back()
  // from /road-to-olympics, /tournaments/[id], /match/[id], etc. lands
  // the user where they were — not at the "middle" of the page where
  // browser-native scroll restoration ends up after async data loads
  // reflow the layout post-restore.
  useScrollMemory('pn-scroll-home')

  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'home' | 'tournaments'>(initialView)

  const switchView = useCallback((next: 'home' | 'tournaments') => {
    setView(next)
    const url = next === 'tournaments' ? '/home?view=tournaments' : '/home'
    router.replace(url, { scroll: false })
  }, [router])

  // First-launch picker gate. Redirects new anonymous users to /welcome once.
  // Existing users who dismissed the legacy coachmark inherit pn_picker_done
  // synthetically so they're never asked again.
  useEffect(() => {
    if (typeof window === 'undefined') return

    // Don't redirect if user already reached the picker terminus
    if (localStorage.getItem('pn_picker_done') === '1') return

    // Legacy migration: users who completed the old SpotlightCoachmarks
    // already saw orientation; don't yank them into a new picker now.
    if (localStorage.getItem('pn_onboarding_done') === '1') {
      try { localStorage.setItem('pn_picker_done', '1') } catch {}
      return
    }

    // Don't fight the referral banner — show picker after that flow finishes.
    const refCode = new URLSearchParams(window.location.search).get('ref')
    if (refCode && !sessionStorage.getItem(`pn_welcome_dismissed_${refCode}`)) {
      return
    }

    router.replace('/welcome')
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
  const [latestNews, setLatestNews] = useState<ClusteredArticle[]>([])
  const [carouselLiveToday, setCarouselLiveToday] = useState<TournamentWithMatchInfo[]>([])
  const [carouselEnabled, setCarouselEnabled] = useState<boolean>(false)
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
        wrap(supabase.from('matches').select(MATCH_SELECT_LEAN_PREMIER).eq('status', 'scheduled').in('tournament.level', PREMIER_LEVELS).order('scheduled_at', { ascending: true }).limit(50) as any, 'home:scheduled'),
        wrap(supabase.from('tournaments')
          .select('id, name, starts_at, ends_at, country, level, location, prize_money, logo_url, cover_image_url')
          .in('level', ['finals', 'major', 'p1', 'p2'])
          // ends_at is stored as UTC midnight of the final day, so comparing
          // against `now` would drop the tournament for the entire day finals
          // are played. Compare against start-of-today UTC instead.
          .gte('ends_at', (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })())
          .order('starts_at', { ascending: true })
          .limit(2) as any, 'home:tournaments'),
        wrap(supabase.from('players').select('id, name, display_name, country, ranking, points, avatar_url, category, ranking_move').eq('category', 'men').not('ranking', 'is', null).order('ranking', { ascending: true }).limit(10) as any, 'home:topMen'),
        wrap(supabase.from('players').select('id, name, display_name, country, ranking, points, avatar_url, category, ranking_move').eq('category', 'women').not('ranking', 'is', null).order('ranking', { ascending: true }).limit(10) as any, 'home:topWomen'),
        wrap(supabase.from('matches').select(MATCH_SELECT_LEAN).in('status', ['finished', 'retired', 'walkover']).not('finished_at', 'is', null).order('finished_at', { ascending: false }).limit(20) as any, 'home:recent'),
        wrap(supabase.from('highlights').select('id, youtube_id, title, channel_name, thumbnail_url, duration, view_count, published_at, category, allowed_countries, blocked_countries').eq('status', 'active').gte('view_count', 500).order('published_at', { ascending: false }).limit(10) as any, 'home:highlights'),
        wrap(fetchClusteredNews(supabase, { limit: 20 }), 'home:articles'),
        // Tournaments carousel — 3 queries: window of tournaments, per-
        // tournament match count for today, and finals matches finished
        // in the last 48h so we can attach champion treatment to crowned
        // cards. Window covers three buckets the card renders distinctly:
        //   - LIVE: starts_at <= now AND ends_at >= now-48h
        //   - UPCOMING: now < starts_at <= now+7d
        //   - CROWNED: tournament with finals decided in the back-window
        wrap(
          supabase
            .from('tournaments')
            .select('id, name, starts_at, ends_at, country, location, level, logo_url, cover_image_url, prize_money')
            // Forward 7 days for upcoming events.
            .lte('starts_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
            // Back-window: 48h before midnight-of-today so a tournament
            // whose final finished yesterday or the day before still
            // surfaces with its champion treatment.
            .gte('ends_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
            .limit(40) as any,
          'home:carousel-window',
        ),
        wrap(
          (async () => {
            const { startUTC, endUTC } = getLocalDayBoundaryUTC()
            return supabase
              .from('matches')
              .select('tournament_id')
              .gte('scheduled_at', startUTC)
              .lte('scheduled_at', endUTC)
          })() as any,
          'home:carousel-match-counts',
        ),
        // Feature flag — controls whether the Live Tournaments carousel
        // renders. Two columns (enabled, enabled_local) resolved by host.
        wrap(
          supabase
            .from('feature_flags')
            .select('enabled, enabled_local')
            .eq('key', FLAG_KEYS.HOME_LIVE_TOURNAMENTS_CAROUSEL)
            .maybeSingle() as any,
          'home:carousel-flag',
        ),
        // Finals matches finished in the last 48h — feeds the "crowned"
        // treatment on the carousel card so freshly-finished tournaments
        // stay visible with their champion(s) for a sticky window
        // instead of disappearing the moment ends_at passes. We grab
        // both M and W finals and a winner-pair player resolution; the
        // home transform turns rows into a per-tournament champion map.
        wrap(
          supabase
            .from('matches')
            .select(`
              tournament_id, category, round, status, winner_pair, finished_at,
              pair1_player1_id, pair1_player1_name, pair1_player1_country,
              pair1_player2_id, pair1_player2_name, pair1_player2_country,
              pair2_player1_id, pair2_player1_name, pair2_player1_country,
              pair2_player2_id, pair2_player2_name, pair2_player2_country,
              pair1_player1:players!matches_pair1_player1_id_fkey(name, country),
              pair1_player2:players!matches_pair1_player2_id_fkey(name, country),
              pair2_player1:players!matches_pair2_player1_id_fkey(name, country),
              pair2_player2:players!matches_pair2_player2_id_fkey(name, country)
            `)
            .in('round', ['Finals', 'F', 'Final'])
            .in('status', ['finished', 'retired', 'walkover'])
            .gte('finished_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
            .not('winner_pair', 'is', null)
            .limit(50) as any,
          'home:carousel-recent-finals',
        ),
      ])

      const dataOf = (i: number) => {
        const r = results[i]
        if (r.status === 'fulfilled') return (r.value as any)?.data ?? []
        console.warn(`[V3 Home] fetch[${i}] failed:`, (r.reason as Error)?.message)
        return []
      }

      setLiveMatches(dataOf(0).filter((m: any) => !isHiddenLevel(m?.tournament?.level)))
      setScheduledMatches(dataOf(1))
      const tournaments: Tournament[] = dataOf(2)
      setUpcomingTournaments(tournaments)
      setTopMen(dataOf(3))
      setTopWomen(dataOf(4))
      setRecentMatches(dataOf(5))
      setHighlights(dataOf(6))
      // fetchClusteredNews returns ClusteredArticle[] directly (not { data: [] })
      const newsResult = results[7]
      setLatestNews(newsResult.status === 'fulfilled' ? (newsResult.value as ClusteredArticle[]) ?? [] : [])

      // ── Carousel transform ─────────────────────────────────────
      const carouselLiveRows: any[] = dataOf(8).filter((r: Tournament) => !isHiddenLevel(r?.level))
      const carouselMatchRows: any[] = dataOf(9)
      const recentFinalsRows: any[] = dataOf(11)
      const matchInfo = buildMatchInfoMap(carouselMatchRows)

      // Build per-tournament champion map from recent finals. Winner_pair
      // tells us which pair is the champion; we prefer the joined players
      // row but fall back to the thin-match name/country columns (same
      // policy as MatchCard) so champions render even when the player
      // FK didn't resolve. crownedAt = the latest finished_at across the
      // tournament's finals — drives the "Coronado hace Xh" relative time.
      type ChampionPair = { player1Name: string; player1Country: string | null; player2Name: string; player2Country: string | null }
      type Champions = { men?: ChampionPair; women?: ChampionPair; crownedAt: string }
      const championsByTournament = new Map<string, Champions>()
      for (const m of recentFinalsRows) {
        const winner = m.winner_pair
        if (winner !== 1 && winner !== 2) continue
        const p1 = winner === 1 ? m.pair1_player1 : m.pair2_player1
        const p2 = winner === 1 ? m.pair1_player2 : m.pair2_player2
        const p1NameRaw = winner === 1 ? m.pair1_player1_name : m.pair2_player1_name
        const p2NameRaw = winner === 1 ? m.pair1_player2_name : m.pair2_player2_name
        const p1CountryRaw = winner === 1 ? m.pair1_player1_country : m.pair2_player1_country
        const p2CountryRaw = winner === 1 ? m.pair1_player2_country : m.pair2_player2_country
        const pair: ChampionPair = {
          player1Name: p1?.name ?? p1NameRaw ?? 'TBD',
          player1Country: p1?.country ?? p1CountryRaw ?? null,
          player2Name: p2?.name ?? p2NameRaw ?? 'TBD',
          player2Country: p2?.country ?? p2CountryRaw ?? null,
        }
        let entry = championsByTournament.get(m.tournament_id)
        if (!entry) {
          entry = { crownedAt: m.finished_at }
          championsByTournament.set(m.tournament_id, entry)
        } else if (m.finished_at > entry.crownedAt) {
          entry.crownedAt = m.finished_at
        }
        if (m.category === 'men') entry.men = pair
        else if (m.category === 'women') entry.women = pair
      }

      const decorate = (rows: any[]): TournamentWithMatchInfo[] =>
        rows
          .map(r => ({
            ...(r as Tournament),
            matchesToday: matchInfo.get(r.id)?.matchesToday ?? 0,
            champions: championsByTournament.get(r.id),
          }))
          // Keep rows in any of the three carousel buckets. Drops
          // tournaments that are running but have zero matches today
          // and aren't crowned (would otherwise be a confusing "in
          // progress with nothing to show" state). Upcoming and
          // crowned rows always survive — they have their own status
          // affordances on the card.
          .filter(t => {
            const bothCrowned = !!(t.champions?.men && t.champions?.women)
            const upcoming = !hasStarted(t.starts_at)
            return t.matchesToday > 0 || bothCrowned || upcoming
          })
          // Bucket order on the rail: LIVE (matches happening now) →
          // UPCOMING (next 7 days, hype) → CROWNED (recently finished,
          // celebratory wrap-up). Within each bucket the canonical
          // tier-first comparator (Premier before FIP) decides order.
          .sort((a, b) => {
            const bucketOf = (t: TournamentWithMatchInfo): number => {
              const bothCrowned = !!(t.champions?.men && t.champions?.women)
              if (bothCrowned) return 2
              if (!hasStarted(t.starts_at)) return 1
              return 0
            }
            const aBucket = bucketOf(a)
            const bBucket = bucketOf(b)
            if (aBucket !== bBucket) return aBucket - bBucket
            return compareTournamentsForCarousel(a, b)
          })
          // Cap the rail at 10 cards. The window can pull up to 40 rows
          // (back-48h + today + forward-7d); the slice keeps the rail
          // scannable on small screens.
          .slice(0, 10)
      // Operator-curated managed events — merged into the rail by bucket +
      // start date (NOT pinned first), so a live Premier event still leads
      // and an upcoming managed event (e.g. Reserve Cup) slots in by date.
      // Back-window mirrors the tournament window (48h).
      const managedCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      let managedCards: TournamentWithMatchInfo[] = []
      try {
        const events = await getActiveManagedEvents(managedCutoff)
        managedCards = events.map(managedEventToCarouselCard) as unknown as TournamentWithMatchInfo[]
      } catch (e) {
        console.warn('[V3 Home] managed events fetch failed:', (e as Error).message)
      }
      setCarouselLiveToday(insertManagedCardsByDate(decorate(carouselLiveRows), managedCards).slice(0, 10))

      // Resolve carousel feature flag — hostname picks enabled vs enabled_local.
      // dataOf(10) from .maybeSingle(): { enabled, enabled_local } when
      // present, [] when the row is missing, undefined on fetch failure.
      const flagRow = dataOf(10)
      const flag =
        flagRow && !Array.isArray(flagRow)
          ? (flagRow as { enabled?: boolean | null; enabled_local?: boolean | null })
          : null
      setCarouselEnabled(
        resolveFlag(
          flag
            ? { enabled: flag.enabled ?? null, enabled_local: flag.enabled_local ?? null }
            : null,
        ),
      )

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

  // Realtime — list-shape watcher only.
  //
  // The home LiveMatchCard now subscribes per-match via useLiveMatch
  // for scores, so this parent sub no longer needs to drive score
  // updates. Its only job is to refetch when the list of live matches
  // changes shape (a match goes live, or finishes and exits the live
  // bucket). Debounced because fetchData() is heavy — it pulls
  // highlights, articles, rankings, recent results, etc.
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null
    const triggerRefetch = () => {
      if (pending) clearTimeout(pending)
      pending = setTimeout(() => {
        pending = null
        fetchData()
      }, 1500)
    }
    const channel = supabase
      .channel('v3-home-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches', filter: 'status=eq.live' },
        triggerRefetch,
      )
      .subscribe()
    return () => {
      if (pending) clearTimeout(pending)
      supabase.removeChannel(channel)
    }
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
      <WelcomeStrip />

      {/* ── LIVE TOURNAMENTS CAROUSEL (feature-flagged) ─────────── */}
      {carouselEnabled && (
        <LiveTournamentsCarousel
          liveToday={carouselLiveToday}
        />
      )}

      {/* ── LIVE NOW ─────────────────────────────────────────── */}
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

      <SocialLinks style={{ padding: '16px 16px 8px' }} />

      <div style={{ height: 30 }} />

      <LoginCtaSheet />
    </div>
  )
}
