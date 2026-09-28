import { describe, it, expect } from 'vitest';
import { padeldevToLiveState } from '../../lib/padeldev-adapter.js';
import type { PadeldevMatchFeed } from '../../lib/padeldev-types.js';

function feed(over: Partial<PadeldevMatchFeed> = {}): PadeldevMatchFeed {
  return {
    id_match: 38859,
    idmatch: 'VCFQRI',
    playername1: 'S. Merah',
    playername2: 'C. Soubrie',
    playername3: 'G. Rosi',
    playername4: 'M. Delgado',
    isfinished: 0,
    winningteam: 0,
    retiredteam: 0,
    court: 'Piste 2',
    lastupdate: 20260923152901561,
    score: {
      teamserving: 2,
      playerserving: 4,
      winningteam: 0,
      retiredteam: 0,
      value: '30-40 1/0 3/6 0/0 0/0',
      starpoint: 0,
      extratop: null,
      extrabottom: null,
    },
    ...over,
  };
}

describe('padeldevToLiveState', () => {
  it('maps completed + current sets and the live point (AB orientation)', () => {
    const s = padeldevToLiveState(feed(), 'uuid-1', 'AB');
    expect(s.matchId).toBe('uuid-1');
    expect(s.matchWidgetId).toBe('VCFQRI');
    expect(s.status).toBe('live');
    expect(s.team1Sets).toEqual([{ games: 3, tiebreak: null }, { games: 1, tiebreak: null }]);
    expect(s.team2Sets).toEqual([{ games: 6, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.pointState).toEqual({ kind: 'regular', team1: 30, team2: 40 });
  });

  it('swaps both sets and serving team under BA orientation', () => {
    const s = padeldevToLiveState(feed(), 'uuid-1', 'BA');
    expect(s.team1Sets).toEqual([{ games: 6, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.team2Sets).toEqual([{ games: 3, tiebreak: null }, { games: 1, tiebreak: null }]);
    expect(s.pointState).toEqual({ kind: 'regular', team1: 40, team2: 30 });
    // padeldev's team B is our pair1 under BA, so its server becomes team 1.
    expect(s.servingTeam).toBe(1);
  });

  it('carries the serving team through (the webtuga adapter could not)', () => {
    expect(padeldevToLiveState(feed(), 'u', 'AB').servingTeam).toBe(2);
    expect(
      padeldevToLiveState(feed({ score: { ...feed().score, teamserving: 1 } }), 'u', 'AB')
        .servingTeam,
    ).toBe(1);
  });

  it('treats teamserving=0 as unknown rather than a team', () => {
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, teamserving: 0 } }), 'u', 'AB',
    );
    expect(s.servingTeam).toBeNull();
  });

  // Captured live 2026-09-23 18:07 — the feed writes advantage as a bare "A",
  // not "AD". parsePointState only understands "AD", so without normalisation
  // every advantage point throws and the scoreboard freezes at deuce.
  it('reads the feed\'s bare "A" advantage label for team 1', () => {
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, value: 'A-40 5/0 6/4 0/0 0/0' } }), 'u', 'AB',
    );
    expect(s.pointState).toEqual({ kind: 'advantage', side: 1 });
  });

  it('reads a bare "A" advantage for team 2', () => {
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, value: '40-A 0/0 0/0 0/0 0/0' } }), 'u', 'AB',
    );
    expect(s.pointState).toEqual({ kind: 'advantage', side: 2 });
  });

  it('flips advantage side under BA orientation', () => {
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, value: 'A-40 5/0 6/4 0/0 0/0' } }), 'u', 'BA',
    );
    expect(s.pointState).toEqual({ kind: 'advantage', side: 2 });
  });

  it('still accepts an explicit "AD" label if the feed ever emits one', () => {
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, value: 'AD-40 0/0 0/0 0/0 0/0' } }), 'u', 'AB',
    );
    expect(s.pointState).toEqual({ kind: 'advantage', side: 1 });
  });

  it('collapses 40-40 to deuce', () => {
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, value: '40-40 1/0 3/6 0/0 0/0' } }), 'u', 'AB',
    );
    expect(s.pointState).toEqual({ kind: 'deuce' });
  });

  it('infers a tiebreak from 6-6 so the scoreboard does not freeze', () => {
    // The webtuga v1 adapter throws here and freezes the score at 6-6.
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, value: '5-3 6/6 0/0 0/0 0/0' } }), 'u', 'AB',
    );
    expect(s.pointState).toEqual({ kind: 'tiebreak', team1: 5, team2: 3 });
  });

  // starpoint counts DEUCES (1st, 2nd, 3rd …), it is not a golden-point flag.
  // Captured live traffic shows it incrementing across 40-40 → A-40 → 40-40.
  // An earlier draft mapped it to golden point and would have relabelled every
  // deuce in the match.
  it('ignores starpoint, which is a deuce counter not a golden point', () => {
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, value: '40-40 1/0 3/6 0/0 0/0', starpoint: 1 } }),
      'u', 'AB',
    );
    expect(s.pointState).toEqual({ kind: 'deuce' });
  });

  it('still reads advantage correctly while starpoint is set', () => {
    const s = padeldevToLiveState(
      feed({ score: { ...feed().score, value: 'A-40 1/0 3/6 0/0 0/0', starpoint: 2 } }),
      'u', 'AB',
    );
    expect(s.pointState).toEqual({ kind: 'advantage', side: 1 });
  });

  it('reports finished when the feed says so', () => {
    const s = padeldevToLiveState(
      feed({ isfinished: 1, score: { ...feed().score, value: '0-0 0/0 3/6 6/2 6/2' } }),
      'u', 'AB',
    );
    expect(s.status).toBe('finished');
    expect(s.team1Sets).toEqual([
      { games: 3, tiebreak: null },
      { games: 6, tiebreak: null },
      { games: 6, tiebreak: null },
    ]);
  });

  it('throws on a malformed score so the caller can isolate the row', () => {
    expect(() =>
      padeldevToLiveState(feed({ score: { ...feed().score, value: 'nonsense' } }), 'u', 'AB'),
    ).toThrow();
  });
});
