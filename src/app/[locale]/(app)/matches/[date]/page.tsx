// src/app/[locale]/(app)/matches/[date]/page.tsx
// SSR daily-matches page. Rendered server-side so Google sees the full
// match list + intro + FAQ copy as HTML, not post-hydration JS.
//
// - [date] segment: YYYY-MM-DD | today | yesterday | tomorrow
// - Aliases redirect to the canonical YYYY-MM-DD URL (in the locale's home TZ)
// - Invalid segments 404
// - ISR: revalidate every 5 minutes

import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Link, redirect } from '@/i18n/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import {
  resolveDateSegment,
  dateAtTzMidnight,
  getLocaleHomeTz,
  localDayRangeUtc,
  isIsoDate,
  isLocaleToday,
  addDaysIso,
} from '@/lib/locale-time'
import { buildDailyIntro, buildDailyFaq, type DailyMatchSummary } from '@/lib/daily-page-copy'
import { DailyDatePills } from '@/components/DailyDatePills'
import { DailyWhereToWatch } from './DailyWhereToWatch'
import EmptyState from '@/components/EmptyState'
import MatchesFilterClient from '@/components/MatchesFilterClient'
import MatchesPageHeader from '@/components/MatchesPageHeader'
import MatchesTournamentGroup from '@/components/MatchesTournamentGroup'
import MatchesDaySwipe from '@/components/MatchesDaySwipe'

export const revalidate = 300 // 5 min

// ── Brand tokens ─────────────────────────────────────────────────
const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'
// Used for the "ON COURT" warm-up pill — same hue as the /matches page + home
// LiveMatchCard so all three surfaces look consistent. See isWarmingUp in
// src/types/match.ts for the status signal.
const ORANGE = '#F5A623'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

type Props = {
  params: Promise<{ locale: string; date: string }>
}

interface PlayerRow {
  id: string
  name: string | null
  display_name: string | null
  country: string | null
  ranking: number | null
}

interface SetRow {
  id: string
  set_number: number | null
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  is_current: boolean | null
}

interface MatchRow {
  id: string
  status: string
  category: string | null
  scheduled_at: string | null
  finished_at: string | null
  round: string | null
  court: string | null
  /**
   * Free-text schedule note from upstream (e.g. "Not before 4:00 PM",
   * "Followed by"). Presence of these phrases marks an approximate time
   * — derived at render time, NOT a boolean column on the table. See
   * sibling `/matches` page which uses the same regex. The page used
   * to reference a nonexistent `schedule_approximate` column, which
   * made every Supabase query fail silently with PGRST 42703 and the
   * page always rendered the empty state.
   */
  schedule_label: string | null
  winner_pair: number | null
  tournament: {
    id: string
    name: string
    level: string | null
    country: string | null
    starts_at: string | null
    ends_at: string | null
    status: string | null
  } | null
  pair1_player1: PlayerRow | null
  pair1_player2: PlayerRow | null
  pair2_player1: PlayerRow | null
  pair2_player2: PlayerRow | null
  sets: SetRow[] | null
}

