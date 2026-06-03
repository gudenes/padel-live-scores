import { describe, it, expect } from 'vitest'
import {
  deriveStage, computeReadiness, isPremierTier, IN_SCOPE_TIERS,
  type TournamentRollup,
} from '@/lib/readiness'

const TODAY = '2026-06-03'

// A fully-healthy completed FIP Bronze event.
function healthyCompletedFip(): TournamentRollup {
  return {
    id: 't-ok', level: 'fip_bronze',
    startsAt: '2026-03-02', endsAt: '2026-03-08', registrationStatus: 'closed',
    finalPlayed: true,
    matchCount: 60, liveOrScheduledCount: 0,
    finishedCount: 60, finishedWithWinner: 60,
    playerSlotsTotal: 240, playerSlotsResolved: 240,
    oopPopulated: 60,
    hasMatchStats: false, entryListResolved: true, hasStreams: false,
    drawSnapshotAt: '2026-03-02', oopSnapshotAt: '2026-03-05', resultsSnapshotAt: '2026-03-08',
  }
}

describe('isPremierTier', () => {
  it('classifies Premier tiers', () => {
    expect(isPremierTier('p1')).toBe(true)
    expect(isPremierTier('major')).toBe(true)
    expect(isPremierTier('fip_bronze')).toBe(false)
    expect(isPremierTier(null)).toBe(false)
  })
  it('IN_SCOPE_TIERS excludes fip_other', () => {
    expect(IN_SCOPE_TIERS).not.toContain('fip_other')
    expect(IN_SCOPE_TIERS).toContain('fip_bronze')
  })
})

describe('deriveStage', () => {
  it('completed when finalPlayed', () => {
    const r = { ...healthyCompletedFip(), endsAt: '2026-12-31', finalPlayed: true }
    expect(deriveStage(r, TODAY)).toBe('completed')
  })
  it('completed when ends_at in the past', () => {
    const r = { ...healthyCompletedFip(), finalPlayed: false, endsAt: '2026-05-01' }
    expect(deriveStage(r, TODAY)).toBe('completed')
  })
  it('ongoing when within the date window', () => {
    const r = { ...healthyCompletedFip(), finalPlayed: false, startsAt: '2026-06-01', endsAt: '2026-06-07' }
    expect(deriveStage(r, TODAY)).toBe('ongoing')
  })
  it('ongoing when it has live/scheduled matches even outside the window', () => {
    const r = { ...healthyCompletedFip(), finalPlayed: false, startsAt: '2026-06-20', endsAt: '2026-06-26', liveOrScheduledCount: 12 }
    expect(deriveStage(r, TODAY)).toBe('ongoing')
  })
  it('upcoming when start is in the future and nothing has played', () => {
    const r = { ...healthyCompletedFip(), finalPlayed: false, startsAt: '2026-08-01', endsAt: '2026-08-07', liveOrScheduledCount: 0, matchCount: 0, finishedCount: 0, finishedWithWinner: 0 }
    expect(deriveStage(r, TODAY)).toBe('upcoming')
  })
})

describe('computeReadiness', () => {
  const cell = (res: ReturnType<typeof computeReadiness>, key: string) =>
    res.dimensions.find(d => d.key === key)!.state

  it('healthy completed FIP → OK, no divergence', () => {
    const res = computeReadiness(healthyCompletedFip(), TODAY)
    expect(res.stage).toBe('completed')
    expect(res.verdict).toBe('ok')
    expect(res.divergent).toBe(false)
    expect(cell(res, 'stats')).toBe('na')   // FIP → N/A
    expect(cell(res, 'matches')).toBe('ok')
  })

  it('Ijuí case: snapshots present but 0 matches → Broken + divergent', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-ijui',
      matchCount: 0, finishedCount: 0, finishedWithWinner: 0,
      playerSlotsTotal: 0, playerSlotsResolved: 0, oopPopulated: 0,
      drawSnapshotAt: '2026-04-26', oopSnapshotAt: '2026-04-26', resultsSnapshotAt: '2026-04-26',
    }
    const res = computeReadiness(r, TODAY)
    expect(res.verdict).toBe('broken')
    expect(res.divergent).toBe(true)
    expect(cell(res, 'matches')).toBe('divergent')
    expect(cell(res, 'results')).toBe('divergent')
  })

  it('Premier ongoing missing stats → Gaps, never Broken', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-p1', level: 'p1',
      finalPlayed: false, startsAt: '2026-06-01', endsAt: '2026-06-07',
      hasMatchStats: false,
      finishedCount: 20, finishedWithWinner: 20,
    }
    const res = computeReadiness(r, TODAY)
    expect(res.stage).toBe('ongoing')
    expect(cell(res, 'stats')).toBe('missing')
    expect(res.verdict).toBe('gaps')
  })

  it('completed event with matches but zero winners → Broken (results required)', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-nowin',
      finishedCount: 60, finishedWithWinner: 0,
      resultsSnapshotAt: null,
    }
    const res = computeReadiness(r, TODAY)
    expect(cell(res, 'results')).toBe('missing')
    expect(res.verdict).toBe('broken')
  })

  it('upcoming event is not penalised for empty matches/results', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-up', finalPlayed: false,
      startsAt: '2026-08-01', endsAt: '2026-08-07',
      matchCount: 0, liveOrScheduledCount: 0, finishedCount: 0, finishedWithWinner: 0,
      playerSlotsTotal: 0, playerSlotsResolved: 0, oopPopulated: 0,
      drawSnapshotAt: null, oopSnapshotAt: null, resultsSnapshotAt: null,
      entryListResolved: true,
    }
    const res = computeReadiness(r, TODAY)
    expect(res.stage).toBe('upcoming')
    expect(cell(res, 'matches')).toBe('missing')
    expect(res.verdict).toBe('ok')
    expect(cell(res, 'players')).toBe('na')
  })

  it('partial player resolution during ongoing → Gaps', () => {
    const r: TournamentRollup = {
      ...healthyCompletedFip(), id: 't-part', finalPlayed: false,
      startsAt: '2026-06-01', endsAt: '2026-06-07',
      playerSlotsTotal: 240, playerSlotsResolved: 120,
      finishedCount: 20, finishedWithWinner: 20,
      hasMatchStats: true,
    }
    const res = computeReadiness(r, TODAY)
    expect(cell(res, 'players')).toBe('partial')
    expect(res.verdict).toBe('gaps')
  })
})
