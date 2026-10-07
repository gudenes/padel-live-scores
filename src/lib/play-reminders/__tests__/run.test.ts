import { beforeEach, it, expect, vi } from 'vitest'
const mocked = vi.hoisted(() => ({ markets: vi.fn(), choices: vi.fn() }))
vi.mock('../data', () => ({
  loadReminderMarkets: mocked.markets,
  loadUserChoices: mocked.choices,
}))
import { runPlayReminders, type ReminderTransport } from '../run'
import type { ReminderMarket } from '../plan'
const now = Date.parse('2026-10-07T08:00:00Z'),
  uid = 'member'
const p = (id: string) => ({ id, name: id, image: null })
const m: ReminderMarket = {
  id: 'q1',
  matchId: 'm1',
  question: 'Who wins?',
  pair1: [p('a'), p('b')],
  pair2: [p('c'), p('d')],
  tournament: 'Madrid P1',
  round: 'SF',
  category: 'men',
  startsAt: '2026-10-07T13:00:00Z',
  locksAt: '2026-10-07T13:00:00Z',
  status: 'open',
  matchStatus: 'scheduled',
  lineup: 'k',
  marketLineup: 'k',
  predictionLineup: 'k',
  requiresPrediction: true,
}
const pref = {
  user_id: uid,
  email_enabled: true,
  push_enabled: false,
  timezone: 'Europe/Madrid',
  unsubscribe_token: 'token',
}
function fakeDb(
  options: {
    access?: boolean
    consent?: boolean
    flag?: boolean
    lastSeen?: string | null
    openedBeforeSend?: string | null
    activityError?: boolean
  } = {}
) {
  const writes: Record<string, unknown>[] = [],
    rpc = vi.fn().mockImplementation(async (_name, args) => ({
      data: {
        id: 'delivery',
        claimed_at: 'claim',
        created_at: new Date(now).toISOString(),
        payload: args.p_payload,
      },
      error: null,
    }))
  let activityReads = 0
  const from = vi.fn((table: string) => {
    let update: unknown,
      selection = '',
      readSingle = false
    const q: any = {
      select: (s: string) => {
        selection = s
        return q
      },
      or: () => q,
      order: () => q,
      range: () => q,
      gte: () => q,
      eq: () => q,
      update: (v: unknown) => {
        update = v
        return q
      },
      maybeSingle: () => {
        readSingle = true
        return q
      },
      then: (resolve: any) => {
        if (update) {
          writes.push({ table, value: update })
          return Promise.resolve({ data: null, error: null }).then(resolve)
        }
        let data: any = null
        if (table === 'feature_flags') data = { enabled: options.flag ?? true }
        if (table === 'play_reminder_preferences')
          data = readSingle
            ? { ...pref, email_enabled: options.consent ?? true }
            : [pref]
        if (table === 'play_access')
          data = options.access ?? true ? { user_id: uid } : null
        if (table === 'profiles')
          data = { locale: 'en', notification_mute_until: null }
        if (table === 'users') data = { email: 'test@example.com' }
        if (table === 'play_reminder_deliveries') data = []
        if (table === 'user_app_activity') {
          activityReads++
          data = {
            last_seen_at:
              activityReads > 1
                ? options.openedBeforeSend ?? options.lastSeen ?? null
                : options.lastSeen ?? null,
          }
          if (options.activityError)
            return Promise.resolve({
              data: null,
              error: { message: 'offline' },
            }).then(resolve)
        }
        return Promise.resolve({ data, error: null }).then(resolve)
      },
    }
    return q
  })
  return { db: { from, rpc } as any, rpc, writes }
}
const transport = (): ReminderTransport => ({
  email: vi.fn().mockResolvedValue('provider'),
  push: vi.fn().mockResolvedValue(true),
})
beforeEach(() => {
  pref.email_enabled = true
  pref.push_enabled = false
  mocked.markets.mockReset().mockResolvedValue([m])
  mocked.choices.mockReset().mockResolvedValue({
    answered: new Set(),
    followed: new Set(),
    bookmarked: new Set(),
  })
})
it('dry-run selects content without claiming, writing or sending', async () => {
  const f = fakeDb(),
    t = transport()
  expect(await runPlayReminders(f.db, t, { dryRun: true, now })).toMatchObject({
    planned: 1,
    emailSent: 0,
  })
  expect(f.rpc).not.toHaveBeenCalled()
  expect(t.email).not.toHaveBeenCalled()
  expect(f.writes).toEqual([])
})
it('successful email uses a stable provider key and completes its claimed delivery', async () => {
  const f = fakeDb(),
    t = transport()
  expect(await runPlayReminders(f.db, t, { dryRun: false, now })).toMatchObject(
    { emailSent: 1, failed: 0 }
  )
  expect(t.email).toHaveBeenCalledWith(
    expect.objectContaining({ matches: expect.any(Array) }),
    'padel-today-delivery'
  )
  expect(f.writes).toContainEqual(
    expect.objectContaining({
      table: 'play_reminder_deliveries',
      value: expect.objectContaining({
        state: 'sent',
        provider_id: 'provider',
      }),
    })
  )
})
it('lineup changes before send consume the reminder without sending stale content', async () => {
  const f = fakeDb(),
    t = transport()
  mocked.markets
    .mockResolvedValueOnce([m])
    .mockResolvedValueOnce([{ ...m, marketLineup: 'old' }])
  expect(await runPlayReminders(f.db, t, { dryRun: false, now })).toMatchObject(
    { skipped: 1, emailSent: 0 }
  )
  expect(t.email).not.toHaveBeenCalled()
})
it('playing a question before dispatch prevents an outdated reminder', async () => {
  const f = fakeDb(),
    t = transport()
  mocked.choices
    .mockResolvedValueOnce({
      answered: new Set(),
      followed: new Set(),
      bookmarked: new Set(),
    })
    .mockResolvedValueOnce({
      answered: new Set(['q1']),
      followed: new Set(),
      bookmarked: new Set(),
    })
  expect(await runPlayReminders(f.db, t, { dryRun: false, now })).toMatchObject(
    { skipped: 1 }
  )
  expect(t.email).not.toHaveBeenCalled()
})
it('withdrawn consent, removed access or disabled feature prevent delivery', async () => {
  for (const options of [
    { consent: false },
    { access: false },
    { flag: false },
  ]) {
    const f = fakeDb(options),
      t = transport()
    await runPlayReminders(f.db, t, { dryRun: false, now })
    expect(t.email).not.toHaveBeenCalled()
  }
})
it('provider failures leave email pending for the same-key retry', async () => {
  const f = fakeDb(),
    t = transport()
  vi.mocked(t.email).mockRejectedValue(Error('provider down'))
  expect(await runPlayReminders(f.db, t, { dryRun: false, now })).toMatchObject(
    { failed: 1, emailSent: 0 }
  )
  expect(f.writes).toEqual([])
})

