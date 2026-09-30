/**
 * Regression suite over REAL payloads captured from FIP Platinum Lyon 2026
 * while matches were in progress (2026-09-23, ~17:50–18:15 CEST), sampled every
 * 10s and deduped on the feed's own `lastupdate`.
 *
 * This exists because hand-written cases missed a live vendor dialect: the feed
 * writes advantage as a bare "A" ("A-40"), which parsePointState rejects. Every
 * advantage point would have thrown in production and frozen the scoreboard at
 * deuce. Replaying captured traffic caught it; the unit tests did not.
 *
 * The event is finite — once Lyon ends this traffic cannot be re-captured, so
 * these fixtures are the durable record of how the feed actually behaves.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { padeldevToLiveState } from '../../lib/padeldev-adapter.js';
import { parsePadeldevScore } from '../../lib/padeldev-score.js';
import { diffLiveState } from '../../lib/live-state.js';
import type { PadeldevMatchFeed } from '../../lib/padeldev-types.js';

// One JSONL record per DISTINCT observed state, deduped on
// (match, score value, starpoint, serving). The unused `points` / `stats` /
// `chart*` blocks are stripped — they were ~70% of the bytes and v1 reads
// neither. Six full payloads live alongside as *.json for the deferred stats
// work, which needs the `stats` block intact.
const CAPTURE = path.join(__dirname, '../fixtures/padeldev/live-capture.jsonl');

function load(): Array<{ name: string; feed: PadeldevMatchFeed }> {
  if (!fs.existsSync(CAPTURE)) return [];
  return fs
    .readFileSync(CAPTURE, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((line, i) => ({
      name: `capture#${i}`,
      feed: JSON.parse(line) as PadeldevMatchFeed,
    }));
}

const SNAPSHOTS = load();

/** Group by match id, ordered by the feed's own update clock. */
function byMatch(): Map<string, PadeldevMatchFeed[]> {
  const m = new Map<string, PadeldevMatchFeed[]>();
  for (const { feed } of SNAPSHOTS) {
    const list = m.get(feed.idmatch) ?? [];
    list.push(feed);
    m.set(feed.idmatch, list);
  }
  for (const list of m.values()) list.sort((a, b) => Number(a.lastupdate) - Number(b.lastupdate));
  return m;
}

describe('padeldev captured live traffic', () => {
  it('captured a usable sample', () => {
    expect(SNAPSHOTS.length).toBeGreaterThan(300);
  });

  /**
   * Honest record of what this capture does NOT cover, so the gap is visible
   * rather than mistaken for verified behaviour.
   *
   * Across ~90 minutes of Lyon play no set reached 6-6, so the tiebreak branch
   * of the adapter (inferring `insideTiebreak` from a 6-6 current set) is
   * REASONED, NOT OBSERVED. If a tiebreak's point labels turn out not to be
   * plain integers, that path will throw and the affected row will be skipped
   * for the duration of the tiebreak — the same failure webtuga's v1 has.
   *
   * This test asserts the gap still exists; if a future capture includes a 6-6
   * set it will fail, which is the prompt to verify the branch for real.
   */
  it('documents that no tiebreak was observed (inferred path, unverified)', () => {
    const tiebreaks = SNAPSHOTS.filter(
      (s) => (s.feed.score?.value ?? '').split(/\s+/)[1] === '6/6',
    );
    expect(tiebreaks.length).toBe(0);
  });

  it('documents that no finished state was captured mid-sample', () => {
    // The sampler skipped finished matches, so finished-state handling is
    // covered by the separate finished_*.json fixtures, not by this replay.
    expect(SNAPSHOTS.every((s) => Number(s.feed.isfinished) === 0)).toBe(true);
  });

  it('adapts every captured snapshot without throwing', () => {
    const failures: string[] = [];
    for (const { name, feed } of SNAPSHOTS) {
      try {
        padeldevToLiveState(feed, 'm', 'AB');
      } catch (e: any) {
        failures.push(`${name} (${feed.score?.value}): ${e.message}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('covers the advantage label that broke the hand-written tests', () => {
    const adv = SNAPSHOTS.filter((s) => /(^|[\s-])A([\s-]|$)/.test(s.feed.score?.value ?? ''));
    expect(adv.length).toBeGreaterThan(0);
    for (const { feed } of adv) {
      const st = padeldevToLiveState(feed, 'm', 'AB');
      expect(st.pointState.kind).toBe('advantage');
    }
  });

  it('produces a servingTeam on every in-play snapshot', () => {
    const inPlay = SNAPSHOTS.filter((s) => Number(s.feed.score?.teamserving) > 0);
    expect(inPlay.length).toBeGreaterThan(0);
    for (const { feed } of inPlay) {
      expect(padeldevToLiveState(feed, 'm', 'AB').servingTeam).not.toBeNull();
    }
  });

  it('diffs consecutive real snapshots without throwing', () => {
    let diffed = 0;
    for (const list of byMatch().values()) {
      for (let i = 1; i < list.length; i++) {
        const prev = padeldevToLiveState(list[i - 1]!, 'm', 'AB');
        const curr = padeldevToLiveState(list[i]!, 'm', 'AB');
        expect(() => diffLiveState(prev, curr)).not.toThrow();
        diffed++;
      }
    }
    expect(diffed).toBeGreaterThan(0);
  });

  it('never loses a completed set as a match progresses', () => {
    // Completed-set count must be monotonic within a match: a parser bug that
    // mis-reads the positional slots would show up as a set disappearing.
    for (const list of byMatch().values()) {
      let seen = 0;
      for (const feed of list) {
        const n = parsePadeldevScore(feed.score.value).completedSets.length;
        expect(n).toBeGreaterThanOrEqual(seen);
        seen = n;
      }
    }
  });

  it('orients consistently: BA is the mirror of AB', () => {
    for (const { feed } of SNAPSHOTS) {
      const ab = padeldevToLiveState(feed, 'm', 'AB');
      const ba = padeldevToLiveState(feed, 'm', 'BA');
      expect(ba.team1Sets).toEqual(ab.team2Sets);
      expect(ba.team2Sets).toEqual(ab.team1Sets);
      if (ab.servingTeam !== null) {
        expect(ba.servingTeam).toBe(ab.servingTeam === 1 ? 2 : 1);
      }
    }
  });
});
