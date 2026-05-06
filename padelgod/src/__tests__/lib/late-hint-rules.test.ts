import { describe, it, expect } from 'vitest';
import {
  computeLateHintsForGroup,
  type LateHintMatchInput,
  type LateHintResult,
} from '../../lib/late-hint-rules.js';

const NOW = new Date('2026-04-26T17:30:00.000Z');
const GAP = 90;

function mk(
  id: string,
  status: LateHintMatchInput['status'],
  scheduledAt: string | null,
  startedAt: string | null = null,
  finishedAt: string | null = null,
  courtOrder: number = 0,
): LateHintMatchInput {
  return {
    id,
    status,
    scheduledAt,
    startedAt,
    finishedAt,
    courtOrder,
  };
}

describe('computeLateHintsForGroup', () => {
  it('returns empty array for empty input', () => {
    const out = computeLateHintsForGroup([], NOW, GAP);
    expect(out).toEqual([]);
  });

  it('first scheduled match in court with future time has no hint', () => {
    const future = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [mk('only', 'scheduled', future)],
      NOW,
      GAP,
    );
    expect(out).toEqual([{ id: 'only', lateHint: null }]);
  });

  it('scheduled match past its scheduled_at gets may_be_late (self-delay)', () => {
    const pastIso = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [mk('late', 'scheduled', pastIso)],
      NOW,
      GAP,
    );
    expect(out).toEqual([{ id: 'late', lateHint: 'may_be_late' }]);
  });

  it('predecessor live and running over gets may_be_late on next match', () => {
    // A started 95 min ago, expected 90 → over by 5 min
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'live', startedIso, startedIso, null, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },        // not scheduled
      { id: 'B', lateHint: 'may_be_late' },
    ]);
  });

  it('predecessor live but within expected duration gets no hint on next', () => {
    const startedIso = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'live', startedIso, startedIso, null, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },
      { id: 'B', lateHint: null },
    ]);
  });

  it('predecessor finished within last 60 min flips next to starting_soon', () => {
    const finishedIso = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'finished', '2026-04-26T15:00:00Z', null, finishedIso, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },
      { id: 'B', lateHint: 'starting_soon' },
    ]);
  });

  it('predecessor finished long ago does not trigger starting_soon', () => {
    const longAgoIso = new Date(NOW.getTime() - 90 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'finished', '2026-04-26T14:00:00Z', null, longAgoIso, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },
      { id: 'B', lateHint: null },
    ]);
  });

  it('walkover predecessor also triggers starting_soon', () => {
    const finishedIso = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'walkover', '2026-04-26T15:00:00Z', null, finishedIso, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out[1]).toEqual({ id: 'B', lateHint: 'starting_soon' });
  });

  it('cascade: A running over → B may_be_late → C may_be_late (future time)', () => {
    const startedIso = new Date(NOW.getTime() - 95 * 60_000).toISOString();
    const futureBIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const futureCIso = new Date(NOW.getTime() + 150 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'live', startedIso, startedIso, null, 0),
        mk('B', 'scheduled', futureBIso, null, null, 1),
        mk('C', 'scheduled', futureCIso, null, null, 2),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'A', lateHint: null },
      { id: 'B', lateHint: 'may_be_late' },
      { id: 'C', lateHint: 'may_be_late' },
    ]);
  });

  it('live predecessor with null started_at treated as clear', () => {
    const futureIso = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const out = computeLateHintsForGroup(
      [
        mk('A', 'live', null, null, null, 0),
        mk('B', 'scheduled', futureIso, null, null, 1),
      ],
      NOW,
      GAP,
    );
    expect(out[1]).toEqual({ id: 'B', lateHint: null });
  });

  it('forces null on matches not in scheduled status', () => {
    const out = computeLateHintsForGroup(
      [
        mk('a', 'live', '2026-04-26T15:30:00Z', '2026-04-26T15:30:00Z'),
        mk('b', 'finished', '2026-04-26T17:00:00Z', null, '2026-04-26T16:50:00Z'),
        mk('c', 'on_court', '2026-04-26T17:00:00Z'),
      ],
      NOW,
      GAP,
    );
    expect(out).toEqual([
      { id: 'a', lateHint: null },
      { id: 'b', lateHint: null },
      { id: 'c', lateHint: null },
    ]);
  });
});
