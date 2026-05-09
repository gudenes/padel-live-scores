import { describe, it, expect } from 'vitest';
import { buildPlayerProfileUpdate } from '../player-profile.js';

describe('buildPlayerProfileUpdate', () => {
  it('writes every parsed field FIP owns when status is ok', () => {
    const parsed = {
      fipId: 'P200038',
      birthDate: '1999-08-22',
      birthPlace: 'Madrid',
      heightCm: 184,
      affiliation: null,
      racketBrand: 'Bullpadel',
      racketModel: 'Vertex 04',
      coaches: ['Coach A'],
    };
    const u = buildPlayerProfileUpdate(parsed, 'ok');
    expect(u.fip_id).toBe('P200038');
    expect(u.birthdate).toBe('1999-08-22');
    expect(u.birthplace).toBe('Madrid');
    expect(u.height).toBe(184);
    expect(u.coaches).toEqual(['Coach A']);
    expect(u.equipment).toEqual({ brand: 'Bullpadel', model: 'Vertex 04' });
    expect(u.profile_status).toBe('ok');
    expect(u.last_updated_by).toBe('padelgod');
    expect(typeof u.profile_attempt_at).toBe('string');
    expect(typeof u.profile_fetched_at).toBe('string');
  });

  it('omits null spec fields so existing values are preserved', () => {
    const parsed = {
      fipId: 'P200038',
      birthDate: null,
      birthPlace: null,
      heightCm: null,
      affiliation: null,
      racketBrand: null,
      racketModel: null,
      coaches: [],
    };
    const u = buildPlayerProfileUpdate(parsed, 'ok');
    expect(u.birthdate).toBeUndefined();
    expect(u.birthplace).toBeUndefined();
    expect(u.height).toBeUndefined();
    expect(u.equipment).toBeUndefined();
    // coaches is always written (per existing 2026 policy: empty array is meaningful)
    expect(u.coaches).toEqual([]);
  });

  it('records failure status without writing parsed fields and without profile_fetched_at', () => {
    const u = buildPlayerProfileUpdate(null, 'http_error');
    expect(u.profile_status).toBe('http_error');
    expect(u.profile_fetched_at).toBeUndefined();
    expect(typeof u.profile_attempt_at).toBe('string');
    expect(u.fip_id).toBeUndefined();
    expect(u.birthdate).toBeUndefined();
    expect(u.coaches).toBeUndefined();
  });

  it('writes equipment with a brand even when model is null', () => {
    const parsed = {
      fipId: 'P1', birthDate: null, birthPlace: null, heightCm: null,
      affiliation: null, racketBrand: 'Babolat', racketModel: null, coaches: [],
    };
    const u = buildPlayerProfileUpdate(parsed, 'ok');
    expect(u.equipment).toEqual({ brand: 'Babolat', model: null });
  });
});
