import { it, expect, vi } from 'vitest'
import { runPlayReminderDispatch } from '../play-reminders.js'
const notify = {
  baseUrl: 'https://padelnachos.com/',
  cronSecret: 'test',
  logger: {} as never,
}
it('skips when not configured', async () =>
  expect(await runPlayReminderDispatch({})).toEqual({ skipped: true }))
it('dispatches the periodic tick with auth and an explicit dry-run', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ planned: 3 }) })
  expect(
    await runPlayReminderDispatch({ notify, dryRun: true, fetchImpl })
  ).toEqual({ planned: 3 })
  expect(fetchImpl).toHaveBeenCalledWith(
    'https://padelnachos.com/api/internal/play-reminders',
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test' }),
      body: '{"dryRun":true}',
    })
  )
})
it('surfaces failed dispatches to scheduler', async () => {
  await expect(
    runPlayReminderDispatch({
      notify,
      fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    })
  ).rejects.toThrow('503')
})
