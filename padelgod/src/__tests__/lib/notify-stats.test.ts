import { describe, it, expect, beforeEach } from 'vitest';
import {
  __resetNotifyStats,
  getNotifyStats,
  recordAttempt,
  recordEnvConfigured,
  recordFetchError,
  recordFired,
  recordNonOk,
  recordSkipEnvMissing,
  recordSkipNotScheduled,
  recordSuccess,
} from '../../lib/notify-stats.js';

describe('notify-stats', () => {
  beforeEach(() => {
    __resetNotifyStats(false);
  });

  it('starts zeroed out with env_configured=false', () => {
    const s = getNotifyStats();
    expect(s.env_configured).toBe(false);
    expect(s.total_attempted).toBe(0);
    expect(s.total_fired).toBe(0);
    expect(s.total_success).toBe(0);
    expect(s.last_success).toBeNull();
    expect(s.last_non_ok).toBeNull();
    expect(s.last_skip).toBeNull();
    expect(typeof s.started_at).toBe('string');
  });

  it('recordEnvConfigured flips env_configured and preserves counters', () => {
    recordAttempt();
    recordFired();
    recordEnvConfigured(true);
    const s = getNotifyStats();
    expect(s.env_configured).toBe(true);
    expect(s.total_attempted).toBe(1);
    expect(s.total_fired).toBe(1);
  });

  it('happy path: attempt → fired → success', () => {
    recordEnvConfigured(true);
    recordAttempt();
    recordFired();
    recordSuccess('match-abc');

    const s = getNotifyStats();
    expect(s.total_attempted).toBe(1);
    expect(s.total_fired).toBe(1);
    expect(s.total_success).toBe(1);
    expect(s.total_non_ok).toBe(0);
    expect(s.last_success?.matchId).toBe('match-abc');
    expect(typeof s.last_success?.at).toBe('string');
  });

  it('env-missing skip: attempt recorded but not fired', () => {
    recordAttempt();
    recordSkipEnvMissing('match-xyz');

    const s = getNotifyStats();
    expect(s.total_attempted).toBe(1);
    expect(s.total_fired).toBe(0);
    expect(s.total_skipped_env_missing).toBe(1);
    expect(s.last_skip?.reason).toBe('env_missing');
    expect(s.last_skip?.matchId).toBe('match-xyz');
  });

  it('not-scheduled skip surfaces the prev status for triage', () => {
    recordSkipNotScheduled('match-m', 'live');
    const s = getNotifyStats();
    expect(s.total_skipped_not_scheduled).toBe(1);
    expect(s.last_skip?.reason).toBe('prev_status_live');
    expect(s.last_skip?.matchId).toBe('match-m');
  });

  it('not-scheduled skip with null prev status renders as prev_status_null', () => {
    recordSkipNotScheduled('match-m', null);
    expect(getNotifyStats().last_skip?.reason).toBe('prev_status_null');
  });

  it('non-ok response captures status + truncated body', () => {
    recordEnvConfigured(true);
    recordAttempt();
    recordFired();
    const longBody = 'x'.repeat(1000);
    recordNonOk('match-401', 401, longBody);

    const s = getNotifyStats();
    expect(s.total_non_ok).toBe(1);
    expect(s.last_non_ok?.status).toBe(401);
    expect(s.last_non_ok?.matchId).toBe('match-401');
    expect(s.last_non_ok?.body.length).toBe(500);
  });

  it('fetch error records truncated error message', () => {
    recordEnvConfigured(true);
    recordAttempt();
    recordFired();
    recordFetchError('match-net', 'ECONNREFUSED ' + 'y'.repeat(1000));

    const s = getNotifyStats();
    expect(s.total_fetch_error).toBe(1);
    expect(s.last_fetch_error?.matchId).toBe('match-net');
    expect(s.last_fetch_error?.error.length).toBe(500);
  });

  it('counters are cumulative across multiple calls', () => {
    recordEnvConfigured(true);
    for (let i = 0; i < 5; i++) {
      recordAttempt();
      recordFired();
      recordSuccess(`match-${i}`);
    }

    const s = getNotifyStats();
    expect(s.total_attempted).toBe(5);
    expect(s.total_success).toBe(5);
    // last_success points at the most recent one
    expect(s.last_success?.matchId).toBe('match-4');
  });

  it('getNotifyStats returns a defensive copy', () => {
    recordEnvConfigured(true);
    const snapshot = getNotifyStats();
    // Mutate the returned object
    (snapshot as any).total_attempted = 999;
    // Internal state is untouched
    expect(getNotifyStats().total_attempted).toBe(0);
  });
});
