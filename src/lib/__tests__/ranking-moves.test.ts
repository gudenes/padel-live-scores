import { describe, expect, it } from 'vitest'
import {
  composeRankingCopy,
  diffOfficialWeeks,
  pickLatestAndPreviousWeeks,
  rankingFallbackCopy,
  type RankingPlayer,
  type RankingSnapshotRow,
} from '@/lib/ranking-moves'

const YEAR = 2026
const WEEK = 34

function snap(partial: Partial<RankingSnapshotRow> & Pick<RankingSnapshotRow, 'player_id' | 'ranking'>): RankingSnapshotRow {
  return {
    ranking_move: null,
    gender: 'men',
    year: YEAR,
    week: WEEK,
    ...partial,
  }
}

function player(id: string, display_name: string, extra: Partial<RankingPlayer> = {}): RankingPlayer {
  return { id, name: display_name, display_name, avatar_url: null, ...extra }
}

const tapia = player('p-tapia', 'Agustin Tapia', {
  avatar_url: 'https://xxx.supabase.co/storage/v1/object/public/avatars/tapia.png',
})
const coello = player('p-coello', 'Arturo Coello')
const galan = player('p-galan', 'Alejandro Galán')
const triay = player('p-triay', 'Gemma Triay')
const brea = player('p-brea', 'Paula Brea')
const ortega = player('p-ortega', 'Marta Ortega')
const directory = [tapia, coello, galan, triay, brea, ortega]

describe('pickLatestAndPreviousWeeks', () => {
  it('picks the two newest (year, week) pairs', () => {
    const out = pickLatestAndPreviousWeeks([
      { year: 2026, week: 2 },
      { year: 2026, week: 34 },
      { year: 2025, week: 52 },
      { year: 2026, week: 33 },
      { year: 2026, week: 34 },
    ])
    expect(out).toEqual({
      current: { year: 2026, week: 34 },
      previous: { year: 2026, week: 33 },
    })
  })

  it('returns null when fewer than two distinct weeks exist', () => {
    expect(pickLatestAndPreviousWeeks([{ year: 2026, week: 34 }])).toBeNull()
    expect(pickLatestAndPreviousWeeks([])).toBeNull()
  })
})

describe('diffOfficialWeeks', () => {
  it('picks the biggest increase and biggest decrease in the top-30 pool', () => {
    const current = [
      snap({ player_id: 'p-tapia', ranking: 1 }),
      snap({ player_id: 'p-coello', ranking: 6 }),
      snap({ player_id: 'p-triay', ranking: 8, gender: 'women' }),
      snap({ player_id: 'p-galan', ranking: 12 }),
    ]
    const previous = [
      snap({ player_id: 'p-tapia', ranking: 1, week: WEEK - 1 }),
      snap({ player_id: 'p-coello', ranking: 3, week: WEEK - 1 }),
      snap({ player_id: 'p-triay', ranking: 14, week: WEEK - 1, gender: 'women' }),
      snap({ player_id: 'p-galan', ranking: 7, week: WEEK - 1 }),
    ]
    const bulletin = diffOfficialWeeks(current, previous, directory)!
    expect(bulletin.biggestIncrease?.playerId).toBe('p-triay')
    expect(bulletin.biggestIncrease?.move).toBe(6)
    expect(bulletin.biggestDecrease?.playerId).toBe('p-galan')
    expect(bulletin.biggestDecrease?.move).toBe(-5)
    expect(bulletin.headline.playerId).toBe('p-triay')
    expect(bulletin.url).toBe('/rankings?gender=women&type=official&highlight=p-triay')
    expect(bulletin.year).toBe(YEAR)
    expect(bulletin.week).toBe(WEEK)
  })

  it('uses the climber photo when the avatar is on Supabase Storage', () => {
    const current = [snap({ player_id: 'p-tapia', ranking: 4 })]
    const previous = [snap({ player_id: 'p-tapia', ranking: 10, week: WEEK - 1 })]
    const bulletin = diffOfficialWeeks(current, previous, directory)!
    expect(bulletin.icon).toContain('supabase.co/storage')
  })

  it('ignores |move| < 2, including a new #1 who only climbed 1', () => {
    const current = [
      snap({ player_id: 'p-tapia', ranking: 1 }),
      snap({ player_id: 'p-coello', ranking: 3 }),
    ]
    const previous = [
      snap({ player_id: 'p-tapia', ranking: 2, week: WEEK - 1 }),
      snap({ player_id: 'p-coello', ranking: 4, week: WEEK - 1 }),
    ]
    expect(diffOfficialWeeks(current, previous, directory)).toBeNull()
  })

  it('includes a top-30 exit as the biggest drop and a top-30 entry as the biggest jump', () => {
    const current = [
      snap({ player_id: 'p-tapia', ranking: 1 }),
      snap({ player_id: 'p-galan', ranking: 35 }),
      snap({ player_id: 'p-ortega', ranking: 25, gender: 'women' }),
    ]
    const previous = [
      snap({ player_id: 'p-tapia', ranking: 1, week: WEEK - 1 }),
      snap({ player_id: 'p-galan', ranking: 28, week: WEEK - 1 }),
      snap({ player_id: 'p-ortega', ranking: 40, week: WEEK - 1, gender: 'women' }),
    ]
    const bulletin = diffOfficialWeeks(current, previous, directory)!
    expect(bulletin.biggestIncrease?.playerId).toBe('p-ortega')
    expect(bulletin.biggestIncrease?.move).toBe(15)
    expect(bulletin.biggestDecrease?.playerId).toBe('p-galan')
    expect(bulletin.biggestDecrease?.move).toBe(-7)
  })

  it('falls back to ranking_move when the previous week row is missing', () => {
    const current = [
      snap({ player_id: 'p-triay', ranking: 8, ranking_move: 6, gender: 'women' }),
    ]
    const bulletin = diffOfficialWeeks(current, [], directory)!
    expect(bulletin.biggestIncrease?.playerId).toBe('p-triay')
    expect(bulletin.biggestIncrease?.move).toBe(6)
    expect(bulletin.biggestDecrease).toBeNull()
  })

  it('headline falls back to the biggest drop when nobody climbed', () => {
    const current = [snap({ player_id: 'p-tapia', ranking: 12 })]
    const previous = [snap({ player_id: 'p-tapia', ranking: 4, week: WEEK - 1 })]
    const bulletin = diffOfficialWeeks(current, previous, directory)!
    expect(bulletin.biggestIncrease).toBeNull()
    expect(bulletin.headline.playerId).toBe('p-tapia')
    expect(bulletin.url).toContain('highlight=p-tapia')
  })

  it('uses the FIP circuit logo when the headline avatar is not on Supabase Storage', () => {
    const current = [snap({ player_id: 'p-triay', ranking: 8, gender: 'women' })]
    const previous = [snap({ player_id: 'p-triay', ranking: 14, week: WEEK - 1, gender: 'women' })]
    const bulletin = diffOfficialWeeks(current, previous, [
      player('p-triay', 'Gemma Triay', { avatar_url: 'https://www.premierpadel.com/triay.png' }),
    ])!
    expect(bulletin.icon).toBe('https://padelnachos.com/branding/fip-tour-icon.png')
  })
})

