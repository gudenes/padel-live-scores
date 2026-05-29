import { describe, it, expect } from 'vitest'
import { resolveNextEnrollment, type EntrySnapshotRow, type UpcomingTournament } from '../next-enrollment-resolver'

const NOW = new Date('2026-05-29T12:00:00Z')

function tourn(over: Partial<UpcomingTournament> & { id: string }): UpcomingTournament {
  return { id: over.id, name: over.name ?? 'T', level: over.level ?? 'major', starts_at: over.starts_at ?? '2026-05-31T00:00:00Z', ends_at: over.ends_at ?? '2026-06-02T00:00:00Z' }
}
function row(over: Partial<EntrySnapshotRow> & { tournament_id: string; scrape_job_id: string; name: string; captured_at: string }): EntrySnapshotRow {
  return { category: 'men', draw_type: 'main_draw', fip_id: null, seed: null, partner_name: null, ...over }
}

describe('resolveNextEnrollment', () => {
  it('matches by fip_id ignoring the fip- prefix mismatch', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P000036', normalizedName: 'lucas bergamini' },
      tournaments: [tourn({ id: 't1', name: 'Italy Major' })],
      snapshots: [row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'L. Bergamini', fip_id: 'fip-P000036', seed: 8, partner_name: 'Javi Garrido', captured_at: '2026-05-29T10:00:00Z' })],
      now: NOW,
    })
    expect(res?.tournamentId).toBe('t1')
    expect(res?.seed).toBe(8)
    expect(res?.partnerName).toBe('Javi Garrido')
  })

  it('honors withdrawals — only the latest scrape_job per (tournament,category) counts', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P000036', normalizedName: 'lucas bergamini' },
      tournaments: [tourn({ id: 't1' })],
      snapshots: [
        row({ tournament_id: 't1', scrape_job_id: 'j2', name: 'Someone Else', fip_id: 'P999', captured_at: '2026-05-29T11:00:00Z' }),
        row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'L. Bergamini', fip_id: 'P000036', captured_at: '2026-05-29T09:00:00Z' }),
      ],
      now: NOW,
    })
    expect(res).toBeNull()
  })

  it('prefers a future-starting tournament over an in-progress one', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P1', normalizedName: 'x' },
      tournaments: [
        tourn({ id: 'inprogress', starts_at: '2026-05-24T00:00:00Z', ends_at: '2026-05-30T00:00:00Z' }),
        tourn({ id: 'future', starts_at: '2026-05-31T00:00:00Z', ends_at: '2026-06-02T00:00:00Z' }),
      ],
      snapshots: [
        row({ tournament_id: 'inprogress', scrape_job_id: 'a', name: 'P', fip_id: 'P1', captured_at: '2026-05-29T10:00:00Z' }),
        row({ tournament_id: 'future', scrape_job_id: 'b', name: 'P', fip_id: 'P1', captured_at: '2026-05-29T10:00:00Z' }),
      ],
      now: NOW,
    })
    expect(res?.tournamentId).toBe('future')
  })

  it('falls back to an in-progress tournament when there is no future enrollment', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P1', normalizedName: 'x' },
      tournaments: [tourn({ id: 'inprogress', starts_at: '2026-05-24T00:00:00Z', ends_at: '2026-05-30T00:00:00Z' })],
      snapshots: [row({ tournament_id: 'inprogress', scrape_job_id: 'a', name: 'P', fip_id: 'P1', captured_at: '2026-05-29T10:00:00Z' })],
      now: NOW,
    })
    expect(res?.tournamentId).toBe('inprogress')
  })

  it('picks the soonest upcoming tournament', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P1', normalizedName: 'x' },
      tournaments: [
        tourn({ id: 'later', starts_at: '2026-06-10T00:00:00Z', ends_at: '2026-06-12T00:00:00Z' }),
        tourn({ id: 'sooner', starts_at: '2026-05-31T00:00:00Z', ends_at: '2026-06-02T00:00:00Z' }),
      ],
      snapshots: [
        row({ tournament_id: 'later', scrape_job_id: 'a', name: 'P', fip_id: 'P1', captured_at: '2026-05-29T10:00:00Z' }),
        row({ tournament_id: 'sooner', scrape_job_id: 'b', name: 'P', fip_id: 'P1', captured_at: '2026-05-29T10:00:00Z' }),
      ],
      now: NOW,
    })
    expect(res?.tournamentId).toBe('sooner')
  })

  it('excludes tournaments that have already ended', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P1', normalizedName: 'x' },
      tournaments: [tourn({ id: 'past', starts_at: '2026-05-01T00:00:00Z', ends_at: '2026-05-03T00:00:00Z' })],
      snapshots: [row({ tournament_id: 'past', scrape_job_id: 'a', name: 'P', fip_id: 'P1', captured_at: '2026-05-01T00:00:00Z' })],
      now: NOW,
    })
    expect(res).toBeNull()
  })

  it('falls back to normalized-name match when fip_id is absent', () => {
    const res = resolveNextEnrollment({
      player: { fipId: null, normalizedName: 'lucas bergamini' },
      tournaments: [tourn({ id: 't1' })],
      snapshots: [row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'Lúcas  Bergamini', fip_id: null, captured_at: '2026-05-29T10:00:00Z' })],
      now: NOW,
    })
    expect(res?.tournamentId).toBe('t1')
  })

  it('does NOT name-match a different person when the player has a known fip_id', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P_KNOWN', normalizedName: 'john doe' },
      tournaments: [tourn({ id: 't1' })],
      snapshots: [row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'John Doe', fip_id: null, captured_at: '2026-05-29T10:00:00Z' })],
      now: NOW,
    })
    expect(res).toBeNull()
  })

  it('prefers the main_draw row for seed/partner when both draws list the player', () => {
    const res = resolveNextEnrollment({
      player: { fipId: 'P1', normalizedName: 'x' },
      tournaments: [tourn({ id: 't1' })],
      snapshots: [
        row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'P', fip_id: 'P1', draw_type: 'qualifying', seed: null, captured_at: '2026-05-29T10:00:00Z' }),
        row({ tournament_id: 't1', scrape_job_id: 'j1', name: 'P', fip_id: 'P1', draw_type: 'main_draw', seed: 3, partner_name: 'Mate', captured_at: '2026-05-29T10:00:00Z' }),
      ],
      now: NOW,
    })
    expect(res?.drawType).toBe('main_draw')
    expect(res?.seed).toBe(3)
  })
})