export default async function DailyMatchesPage({ params }: Props) {
  const { locale, date } = await params

  // Alias ("today"/"yesterday"/"tomorrow") → canonical dated URL.
  // next-intl's redirect preserves the active locale prefix.
  if (!isIsoDate(date)) {
    const resolved = resolveDateSegment(date, locale)
    if (!resolved) notFound()
    redirect({ href: `/matches/${resolved}`, locale: locale as 'en' | 'es' | 'pt' | 'it' | 'fr' })
  }

  const iso = date
  if (!iso) notFound()

  const tz = getLocaleHomeTz(locale)
  const { startUtc, endUtc } = localDayRangeUtc(iso, tz)

  // Read user TZ from cookie for display (Googlebot → fall back to locale home TZ)
  const cookieStore = await cookies()
  const userTz = cookieStore.get('geo-timezone')?.value || tz

  // ── Fetch matches for the day ─────────────────────────────────
  const supabase = createServerClient()
  const playerJoins = `
    pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, ranking),
    pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, ranking),
    pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, ranking),
    pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, ranking)
  `
  // Fetch matches whose scheduled_at OR finished_at lands in this day's UTC
  // window. Pulling on both columns matters because upstream `scheduled_at`
  // can be stale — e.g. a Brussels R16 stamped "Starting at 12:00 PM" on the
  // 25th but actually played on the 23rd — so without the finished_at arm
  // matches would be pinned to the wrong day forever. The post-fetch filter
  // below bucketizes per-column: active (live/on_court/scheduled) keys off
  // scheduled_at, finished (finished/retired/walkover) keys off finished_at.
  const startIso = startUtc.toISOString()
  const endIso = endUtc.toISOString()
  const { data: rawMatches, error } = await supabase
    .from('matches')
    .select(`
      id, status, category, scheduled_at, finished_at, round, court,
      schedule_label, winner_pair,
      tournament:tournaments(id, name, level, country, starts_at, ends_at, status),
      ${playerJoins},
      sets(id, set_number, set_score, pair1_games, pair2_games, is_current)
    `)
    .or(
      `and(scheduled_at.gte.${startIso},scheduled_at.lt.${endIso}),` +
      `and(finished_at.gte.${startIso},finished_at.lt.${endIso})`,
    )
    .order('scheduled_at', { ascending: true })
    .limit(400)

  if (error) {
    console.error('[daily page] fetch failed:', error.message)
  }

  // De-dup (a single match could match both arms of the OR if it finished
  // the same day it was scheduled — PostgREST returns distinct rows per
  // match anyway, but be defensive) and drop rows whose tournament join
  // failed.
  const matches = ((rawMatches ?? []) as unknown as MatchRow[]).filter(m => !!m.tournament)

  // Per-bucket day-window check. A match returned by the OR query may
  // belong to one bucket-day and not the other — e.g. a R16 scheduled on
  // the 25th but finished on the 23rd shows up when fetching 2026-04-25
  // (via scheduled_at) but should NOT appear as "Finished" on the 25th.
  // We reject it by comparing the finished_at to today's window.
  const inWindow = (iso: string | null): boolean => {
    if (!iso) return false
    const t = Date.parse(iso)
    return !Number.isNaN(t) && t >= startUtc.getTime() && t < endUtc.getTime()
  }

  // ── Bucket by status + the date column that's semantically correct ──
  // `on_court` (warmup phase observed by padelgod's live-poller) belongs
  // in the live bucket — fans want to see those matches in the "Live Now"
  // section rather than the upcoming list. MatchCard renders them with an
  // "On court" badge instead of a score via the existing isWarmingUp path.
  //
  // Active matches key off `scheduled_at` (the user cares WHEN it's meant
  // to play). Finished matches key off `finished_at` (what day did it
  // actually happen) — this is what prevents a R16 finished 2 days ago
  // with a stale scheduled_at appearing on a future day's page.
  const liveMatches = matches.filter(
    m => (m.status === 'live' || m.status === 'on_court') && inWindow(m.scheduled_at),
  )
  const upcomingMatches = matches.filter(
    m => m.status === 'scheduled' && inWindow(m.scheduled_at),
  )
  const finishedMatches = matches.filter(
    m => ['finished', 'retired', 'walkover'].includes(m.status) && inWindow(m.finished_at),
  )
  // Union — used for the day's intro/FAQ copy and the SEO JSON-LD ItemList.
  // Must stay in sync with the three bucket filters above. A match that
  // appeared in the OR-fetched set but didn't qualify for any bucket
  // (scheduled_at in window but status=finished with finished_at out of
  // window, for example) is intentionally excluded from the day's story.
  const dayMatches = [...liveMatches, ...upcomingMatches, ...finishedMatches]

  // Premier presence drives the Where-to-Watch header (only tier with
  // broadcaster data). Computed from the day's tournaments, not status —
  // a page with only upcoming Premier still earns the section.
  const hasPremierToday = dayMatches.some(m => isPremierLevel(m.tournament?.level ?? null))

  // ── Build intro + FAQ copy ────────────────────────────────────
  const tDaily = await getTranslations({ locale, namespace: 'daily' })
  // common namespace — used by the status pill (live / on_court) in
  // DailyMatchRow. Loaded here server-side so the row doesn't need its
  // own translator.
  const tCommon = await getTranslations({ locale, namespace: 'common' })
  const dateLong = formatLongDate(iso, locale)
  const summaries: DailyMatchSummary[] = dayMatches.map(m => ({
    status: (m.status as DailyMatchSummary['status']) ?? 'scheduled',
    scheduledAt: m.scheduled_at,
    tournament: m.tournament ? { name: m.tournament.name, level: m.tournament.level } : null,
    featuredPlayer: pickFeaturedFromMatch(m),
  }))
  const intro = buildDailyIntro({ iso, locale, dateLong, matches: summaries })
  const faqs = buildDailyFaq({ iso, locale, dateLong, matches: summaries })

  // ── JSON-LD: ItemList of SportsEvent + FAQPage ─────────────────
  const jsonLd = buildJsonLd({
    iso, locale, intro, matches: dayMatches,
  })
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  const isToday = isLocaleToday(iso, locale)

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh' }}>
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, '\\u003c') }}
      />

      {/* Global app header — same logo / search / share / profile pattern
          as home, feed, following. Sticky at top:0 with z:100, hides on
          scroll down. */}
      <MatchesPageHeader />

      {/* Date pills + filter bar — sticky together at top:0 so the user
          can flip dates or refine filters from anywhere in the list.
          Sits at z:50, BELOW the AppHeader's z:100 — when AppHeader
          slides back into view (on scroll up) it briefly overlaps the
          pills. That's a deliberate trade-off: the alternative (offset
          top:62) leaves a 62px empty band when AppHeader hides via
          transform, which looks worse on a dark canvas than a brief
          overlap. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(10,10,10,0.94)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <DailyDatePills selectedIso={iso} locale={locale} />
        {dayMatches.length > 0 && (
          <MatchesFilterClient rootId="matches-filter-root" />
        )}
      </div>

      {/* Where-to-watch + match list. Wrapped in:
            (a) MatchesDaySwipe — touch swipe left/right on this body
                navigates to the next / previous day, sticky header stays
                put. Tactile alternative to tapping the day pills.
            (b) `.matches-day-fade` — soft 240ms fade + lift on day change
                so the swap feels less jarring than a page-flash.
          Intro h1/lead and the FAQ section that used to live here were
          removed — operators / SEO already get the dated-URL signal, and
          the page reads cleaner as a pure scoreboard. */}
      <MatchesDaySwipe
        prevIso={addDaysIso(iso, -1, getLocaleHomeTz(locale))}
        nextIso={addDaysIso(iso, 1, getLocaleHomeTz(locale))}
        locale={locale}
      >
      <div className="matches-day-fade">
        {/* Where to watch — only when the day has a Premier-tier tournament.
            The Premier API (sync-broadcasters cron) is the only source the
            broadcasters table is wired up to; rendering this block on an
            all-FIP day would show Premier broadcasters for matches that
            won't be on them. */}
        {hasPremierToday && <DailyWhereToWatch locale={locale} />}

        {/* Empty state — ZERO matches on this day at all. The filter
            drawer's "filters hide everything" empty state is rendered by
            MatchesFilterClient (sits in the sticky header above) and only
            fires when the user has narrowed a non-empty day to nothing. */}
        {dayMatches.length === 0 && (
          <div style={{ padding: '8px 16px 24px' }}>
            <EmptyState title={tDaily('noMatchesTitle')} subtitle={tDaily('noMatchesSub')} />
          </div>
        )}

        {/* Matches list — grouped by tournament, with per-tournament
            sub-sections for Live / Upcoming / Results. The flatter
            top-level Live/Upcoming/Finished sections used to live here;
            user feedback was that grouping by tournament reads better
            because all of a tournament's day-relevant matches sit
            together. */}
        <div id="matches-filter-root" style={{ padding: '0 8px' }}>
          {groupByTournament(dayMatches).map(g => (
            <MatchesTournamentGroup
              key={g.tournamentId}
              group={{
                tournamentId: g.tournamentId,
                tournamentName: g.tournamentName,
                tournamentLevel: g.tournamentLevel,
                tournamentCountry: g.tournamentCountry,
                tournamentStartsAt: g.tournamentStartsAt,
                tournamentEndsAt: g.tournamentEndsAt,
                tournamentStatus: g.tournamentStatus,
                matches: g.matches,
                isPremier: isPremierLevel(g.tournamentLevel),
                locale,
                userTz,
                labels: {
                  liveNow: tDaily('liveSection'),
                  upcoming: tDaily('upcomingSection'),
                  results: tDaily('finishedSection'),
                },
              }}
            />
          ))}
        </div>
      </div>
      </MatchesDaySwipe>

      <div style={{ height: 30 }} />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// Helpers — formatters + components (all server-side)
