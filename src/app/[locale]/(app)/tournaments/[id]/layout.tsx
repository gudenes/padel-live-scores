// src/app/[locale]/(app)/tournaments/[id]/layout.tsx
// Server-side layout wrapper:
//   1. Provides OG metadata + SportsEvent JSON-LD for the tournament
//   2. Server-fetches the editorial post for this tournament + locale and
//      passes it down to the client page via EditorialProvider — so the
//      initial HTML already contains the editorial content by the time
//      Googlebot parses it. No waiting for JS to execute.
//   3. Emits an Article JSON-LD for the editorial when one exists, giving
//      Google first-pass structured-data indexing of the post.

import { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { createServerClient } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'
import { EditorialProvider, type EditorialPost } from '@/components/EditorialProvider'
import { fetchSeoBroadcasters } from '@/lib/where-to-watch/fetch-seo-broadcasters'
import { buildBroadcastJsonLd } from '@/lib/where-to-watch/build-broadcast-jsonld'
import { buildSeoSummary } from '@/lib/where-to-watch/build-seo-summary'
import { levelToChannelAbbr } from '@/lib/where-to-watch/circuit-map'
import {
  buildTournamentResults,
  type TournamentResults,
  type TournamentResultMatchInput,
  type TournamentResultPlayer,
} from '@/lib/seo/tournament-results'

type Props = {
  params: Promise<{ locale: string; id: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id, locale } = await params

  let supabase
  try { supabase = createServerClient() } catch { return { title: 'Tournament | Padel Nachos' } }

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, country, level, starts_at, ends_at')
    .eq('id', id)
    .single()

  // Ghost rows: missing tournament, empty name, or no start date.
  // These render as "Tournament Detail" with em-dashes everywhere
  // and have nothing useful for Search. De-index them so Google
  // drops the URL on next crawl.
  const isGhost = !tournament || !tournament.name?.trim() || !tournament.starts_at
  if (isGhost) {
    return {
      title: 'Tournament | Padel Nachos',
      robots: { index: false, follow: false },
    }
  }

  const t = await getTranslations({ locale, namespace: 'seo.tournament' })
  const title = t('title', { name: tournament.name })
  const description = t('description', { name: tournament.name })

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
    },
    ...buildAlternates(`/tournaments/${id}`, locale),
  }
}

