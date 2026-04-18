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
import { createServerClient } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'
import { EditorialProvider, type EditorialPost } from '@/components/EditorialProvider'

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

  if (!tournament) {
    return { title: 'Tournament | Padel Nachos' }
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

  try {
    const supabase = createServerClient()

    // Fetch tournament metadata + the freshest editorial post in parallel.
    // Editorial is ordered desc so a recap naturally supersedes an older
    // preview once the cron generates it after the event ends.
    const [tournamentRes, editorialRes] = await Promise.all([
      supabase
        .from('tournaments')
        .select('id, name, country, starts_at, ends_at')
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
    editorial = (editorialRes.data && editorialRes.data[0]
      ? editorialRes.data[0] as unknown as EditorialPost
      : null)

    jsonLd = tournament
      ? {
          '@context': 'https://schema.org',
          '@type': 'SportsEvent',
          name: tournament.name,
          startDate: tournament.starts_at,
          endDate: tournament.ends_at,
          location: { '@type': 'Place', name: tournament.country },
          sport: 'Padel',
        }
      : null

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
      <EditorialProvider post={editorial}>
        {children}
      </EditorialProvider>
    </>
  )
}
