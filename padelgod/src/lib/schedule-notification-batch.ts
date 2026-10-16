import { createHash } from 'node:crypto';
import type { NotifyEventPayload } from './notify.js';

/** One delivery per schedule refresh, even when several tournaments changed. */
export function scheduleNotificationBatch(matchIds: string[]): NotifyEventPayload | null {
  const ids = [...new Set(matchIds)].sort();
  if (!ids.length) return null;
  const hash = createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 32);
  return {
    category: 'match_scheduled', entityType: 'match', entityId: ids[0]!, entityIds: ids,
    title: 'Schedules updated', body: 'Matches you follow now have a time and court.',
    url: '/following', metadata: { match_ids: ids },
    dedupeKey: `match_scheduled:batch:${hash}`,
  };
}
