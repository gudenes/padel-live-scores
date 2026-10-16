import { describe, it, expect, vi } from 'vitest';
import { drawFinishedAt, loadLatestDrawRows, translateDrawSnapshotToMatchPatch } from '../fip-draw-results-writer.js';

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


describe('loadLatestDrawRows', () => {
  function client(rows: unknown[], errorOffset = -1) {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['schema', 'from', 'select', 'eq', 'gte', 'lte', 'order']) {
      query[method] = vi.fn(() => query);
    }
    query.range = vi.fn(async (start: number, end: number) => ({
      data: start === errorOffset ? null : rows.slice(start, end + 1),
      error: start === errorOffset ? { message: 'read failed' } : null,
    }));
    return query;
  }

  it('reads beyond the response cap and retains the newest state per match', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      match_widget_id: `MD${i}`, captured_at: '2026-10-16T07:00:00Z', status: 'scheduled',
    }));
    const q = client([...rows,
      { match_widget_id: 'WQ010', captured_at: '2026-10-16T06:00:00Z', status: 'finished', winner_team: 2 },
      { match_widget_id: 'WQ010', captured_at: '2026-10-16T05:00:00Z', status: 'scheduled', winner_team: null },
    ]);
    const result = await loadLatestDrawRows(q as never, 'milano');
    expect(result.find(r => r.match_widget_id === 'WQ010')).toMatchObject({ status: 'finished', winner_team: 2 });
    expect(q.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(q.range).toHaveBeenNthCalledWith(2, 1000, 1999);
    expect(q.order).toHaveBeenCalledWith('id', { ascending: false });
    expect(q.gte).toHaveBeenCalledWith('captured_at', expect.any(String));
    expect(q.lte).toHaveBeenCalledWith('captured_at', expect.any(String));
  });

  it('fails the run instead of settling from an incomplete read', async () => {
    const q = client(Array.from({ length: 1000 }, () => ({})), 1000);
    await expect(loadLatestDrawRows(q as never, 'milano')).rejects.toThrow('read failed');
  });
});


describe('drawFinishedAt', () => {
  it('leaves an unobserved walkover completion time unknown', () => {
    expect(drawFinishedAt({ started_at: null, duration: null })).toBeNull();
    expect(drawFinishedAt({ started_at: '2026-10-11T12:00:00Z', duration: null })).toBeNull();
  });
  it('uses real match timing and rejects malformed or implausible durations', () => {
    expect(drawFinishedAt({ started_at: '2026-10-11T12:00:00Z', duration: '01:20' })).toBe('2026-10-11T13:20:00.000Z');
    expect(drawFinishedAt({ started_at: 'invalid', duration: '01:20' })).toBeNull();
    expect(drawFinishedAt({ started_at: '2026-10-11T12:00:00Z', duration: '22:30' })).toBeNull();
  });
});
