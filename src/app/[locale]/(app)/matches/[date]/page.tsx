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
import type { LiveChannel } from '@/components/YoutubeLiveIndicator'

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
          played_at: (m as any).finished_at ?? null,
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

  // YouTube live indicator data — single query, server-rendered, fresh per
  // navigation. No client-side polling for v1.
  const STALE_MS = 30 * 60 * 1000
  const liveChannelsRes = await supabase
    .from('youtube_channel_live')
    .select(`
      video_id,
      title,
      channel:youtube_channels!inner (
        id,
        name,
        abbreviation,
        color_hex,
        display_order
      )
    `)
    .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
    .eq('channel.is_active', true)

  const liveChannels: LiveChannel[] = (liveChannelsRes.data ?? [])
    .map((r) => {
      const ch = Array.isArray(r.channel) ? r.channel[0] : r.channel
      if (!ch) return null
      return {
        videoId: r.video_id as string,
        title: r.title as string,
        channel: {
          id: ch.id as string,
          name: ch.name as string,
          abbreviation: ch.abbreviation as string,
          colorHex: ch.color_hex as string,
          displayOrder: ch.display_order as number,
        },
      }
    })
    .filter((x): x is LiveChannel => x !== null)
    .sort((a, b) => a.channel.displayOrder - b.channel.displayOrder)

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

      {/* SEO/a11y heading — visible day pills + match list serve as
          the primary visual hierarchy; the h1 itself stays SR-only. */}
      <h1 className="sr-only">{intro.h1}</h1>

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
        liveChannels={liveChannels}
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
  const items = matches.slice(0, 50).flatMap((m, i) => {
    const p1 = [m.pair1_player1, m.pair1_player2].filter(Boolean).map(p => (p!.display_name || p!.name || '').trim()).filter(Boolean)
    const p2 = [m.pair2_player1, m.pair2_player2].filter(Boolean).map(p => (p!.display_name || p!.name || '').trim()).filter(Boolean)
    // Fall back to tournament start when match-level scheduling is missing.
    // SportsEvent without a startDate is invalid in Search Console; matches
    // that can't supply either are skipped entirely rather than emitted
    // broken.
    const startDate = m.scheduled_at ?? m.tournament?.starts_at ?? null
    if (!startDate) return []

    const buildTeam = (names: string[]) =>
      names.length > 0
        ? {
            '@type': 'SportsTeam',
            name: names.join(' / '),
            athlete: names.map((n) => ({ '@type': 'Person', name: n })),
          }
        : null
    const competitor = [buildTeam(p1), buildTeam(p2)].filter(Boolean)

    return [{
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'SportsEvent',
        name: `${p1.join(' / ')} vs ${p2.join(' / ')}`,
        startDate,
        ...(m.finished_at ? { endDate: m.finished_at } : {}),
        sport: 'Padel',
        url: `https://padelnachos.com/match/${m.id}`,
        location: m.tournament
          ? {
              '@type': 'Place',
              name: m.tournament.name,
              ...(m.tournament.country ? { address: m.tournament.country } : {}),
            }
          : { '@type': 'Place', name: 'Padel Tournament' },
        eventStatus:
          m.status === 'live' ? 'https://schema.org/EventInProgress'
          : m.status === 'scheduled' ? 'https://schema.org/EventScheduled'
          : 'https://schema.org/EventOnHold',
        ...(competitor.length > 0 ? { competitor } : {}),
        superEvent: m.tournament
          ? {
              '@type': 'SportsEvent',
              name: m.tournament.name,
              url: `https://padelnachos.com/tournaments/${m.tournament.id}`,
            }
          : undefined,
      },
    }]
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
