import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  flattenTournamentFeed,
  isNotStarted,
  selectLiveEntries,
} from '../../lib/padeldev-feed.js';
import type { PadeldevTournamentFeed } from '../../lib/padeldev-types.js';

const FIXTURE = path.join(__dirname, '../fixtures/padeldev/tournament.json');
const feed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as PadeldevTournamentFeed;

describe('isNotStarted', () => {
  it('recognises the all-zero sentinel', () => {
    expect(isNotStarted('0-0 0/0 0/0 0/0 0/0')).toBe(true);
    expect(isNotStarted('0-0 0/0 0/0 0/0 0/0 ')).toBe(true);
    expect(isNotStarted('')).toBe(true);
  });
  it('does not treat a live 0-0 point as not-started when games exist', () => {
    expect(isNotStarted('0-0 1/2 0/0 0/0 0/0')).toBe(false);
    expect(isNotStarted('0-0 0/0 6/4 0/0 0/0')).toBe(false);
    expect(isNotStarted('15-0 0/0 0/0 0/0 0/0')).toBe(false);
  });
});

describe('flattenTournamentFeed (real Lyon capture)', () => {
  it('reads only the 8-digit day keys, not the metadata keys', () => {
    const all = flattenTournamentFeed(feed);
    expect(all.length).toBeGreaterThan(0);
    // name/timezone/startdatetime must not become "days"
    expect(all.every((e) => /^\d{8}$/.test(e.day))).toBe(true);
  });

  it('keeps court context and extracts a match ref for every entry', () => {
    const all = flattenTournamentFeed(feed);
    expect(all.every((e) => e.matchRef.endsWith('.json'))).toBe(true);
    expect(all.every((e) => e.court.length > 0)).toBe(true);
  });

  it('finds the same total the raw fixture contains', () => {
    const t = (feed as any).tournament;
    let expected = 0;
    for (const k of Object.keys(t)) {
      if (!/^\d{8}$/.test(k)) continue;
      for (const court of Object.keys(t[k])) expected += t[k][court].length;
    }
    expect(flattenTournamentFeed(feed).length).toBe(expected);
  });

  it('selects only unfinished, started matches', () => {
    const live = selectLiveEntries(flattenTournamentFeed(feed));
    expect(live.every((e) => Number(e.entry.isfinished) !== 1)).toBe(true);
    expect(live.every((e) => !isNotStarted(e.entry.score))).toBe(true);
  });

  it('tolerates a malformed feed without throwing', () => {
    expect(flattenTournamentFeed({ tournament: {} } as any)).toEqual([]);
    expect(flattenTournamentFeed({} as any)).toEqual([]);
    expect(flattenTournamentFeed({ tournament: { '20260923': null } } as any)).toEqual([]);
  });
});
