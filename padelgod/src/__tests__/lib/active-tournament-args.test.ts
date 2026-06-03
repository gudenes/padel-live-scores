import { describe, it, expect } from 'vitest';
import { activeTournamentArgs } from '../../lib/active-tournament-args.js';

describe('activeTournamentArgs', () => {
  it('returns empty args when no ids (scheduled run → windowed)', () => {
    expect(activeTournamentArgs(undefined)).toEqual({});
    expect(activeTournamentArgs(new Set())).toEqual({});
  });

  it('returns p_only_ids array when ids are present (targeted refresh → bypass)', () => {
    const args = activeTournamentArgs(new Set(['a', 'b']));
    expect(args).toEqual({ p_only_ids: ['a', 'b'] });
  });

  it('preserves a single id', () => {
    expect(activeTournamentArgs(new Set(['x']))).toEqual({ p_only_ids: ['x'] });
  });
});