// ═════════════════════════════════════════════════════════════════

function formatLongDate(iso: string, locale: string): string {
  const tz = getLocaleHomeTz(locale)
  const anchor = dateAtTzMidnight(iso, tz)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
    timeZone: tz,
  }).format(anchor)
}

function pickFeaturedFromMatch(m: MatchRow): { name: string; ranking: number | null } | null {
  const candidates = [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2].filter(Boolean) as PlayerRow[]
  let best: { name: string; ranking: number | null } | null = null
  for (const p of candidates) {
    const name = p.display_name || p.name
    if (!name) continue
    if (!best || (p.ranking != null && (best.ranking == null || p.ranking < best.ranking))) {
      best = { name, ranking: p.ranking ?? null }
    }
  }
  return best
}

// Tier priority for tournament groups within a section. Premier Padel
// (Major → Finals → P1 → P2 → WPT-era rebrands) sits at the top of every
// day because it's the tier with the largest audience + the only one
// with Where-to-Watch broadcaster data. FIP falls below in its own
// pecking order (Platinum → Gold → Silver → Other). Null/unknown levels
// land last so uncategorised rows don't accidentally jump the queue.
// The daily page uses this to sort groups after `groupByTournament`.
const TIER_ORDER: Record<string, number> = {
  // Premier / WPT-era
  major:        0,
  finals:       0,
  p1:           0,
  p2:           0,
  wpt_final:    0,
  wpt_1000:     0,
  wpt_master:   0,
  wpt_500:      0,
  // FIP cascade
  fip_platinum: 1,
  fip_gold:     2,
  fip_silver:   3,
  fip_other:    4,
}

