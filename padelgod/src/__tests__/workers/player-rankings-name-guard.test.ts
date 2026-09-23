import { describe, it, expect } from 'vitest'
import { shouldAcceptFeedName } from '../../workers/player-rankings.js'

const URL_ANDRES = 'https://www.padelfip.com/es/player/andres-fernandez-lancha/'
const URL_POL = 'https://www.padelfip.com/es/player/pol-hernandez-alvarez/'

describe('shouldAcceptFeedName', () => {
  it('refuses the 2026-09-23 incident: a wholly different person', () => {
    // fip_id P101601 is Andres Fernandez Lancha. The feed sent Pol
    // Hernandez Alvarez, who is a different real player with his own row.
    expect(shouldAcceptFeedName('Pol Hernandez Alvarez', URL_ANDRES)).toBe(false)
  })

  it('accepts the same feed name against the RIGHT row', () => {
    expect(shouldAcceptFeedName('Pol Hernandez Alvarez', URL_POL)).toBe(true)
  })

  it('accepts an accent-only correction', () => {
    expect(shouldAcceptFeedName('Andrés Fernández Lancha', URL_ANDRES)).toBe(true)
  })

  it('accepts a shortened broadcast form', () => {
    expect(shouldAcceptFeedName('Andres Fernandez', URL_ANDRES)).toBe(true)
  })

  it('accepts adding or dropping a second surname', () => {
    expect(shouldAcceptFeedName('Andres Fernandez Lancha Garcia', URL_ANDRES)).toBe(true)
    expect(shouldAcceptFeedName('Lancha', URL_ANDRES)).toBe(true)
  })

  it('accepts a married-name change that keeps one token', () => {
    expect(shouldAcceptFeedName('Marta Ortega Ruiz', 'https://www.padelfip.com/es/player/marta-ortega/')).toBe(true)
  })

  it('falls back to trusting the feed when there is no witness', () => {
    expect(shouldAcceptFeedName('Anything At All', null)).toBe(true)
    expect(shouldAcceptFeedName('Anything At All', '')).toBe(true)
    expect(shouldAcceptFeedName('Anything At All', 'https://www.padelfip.com/es/about/')).toBe(true)
  })

  it('refuses an empty feed name', () => {
    expect(shouldAcceptFeedName('', URL_ANDRES)).toBe(false)
    expect(shouldAcceptFeedName(null, URL_ANDRES)).toBe(false)
  })

  it('tolerates a trailing query or fragment on the url', () => {
    expect(shouldAcceptFeedName('Pol Hernandez Alvarez', URL_ANDRES + '?utm=x')).toBe(false)
  })
})
