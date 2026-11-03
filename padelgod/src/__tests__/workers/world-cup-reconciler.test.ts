import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWorldCupSquads, resolveWorldCupPlayer, type Profile } from '../../workers/world-cup-reconciler.js';
const squads = [{country:'NL',category:'women',names:['Marcella Koek','Tess De Vocht']}, {country:'PY',category:'women',names:['Fatima Yuri Kudo Ykkatai']}];
const profile = (id:string,name:string,country='NL'): Profile => ({id,name,country,category:'women',display_name:null});
describe('World Cup roster identity',()=>{
  it('parses national squads and excludes coaches',()=>{
    const rows=parseWorldCupSquads(readFileSync('../src/lib/__tests__/fixtures/world-cup/entrylist.html','utf8'));
    expect(rows.length).toBe(32);
    expect(rows.every(s=>s.names.length>0 && s.names.length<=8)).toBe(true);
  });
  it('resolves initials and multipart surnames within the national squad',()=>{
    expect(resolveWorldCupPlayer('T. De Vocht','NED','women',squads,[profile('t','Tess De Vocht')])).toBe('t');
    expect(resolveWorldCupPlayer('F. Kudo Ykkatai','PAR','women',squads,[profile('f','Fatima Yuri Kudo Ykkatai','PY')])).toBe('f');
  });
  it('rejects ambiguous squad initials, duplicate profiles, wrong gender and unrelated names',()=>{
    const p=[profile('m','Marcella Koek')];
    expect(resolveWorldCupPlayer('M. Koek','NED','women',[{...squads[0]!,names:['Marcella Koek','Maria Koek']}],p)).toBeNull();
    expect(resolveWorldCupPlayer('M. Koek','NED','women',squads,[...p,profile('duplicate','Marcella Koek')])).toBeNull();
    expect(resolveWorldCupPlayer('M. Koek','NED','men',squads,p)).toBeNull();
    expect(resolveWorldCupPlayer('Koek','NED','women',squads,p)).toBeNull();
  });
  it('allows omitted middle names only with unique full first and last names',()=>{
    const roster = [{country:'AR',category:'women',names:['Leandro Augsburger']}];
    expect(resolveWorldCupPlayer('L. Augsburger','ARG','women',roster,[profile('l','Leandro Roman Augsburger','AR')])).toBe('l');
    expect(resolveWorldCupPlayer('L. Augsburger','ARG','women',roster,[profile('l','Leandro Roman Augsburger','AR'),profile('other','Leandro Jose Augsburger','AR')])).toBeNull();
  });
  it('uses verified squad membership when represented country differs from nationality',()=>{
    expect(resolveWorldCupPlayer('M. Koek','NED','women',squads,[profile('m','Marcella Koek','ES')])).toBe('m');
  });
});

describe('reviewed World Cup FIP identities', () => {
  const roster = [{ country: 'MX', category: 'men', names: ['Eduardo Agustin Torre'] }];
  const torre: Profile = { id: 'torre', name: 'Agustín Torre', display_name: null, country: 'AR', category: 'men', fip_id: 'P100879' };
  it('links a verified full roster name by FIP ID despite different nationality and abbreviated DB name', () => {
    expect(resolveWorldCupPlayer('E. Torre', 'MEX', 'men', roster, [torre])).toBe('torre');
  });
  it('does not infer identity from surname or a missing/duplicated FIP ID', () => {
    expect(resolveWorldCupPlayer('E. Torre', 'MEX', 'men', roster, [{ ...torre, fip_id: null }])).toBeNull();
    expect(resolveWorldCupPlayer('E. Torre', 'MEX', 'men', roster, [torre, { ...torre, id: 'duplicate' }])).toBeNull();
    expect(resolveWorldCupPlayer('E. Torre', 'MEX', 'men', roster, [{ ...torre, category: 'women' }])).toBeNull();
    expect(resolveWorldCupPlayer('E. Torre', 'ARG', 'men', roster, [torre])).toBeNull();
  });
  it('prefers the reviewed FIP identity over an ID-less duplicate', () => {
    const squad = [{ country: 'SE', category: 'women', names: ['Amanda Girdo'] }];
    const amanda = { ...profile('amanda', 'Amanda Girdo', 'SE'), fip_id: 'P200116' };
    expect(resolveWorldCupPlayer('A. Girdo', 'SWE', 'women', squad, [amanda, profile('duplicate', 'Amanda Girdo', 'SE')])).toBe('amanda');
  });
  it('leaves conflicting identities outside the reviewed list unresolved', () => {
    const squad = [{ country: 'DE', category: 'women', names: ['Milla Blaschke'] }];
    expect(resolveWorldCupPlayer('M. Blaschke', 'GER', 'women', squad, [
      { ...profile('a', 'Milla Blaschke', 'DE'), fip_id: 'P204071' },
      { ...profile('b', 'Milla Blaschke', 'DE'), fip_id: 'P214369' },
    ])).toBeNull();
  });
});
