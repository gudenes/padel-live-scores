import { describe, it, expect } from 'vitest'
import { winColor, pairSurnames } from '@/lib/projection-view'
import { buildProjectionShareUrl, buildProjectionSharePayload } from '@/app/[locale]/(app)/tournaments/[id]/projection-url'

describe('winColor', () => {
  it('lime at >= 0.65', () => expect(winColor(0.65)).toBe('#7ED321'))
  it('gold between 0.45 and 0.65', () => expect(winColor(0.5)).toBe('#F5A623'))
  it('red below 0.45', () => expect(winColor(0.3)).toBe('#FF4655'))
  it('gold at exactly 0.45', () => expect(winColor(0.45)).toBe('#F5A623'))
  it('live just below 0.45', () => expect(winColor(0.44)).toBe('#FF4655'))
})

describe('pairSurnames', () => {
  it('joins last name tokens', () => {
    expect(pairSurnames([
      { id: '1', name: 'Alex Chozas', country: null, avatarUrl: null },
      { id: '2', name: 'Valentino Libaak', country: null, avatarUrl: null },
    ])).toBe('Chozas / Libaak')
  })
  it('falls back to full name when single token', () => {
    expect(pairSurnames([{ id: '1', name: 'Coello', country: null, avatarUrl: null }])).toBe('Coello')
  })
  it('falls back to full names when both players are single-token', () => {
    expect(pairSurnames([
      { id: '1', name: 'Coello', country: null, avatarUrl: null },
      { id: '2', name: 'Tapia', country: null, avatarUrl: null },
    ])).toBe('Coello / Tapia')
  })
})

describe('buildProjectionShareUrl', () => {
  const origin = 'https://padelnachos.com'
  it('no locale prefix for English (as-needed)', () => {
    expect(buildProjectionShareUrl(origin, 'en', 't1', 'coello-tapia'))
      .toBe('https://padelnachos.com/tournaments/t1/projection/coello-tapia')
  })
  it('prefixes non-default locales', () => {
    expect(buildProjectionShareUrl(origin, 'es', 't1', 'coello-tapia'))
      .toBe('https://padelnachos.com/es/tournaments/t1/projection/coello-tapia')
  })
})

describe('buildProjectionSharePayload', () => {
  const t = (k: string, v?: Record<string, unknown>) =>
    ({ shareTitle: `${v?.pair} — road to the title`,
       shareTextContender: `${v?.pct}% to win ${v?.name}`,
       shareTextChampion: `Champions at ${v?.name}!`,
       shareTextEliminated: `Out of ${v?.name}` }[k] ?? k)
  it('contender → pct text', () => {
    const p = buildProjectionSharePayload({ pair: 'Coello / Tapia', tournamentName: 'Valladolid P2', championPct: 47, status: 'active' }, t as never)
    expect(p.title).toBe('Coello / Tapia — road to the title')
    expect(p.text).toBe('47% to win Valladolid P2')
  })
  it('champion → champion text', () => {
    const p = buildProjectionSharePayload({ pair: 'Coello / Tapia', tournamentName: 'Valladolid P2', championPct: 100, status: 'champion' }, t as never)
    expect(p.text).toBe('Champions at Valladolid P2!')
  })
  it('eliminated → eliminated text', () => {
    const p = buildProjectionSharePayload({ pair: 'X / Y', tournamentName: 'Valladolid P2', championPct: 0, status: 'eliminated' }, t as never)
    expect(p.text).toBe('Out of Valladolid P2')
  })
})
