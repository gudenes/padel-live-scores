import { describe, it, expect } from 'vitest';
import { scheduleNotificationBatch } from '../../lib/schedule-notification-batch.js';
describe('schedule notification batches', () => {
  it('emits one event carrying every match rather than ten events', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `match-${i}`);
    const payload = scheduleNotificationBatch(ids)!;
    expect(payload.entityIds).toEqual(ids);
    expect(payload.category).toBe('match_scheduled');
    expect(payload.metadata).toEqual({ match_ids: ids });
  });
  it('dedupes ids and uses the same key regardless of processing order', () => {
    expect(scheduleNotificationBatch(['b', 'a', 'b'])).toEqual(scheduleNotificationBatch(['a', 'b']));
  });
  it('does not send an empty refresh', () => expect(scheduleNotificationBatch([])).toBeNull());
});
