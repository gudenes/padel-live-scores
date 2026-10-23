import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parsePuntuate, normalizePuntuateUrl, fetchResultsFeed } from '../../lib/puntuate-client.js';
import { puntuateToLiveState } from '../../lib/puntuate-adapter.js';
import { resolvePuntuateMatch, type CandidateMatch } from '../../lib/puntuate-resolve.js';
const html = readFileSync(new URL('../fixtures/puntuate/melilla-20261021.html', import.meta.url), 'utf8');
const rows = parsePuntuate(html);
const live = rows.find(r => r.teamA.includes('Bautista'))!;
const candidate: CandidateMatch = {
  id: 'match', category: 'men', status: 'scheduled',
  pair1Player1Name: 'Jairo Bautista', pair1Player2Name: 'Lucas Bergamini',
  pair2Player1Name: 'Joel Olivera Palos', pair2Player2Name: 'Mohamed Alami',
  pair1Player1Id: 'a', pair1Player2Id: 'b', pair2Player1Id: 'c', pair2Player2Id: 'd',
};
describe('Puntuate captured Melilla scoreboard', () => {
  it('extracts live, finished, scheduled and dated cards', () => {
    expect(rows).toHaveLength(29);
    expect(rows.filter(r => r.status === 'Live')).toHaveLength(3);
    expect(rows.filter(r => r.status === 'Finished')).toHaveLength(19);
    expect(live).toMatchObject({ date: '2026-10-21', court: 'COURT 1', category: 'men', round: 'Round of 32' });
    expect(live.servingTeam).not.toBeNull();
    expect(rows.some(r => r.teamB.includes('Ordoñez'))).toBe(true);
  });
  it('identity survives score/court changes and deduplicates repeated layouts', () => {
    const changed = parsePuntuate(html.replaceAll("ojf-set'>1<", "ojf-set'>3<").replaceAll('COURT 1', 'COURT 9'));
    expect(changed.map(r => r.id)).toEqual(rows.map(r => r.id));
    expect(parsePuntuate(html + html)).toHaveLength(29);
  });
  it('rejects an error page and skips broken player cards', () => {
    expect(() => parsePuntuate('<html>Maintenance</html>')).toThrow();
    expect(parsePuntuate(html.replaceAll('ojf-name\'', 'missing-name\''))).toEqual([]);
  });
  it('normalizes a live URL to the full dated scoreboard and restricts hosts', () => {
    expect(normalizePuntuateUrl('https://fipmelilla.puntuate.com/ordenJuegoFip.aspx?idTorneo=2310&rf=30&enjuego=1')).toBe('https://fipmelilla.puntuate.com/ordenJuegoFip.aspx?idTorneo=2310&rf=0');
    for (const url of ['http://fipmelilla.puntuate.com/ordenJuegoFip.aspx?idTorneo=2310', 'https://evil.test/ordenJuegoFip.aspx?idTorneo=2310', 'https://fipmelilla.puntuate.com/ordenJuegoFip.aspx']) expect(() => normalizePuntuateUrl(url)).toThrow();
  });
  it('fetches text with bounded timeout and no redirects', async () => {
    const get = vi.fn().mockResolvedValue({ data: html });
    expect(await fetchResultsFeed({ get } as any, 'https://fipmelilla.puntuate.com/ordenJuegoFip.aspx?idTorneo=2310')).toHaveLength(29);
    expect(get.mock.calls[0]![1]).toMatchObject({ timeout: 15000, maxRedirects: 0 });
  });
});
describe('Puntuate adapter', () => {
  it('reverses sets, points and serving side together', () => {
    const state = puntuateToLiveState({ ...live, setsA: [6, 2], setsB: [3, 1], pointsA: '30', pointsB: '15', servingTeam: 1 }, 'match', 'BA');
    expect(state.team1Sets.map(s => s?.games)).toEqual([3, 1]);
    expect(state.pointState).toEqual({ kind: 'regular', team1: 15, team2: 30 });
    expect(state.servingTeam).toBe(2);
  });
  it('handles tiebreaks, advantage and rejects missing points', () => {
    expect(puntuateToLiveState({ ...live, setsA: [6], setsB: [6], pointsA: '5', pointsB: '7' }, 'm', 'AB').pointState).toEqual({ kind: 'tiebreak', team1: 5, team2: 7 });
    expect(puntuateToLiveState({ ...live, pointsA: 'AD', pointsB: '40' }, 'm', 'AB').pointState).toEqual({ kind: 'advantage', side: 1 });
    expect(() => puntuateToLiveState({ ...live, pointsA: '' }, 'm', 'AB')).toThrow();
  });
});
describe('Puntuate match resolution', () => {
  it('resolves all four initials/surnames and flipped teams', () => {
    expect(resolvePuntuateMatch(live, [candidate])).toMatchObject({ matchId: 'match', orientation: 'AB' });
    expect(resolvePuntuateMatch({ ...live, teamA: live.teamB, teamB: live.teamA }, [candidate])).toMatchObject({ orientation: 'BA' });
  });
  it('rejects partial, wrong-gender, terminal and ambiguous matches', () => {
    expect(resolvePuntuateMatch(live, [{ ...candidate, pair2Player2Name: 'Someone Else' }])).toBeNull();
    expect(resolvePuntuateMatch(live, [{ ...candidate, category: 'women' }])).toBeNull();
    expect(resolvePuntuateMatch(live, [{ ...candidate, status: 'finished' }])).toBeNull();
    expect(resolvePuntuateMatch(live, [candidate, { ...candidate, id: 'other' }])).toEqual({ ambiguous: true });
  });
});

it('retains the three live quarterfinal cards before Puntuate publishes sets', () => {
  const startHtml = readFileSync(new URL('../fixtures/puntuate/melilla-20261023-start.html', import.meta.url), 'utf8');
  const liveRows = parsePuntuate(startHtml).filter(r => r.status === 'Live');
  expect(liveRows).toHaveLength(3);
  expect(liveRows.map(r => r.teamA)).toContain('C. Ntanou / R. Piltcher');
  expect(liveRows.map(r => r.teamA)).toContain('J. Lasgoity / O. De Chamisso');
  for (const row of liveRows) {
    expect(row.setsA).toEqual([]);
    expect(row.setsB).toEqual([]);
  }
});
