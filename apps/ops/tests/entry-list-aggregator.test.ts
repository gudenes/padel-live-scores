import { describe, it, expect } from 'vitest'
import { synthesizeGhostPartners, type EntryTeam } from '@/lib/entry-list-aggregator'

describe('synthesizeGhostPartners', () => {
  it('adds a ghost EntryPlayer for unresolved partners', () => {
    const teams: EntryTeam[] = [
      {
        player1: {
          fipId: 'P000052',
          name: 'Juanlu Esbri',
          country: 'ES',
          seed: 7,
          drawType: 'main_draw',
          partnerFipId: null,
          partnerName: 'Alejandro Ruiz Granados',
          resolvedPlayerId: 'u-esbri',
          resolvedPlayerName: 'Juanlu Esbri',
          resolutionMethod: 'fip_id',
        },
        player2: null,
        seed: 7,
        drawType: 'main_draw',
      },
    ]
    const out = synthesizeGhostPartners(teams)
    expect(out[0].player2).not.toBeNull()
    expect(out[0].player2!.name).toBe('Alejandro Ruiz Granados')
    expect(out[0].player2!.resolutionMethod).toBe('none')
    expect(out[0].player2!.fipId).toBeNull()
    expect(out[0].player2!.isGhostPartner).toBe(true)
  })

  it('leaves fully-resolved teams untouched', () => {
    const teams: EntryTeam[] = [
      {
        player1: {
          fipId: 'P1', name: 'A', country: 'ES', seed: 1, drawType: 'main_draw',
          partnerFipId: 'P2', partnerName: 'B',
          resolvedPlayerId: 'x', resolvedPlayerName: 'A', resolutionMethod: 'fip_id',
        },
        player2: {
          fipId: 'P2', name: 'B', country: 'ES', seed: null, drawType: 'main_draw',
          partnerFipId: 'P1', partnerName: 'A',
          resolvedPlayerId: 'y', resolvedPlayerName: 'B', resolutionMethod: 'fip_id',
        },
        seed: 1, drawType: 'main_draw',
      },
    ]
    const out = synthesizeGhostPartners(teams)
    expect(out[0].player2!.isGhostPartner).toBeUndefined()
  })

  it('leaves a solo player (no partnerName) untouched', () => {
    const teams: EntryTeam[] = [
      {
        player1: {
          fipId: 'P1', name: 'Solo', country: 'AL', seed: 7, drawType: 'main_draw',
          partnerFipId: null, partnerName: null,
          resolvedPlayerId: 'u-solo', resolvedPlayerName: 'Solo', resolutionMethod: 'fip_id',
        },
        player2: null,
        seed: 7,
        drawType: 'main_draw',
      },
    ]
    const out = synthesizeGhostPartners(teams)
    expect(out[0].player2).toBeNull()
  })
})
