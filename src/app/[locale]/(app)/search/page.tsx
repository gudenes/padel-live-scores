// src/app/[locale]/(app)/search/page.tsx
//
// Server-rendered search route. Exists primarily as a real URL endpoint
// for the SearchAction JSON-LD on the homepage (Google's in-result
// search box requires a navigable URL pattern, not a JS-only overlay).
//
// Mirrors the SearchOverlay's data flow at a smaller scope: players +
// tournaments by name. Matches are intentionally omitted server-side
// to keep the page light — the in-app overlay still surfaces them for
// authenticated browsing. Indexed result pages would also bloat
// Google's view of the site, so /search?q=... is noindexed; only the
// bare /search entry (used by the SearchAction handler) is indexable.

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { buildAlternates } from '@/lib/seo-helpers'
import { levelLabel } from '@/lib/tournament-labels'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ q?: string }>
}

export async function generateMetadata(
  { params, searchParams }: Props,
): Promise<Metadata> {
  const { locale } = await params
  const { q } = await searchParams
  const t = await getTranslations({ locale, namespace: 'seo.search' })
  const query = (q ?? '').trim()
  const title = query ? t('titleWithQuery', { query }) : t('title')
  const description = query ? t('descriptionWithQuery', { query }) : t('description')

  return {
    title,
    description,
    // Result pages get noindex — they're thin, infinitely variable, and
    // would dilute the index. The entry /search URL stays indexable so
    // Google's SearchAction validation can fetch it.
    robots: query ? { index: false, follow: true } : undefined,
    ...buildAlternates('/search', locale),
  }
}

interface PlayerRow {
  id: string
  name: string
  country: string | null
  ranking: number | null
  category: 'men' | 'women' | null
  avatar_url: string | null
}

interface TournamentRow {
  id: string
  name: string
  country: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
}

async function runSearch(q: string): Promise<{ players: PlayerRow[]; tournaments: TournamentRow[] }> {
  const pattern = `%${q}%`
  const [playersRes, tournamentsRes] = await Promise.all([
    supabase
      .from('players')
      .select('id, name, country, ranking, category, avatar_url')
      .ilike('name', pattern)
      .order('ranking', { ascending: true, nullsFirst: false })
      .limit(20),
    supabase
      .from('tournaments')
      .select('id, name, country, level, starts_at, ends_at')
      .ilike('name', pattern)
      .order('starts_at', { ascending: false })
      .limit(10),
  ])
  return {
    players: (playersRes.data ?? []) as PlayerRow[],
    tournaments: (tournamentsRes.data ?? []) as TournamentRow[],
  }
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams
  const query = (q ?? '').trim()
  const t = await getTranslations('search')
  const tCat = await getTranslations('nav.search')

  const { players, tournaments } = query
    ? await runSearch(query)
    : { players: [], tournaments: [] }
  const totalResults = players.length + tournaments.length

  return (
    <main style={{ background: BG_BASE, minHeight: '100vh', padding: '20px 16px', color: '#fff' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 6, letterSpacing: '-0.01em' }}>
        {t('heading')}
      </h1>

      {/* GET form so submission updates ?q= in the URL — keeps SSR simple
          and works without JS. */}
      <form method="get" action="" style={{ marginBottom: 20 }}>
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder={t('placeholder')}
          autoFocus
          style={{
            width: '100%',
            padding: '12px 14px',
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            color: '#fff',
            fontSize: 15,
            outline: 'none',
          }}
        />
      </form>

      {!query && (
        <p style={{ color: MUTED, fontSize: 14 }}>{t('typeToSearch')}</p>
      )}

      {query && totalResults === 0 && (
        <p style={{ color: MUTED, fontSize: 14 }}>
          {t('noResults', { query })}
        </p>
      )}

      {query && players.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: GREEN, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {tCat('typePlayers')} · {players.length}
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {players.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/player/${p.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: BG_CARD,
                    border: `1px solid ${BORDER}`,
                    color: '#fff',
                    textDecoration: 'none',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  <span style={{ color: MUTED, fontSize: 12 }}>
                    {p.ranking ? `#${p.ranking}` : ''}
                    {p.category ? ` · ${p.category === 'men' ? tCat('categoryMen') : tCat('categoryWomen')}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {query && tournaments.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: ORANGE, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {tCat('typeTournaments')} · {tournaments.length}
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {tournaments.map((tn) => (
              <li key={tn.id}>
                <Link
                  href={`/tournaments/${tn.id}`}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: BG_CARD,
                    border: `1px solid ${BORDER}`,
                    color: '#fff',
                    textDecoration: 'none',
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{tn.name}</span>
                  <span style={{ color: MUTED, fontSize: 12 }}>
                    {tn.level ? levelLabel(tn.level) : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
