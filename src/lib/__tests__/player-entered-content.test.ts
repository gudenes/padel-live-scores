import { describe, it, expect } from 'vitest'
import { buildPlayerEnteredContent, type EnteredPlayer } from '../player-entered-content'

const tapia: EnteredPlayer = { id: 'p-tapia', name: 'Agustin Tapia', display_name: null, avatar_url: 'https://cdn/tapia.png', ranking: 1 }
const coello: EnteredPlayer = { id: 'p-coello', name: 'Arturo Coello', display_name: null, avatar_url: 'https://cdn/coello.png', ranking: 2 }
const noAvatar: EnteredPlayer = { id: 'p-x', name: 'No Avatar', display_name: null, avatar_url: null, ranking: 5 }
const noName: EnteredPlayer = { id: 'p-y', name: null, display_name: null, avatar_url: null, ranking: 7 }
const premier = { name: 'Madrid P1', level: 'P1' }

describe('buildPlayerEnteredContent', () => {
  it('single player → name + tournament title, avatar icon, player url', () => {
    const c = buildPlayerEnteredContent([tapia], premier)
    expect(c).toEqual({
      title: 'Tapia entered Madrid P1',
      body: 'Just added to the entry list.',
      icon: 'https://cdn/tapia.png',
      url: '/player/p-tapia',
    })
  })

  it('multiple players → "+N more", best-ranked headliner', () => {
    // coello passed first but tapia (ranking 1) is the headliner
    const c = buildPlayerEnteredContent([coello, tapia], premier)
    expect(c?.title).toBe('Tapia +1 more entered Madrid P1')
    expect(c?.body).toBe('Players you follow joined the draw.')
    expect(c?.url).toBe('/player/p-tapia')
    expect(c?.icon).toBe('https://cdn/tapia.png')
  })

  it('headliner without avatar → circuit logo (Premier star)', () => {
    const c = buildPlayerEnteredContent([noAvatar], premier)
    expect(c?.icon).toBe('https://padelnachos.com/branding/premier-padel-star.png')
  })

  it('FIP-tier without avatar → FIP tour icon', () => {
    const c = buildPlayerEnteredContent([noAvatar], { name: 'Vigo Bronze', level: 'fip_bronze' })
    expect(c?.icon).toBe('https://padelnachos.com/branding/fip-tour-icon.png')
  })

  it('drops players with no name; returns null when none remain', () => {
    expect(buildPlayerEnteredContent([noName], premier)).toBeNull()
  })

  it('null tournament name → "an event" fallback', () => {
    const c = buildPlayerEnteredContent([tapia], { name: null, level: 'P1' })
    expect(c?.title).toBe('Tapia entered an event')
  })

  it('null ranking sorts last; alpha tie-break on equal ranking', () => {
    const a: EnteredPlayer = { id: 'a', name: 'Zoe Alpha', display_name: null, avatar_url: null, ranking: null }
    const b: EnteredPlayer = { id: 'b', name: 'Yan Beta', display_name: null, avatar_url: null, ranking: null }
    // both null ranking → alpha by last name: Alpha < Beta
    const c = buildPlayerEnteredContent([b, a], premier)
    expect(c?.url).toBe('/player/a')
  })
})
