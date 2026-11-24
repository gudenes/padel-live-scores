import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePplDocument, parsePplEventPage, parsePplIndex, pplScheduleUtc, PplClient, type PplEvent } from '../../lib/ppl-client.js';
import { pplToSnapshot } from '../../lib/ppl-adapter.js';
import { resolvePplSnapshot, type PplContext } from '../../lib/ppl-resolve.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/ppl/${name}.json`, import.meta.url), 'utf8'));
export const event: PplEvent = { slug: 'playa-del-carmen', name: 'Playa del Carmen', startsAt: '2026-09-24', endsAt: '2026-09-27', league: 'ppl' };
const page = parsePplEventPage(fixture('playa-event'), event);
const id = 'playa-del-carmen-d4-m1-womens';
const decoded = () => decodePplDocument(fixture('finished'), id);
const snapshot = () => { const d = decoded(); return pplToSnapshot(d.data, id, d.revision, page); };
function context(): PplContext {
  const s = snapshot();
  return { players: s.players.map((p, i) => ({ ...p, id: String(i) })), aliases: new Map(), mappings: new Map(), matchMappings: new Map(),
    ties: [{ id: 'tie', tie_key: 'Group Stage|4|new-york-atlantics|florida-goats' }],
    matches: [{ id: 'match', tie_id: 'tie', category: 'women', status: 'scheduled',
      pair1_player1_id: null, pair1_player2_id: null, pair2_player1_id: null, pair2_player2_id: null }] };
}