export default async function TournamentLayout({ params, children }: Props) {
  const { id, locale } = await params
  let jsonLd: object | null = null
  let editorialJsonLd: object | null = null
  let editorial: EditorialPost | null = null
  let tournamentName: string | null = null
  let seoData: Awaited<ReturnType<typeof fetchSeoBroadcasters>> | null = null
  let seoSentence: string | null = null
  let results: TournamentResults | null = null

  try {
    const supabase = createServerClient()

    // Fetch tournament metadata + the freshest editorial post + this
    // tournament's matches in parallel. The matches feed the server-rendered
    // results list below — the tournament page is 'use client' and only mounts
    // the match list on the PARTIDOS tab, so without this the results are
    // absent from the first-pass HTML and from the default-tab render a crawler
    // sees. Per-tournament read is bounded, so no pagination needed.
    const [tournamentRes, editorialRes, matchesRes] = await Promise.all([
      supabase
        .from('tournaments')
        .select('id, name, country, level, starts_at, ends_at')
        .eq('id', id)
        .single(),
      supabase
        .from('editorial_posts')
        .select('kind, headline, lead, body_md, callout_key, callout_value, word_count, generated_at')
        .eq('entity_type', 'tournament')
        .eq('entity_id', id)
        .eq('locale', locale)
        .in('kind', ['preview', 'recap'])
        .order('generated_at', { ascending: false })
        .limit(1),
      supabase
        .from('matches')
        .select(`
          id, status, round, category, winner_pair, finished_at, scheduled_at,
          pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name,
          pair1_player1:players!matches_pair1_player1_id_fkey(id, name),
          pair1_player2:players!matches_pair1_player2_id_fkey(id, name),
          pair2_player1:players!matches_pair2_player1_id_fkey(id, name),
          pair2_player2:players!matches_pair2_player2_id_fkey(id, name),
          sets(set_number, pair1_games, pair2_games)
        `)
        .eq('tournament_id', id)
        .limit(500),
    ])

    // Coalesce player join → thin-name fallback (amateur-tier matches store
    // names on the match row when no player FK resolved). Same pattern as the
    // match-page layout.
    const toPlayer = (joined: unknown, fallback: string | null | undefined): TournamentResultPlayer | null => {
      const ref = joined as { id: string; name: string } | null
      const name = ref?.name ?? (fallback?.trim() || '')
      if (!name) return null
      return { id: ref?.id ?? null, name }
    }
    const matchInputs: TournamentResultMatchInput[] = (matchesRes.data ?? []).map((m) => {
      const row = m as Record<string, unknown>
      return {
        id: row.id as string,
        status: (row.status as string | null) ?? null,
        round: (row.round as string | null) ?? null,
        category: (row.category as string | null) ?? null,
        winner_pair: (row.winner_pair as number | null) ?? null,
        finished_at: (row.finished_at as string | null) ?? null,
        scheduled_at: (row.scheduled_at as string | null) ?? null,
        pair1: [
          toPlayer(row.pair1_player1, row.pair1_player1_name as string | null),
          toPlayer(row.pair1_player2, row.pair1_player2_name as string | null),
        ].filter((p): p is TournamentResultPlayer => p !== null),
        pair2: [
          toPlayer(row.pair2_player1, row.pair2_player1_name as string | null),
          toPlayer(row.pair2_player2, row.pair2_player2_name as string | null),
        ].filter((p): p is TournamentResultPlayer => p !== null),
        sets: ((row.sets as Array<{ set_number: number; pair1_games: number | null; pair2_games: number | null }>) ?? []),
      }
    })
    const built = buildTournamentResults(matchInputs)
    results = built.rows.length > 0 ? built : null

    const tournament = tournamentRes.data
    tournamentName = tournament?.name?.trim() || null
    editorial = (editorialRes.data && editorialRes.data[0]
      ? editorialRes.data[0] as unknown as EditorialPost
      : null)

    // Fetch SEO broadcaster data — scoped to the tournament's circuit.
    const seoChannelAbbr = levelToChannelAbbr(tournament?.level ?? null)
    seoData = await fetchSeoBroadcasters(supabase, seoChannelAbbr)

    // Mirror generateMetadata's isGhost guard: nameless or dateless rows
    // produce SportsEvent items that Search Console rejects as "Missing
    // field 'startDate'" / "Missing field 'location'". Skip emission
    // entirely on those rows instead of emitting nulls.
    const isGhost = !tournament || !tournament.name?.trim() || !tournament.starts_at
    // Stable @id for the SportsEvent so the editorial Article can reference it
    // by id instead of inlining a second, name-only SportsEvent (which Search
    // Console flags as invalid: "Missing field 'startDate' / 'location'").
    const eventId = `https://padelnachos.com${locale === 'en' ? '' : `/${locale}`}/tournaments/${id}#event`
    jsonLd = !isGhost && tournament
      ? {
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          '@id': eventId,
          name: tournament.name,
          startDate: tournament.starts_at,
          ...(tournament.ends_at ? { endDate: tournament.ends_at } : {}),
          location: {
            '@type': 'Place',
            name: tournament.name,
            ...(tournament.country ? { address: tournament.country } : {}),
          },
          sport: 'Padel',
          // BroadcastEvent[] for Google's "where to watch" carousel
          ...(seoData?.channelMeta
            ? { publication: buildBroadcastJsonLd(seoData) }
            : {}),
        }
      : null

    // Build the sr-only broadcaster sentence for this tournament.
    if (seoData?.channelMeta) {
      const summaryData = buildSeoSummary({ broadcasters: seoData.broadcasters })
      const parts: string[] = [`${seoData.channelMeta.name} YouTube`]
      for (const b of summaryData.named) {
        const countries = b.countriesShown.join(', ')
        parts.push(
          b.extraCountryCount > 0
            ? `${b.name} (${countries}, +${b.extraCountryCount} more)`
            : `${b.name} (${countries})`,
        )
      }
      const list = parts.join(', ')
      const target = tournament?.name ?? 'this tournament'
      const t = await getTranslations({ locale, namespace: 'whereToWatch' })
      seoSentence = t('seoSummary', { target, list, extra: summaryData.remainingCount })
    }

    // Article JSON-LD — gives Google first-pass access to the editorial text
    // via structured data, independent of tab state or JS execution.
    if (editorial && tournament) {
      editorialJsonLd = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: editorial.headline,
        articleBody: editorial.body_md,
        datePublished: editorial.generated_at,
        dateModified: editorial.generated_at,
        inLanguage: locale,
        // Reference the SportsEvent by @id rather than inlining an incomplete
        // copy — keeps a single valid event entity on the page.
        about: { '@id': eventId },
        author: {
          '@type': 'Organization',
          name: 'PadelNachos',
          url: 'https://padelnachos.com',
        },
        publisher: {
          '@type': 'Organization',
          name: 'PadelNachos',
          url: 'https://padelnachos.com',
        },
      }
    }
  } catch {
    // DB unavailable — render children without JSON-LD or editorial context
  }

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {editorialJsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(editorialJsonLd) }}
        />
      )}
      {/* SEO/a11y heading — visible tournament name lives in the
          client page's hero block as a styled div for design reasons. */}
      {tournamentName && (
        <header className="sr-only">
          <h1>{tournamentName} — Padel Tournament Results</h1>
          {seoSentence && <p>{seoSentence}</p>}
        </header>
      )}
      {/* Server-rendered results list. The visible match cards live behind the
          client page's PARTIDOS tab (not in first-pass HTML); this puts the
          actual results — player names, scores, rounds — and crawlable links to
          each match into the initial HTML for every crawler. sr-only so it
          doesn't duplicate the styled client UI; it is still fully crawlable. */}
      {results && (
        <section className="sr-only" aria-label="Tournament results and schedule">
          <h2>{tournamentName ? `${tournamentName} — Results` : 'Results'}</h2>
          <ul>
            {results.rows.map((r) => {
              const matchHref = locale === 'en' ? `/match/${r.id}` : `/${locale}/match/${r.id}`
              return (
                <li key={r.id}>
                  <a href={matchHref}>
                    {r.round ? `${r.round}: ` : ''}{r.headline}
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <EditorialProvider post={editorial}>
        {children}
      </EditorialProvider>
    </>
  )
}