function tournamentTierRank(level: string | null): number {
  if (!level) return 99
  return TIER_ORDER[level] ?? 99
}

function isPremierLevel(level: string | null): boolean {
  return tournamentTierRank(level) === 0
}

interface TournamentGroupShape {
  tournamentId: string
  tournamentName: string
  tournamentLevel: string | null
  tournamentCountry: string | null
  tournamentStartsAt: string | null
  tournamentEndsAt: string | null
  tournamentStatus: string | null
  matches: MatchRow[]
}

function groupByTournament(ms: MatchRow[]): TournamentGroupShape[] {
  const map = new Map<string, TournamentGroupShape>()
  for (const m of ms) {
    const t = m.tournament
    if (!t) continue
    const existing = map.get(t.id)
    if (existing) existing.matches.push(m)
    else map.set(t.id, {
      tournamentId: t.id,
      tournamentName: t.name,
      tournamentLevel: t.level,
      tournamentCountry: t.country,
      tournamentStartsAt: t.starts_at,
      tournamentEndsAt: t.ends_at,
      tournamentStatus: t.status,
      matches: [m],
    })
  }
  // Sort groups: Premier first, then FIP by tier, then unknown. Within a
  // tier we keep insertion order (which inherits from match scheduled_at
  // ascending), so same-tier tournaments stay time-ordered.
  const groups = Array.from(map.values())
  groups.sort((a, b) => tournamentTierRank(a.tournamentLevel) - tournamentTierRank(b.tournamentLevel))
  return groups
}

function buildJsonLd({
  iso, locale, intro, matches,
}: {
  iso: string
  locale: string
  intro: { h1: string; lead: string }
  matches: MatchRow[]
}) {
  const items = matches.slice(0, 50).map((m, i) => {
    const p1 = [m.pair1_player1, m.pair1_player2].filter(Boolean).map(p => (p!.display_name || p!.name || '').trim()).filter(Boolean)
    const p2 = [m.pair2_player1, m.pair2_player2].filter(Boolean).map(p => (p!.display_name || p!.name || '').trim()).filter(Boolean)
    return {
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'SportsEvent',
        name: `${p1.join(' / ')} vs ${p2.join(' / ')}`,
        startDate: m.scheduled_at,
        sport: 'Padel',
        url: `https://padelnachos.com/match/${m.id}`,
        eventStatus:
          m.status === 'live' ? 'https://schema.org/EventInProgress'
          : m.status === 'scheduled' ? 'https://schema.org/EventScheduled'
          : 'https://schema.org/EventOnHold',
        superEvent: m.tournament
          ? {
              '@type': 'SportsEvent',
              name: m.tournament.name,
              url: `https://padelnachos.com/tournaments/${m.tournament.id}`,
            }
          : undefined,
      },
    }
  })
  const locPrefix = locale === 'en' ? '' : `/${locale}`
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: intro.h1,
    description: intro.lead,
    url: `https://padelnachos.com${locPrefix}/matches/${iso}`,
    numberOfItems: matches.length,
    itemListElement: items,
  }
}