describe('public PPL snapshots', () => {
  it('reads actual completed score in home/away order, despite reversed visual scoreboard', () => {
    const s = snapshot();
    expect(s.status).toBe('finished'); expect(s.winner).toBe(1);
    expect(s.sets.map(x => [x.a, x.b])).toEqual([[6, 4], [6, 4]]);
    expect(s.players.map(x => x.slug)).toEqual(['sofia-saiz-vallejo', 'marta-talavan', 'noa-canovas', 'carolina-orsi']);
    expect(s.game).toBeNull(); expect(s.finishedAt).toBe('2026-09-26T16:38:25.469Z');
  });
  it('uses real match-tiebreak points, not the provider 1–0 placeholder', () => {
    const id = 'playa-del-carmen-podium-mens-third';
    const d = decodePplDocument(fixture('supertiebreak'), id);
    const s = pplToSnapshot(d.data, id, d.revision, page);
    expect(s.sets.map(x => [x.a, x.b])).toEqual([[0, 6], [6, 2], [10, 6]]);
    expect(s.winner).toBe(1);
  });
  it('does not mistake a prefilled 0–0 current set for a live match', () => {
    const e = { ...event, slug: 'mgm-pro-padel-league-las-vegas-2026', startsAt: '2026-11-18', endsAt: '2026-11-21' };
    const p = parsePplEventPage(fixture('vegas-event'), e);
    const id = p.matchIds[0]!; const d = decodePplDocument(fixture('scheduled'), id);
    const s = pplToSnapshot(d.data, id, d.revision, p);
    expect(s).toMatchObject({ status: 'scheduled', players: [], sets: [], game: null, winner: null });
    const withoutState = structuredClone(d.data) as any; delete withoutState.state;
    expect(pplToSnapshot(withoutState, id, d.revision, p)).toMatchObject({ status: 'scheduled', sets: [], game: null });
  });
  it('rejects event/fixture confusion, unsupported statuses and unconfirmed lineups', () => {
    const d = decoded(); const raw = d.data as any;
    expect(() => pplToSnapshot(raw, 'other-match', d.revision, page)).toThrow();
    raw.state.match_details.status = 'cancelled';
    expect(() => pplToSnapshot(raw, id, d.revision, page)).toThrow(/Unsupported/);
    raw.state.match_details.status = 'completed'; raw.lineup.homeLeft = null;
    expect(() => pplToSnapshot(raw, id, d.revision, page)).toThrow(/lineup/);
  });
  it('rejects silent A/B swaps and inconsistent winning sets', () => {
    const d = decoded(), raw = d.data as any;
    raw.state.competitors.team_a.player_1_name = 'Noa Canovas';
    expect(() => pplToSnapshot(raw, id, d.revision, page)).toThrow(/orientation/);
    const d2 = decoded(); (d2.data as any).state.match_score_summary.team_a_sets_won = 1;
    expect(() => pplToSnapshot(d2.data, id, d2.revision, page)).toThrow(/sets won/);
  });
  it('replays synthetic live progression with no invented history or server identity', () => {
    const d = decoded(), raw = d.data as any;
    raw.state.match_details.status = 'in_progress';
    raw.state.match_score_summary.team_a_sets_won = 1;
    raw.state.match_score_summary.set_scores[1] = { set_number: 2, status: 'in_progress', team_a_games: 2, team_b_games: 3 };
    raw.state.match_score_summary.current_point = { team_a_display: '30', team_b_display: '40', in_tiebreak: false };
    const s = pplToSnapshot(raw, id, d.revision, page);
    expect(s).toMatchObject({ status: 'live', winner: null, game: { set: 2, number: 6, score: '30-40', servingPair: 1 } });
    raw.state.match_state.game_started = false;
    expect(() => pplToSnapshot(raw, id, d.revision, page)).toThrow(/not confirmed/);
  });
  it('refuses invalid completed supertiebreak and missing point values', () => {
    const id = 'playa-del-carmen-podium-mens-third'; const d = decodePplDocument(fixture('supertiebreak'), id);
    const r = d.data as any; r.state.match_score_summary.set_scores[2].match_tiebreak_points = { a: 10, b: 9 };
    expect(() => pplToSnapshot(r, id, d.revision, page)).toThrow(/completed set/);
    delete r.state.match_score_summary.set_scores[2].match_tiebreak_points;
    expect(() => pplToSnapshot(r, id, d.revision, page)).toThrow(/points missing/);
  });
});
describe('PPL discovery and identity', () => {
  it('converts venue time with DST and leaves podium placeholders unmaterialized', () => {
    expect(pplScheduleUtc('2026-11-18T17:00:00','America/Los_Angeles')).toBe('2026-11-19T01:00:00.000Z');
    expect(pplScheduleUtc('9/27/2026 1:00:00 PM','America/Cancun')).toBe('2026-09-27T18:00:00.000Z');
    const vegas=parsePplEventPage(fixture('vegas-event'),{...event,slug:'mgm-pro-padel-league-las-vegas-2026',startsAt:'2026-11-18',endsAt:'2026-11-21'});
    expect(vegas.matchIds).toHaveLength(24); expect(vegas.fixtures).toHaveLength(20);
  });
  it('ignores hidden Guadalajara and discovers the published November event', () => {
    const raw = { pageProps: { extraProps: { tournaments: [
      { id: 'guadalajara-2026', values: { title: 'Guadalajara', startDate: '2026-11-19', endDate: '2026-11-22', leagueId: 'ppl', hiddenFromWeb: true } },
      { id: 'mgm-pro-padel-league-las-vegas-2026', values: { title: 'Las Vegas', startDate: '2026-11-18', endDate: '2026-11-21', leagueId: 'ppl' } },
    ] } } };
    expect(parsePplIndex(raw).map(x => x.slug)).toEqual(['mgm-pro-padel-league-las-vegas-2026']);
  });
  it('recovers an absent match mapping using exactly one event tie and category', () => {
    expect(resolvePplSnapshot(snapshot(), context())).toMatchObject({ ok: true, matchId: 'match', playerIds: ['0', '1', '2', '3'] });
  });
  it.each(['', 'null'])('reuses a missing-session tie encoded as %j and passes its stored key to the writer', (session) => {
    const s = { ...snapshot(), session: null }, c = context();
    c.ties[0]!.tie_key = `${s.stage}|${session}|${s.homeTeam}|${s.awayTeam}`;
    expect(resolvePplSnapshot(s, c)).toMatchObject({ ok: true, matchId: 'match', tieKey: c.ties[0]!.tie_key });
  });
  it('rejects two encodings of the same tie even if only one has a match', () => {
    const s = { ...snapshot(), session: null }, c = context();
    c.ties = ['', 'null'].map((session, i) => ({ id: i ? 'duplicate' : 'tie', tie_key: `${s.stage}|${session}|${s.homeTeam}|${s.awayTeam}` }));
    expect(resolvePplSnapshot(s, c)).toMatchObject({ ok: false, reason: 'ambiguous_fixture' });
  });
  it('blocks duplicate people, conflicting mappings and duplicate fixtures', () => {
    const c = context(); c.players.push({ ...c.players[0]!, id: 'duplicate' });
    expect(resolvePplSnapshot(snapshot(), c)).toMatchObject({ ok: false, reason: expect.stringContaining('ambiguous') });
    const c2 = context(); c2.matchMappings.set(id, 'another-match');
    expect(resolvePplSnapshot(snapshot(), c2)).toMatchObject({ ok: false, reason: 'provider_id_conflict' });
    const c3 = context(); c3.matches.push({ ...c3.matches[0]!, id: 'duplicate' });
    expect(resolvePplSnapshot(snapshot(), c3)).toMatchObject({ ok: false, reason: 'ambiguous_fixture' });
  });
  it('does not use an existing foreign key to choose between namesakes', () => {
    const c = context(); c.matches[0]!.pair1_player1_id = '0'; c.players.push({ ...c.players[0]!, id: 'duplicate' });
    expect(resolvePplSnapshot(snapshot(), c).ok).toBe(false);
  });
  it('keeps the reviewed Javier Martinez mapping consistent with the existing import decision', () => {
    const original = JSON.parse(readFileSync(new URL('../../../../scripts/ppl-player-map.json', import.meta.url), 'utf8'));
    const reviewed = JSON.parse(readFileSync(new URL('../../lib/ppl-reviewed-identities.json', import.meta.url), 'utf8'));
    expect(reviewed['javier-martinez'].id).toBe(original['javier-martinez']);
  });
  it('only requests validated IDs on the public allowlisted host', async () => {
    const http = { get: vi.fn() } as any;
    await expect(new PplClient().match(http, '../../private')).rejects.toThrow();
    expect(http.get).not.toHaveBeenCalled();
    expect(() => decodePplDocument(fixture('finished'), 'another-id')).toThrow();
  });
});
