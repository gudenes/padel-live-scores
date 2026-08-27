import { describe, expect, it } from 'vitest'
import {
  composeEliminated,
  composeScheduled,
  formatPushTime,
  personalizeEliminated,
  personalizeScheduled,
  playerLastName,
} from '@/lib/push-copy'

const triay = { name: 'Gemma Triay Pons', display_name: 'Gemma Triay' }
const brea = { name: 'Paula Josemaria Brea', display_name: 'Paula Josemaría Brea' }

describe('playerLastName', () => {
  it('uses the last token of display_name when set (on-court rule)', () => {
    expect(playerLastName(triay)).toBe('Triay')
  })
  it('falls back to canonical name', () => {
    expect(playerLastName({ name: 'Arturo Coello', display_name: null })).toBe('Coello')
  })
  it('returns empty when both missing', () => {
    expect(playerLastName({ name: null, display_name: null })).toBe('')
  })
})

describe('formatPushTime', () => {
  // 2026-08-27 16:00 UTC = 18:00 in Brussels (CEST, UTC+2)
  const iso = '2026-08-27T16:00:00.000Z'

  it('formats 24h clock in the user timezone when provided', () => {
    expect(formatPushTime(iso, { userTimeZone: 'America/Sao_Paulo', tournamentTimeZone: 'Europe/Brussels' }))
      .toBe('13:00')
  })
  it('falls back to tournament clock + abbreviation when user tz is missing', () => {
    const out = formatPushTime(iso, { userTimeZone: null, tournamentTimeZone: 'Europe/Brussels' })
    expect(out.startsWith('18:00')).toBe(true)
    expect(out.length).toBeGreaterThan(5)
  })
  it('returns null when scheduled_at is missing', () => {
    expect(formatPushTime(null, { userTimeZone: 'UTC', tournamentTimeZone: 'UTC' })).toBeNull()
  })
})

describe('composeScheduled', () => {
  const base = {
    pair1: 'Triay/Brea',
    pair2: 'Ortega/Josemaría',
    tournament: 'Brussels P2',
    round: 'R16',
    court: 'Court 1',
    time: '18:00',
    playerName: 'Triay',
  }

  it('follow + time: name and clock in the title (en)', () => {
    const out = composeScheduled({ ...base, locale: 'en', reason: 'follow' })
    expect(out.title).toBe('Triay plays at 18:00')
    expect(out.body).toBe('Triay/Brea vs Ortega/Josemaría — Court 1 · Brussels P2 R16')
  })
  it('bookmark + time: generic title, same body (en)', () => {
    const out = composeScheduled({ ...base, locale: 'en', reason: 'bookmark' })
    expect(out.title).toBe('Match scheduled · 18:00')
  })
  it('follow without time drops the clock', () => {
    const out = composeScheduled({ ...base, locale: 'en', reason: 'follow', time: null })
    expect(out.title).toBe('Triay is scheduled')
  })
  it('pt follow uses 24h copy', () => {
    const out = composeScheduled({ ...base, locale: 'pt', reason: 'follow' })
    expect(out.title).toBe('Triay joga às 18:00')
  })
})

describe('composeEliminated', () => {
  const base = {
    playerName: 'Triay',
    score: '6-3, 6-4',
    opponent: 'Ortega/Josemaría',
    tournament: 'Brussels P2',
    round: 'QF',
    category: 'women' as const,
  }

  it('en: name + knocked out, score in the body', () => {
    const out = composeEliminated({ ...base, locale: 'en' })
    expect(out.title).toBe('Triay knocked out')
    expect(out.body).toBe('6-3, 6-4 vs Ortega/Josemaría — Brussels P2 QF')
  })
  it('pt women: eliminada', () => {
    expect(composeEliminated({ ...base, locale: 'pt' }).title).toBe('Triay eliminada')
  })
  it('pt men: eliminado', () => {
    expect(composeEliminated({ ...base, locale: 'pt', category: 'men', playerName: 'Tapia' }).title)
      .toBe('Tapia eliminado')
  })
  it('es women: eliminada', () => {
    expect(composeEliminated({ ...base, locale: 'es' }).title).toBe('Triay eliminada')
  })
})

const match = {
  id: 'm1',
  round: 'QF',
  court: 'Court 1',
  scheduled_at: '2026-08-27T16:00:00.000Z',
  category: 'women',
  winner_pair: 2,
  tournament: { name: 'Brussels P2', level: 'P2', timezone: 'Europe/Brussels' },
  pair1_player1: { id: 't', name: 'Gemma Triay Pons', display_name: 'Gemma Triay', avatar_url: 'https://img/triay.png' },
  pair1_player2: { id: 'b', name: 'Paula Brea', display_name: 'Paula Brea', avatar_url: null },
  pair2_player1: { id: 'o', name: 'Marta Ortega', display_name: 'Marta Ortega', avatar_url: null },
  pair2_player2: { id: 'j', name: 'Bea Gonzalez', display_name: 'Bea Gonzalez', avatar_url: null },
  sets: [
    { set_number: 1, set_score: '6-3', pair1_games: 6, pair2_games: 3 },
    { set_number: 2, set_score: '6-4', pair1_games: 6, pair2_games: 4 },
  ],
}

describe('personalizeScheduled', () => {
  it('follow uses the player name + avatar and user-local clock', () => {
    const out = personalizeScheduled(match, { locale: 'en', timeZone: 'America/Sao_Paulo', followedPlayerId: 't' })
    expect(out.title).toBe('Triay plays at 13:00')
    expect(out.iconReason).toBe('follow')
    expect(out.iconAvatarUrl).toBe('https://img/triay.png')
  })
  it('bookmark uses circuit-style title and no avatar', () => {
    const out = personalizeScheduled(match, { locale: 'en', timeZone: 'Europe/Brussels', followedPlayerId: null })
    expect(out.title).toBe('Match scheduled · 18:00')
    expect(out.iconReason).toBe('bookmark')
    expect(out.iconAvatarUrl).toBeNull()
  })
})

describe('personalizeEliminated', () => {
  it('names the followed player and the opponents', () => {
    const out = personalizeEliminated(match, { locale: 'en', followedPlayerId: 't' })
    expect(out?.title).toBe('Triay knocked out')
    expect(out?.body).toContain('6-3, 6-4 vs Ortega/Gonzalez')
    expect(out?.iconAvatarUrl).toBe('https://img/triay.png')
  })
  it('returns null when the user does not follow a player in the match', () => {
    expect(personalizeEliminated(match, { locale: 'en', followedPlayerId: null })).toBeNull()
  })
})
