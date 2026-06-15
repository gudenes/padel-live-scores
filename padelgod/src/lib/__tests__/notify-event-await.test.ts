import { describe, it, expect, vi } from 'vitest';
import { notifyEventAwait, type NotifyEventPayload } from '../notify.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const payload: NotifyEventPayload = {
  category: 'projection_ready', entityType: 'player', entityId: 'p1',
  title: 't', body: 'b', dedupeKey: 'projection_ready:tournament:T1',
};

describe('notifyEventAwait', () => {
  it('awaits the POST and resolves with the response status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    const res = await notifyEventAwait(payload, { baseUrl: 'https://x', cronSecret: 's', logger, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x/api/push/notify-event');
    expect(JSON.parse(init.body).dedupeKey).toBe('projection_ready:tournament:T1');
    expect(res).toEqual({ ok: true, status: 200 });
  });

  it('no-ops (ok:false) when env is missing', async () => {
    const fetchImpl = vi.fn();
    const res = await notifyEventAwait(payload, { baseUrl: undefined, cronSecret: undefined, logger, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });
});
