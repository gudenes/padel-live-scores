import { describe, it, expect } from 'vitest';
import { translateDrawSnapshotToMatchPatch } from '../fip-draw-results-writer.js';

describe('translateDrawSnapshotToMatchPatch', () => {
  it('returns null when winner_team is missing — bracket not yet decided', () => {
    expect(
      translateDrawSnapshotToMatchPatch({
        status: 'scheduled',
        winner_team: null,
        set_scores: null,
      }),
    ).toBeNull();
  });

  it('returns null when status is "scheduled" even if winner_team is somehow set', () => {
    // Defensive: shouldn't happen upstream, but if it does we don't want to flip.
    expect(
      translateDrawSnapshotToMatchPatch({
        status: 'scheduled',
        winner_team: 1,
        set_scores: null,
      }),
    ).toBeNull();
  });

  it('returns null for unknown status strings', () => {
    expect(
      translateDrawSnapshotToMatchPatch({
        status: 'cancelled',
        winner_team: 1,
        set_scores: null,
      }),
    ).toBeNull();
  });

  it('translates draw walkover to walkover with no sets', () => {
    const out = translateDrawSnapshotToMatchPatch({
      status: 'walkover',
      winner_team: 2,
      set_scores: null,
    });
    expect(out).toEqual({ status: 'walkover', winnerPair: 2, parsedSets: [] });
  });

  it('translates draw "finished" with empty set_scores to WALKOVER — the FIP pre-match no-show case', () => {
    // The reason this writer exists. FIP's event page tags pre-match
    // no-shows as `status=finished, winner_team=1, set_scores=null`.
    // Our convention is walkover.
    const out = translateDrawSnapshotToMatchPatch({
      status: 'finished',
      winner_team: 1,
      set_scores: null,
    });
    expect(out).toEqual({ status: 'walkover', winnerPair: 1, parsedSets: [] });
  });

  it('treats an empty-string set_scores the same as null (still walkover)', () => {
    const out = translateDrawSnapshotToMatchPatch({
      status: 'finished',
      winner_team: 2,
      set_scores: '',
    });
    expect(out).toEqual({ status: 'walkover', winnerPair: 2, parsedSets: [] });
  });

  it('treats whitespace-only set_scores as empty (walkover)', () => {
    const out = translateDrawSnapshotToMatchPatch({
      status: 'finished',
      winner_team: 1,
      set_scores: '   ',
    });
    expect(out).toEqual({ status: 'walkover', winnerPair: 1, parsedSets: [] });
  });

  it('treats garbage that does not parse to any set as empty (walkover)', () => {
    // parseSetScores returns [] for tokens that don't match its regex.
    const out = translateDrawSnapshotToMatchPatch({
      status: 'finished',
      winner_team: 1,
      set_scores: 'WO',
    });
    expect(out?.status).toBe('walkover');
    expect(out?.parsedSets).toEqual([]);
  });

  it('translates draw "finished" with parseable scores to FINISHED + sets', () => {
    const out = translateDrawSnapshotToMatchPatch({
      status: 'finished',
      winner_team: 1,
      set_scores: '6-3 6-4',
    });
    expect(out?.status).toBe('finished');
    expect(out?.winnerPair).toBe(1);
    expect(out?.parsedSets).toHaveLength(2);
    expect(out?.parsedSets[0]).toMatchObject({ set_number: 1, pair1_games: 6, pair2_games: 3, set_score: '6-3' });
    expect(out?.parsedSets[1]).toMatchObject({ set_number: 2, pair1_games: 6, pair2_games: 4, set_score: '6-4' });
  });

  it('translates retired with scores to retired (preserves played sets)', () => {
    const out = translateDrawSnapshotToMatchPatch({
      status: 'retired',
      winner_team: 1,
      set_scores: '6-2 1-3',
    });
    expect(out?.status).toBe('retired');
    expect(out?.parsedSets).toHaveLength(2);
  });

  it('is case-insensitive on status', () => {
    const out = translateDrawSnapshotToMatchPatch({
      status: 'WALKOVER',
      winner_team: 1,
      set_scores: null,
    });
    expect(out?.status).toBe('walkover');
  });
});
