import { describe, it, expect, vi } from 'vitest';
import { CourtbitClient, parseCourtbitFeed, normalizeCourtbitUrl, type CourtbitMatch } from '../../lib/courtbit-client.js';
import { courtbitToSnapshot, observedPointWinner } from '../../lib/courtbit-adapter.js';
import { strictPlayerLookup } from '../../lib/strict-player-resolver.js';
import { resolveCourtbitMatch, type CourtbitContext } from '../../lib/courtbit-resolve.js';
import fixture from '../fixtures/courtbit/widget.json';
import { courtbitPlayerKey } from '../../lib/courtbit-client.js';

import { row, context } from '../helpers/courtbit.js';

describe('CourtBit transport', () => {
  it('accepts the captured tournament including two wildcard players without slugs', () => {
    const parsed = parseCourtbitFeed(fixture, fixture.name);
    expect(parsed.rejected).toBe(0);
    expect(parsed.matches).toHaveLength(41);
    const missingSlugs = parsed.matches.flatMap(m => [...m.a.players, ...m.b.players]).filter(p => p.slug === null);
    expect(missingSlugs).toHaveLength(2);
    expect(new Set(missingSlugs.map(courtbitPlayerKey)).size).toBe(2);
  });
  it('validates the event, isolates malformed rows and rejects duplicate IDs', () => {
    const feed = { ok: true, name: 'FIP Aguascalientes 2026', matches: [row, { ...row, id: 'bad', status: 'other' }] };
    expect(parseCourtbitFeed(feed, feed.name)).toMatchObject({ rejected: 1, matches: [row] });
    expect(() => parseCourtbitFeed(feed, 'Another tournament')).toThrow('identity');
    expect(() => parseCourtbitFeed({ ...feed, matches: [row, row] }, feed.name)).toThrow('Duplicate');
  });
  it('only fetches the known HTTPS host without credentials or arbitrary URLs', () => {
    expect(normalizeCourtbitUrl('https://fip.courtbit.com.mx/widget/resultados')).toBe('https://fip.courtbit.com.mx/api/widget');
    for (const url of ['http://fip.courtbit.com.mx', 'https://evil.test', 'https://fip.courtbit.com.mx.evil.test', 'https://user:pass@fip.courtbit.com.mx', 'https://fip.courtbit.com.mx/?event=other']) expect(() => normalizeCourtbitUrl(url)).toThrow();
  });
  it('returns the cached body on 304 for persistence retries', async () => {
    const get = vi.fn().mockResolvedValueOnce({ status: 200, data: { ok: true, name: 'Event', matches: [row] }, headers: { etag: 'one' } })
      .mockResolvedValueOnce({ status: 304 });
    const client = new CourtbitClient();
    const first = await client.fetch({ get } as any, 'https://fip.courtbit.com.mx', 'Event');
    const second = await client.fetch({ get } as any, 'https://fip.courtbit.com.mx', 'Event');
    expect(second.feed).toEqual(first.feed);
    expect(second.observedAt).toBe(first.observedAt);
    expect(get.mock.calls[1]![1].headers).toEqual({ 'If-None-Match': 'one' });
  });
});

describe('strict shared Player Resolver', () => {
  const input = { name: 'Mateo Alvarez', category: 'men', country: 'ARG' };
  const players = [{ id: 'chile', name: input.name, category: 'men', country: 'CL' }, { id: 'argentina', name: input.name, category: 'men', country: 'AR' }];
  it('resolves the Argentine Mateo independent of row order', () => {
    for (const candidates of [players, [...players].reverse()]) expect(strictPlayerLookup(input, candidates)).toMatchObject({ found: true, playerId: 'argentina' });
  });
  it('rejects same-country duplicates, including an alias hiding a duplicate', () => {
    const dupes = [players[1]!, { ...players[1]!, id: 'duplicate' }];
    expect(strictPlayerLookup(input, dupes, new Map([['mateo alvarez', ['argentina']]]))).toMatchObject({ found: false, reason: 'ambiguous' });
  });
  it('rejects country/category conflicts on exact IDs and aliases', () => {
    expect(strictPlayerLookup(input, [players[0]!], new Map([['mateo alvarez', ['chile']]]))).toMatchObject({ found: false, reason: 'identity_conflict' });
    expect(strictPlayerLookup({ ...input, fipId: 'P1' }, [{ ...players[0]!, fipId: 'P1' }])).toMatchObject({ found: false, reason: 'identity_conflict' });
  });
  it('does not arbitrarily pick among tied subset matches', () => {
    expect(strictPlayerLookup(input, [{ ...players[1]!, name: 'Mateo Alvarez One' }, { ...players[1]!, id: 'two', name: 'Mateo Alvarez Two' }])).toMatchObject({ found: false, reason: 'ambiguous' });
  });
});

