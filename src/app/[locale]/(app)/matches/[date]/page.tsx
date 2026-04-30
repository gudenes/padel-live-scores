// src/app/[locale]/(app)/matches/[date]/page.tsx
// SSR daily-matches page. Rendered server-side so Google sees the full
// match list as HTML, not post-hydration JS. Once the page hydrates,
// `MatchesDayShell` takes over: it caches adjacent days client-side
// and swaps the body instantly when the user taps a day pill or swipes.
//
// - [date] segment: YYYY-MM-DD | today | yesterday | tomorrow
// - Aliases redirect to the canonical YYYY-MM-DD URL (in the locale's home TZ)
// - Invalid segments 404
// - ISR: revalidate every 5 minutes

import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'
import {
  resolveDateSegment,
  dateAtTzMidnight,
  getLocaleHomeTz,
  isIsoDate,
} from '@/lib/locale-time'
import { buildDailyIntro, buildDailyFaq, type DailyMatchSummary } from '@/lib/daily-page-copy'
import { fetchMatchesDay, type MatchesDayMatch } from '@/lib/fetch-matches-day'
import { resolveStreamsForMatches } from '@/lib/fip-stream-resolver'
import MatchesPageHeader from '@/components/MatchesPageHeader'
import MatchesDayShell from '@/components/MatchesDayShell'

export const revalidate = 300 // 5 min

const BG_BASE = '#1A1A1A'

type Props = {
  params: Promise<{ locale: string; date: string }>
}

export default async function DailyMatchesPage({ params }: Props) {
  const { locale, date } = await params

  // Alias ("today"/"yesterday"/"tomorrow") → canonical dated URL.
  if (!isIsoDate(date)) {
    const resolved = resolveDateSegment(date, locale)
    if (!resolved) notFound()
    redirect({ href: `/matches/${resolved}`, locale: locale as 'en' | 'es' | 'pt' | 'it' | 'fr' })
  }

  const iso = date
  if (!iso) notFound()

  const tz = getLocaleHomeTz(locale)

  // Read user TZ from cookie for display (Googlebot → fall back to locale home TZ)
  const cookieStore = await cookies()
  const userTz = cookieStore.get('geo-timezone')?.value || tz

  // Fetch via shared helper — same shape the API route returns, so the
  // client cache hydrates without reprocessing.
  const supabase = createServerClient()
  const { groups: rawGroups } = await fetchMatchesDay(supabase, iso, tz)

  // Flatten raw matches for stream resolution.
  const rawMatches: MatchesDayMatch[] = rawGroups.flatMap((g) => g.matches)

  // Build tournament name lookup for tier 3 fallback URL.
  const tournamentNamesForStreams: Record<string, string> = {}
  for (const m of rawMatches) {
    const name = m.tournament?.name
    const tid = m.tournament?.id
    if (name && tid) tournamentNamesForStreams[tid] = name
  }

  // Resolve YouTube stream tiers for all matches on this day.
  const streamTiers = process.env.NEXT_PUBLIC_FIP_STREAMS_ENABLED === 'true'
    ? await resolveStreamsForMatches(
        supabase,
        rawMatches.map(m => ({
          id: m.id,
          tournament_id: m.tournament?.id ?? '',
          tournament_level: m.tournament?.level ?? null,
          court: m.court,
          scheduled_at: m.scheduled_at,
          played_at: null,
        })),
        tournamentNamesForStreams,
      )
    : new Map<string, null>()

  // Decorate each match with its resolved streamTier, then re-bucket into groups.
  const matchStreamMap = new Map(rawMatches.map(m => [
    m.id,
    { ...m, streamTier: streamTiers.get(m.id) ?? null },
  ]))
  const groups = rawGroups.map(g => ({
    ...g,
    matches: g.matches.map(m => matchStreamMap.get(m.id) ?? m),
  }))

  // Flatten for SEO copy + JSON-LD.
  const dayMatches: MatchesDayMatch[] = groups.flatMap((g) => g.matches)

  // ── Build intro + FAQ copy ────────────────────────────────────
  const tDaily = await getTranslations({ locale, namespace: 'daily' })
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
  const jsonLd = buildJsonLd({ iso, locale, intro, matches: dayMatches })
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

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
          as home, feed, following. */}
      <MatchesPageHeader />

      {/* Shell owns the sticky day pills + filter + body. Initial paint
          uses server-rendered groups; the shell hydrates a client cache
          and prefetches ±3 days so subsequent pill clicks swap instantly. */}
      <MatchesDayShell
        initialIso={iso}
        initialGroups={groups}
        locale={locale}
        userTz={userTz}
        emptyStateTitle={tDaily('noMatchesTitle')}
        emptyStateSubtitle={tDaily('noMatchesSub')}
      />

      <div style={{ height: 30 }} />
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════

function formatLongDate(iso: string, locale: string): string {
  const tz = getLocaleHomeTz(locale)
  const anchor = dateAtTzMidnight(iso, tz)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
    timeZone: tz,
  }).format(anchor)
}

function pickFeaturedFromMatch(m: MatchesDayMatch): { name: string; ranking: number | null } | null {
  const candidates = [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2].filter(Boolean) as Array<{
    name: string | null; display_name: string | null; ranking: number | null
  }>
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

function buildJsonLd({
  iso, locale, intro, matches,
}: {
  iso: string
  locale: string
  intro: { h1: string; lead: string }
  matches: MatchesDayMatch[]
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
