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

type Props = {
  params: Promise<{ locale: string; id: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params

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

  const title = `${tournament.name} — Results & Live Scores`
  const description = `Follow ${tournament.name} live. Scores, rankings and highlights.`

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
    ...buildAlternates(`/tournaments/${id}`),
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

  try {
    const supabase = createServerClient()

    // Fetch tournament metadata + the freshest editorial post in parallel.
    // Editorial is ordered desc so a recap naturally supersedes an older
    // preview once the cron generates it after the event ends.
    const [tournamentRes, editorialRes] = await Promise.all([
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
    ])

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
    jsonLd = !isGhost && tournament
      ? {
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
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
        about: { '@type': 'SportsEvent', name: tournament.name },
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
      <EditorialProvider post={editorial}>
        {children}
      </EditorialProvider>
    </>
  )
}