describe('CourtBit match identity', () => {
  it('resolves four UUIDs, normalizes round and respects player order within pairs', () => {
    expect(resolveCourtbitMatch(row, context())).toMatchObject({ ok: true, matchId: 'match', orientation: 'AB', players: ['2', '1', '4', '3'] });
    expect(resolveCourtbitMatch({ ...row, a: row.b, b: row.a }, context())).toMatchObject({ ok: true, orientation: 'BA' });
  });
  it('refuses nameless null FKs, wrong rounds, duplicate players and ambiguous matches', () => {
    const ctx = context(); ctx.matches[0]!.pair1_player1_id = null;
    expect(resolveCourtbitMatch(row, ctx)).toMatchObject({ ok: false, reason: 'match_requires_reconciliation' });
    expect(resolveCourtbitMatch({ ...row, phase: 'Unknown' }, context())).toMatchObject({ ok: false, reason: 'unknown_round' });
    expect(resolveCourtbitMatch({ ...row, b: row.a }, context())).toMatchObject({ ok: false, reason: 'duplicate_player' });
    const duplicate = context(); duplicate.matches.push({ ...duplicate.matches[0]!, id: 'other' });
    expect(resolveCourtbitMatch(row, duplicate)).toMatchObject({ ok: false, reason: 'ambiguous_match' });
  });
  it('revalidates provider mappings and blocks reused match IDs', () => {
    const ctx = context(); ctx.mappings.set('ana-one', { id: '1', metadata: { name: 'Different Person', country: 'ESP', category: 'women' } });
    expect(resolveCourtbitMatch(row, ctx)).toMatchObject({ ok: false, reason: 'player_identity_conflict' });
    const cached = context(); cached.cache.set(row.id, { matchId: 'different', snapshot: null });
    expect(resolveCourtbitMatch(row, cached)).toMatchObject({ ok: false, reason: 'provider_id_reused' });
  });
});

describe('CourtBit scores and observed points', () => {
  it('initializes all sets and current game on first observation, including side swap', () => {
    const snap = courtbitToSnapshot(row, 'match', 'BA');
    expect(snap.sets).toEqual([{ number: 1, a: 6, b: 4, score: '6-4', current: false }, { number: 2, a: 5, b: 1, score: null, current: true }]);
    expect(snap.game).toMatchObject({ score: '40-15', servingPair: 2, set: 2, number: 7 });
    expect(observedPointWinner(null, snap)).toBeNull();
  });
  it('preserves zero tiebreak loser score and avoids a phantom set on completion', () => {
    const snap = courtbitToSnapshot({ ...row, status: 'done', sets: [[7, 6], [6, 1]], tb: [0, null], games: [0, 0], points: null }, 'm', 'AB');
    expect(snap.sets[0]!.score).toBe('7-6(0)');
    expect(snap.sets).toHaveLength(2); expect(snap.game).toBeNull();
  });
  it('validates advantage/tiebreak points and handles unpublished scores', () => {
    expect(courtbitToSnapshot({ ...row, points: ['AD', '40'] }, 'm', 'AB').game?.score).toBe('AD-40');
    expect(courtbitToSnapshot({ ...row, games: [6, 6], points: ['8', '7'] }, 'm', 'AB').game?.tiebreak).toBe(true);
    expect(() => courtbitToSnapshot({ ...row, games: [6, 6], points: ['AD', '7'] }, 'm', 'AB')).toThrow();
    expect(courtbitToSnapshot({ ...row, sets: [], games: null, points: null }, 'm', 'AB')).toMatchObject({ sets: [], game: null, liveState: null });
  });
  it('logs only an unambiguous same-game point, not gaps/corrections/replays', () => {
    const prev = courtbitToSnapshot(row, 'm', 'AB');
    const next = courtbitToSnapshot({ ...row, points: ['30', '40'] }, 'm', 'AB');
    expect(observedPointWinner(prev, next)).toBe(1);
    expect(observedPointWinner(next, next)).toBeNull();
    expect(observedPointWinner(prev, courtbitToSnapshot({ ...row, points: ['40', '40'] }, 'm', 'AB'))).toBeNull();
    expect(observedPointWinner(next, prev)).toBeNull();
    expect(observedPointWinner(prev, courtbitToSnapshot({ ...row, games: [2, 5], points: ['0', '0'] }, 'm', 'AB'))).toBeNull();
  });
});


describe('CourtBit thin fixture identities', () => {
  it('identifies a fixture by exact names while duplicate profiles stay unlinked', () => {
    const ctx = context(); ctx.players.push({...ctx.players[0]!, id:'duplicate'});
    const result = resolveCourtbitMatch(row,ctx);
    expect(result).toMatchObject({ok:true,participants:[{playerId:'2'},{playerId:null,name:'Ana One'},{playerId:'4'},{playerId:'3'}]});
    if (result.ok) expect(result.links.map(p=>p.playerId)).toEqual(['2','4','3']);
    expect(resolveCourtbitMatch({...row,a:row.b,b:row.a},ctx)).toMatchObject({ok:true,orientation:'BA'});
  });
  it('accepts a missing profile when raw name/country uniquely identify its fixture slot', () => {
    const ctx=context(); ctx.players=ctx.players.filter(p=>p.id!=='1');
    Object.assign(ctx.matches[0]!,{pair1_player2_id:null,pair1_player2_name:'Ana One',pair1_player2_country:'ESP'});
    expect(resolveCourtbitMatch(row,ctx)).toMatchObject({ok:true,participants:[{playerId:'2'},{playerId:null,name:'Ana One'},{playerId:'4'},{playerId:'3'}]});
    ctx.matches[0]!.pair1_player2_country='ARG';
    expect(resolveCourtbitMatch(row,ctx)).toMatchObject({ok:false});
  });
  it('does not attach a score to an ambiguous fixture or replace a different person', () => {
    const ctx=context();ctx.players.push({...ctx.players[0]!,id:'duplicate'});
    ctx.matches.push({...ctx.matches[0]!,id:'duplicate-match'});
    expect(resolveCourtbitMatch(row,ctx)).toMatchObject({ok:false,reason:'ambiguous_match'});
    ctx.matches.pop();ctx.players.find(p=>p.id==='1')!.name='Different Person';
    expect(resolveCourtbitMatch(row,ctx)).toMatchObject({ok:false});
  });
});
