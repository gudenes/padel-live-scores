import { describe, it, expect, vi } from 'vitest';
import { notifyEventAwait, notifyRankingUpdated, type NotifyEventPayload } from '../notify.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
} as any;
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

describe('notifyRankingUpdated', () => {
  it('POSTs /api/push/notify-ranking', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{}' });
    notifyRankingUpdated({ baseUrl: 'https://x', cronSecret: 's', logger, fetchImpl });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x/api/push/notify-ranking');
    expect(init.headers.Authorization).toBe('Bearer s');
  });

  it('no-ops when env is missing', () => {
    const fetchImpl = vi.fn();
    notifyRankingUpdated({ baseUrl: undefined, cronSecret: undefined, logger, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