it('rescheduling a match before dispatch prevents an email with the old time', async () => {
  const f = fakeDb(),
    t = transport()
  mocked.markets
    .mockResolvedValueOnce([m])
    .mockResolvedValueOnce([{ ...m, startsAt: '2026-10-07T14:00:00Z' }])
  expect(await runPlayReminders(f.db, t, { dryRun: false, now })).toMatchObject(
    { skipped: 1 }
  )
  expect(t.email).not.toHaveBeenCalled()
})

function configurePush() {
  pref.email_enabled = false
  pref.push_enabled = true
  mocked.markets.mockResolvedValue([
    { ...m, startsAt: '2026-10-07T08:25:00Z', locksAt: '2026-10-07T08:25:00Z' },
  ])
  mocked.choices.mockResolvedValue({
    answered: new Set(),
    followed: new Set(['a']),
    bookmarked: new Set(),
  })
}
it('recent app use suppresses only mobile, not daily email', async () => {
  configurePush()
  const f = fakeDb({ lastSeen: '2026-10-07T07:45:00Z' }),
    t = transport()
  await runPlayReminders(f.db, t, { dryRun: false, now })
  expect(t.push).not.toHaveBeenCalled()
  expect(f.rpc).not.toHaveBeenCalled()
  pref.email_enabled = true
  pref.push_enabled = false
  mocked.markets.mockResolvedValue([m])
  const e = fakeDb({ lastSeen: '2026-10-07T07:45:00Z' }),
    et = transport()
  expect(
    await runPlayReminders(e.db, et, { dryRun: false, now })
  ).toMatchObject({ emailSent: 1 })
})
it('opening the app after selection cancels the claimed push', async () => {
  configurePush()
  const f = fakeDb({
      lastSeen: '2026-10-07T07:00:00Z',
      openedBeforeSend: '2026-10-07T07:59:00Z',
    }),
    t = transport()
  expect(await runPlayReminders(f.db, t, { dryRun: false, now })).toMatchObject(
    { skipped: 1, pushSent: 0 }
  )
  expect(t.push).not.toHaveBeenCalled()
})
it('users inactive for over 30 minutes can receive a followed-player reminder', async () => {
  configurePush()
  const f = fakeDb({ lastSeen: '2026-10-07T07:29:00Z' }),
    t = transport()
  expect(await runPlayReminders(f.db, t, { dryRun: false, now })).toMatchObject(
    { pushSent: 1, failed: 0 }
  )
  expect(t.push).toHaveBeenCalledTimes(1)
})
it('activity lookup failures suppress mobile delivery', async () => {
  configurePush()
  const f = fakeDb({ activityError: true }),
    t = transport()
  await runPlayReminders(f.db, t, { dryRun: false, now })
  expect(t.push).not.toHaveBeenCalled()
})
