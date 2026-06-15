import { describe, it, expect } from 'vitest';
import {
  selectProjectionCandidates,
  buildProjectionPayloads,
  type ActiveTournament,
  type ProjectionPairRow,
  type PlayerLite,
} from '../projection-ready-notifier.js';

describe('selectProjectionCandidates', () => {
  const active: ActiveTournament[] = [
    { id: 'T1', name: 'Valencia P1', level: 'p1' },
    { id: 'T2', name: 'Rome P2', level: 'p2' },
  ];
  it('returns (tournament,category) with projection rows, not already claimed', () => {
    const pairs: ProjectionPairRow[] = [
      { tournament_id: 'T1', category: 'men', pair_key: 'a::b', pair_player_ids: ['a', 'b'], champion_prob: 0.5 },
      { tournament_id: 'T1', category: 'women', pair_key: 'c::d', pair_player_ids: ['c', 'd'], champion_prob: 0.3 },
      { tournament_id: 'T2', category: 'men', pair_key: 'e::f', pair_player_ids: ['e', 'f'], champion_prob: 0.4 },
    ];
    const claimed = new Set(['T2:men']);  // already fired
    const out = selectProjectionCandidates(active, pairs, claimed);
    expect(out.map((c) => `${c.tournamentId}:${c.category}`).sort()).toEqual(['T1:men', 'T1:women']);
  });
  it('ignores projections for tournaments not in the active set (finished excluded upstream)', () => {
    const pairs: ProjectionPairRow[] = [
      { tournament_id: 'T9', category: 'men', pair_key: 'x::y', pair_player_ids: ['x', 'y'], champion_prob: 0.9 },
    ];
    expect(selectProjectionCandidates(active, pairs, new Set())).toEqual([]);
  });
});

describe('buildProjectionPayloads', () => {
  const tournament: ActiveTournament = { id: 'T1', name: 'Valencia P1', level: 'p1' };
  const pairs: ProjectionPairRow[] = [
    { tournament_id: 'T1', category: 'men', pair_key: 'galan::chingotto', pair_player_ids: ['idG', 'idC'], champion_prob: 0.30 },
    { tournament_id: 'T1', category: 'men', pair_key: 'coello::tapia', pair_player_ids: ['idCo', 'idT'], champion_prob: 0.55 },
  ];
  const players: Record<string, PlayerLite> = {
    idG: { id: 'idG', name: 'Ale Galan', avatar_url: 'g.png' },
    idC: { id: 'idC', name: 'Fede Chingotto', avatar_url: null },
    idCo: { id: 'idCo', name: 'Arturo Coello', avatar_url: 'co.png' },
    idT: { id: 'idT', name: 'Agustin Tapia', avatar_url: 't.png' },
  };

  it('emits one payload per player, pairs ordered by champion% desc, tournament-scoped dedupeKey', () => {
    const out = buildProjectionPayloads({ tournamentId: 'T1', category: 'men' }, tournament, pairs, players);
    expect(out.map((p) => p.entityId)).toEqual(['idCo', 'idT', 'idG', 'idC']);
    expect(out.every((p) => p.category === 'projection_ready')).toBe(true);
    expect(out.every((p) => p.entityType === 'player')).toBe(true);
    expect(out.every((p) => p.dedupeKey === 'projection_ready:tournament:T1')).toBe(true);
  });

  it('builds tournament-framed title, pair-framed body, per-pair url, and avatar icon with circuit fallback', () => {
    const out = buildProjectionPayloads({ tournamentId: 'T1', category: 'men' }, tournament, pairs, players);
    const coello = out.find((p) => p.entityId === 'idCo')!;
    expect(coello.title).toBe('Predictions for Valencia P1 are ready');
    expect(coello.body).toBe("See Coello / Tapia's road to the title →");
    expect(coello.url).toBe('/tournaments/T1/projection/coello-tapia');
    expect(coello.icon).toBe('co.png');
    const chingotto = out.find((p) => p.entityId === 'idC')!;
    expect(chingotto.icon).toBe('https://padelnachos.com/branding/premier-padel-star.png');
    expect(chingotto.url).toBe('/tournaments/T1/projection/chingotto-galan');
  });

  it('circuitIcon uses prefix matching: p1/p2/major/premier → premier star; fip_bronze → fip icon; fip_platinum → fip icon', () => {
    // p1 prefix → Premier (existing behaviour still holds)
    const t_p1: ActiveTournament = { id: 'X', name: 'Test P1', level: 'p1' };
    const pairP1: ProjectionPairRow[] = [
      { tournament_id: 'X', category: 'men', pair_key: 'a::b', pair_player_ids: ['idG', 'idC'], champion_prob: 0.5 },
    ];
    const outP1 = buildProjectionPayloads({ tournamentId: 'X', category: 'men' }, t_p1, pairP1, players);
    expect(outP1.find((p) => p.entityId === 'idC')!.icon).toBe('https://padelnachos.com/branding/premier-padel-star.png');

    // fip_bronze → FIP icon (prefix match excludes it from premier)
    const t_bronze: ActiveTournament = { id: 'X', name: 'Test Bronze', level: 'fip_bronze' };
    const pairBronze: ProjectionPairRow[] = [
      { tournament_id: 'X', category: 'men', pair_key: 'a::b', pair_player_ids: ['idG', 'idC'], champion_prob: 0.5 },
    ];
    const outBronze = buildProjectionPayloads({ tournamentId: 'X', category: 'men' }, t_bronze, pairBronze, players);
    expect(outBronze.find((p) => p.entityId === 'idC')!.icon).toBe('https://padelnachos.com/branding/fip-tour-icon.png');

    // fip_platinum — NOT Premier circuit (prefix doesn't match p1/p2/major/premier)
    const t_platinum: ActiveTournament = { id: 'X', name: 'Test Platinum', level: 'fip_platinum' };
    const pairPlatinum: ProjectionPairRow[] = [
      { tournament_id: 'X', category: 'men', pair_key: 'a::b', pair_player_ids: ['idG', 'idC'], champion_prob: 0.5 },
    ];
    const outPlatinum = buildProjectionPayloads({ tournamentId: 'X', category: 'men' }, t_platinum, pairPlatinum, players);
    expect(outPlatinum.find((p) => p.entityId === 'idC')!.icon).toBe('https://padelnachos.com/branding/fip-tour-icon.png');
  });

  it('skips pairs where any player is missing from playersById, but still emits complete pairs', () => {
    const pairsWithGap: ProjectionPairRow[] = [
      // complete pair — both players known
      { tournament_id: 'T1', category: 'men', pair_key: 'galan::chingotto', pair_player_ids: ['idG', 'idC'], champion_prob: 0.30 },
      // broken pair — 'idUnknown' not in playersById
      { tournament_id: 'T1', category: 'men', pair_key: 'coello::unknown', pair_player_ids: ['idCo', 'idUnknown'], champion_prob: 0.55 },
    ];
    const out = buildProjectionPayloads({ tournamentId: 'T1', category: 'men' }, tournament, pairsWithGap, players);
    // Only the complete pair should emit payloads (2 players × 1 pair = 2 payloads)
    expect(out.length).toBe(2);
    expect(out.map((p) => p.entityId).sort()).toEqual(['idC', 'idG']);
    // The broken pair (idCo, idUnknown) must not appear at all
    expect(out.some((p) => p.entityId === 'idUnknown')).toBe(false);
    expect(out.some((p) => p.entityId === 'idCo')).toBe(false);
  });
});
