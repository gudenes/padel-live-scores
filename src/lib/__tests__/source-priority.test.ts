import { describe, it, expect } from 'vitest'
import {
  shouldOverwrite,
  primarySourceFor,
  prioritiesFor,
  isPrimaryOwner,
  isListedSource,
  filterUpdateByPriority,
  SOURCE_PRIORITY,
} from '../source-priority'

describe('shouldOverwrite', () => {
  // ── Empty-field / same-source base cases ───────────────────

  it('allows writing to an empty field', () => {
    expect(shouldOverwrite('player.name', null, 'padelapi')).toBe(true)
    expect(shouldOverwrite('player.name', undefined, 'fip')).toBe(true)
  })

  it('allows refreshing from the same source', () => {
    expect(shouldOverwrite('player.name', 'padelapi', 'padelapi')).toBe(true)
    expect(shouldOverwrite('player.ranking', 'fip_official', 'fip_official')).toBe(true)
  })

  // ── Priority ordering ──────────────────────────────────────

  it('allows higher-priority source to overwrite lower-priority', () => {
    // player.name = ['fip', 'padelapi', 'manual'] — fip wins over padelapi
    // (flipped 2026-05-07: FIP is now canonical for player identity)
    expect(shouldOverwrite('player.name', 'padelapi', 'fip')).toBe(true)
  })

  it('rejects lower-priority source from overwriting higher', () => {
    expect(shouldOverwrite('player.name', 'fip', 'padelapi')).toBe(false)
  })

  it('treats equal-priority sources as winners (ties go to attempt)', () => {
    // shouldOverwrite returns true when attempting index ≤ current index
    expect(shouldOverwrite('player.name', 'fip', 'fip')).toBe(true)
  })

  // ── Ranking fields are FIP-authoritative ───────────────────

  it('fip_official beats padelapi for player.ranking', () => {
    expect(shouldOverwrite('player.ranking', 'padelapi', 'fip_official')).toBe(true)
  })

  it('padelapi cannot overwrite fip_official ranking', () => {
    expect(shouldOverwrite('player.ranking', 'fip_official', 'padelapi')).toBe(false)
  })

  it('fip (scraped) is higher than padelapi for ranking', () => {
    expect(shouldOverwrite('player.ranking', 'padelapi', 'fip')).toBe(true)
  })

  it('fip_official beats fip (scraped) for ranking', () => {
    expect(shouldOverwrite('player.ranking', 'fip', 'fip_official')).toBe(true)
  })

  // ── Tournament fields: different ownership per field ──────

  it('padelapi owns tournament.name', () => {
    expect(shouldOverwrite('tournament.name', 'fip', 'padelapi')).toBe(true)
    expect(shouldOverwrite('tournament.name', 'padelapi', 'fip')).toBe(false)
  })

  it('fip owns tournament.logo_url', () => {
    expect(shouldOverwrite('tournament.logo_url', 'padelapi', 'fip')).toBe(true)
    expect(shouldOverwrite('tournament.logo_url', 'fip', 'padelapi')).toBe(false)
  })

  it('fip owns draw sizes', () => {
    expect(shouldOverwrite('tournament.draw_size_md', 'padelapi', 'fip')).toBe(true)
    expect(shouldOverwrite('tournament.draw_size_qd', 'padelapi', 'fip')).toBe(true)
  })

  // ── Match fields: padelapi-exclusive ──────────────────────

  it('rejects fip attempts to write match scores', () => {
    // match.sets has no fip in the priority list → fip is rejected
    expect(shouldOverwrite('match.sets', 'padelapi', 'fip')).toBe(false)
  })

  it('rejects fip attempts to write match.status', () => {
    expect(shouldOverwrite('match.status', 'padelapi', 'fip')).toBe(false)
  })

  it('allows simulated to write match.sets when match belongs to simulator', () => {
    expect(shouldOverwrite('match.sets', 'simulated', 'simulated')).toBe(true)
  })

  // ── Unknown sources / fields ──────────────────────────────

  it('rejects unknown source attempting to overwrite known source', () => {
    // 'youtube' is not in the player.name priority list → should lose to padelapi
    expect(shouldOverwrite('player.name', 'padelapi', 'youtube' as never)).toBe(false)
  })

  it('allows known source to replace an unknown previous source', () => {
    expect(shouldOverwrite('player.name', 'youtube' as never, 'padelapi')).toBe(true)
  })

  it('unknown field key defaults to permissive', () => {
    // @ts-expect-error intentional invalid field for default-permissive test
    expect(shouldOverwrite('player.nonexistent_field', 'padelapi', 'fip')).toBe(true)
  })
})