describe('composeRankingCopy', () => {
  it('en: generic title, body is biggest up then biggest down', () => {
    const b = diffOfficialWeeks(
      [
        snap({ player_id: 'p-triay', ranking: 8, gender: 'women' }),
        snap({ player_id: 'p-galan', ranking: 12 }),
      ],
      [
        snap({ player_id: 'p-triay', ranking: 14, week: WEEK - 1, gender: 'women' }),
        snap({ player_id: 'p-galan', ranking: 7, week: WEEK - 1 }),
      ],
      directory,
    )!
    const copy = composeRankingCopy(b, 'en')
    expect(copy.title).toBe('Ranking updates 🔥')
    expect(copy.body).toBe('Biggest moves\nTriay +6 to #8 · Galán -5 to #12')
  })

  it('omits the missing side when the week only has a jump or only a drop', () => {
    const upOnly = diffOfficialWeeks(
      [snap({ player_id: 'p-triay', ranking: 8, gender: 'women' })],
      [snap({ player_id: 'p-triay', ranking: 14, week: WEEK - 1, gender: 'women' })],
      directory,
    )!
    expect(composeRankingCopy(upOnly, 'en')).toEqual({
      title: 'Ranking updates 🔥',
      body: 'Biggest moves\nTriay +6 to #8',
    })
    const downOnly = diffOfficialWeeks(
      [snap({ player_id: 'p-tapia', ranking: 12 })],
      [snap({ player_id: 'p-tapia', ranking: 4, week: WEEK - 1 })],
      directory,
    )!
    expect(composeRankingCopy(downOnly, 'en').body).toBe('Biggest moves\nTapia -8 to #12')
  })

  it('pt / es / it / fr keep 🔥 on the title; body still uses names + signed move', () => {
    const b = diffOfficialWeeks(
      [snap({ player_id: 'p-triay', ranking: 8, gender: 'women' })],
      [snap({ player_id: 'p-triay', ranking: 14, week: WEEK - 1, gender: 'women' })],
      directory,
    )!
    expect(composeRankingCopy(b, 'pt').title).toBe('Atualização do ranking 🔥')
    expect(composeRankingCopy(b, 'es').title).toContain('🔥')
    expect(composeRankingCopy(b, 'it').title).toContain('🔥')
    expect(composeRankingCopy(b, 'fr').title).toContain('🔥')
    expect(composeRankingCopy(b, 'pt').body).toBe('Maiores movimentos\nTriay +6 para #8')
    expect(composeRankingCopy(b, 'es').body).toContain('Triay +6')
  })
})

describe('rankingFallbackCopy', () => {
  it('en fallback so Test still delivers when the week is flat', () => {
    const copy = rankingFallbackCopy('en')
    expect(copy.title).toBe('Ranking updates 🔥')
    expect(copy.body).toBe('No moves ≥2 in the top 30 this week.')
    expect(copy.url).toBe('/rankings?type=official')
    expect(copy.icon).toBe('https://padelnachos.com/branding/fip-tour-icon.png')
  })
})
