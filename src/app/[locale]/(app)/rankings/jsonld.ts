// src/app/[locale]/(app)/rankings/jsonld.ts
// Pure builder for the schema.org ItemList JSON-LD emitted on the
// rankings page. Server-only consumer (page.tsx); no runtime deps.

import type { Player } from './shared'

type LdPerson = {
  '@type': 'Person'
  name: string
  nationality?: string
}

type LdListItem = {
  '@type': 'ListItem'
  position: number
  url: string
  item: LdPerson
}

export type RankingsJsonLd = {
  '@context': 'https://schema.org'
  '@type': 'ItemList'
  inLanguage: string
  name: string
  itemListElement: LdListItem[]
}

interface BuildInput {
  players: Player[]
  locale: string
  baseUrl: string
  listName: string
}

export function buildRankingsJsonLd({
  players,
  locale,
  baseUrl,
  listName,
}: BuildInput): RankingsJsonLd {
  const localePrefix = locale === 'en' ? '' : `/${locale}`

  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    inLanguage: locale,
    name: listName,
    itemListElement: players.map((p, idx) => {
      const item: LdPerson = {
        '@type': 'Person',
        name: p.name,
      }
      if (p.country) item.nationality = p.country
      return {
        '@type': 'ListItem',
        position: p.ranking ?? idx + 1,
        url: `${baseUrl}${localePrefix}/player/${p.id}`,
        item,
      }
    }),
  }
}