describe('primarySourceFor', () => {
  it('returns the first source in the priority list', () => {
    expect(primarySourceFor('player.ranking')).toBe('fip_official')
    // FIP is now canonical for player identity (flipped 2026-05-07).
    expect(primarySourceFor('player.name')).toBe('fip')
    expect(primarySourceFor('tournament.logo_url')).toBe('fip')
    expect(primarySourceFor('match.sets')).toBe('padelapi')
  })

  it('keeps padelapi-primary on enrichment fields where padelapi is authoritative', () => {
    // avatar_url: padelapi-hosted on Supabase Storage, higher quality
    expect(primarySourceFor('player.avatar_url')).toBe('padelapi')
    // career stats: FIP doesn't compute these
    expect(primarySourceFor('player.win_rate')).toBe('padelapi')
    expect(primarySourceFor('player.total_matches')).toBe('padelapi')
    expect(primarySourceFor('player.titles')).toBe('padelapi')
  })
})

describe('prioritiesFor', () => {
  it('returns the full list in order', () => {
    // FIP-primary for identity (flipped 2026-05-07).
    expect(prioritiesFor('player.name')).toEqual(['fip', 'padelapi', 'manual'])
    expect(prioritiesFor('player.country')).toEqual(['fip', 'padelapi', 'manual'])
    expect(prioritiesFor('tournament.draw_size_md')).toEqual(['fip', 'padelapi'])
  })
})

describe('isPrimaryOwner', () => {
  it('returns true for the top of the priority list', () => {
    // After the FIP-canonical flip (2026-05-07): FIP owns identity.
    expect(isPrimaryOwner('player.name', 'fip')).toBe(true)
    expect(isPrimaryOwner('player.ranking', 'fip_official')).toBe(true)
    expect(isPrimaryOwner('tournament.logo_url', 'fip')).toBe(true)
    // padelapi still primary for enrichment fields it authoritatively owns
    expect(isPrimaryOwner('player.avatar_url', 'padelapi')).toBe(true)
    expect(isPrimaryOwner('player.win_rate', 'padelapi')).toBe(true)
  })
  it('returns false for non-primary sources', () => {
    expect(isPrimaryOwner('player.name', 'padelapi')).toBe(false)
    expect(isPrimaryOwner('tournament.logo_url', 'padelapi')).toBe(false)
  })
})

describe('isListedSource', () => {
  it('returns true for any source in the list', () => {
    expect(isListedSource('player.name', 'padelapi')).toBe(true)
    expect(isListedSource('player.name', 'fip')).toBe(true)
    expect(isListedSource('player.name', 'manual')).toBe(true)
  })
  it('returns false for sources not in the list', () => {
    expect(isListedSource('match.sets', 'fip')).toBe(false)
    expect(isListedSource('player.name', 'youtube')).toBe(false)
  })
})

