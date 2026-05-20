import { describe, expect, it } from 'vitest'
import { buildRankingsJsonLd } from './jsonld'
import type { Player } from './shared'

const PLAYERS: Pick<Player, 'id' | 'name' | 'ranking' | 'country'>[] = [
  { id: 'p1', name: 'Arturo Coello', ranking: 1, country: 'ESP' },
  { id: 'p2', name: 'Agustín Tapia', ranking: 2, country: 'ARG' },
]

describe('buildRankingsJsonLd', () => {
  it('returns an ItemList with @context schema.org', () => {
    const ld = buildRankingsJsonLd({
      players: PLAYERS as Player[],
      locale: 'en',
      baseUrl: 'https://padelnachos.com',
      listName: "FIP Men's Padel Rankings",
    })
    expect(ld['@context']).toBe('https://schema.org')
    expect(ld['@type']).toBe('ItemList')
  })

  it('sets inLanguage to the active locale', () => {
    const ld = buildRankingsJsonLd({
      players: PLAYERS as Player[],
      locale: 'es',
      baseUrl: 'https://padelnachos.com',
      listName: 'Ranking FIP de pádel masculino',
    })
    expect(ld.inLanguage).toBe('es')
    expect(ld.name).toBe('Ranking FIP de pádel masculino')
  })

  it('emits one item per player, with rank and a Person sub-entity', () => {
    const ld = buildRankingsJsonLd({
      players: PLAYERS as Player[],
      locale: 'en',
      baseUrl: 'https://padelnachos.com',
      listName: 'X',
    })
    expect(ld.itemListElement).toHaveLength(2)
    expect(ld.itemListElement[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      url: 'https://padelnachos.com/player/p1',
      item: {
        '@type': 'Person',
        name: 'Arturo Coello',
        nationality: 'ESP',
      },
    })
  })

  it('prefixes player URLs with the locale for non-English', () => {
    const ld = buildRankingsJsonLd({
      players: PLAYERS as Player[],
      locale: 'pt',
      baseUrl: 'https://padelnachos.com',
      listName: 'X',
    })
    expect(ld.itemListElement[0].url).toBe('https://padelnachos.com/pt/player/p1')
  })

  it('omits nationality field when player.country is null', () => {
    const ld = buildRankingsJsonLd({
      players: [{ id: 'p3', name: 'X', ranking: 3, country: null } as Player],
      locale: 'en',
      baseUrl: 'https://padelnachos.com',
      listName: 'X',
    })
    expect(ld.itemListElement[0].item).toEqual({
      '@type': 'Person',
      name: 'X',
    })
  })
})
