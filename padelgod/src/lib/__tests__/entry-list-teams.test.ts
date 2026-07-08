import { describe, it, expect } from 'vitest';
import { buildEntryTeams, type EntrySnapshotInput } from '../entry-list-teams.js';

const base = { tournament_id: 't1', category: 'men' as const };

describe('buildEntryTeams', () => {
  it('collapses the two rows of a pair into one team with both countries', () => {
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'A', name: 'Galán', country: 'ES', seed: 1, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main_draw' },
      { ...base, fip_id: 'B', name: 'Chingotto', country: 'AR', seed: 1, partner_fip_id: 'A', partner_name: 'Galán', draw_type: 'main_draw' },
    ];
    const teams = buildEntryTeams(rows);
    expect(teams).toHaveLength(1);
    const t = teams[0];
    expect(t.fip1).toBe('A');
    expect(t.country1).toBe('ES');
    expect(t.fip2).toBe('B');
    expect(t.country2).toBe('AR');
    expect(t.seed).toBe(1);
    expect(t.draw_type).toBe('main_draw');
    expect(t.marker).toBeNull();
  });

  it('maps qualifying draw_type to a Q marker and nulls its per-draw seed', () => {
    // Qualifying rows carry a per-draw position in `seed` (1..M) that must NOT
    // render as a competitive seed alongside the main draw.
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'C', name: 'Peña', country: 'CL', seed: 1, partner_fip_id: 'D', partner_name: 'Giusto', draw_type: 'qualifying' },
      { ...base, fip_id: 'D', name: 'Giusto', country: 'AR', seed: 1, partner_fip_id: 'C', partner_name: 'Peña', draw_type: 'qualifying' },
    ];
    const teams = buildEntryTeams(rows);
    expect(teams).toHaveLength(1);
    expect(teams[0].marker).toBe('Q');
    expect(teams[0].seed).toBeNull();
  });

  it('falls back to partner_name (country null) when the partner has no own row', () => {
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'E', name: 'Solo', country: 'BR', seed: null, partner_fip_id: 'F', partner_name: 'Ghost', draw_type: 'main_draw' },
    ];
    const teams = buildEntryTeams(rows);
    expect(teams).toHaveLength(1);
    expect(teams[0].fip1).toBe('E');
    expect(teams[0].name2).toBe('Ghost');
    expect(teams[0].fip2).toBe('F');
    expect(teams[0].country2).toBeNull();
  });

  it('keeps a non-null seed when only one row of the pair carries it', () => {
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'A', name: 'Galán', country: 'ES', seed: 2, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main_draw' },
      { ...base, fip_id: 'B', name: 'Chingotto', country: 'AR', seed: null, partner_fip_id: 'A', partner_name: 'Galán', draw_type: 'main_draw' },
    ];
    expect(buildEntryTeams(rows)[0].seed).toBe(2);
  });

  it('isolates independent pairs into separate teams', () => {
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'A', name: 'Galán', country: 'ES', seed: 1, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main_draw' },
      { ...base, fip_id: 'B', name: 'Chingotto', country: 'AR', seed: 1, partner_fip_id: 'A', partner_name: 'Galán', draw_type: 'main_draw' },
      { ...base, fip_id: 'C', name: 'Coello', country: 'ES', seed: 2, partner_fip_id: 'D', partner_name: 'Tapia', draw_type: 'main_draw' },
      { ...base, fip_id: 'D', name: 'Tapia', country: 'AR', seed: 2, partner_fip_id: 'C', partner_name: 'Coello', draw_type: 'main_draw' },
    ];
    const teams = buildEntryTeams(rows);
    expect(teams).toHaveLength(2);
    const byKey = new Set(teams.map((t) => `${t.fip1}::${t.fip2}`));
    expect(byKey).toEqual(new Set(['A::B', 'C::D']));
  });
});