describe('filterUpdateByPriority', () => {
  it('strict mode: keeps fields where source is the primary owner — FIP-primary for identity', () => {
    // FIP trying to update a player — after the 2026-05-07 flip, FIP is
    // primary for identity fields and can write them in strict mode.
    const fipPayload = {
      name: 'Player Name',         // primary: fip → KEPT
      country: 'ES',               // primary: fip → KEPT
      ranking: 5,                  // primary: fip_official → STRIPPED
      birthdate: '2000-01-01',     // primary: fip → KEPT
      birthplace: 'Madrid',        // primary: fip → KEPT
      avatar_url: 'http://x.png',  // primary: padelapi → STRIPPED
    }
    const result = filterUpdateByPriority(fipPayload, 'player', 'fip')
    expect(result).toEqual({
      name: 'Player Name',
      country: 'ES',
      birthdate: '2000-01-01',
      birthplace: 'Madrid',
    })
  })

  it('strict mode: padelapi keeps only enrichment fields, NOT identity', () => {
    // After the FIP-canonical flip, padelapi can no longer overwrite name /
    // country / category — those belong to FIP. Padelapi keeps avatar (better
    // hosting), win_rate, total_matches, titles, finals.
    const payload = {
      name: 'Name',          // primary: fip → STRIPPED
      country: 'AR',         // primary: fip → STRIPPED
      avatar_url: 'x.png',   // primary: padelapi → KEPT
      ranking: 5,            // primary: fip_official → STRIPPED
      win_rate: 80,          // primary: padelapi → KEPT
      total_matches: 100,    // primary: padelapi → KEPT
    }
    const result = filterUpdateByPriority(payload, 'player', 'padelapi')
    expect(result).toEqual({
      avatar_url: 'x.png',
      win_rate: 80,
      total_matches: 100,
    })
  })

  it('writable mode: keeps fields where source is listed anywhere', () => {
    const payload = {
      name: 'Name',        // fip is primary now → KEPT
      ranking: 5,          // fip is listed → KEPT
      win_rate: 80,        // fip not listed → STRIPPED
    }
    const result = filterUpdateByPriority(payload, 'player', 'fip', 'writable')
    expect(result).toEqual({
      name: 'Name',
      ranking: 5,
    })
  })

  it('strips fields the source cannot write in any mode', () => {
    // FIP cannot write match.sets at all
    const payload = { sets: [{ pair1: 6, pair2: 4 }], status: 'finished' }
    const result = filterUpdateByPriority(payload, 'match', 'fip')
    expect(result).toEqual({})
  })

  it('passes unknown field keys through unchanged', () => {
    // Use a non-primary field to demonstrate stripping; after the FIP-canonical
    // flip, 'name' is fip-primary so it survives and isn't useful here.
    const payload = { win_rate: 80, made_up_field: 'whatever' }
    const result = filterUpdateByPriority(payload, 'player', 'fip')
    // 'win_rate' stripped (padelapi-primary), 'made_up_field' passes through
    expect(result).toEqual({ made_up_field: 'whatever' })
  })

  it('tournament: fip can write logo but not name in strict mode', () => {
    const payload = {
      name: 'Tournament Name',
      logo_url: 'https://fip.com/logo.png',
      prize_money_fip: 50000,
    }
    const result = filterUpdateByPriority(payload, 'tournament', 'fip')
    expect(result).toEqual({
      logo_url: 'https://fip.com/logo.png',
      prize_money_fip: 50000,
    })
  })
})

describe('SOURCE_PRIORITY integrity', () => {
  it('every field has at least one source', () => {
    for (const [field, list] of Object.entries(SOURCE_PRIORITY)) {
      expect(list.length, `${field} has no sources`).toBeGreaterThan(0)
    }
  })

  it('no field has duplicate sources in its priority list', () => {
    for (const [field, list] of Object.entries(SOURCE_PRIORITY)) {
      const unique = new Set(list)
      expect(unique.size, `${field} has duplicate sources`).toBe(list.length)
    }
  })

  it('match.sets specifically excludes fip (fip has no live scoring)', () => {
    expect(SOURCE_PRIORITY['match.sets']).not.toContain('fip')
  })

  it('player.ranking starts with fip_official', () => {
    expect(SOURCE_PRIORITY['player.ranking'][0]).toBe('fip_official')
  })
})
