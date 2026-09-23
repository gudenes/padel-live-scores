import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTournamentPayload, extractBuildId, stripNickname } from '../lib/ppl-source'

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/ppl-los-angeles-2026.json'), 'utf8'),
)

describe('extractBuildId', () => {
  it('pulls the buildId out of the __NEXT_DATA__ blob', () => {
    expect(extractBuildId('<script>{"buildId":"abc123","x":1}</script>')).toBe('abc123')
  })

  it('throws rather than returning a stale or empty id', () => {
    expect(() => extractBuildId('<html>no next data</html>')).toThrow(/buildId/)
  })
})

describe('parseTournamentPayload', () => {
  const t = parseTournamentPayload(FIXTURE, 'los-angeles-2026')

  it('reads the event header', () => {
    expect(t.slug).toBe('los-angeles-2026')
    expect(t.name).toBe('Los Angeles')
    expect(t.startDate).toBe('2026-08-13')
    expect(t.endDate).toBe('2026-08-16')
  })

  it('reads all ten franchises with branding', () => {
    expect(t.teams).toHaveLength(10)
    const miami = t.teams.find((x) => x.slug === 'miami-padel-club')!
    expect(miami.name).toBe('Miami Padel Club')
    expect(miami.location).toBe('Miami')
    expect(miami.brandColor).toBe('#0187d1')
    expect(miami.mensPlayerIds).toContain('alvaro-melendez-amaya')
    expect(miami.womensPlayerIds).toContain('anna-ortiz-gasco')
  })

  it('reads players with a usable display name and sex', () => {
    const tapia = t.players.find((p) => p.slug === 'agustin-tapia')!
    expect(tapia.name).toBe('Agustin Tapia')
    expect(tapia.sex).toBe('male')
    expect(tapia.league).toBe('ppl')
  })

  it('reads all 24 matches with both franchises and a category', () => {
    expect(t.matches).toHaveLength(24)
    const m = t.matches.find((x) => x.id === 'los-angeles-2026-d1-m1-mens')!
    expect(m.homeTeamSlug).toBe('toronto-polar-bears')
    expect(m.awayTeamSlug).toBe('las-vegas-smash')
    expect(m.category).toBe('men')
    expect(m.stage).toBe('Group Stage')
    expect(m.sessionNumber).toBe(1)
    expect(m.league).toBe('ppl')
  })

  it('maps game_type female to our women category', () => {
    const w = t.matches.find((x) => x.id === 'los-angeles-2026-d1-m1-womens')!
    expect(w.category).toBe('women')
  })

  it('leaves sessionNumber null on podium ties', () => {
    const podium = t.matches.find((x) => x.id === 'los-angeles-2026-podium-mens-first')!
    expect(podium.sessionNumber).toBeNull()
    expect(podium.stage).toBe('Championship')
  })

  it('carries no score data — that is Phase 2b', () => {
    for (const m of t.matches) expect(m).not.toHaveProperty('sets')
  })
})

// These three lock in the name-source decision. Without them the module
// passes its whole suite with the WRONG field preference — measured: reading
// firstName+lastName instead of displayName resolves 46 of 132 players
// against our database where displayName resolves 67, because upstream's
// split fields carry the two Spanish surnames in reverse order.
describe('player name source', () => {
  const t = parseTournamentPayload(FIXTURE, 'los-angeles-2026')

  it('strips a quoted nickname', () => {
    expect(stripNickname('Alejandro "Alex" Ruiz')).toBe('Alejandro Ruiz')
    expect(stripNickname('Leonel "Tolito" Aguirre')).toBe('Leonel Aguirre')
    expect(stripNickname('Federico Chingotto')).toBe('Federico Chingotto')
  })

  it('strips the nickname off a real roster entry', () => {
    // upstream: displayName 'Alejandro "Alex" Ruiz', firstName 'Alejandro "Alex"'
    expect(t.players.find((p) => p.slug === 'alejandro-alex-ruiz')!.name).toBe('Alejandro Ruiz')
  })

  it('keeps the displayName surname ORDER, not the reversed split fields', () => {
    // upstream: displayName 'Anna Ortiz Gasco' vs firstName+lastName 'Anna Gasco Ortiz'.
    // Spanish paternal surname comes first, and that is what our DB holds.
    expect(t.players.find((p) => p.slug === 'anna-ortiz-gasco')!.name).toBe('Anna Ortiz Gasco')
    expect(t.players.find((p) => p.slug === 'araceli-martinez-ibanez')!.name).toBe('Araceli Martinez Ibanez')
  })
})
