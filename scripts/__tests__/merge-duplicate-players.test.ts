import { describe, it, expect } from 'vitest';
import {
  normalizeFipId,
  groupKey,
  selectSurvivor,
  buildMergePayload,
  type PlayerRow,
} from '../merge-duplicate-players.ts';

describe('normalizeFipId', () => {
  it('strips fip- prefix when present', () => {
    expect(normalizeFipId('fip-P203884')).toBe('P203884');
    expect(normalizeFipId('P203884')).toBe('P203884');
  });
  it('returns null for null input', () => {
    expect(normalizeFipId(null)).toBeNull();
  });
});

describe('groupKey', () => {
  it('uses lowercased name + category, accent-insensitive', () => {
    expect(groupKey('Maximiliano Arce Simó', 'men')).toBe(
      groupKey('maximiliano arce simo', 'men'),
    );
  });
  it('treats different categories as different groups', () => {
    expect(groupKey('Test Name', 'men')).not.toBe(groupKey('Test Name', 'women'));
  });
  it('handles null name and category', () => {
    expect(groupKey(null, null)).toBe('|');
  });
});

const row = (overrides: Partial<PlayerRow>): PlayerRow => ({
  id: 'uuid-default',
  fip_id: null,
  name: 'Test',
  category: 'men',
  ranking: null,
  birthdate: null,
  birthplace: null,
  height: null,
  coaches: null,
  equipment: null,
  profile_url: null,
  country: null,
  ...overrides,
});

describe('selectSurvivor', () => {
  it('case 1: prefix vs no-prefix → NON-PREFIXED survives', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203884' });
    const b = row({ id: 'b', fip_id: 'P203884' });
    const r = selectSurvivor([a, b]);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.survivor.id).toBe('b');
      expect(r.losers.map(l => l.id)).toEqual(['a']);
    }
  });

  it('case 2: prefix + no-prefix + null fip_id → non-prefixed survives, both others lose', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203884' });
    const b = row({ id: 'b', fip_id: 'P203884' });
    const c = row({ id: 'c', fip_id: null });
    const r = selectSurvivor([a, b, c]);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.survivor.id).toBe('b');
      expect(r.losers.map(l => l.id).sort()).toEqual(['a', 'c']);
    }
  });

  it('case 3: two NULL-fip_id rows → most-populated row wins', () => {
    const a = row({ id: 'a', fip_id: null, ranking: 100, birthdate: '1999-01-01' });
    const b = row({ id: 'b', fip_id: null, ranking: 200 });
    const r = selectSurvivor([a, b]);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.survivor.id).toBe('a'); // 2 fields populated > 1
    }
  });

  it('case 4: distinct fip_ids that are NOT prefix variants → review', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203211' });
    const b = row({ id: 'b', fip_id: 'fip-P216185' });
    const r = selectSurvivor([a, b]);
    expect(r.kind).toBe('review');
    if (r.kind === 'review') {
      expect(r.reason).toMatch(/distinct fip_ids/);
    }
  });

  it('case 5: prefix variants PLUS an unrelated id → review', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203211' });
    const b = row({ id: 'b', fip_id: 'P203211' });
    const c = row({ id: 'c', fip_id: 'fip-P999999' });
    const r = selectSurvivor([a, b, c]);
    expect(r.kind).toBe('review');
  });

  it('case 6: only non-prefixed rows + a null → most-populated non-prefixed survives', () => {
    const a = row({ id: 'a', fip_id: 'P203884', ranking: 45 });
    const b = row({ id: 'b', fip_id: null });
    const r = selectSurvivor([a, b]);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.survivor.id).toBe('a');
      expect(r.losers.map(l => l.id)).toEqual(['b']);
    }
  });

  it('case 7: only PREFIXED rows + a null → most-populated prefixed survives (legacy fallback)', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203884', ranking: 45 });
    const b = row({ id: 'b', fip_id: null });
    const r = selectSurvivor([a, b]);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.survivor.id).toBe('a');
      expect(r.losers.map(l => l.id)).toEqual(['b']);
    }
  });
});

describe('buildMergePayload', () => {
  it('copies populated fields from losers into survivor where survivor is NULL', () => {
    const survivor = row({ id: 's', fip_id: 'fip-P1', ranking: null, birthdate: null });
    const losers = [
      row({ id: 'l1', fip_id: 'P1', ranking: 45, birthdate: '1999-01-01', height: 180 }),
    ];
    const payload = buildMergePayload(survivor, losers);
    expect(payload.ranking).toBe(45);
    expect(payload.birthdate).toBe('1999-01-01');
    expect(payload.height).toBe(180);
  });

  it('preserves survivor values when survivor already has them', () => {
    const survivor = row({ id: 's', fip_id: 'fip-P1', ranking: 10, birthdate: '1990-01-01' });
    const losers = [row({ id: 'l1', fip_id: 'P1', ranking: 99, birthdate: '2000-01-01' })];
    const payload = buildMergePayload(survivor, losers);
    expect(payload.ranking).toBeUndefined();
    expect(payload.birthdate).toBeUndefined();
  });

  it('returns empty payload when survivor is fully populated', () => {
    const survivor = row({
      id: 's',
      fip_id: 'fip-P1',
      ranking: 10,
      birthdate: '1990-01-01',
      height: 180,
      birthplace: 'Madrid',
      coaches: ['C'],
      equipment: { brand: 'B' },
      profile_url: 'u',
      country: 'AR',
    });
    const losers = [row({ id: 'l1', fip_id: 'P1' })];
    const payload = buildMergePayload(survivor, losers);
    expect(Object.keys(payload).length).toBe(0);
  });

  it('treats empty arrays as missing (so loser values can override [])', () => {
    const survivor = row({ id: 's', fip_id: 'fip-P1', coaches: [] });
    const losers = [row({ id: 'l1', fip_id: 'P1', coaches: ['Coach A'] })];
    const payload = buildMergePayload(survivor, losers);
    expect(payload.coaches).toEqual(['Coach A']);
  });
});
