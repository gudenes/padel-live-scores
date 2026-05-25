import { describe, it, expect, vi } from 'vitest';

// Mock Supabase so the top-level createClient call in route.ts doesn't fail
// during the test environment (no env vars set).
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}));

import { synthesizeGhostPartners } from '../route';

describe('synthesizeGhostPartners', () => {
  it('adds a ghost EntryPlayer for unresolved partners', () => {
    const teams = [
      {
        player1: {
          fipId: 'P000052', name: 'Juanlu Esbri', country: 'ES', seed: 7, drawType: 'main_draw' as const,
          partnerFipId: null, partnerName: 'Alejandro Ruiz Granados',
          resolvedPlayerId: 'u-esbri', resolvedPlayerName: 'Juanlu Esbri', resolutionMethod: 'fip_id' as const,
        },
        player2: null,
        seed: 7,
        drawType: 'main_draw' as const,
      },
    ];
    const out = synthesizeGhostPartners(teams);
    expect(out[0].player2).not.toBeNull();
    expect(out[0].player2!.name).toBe('Alejandro Ruiz Granados');
    expect(out[0].player2!.resolutionMethod).toBe('none');
    expect(out[0].player2!.fipId).toBeNull();
    expect((out[0].player2 as any).isGhostPartner).toBe(true);
  });

  it('leaves fully-resolved teams untouched', () => {
    const teams = [
      {
        player1: { fipId: 'P1', name: 'A', country: 'ES', seed: 1, drawType: 'main_draw' as const, partnerFipId: 'P2', partnerName: 'B', resolvedPlayerId: 'x', resolvedPlayerName: 'A', resolutionMethod: 'fip_id' as const },
        player2: { fipId: 'P2', name: 'B', country: 'ES', seed: null, drawType: 'main_draw' as const, partnerFipId: 'P1', partnerName: 'A', resolvedPlayerId: 'y', resolvedPlayerName: 'B', resolutionMethod: 'fip_id' as const },
        seed: 1, drawType: 'main_draw' as const,
      },
    ];
    const out = synthesizeGhostPartners(teams);
    expect((out[0].player2 as any).isGhostPartner).toBeUndefined();
  });
});
