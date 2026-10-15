export type ReminderChannel = 'email' | 'push'
export type ReminderPlayer = { id: string; name: string; image: string | null }
export type ReminderMarket = {
  id: string
  matchId: string
  question: string
  pair1: ReminderPlayer[]
  pair2: ReminderPlayer[]
  tournament: string
  tournamentLevel?: string | null
  round: string
  category: string
  startsAt: string
  locksAt: string
  status: string
  matchStatus: string
  lineup: string | null
  marketLineup: string | null
  predictionLineup: string | null
  requiresPrediction: boolean
}
export type ReminderMatch = Omit<ReminderMarket, 'id' | 'question'> & {
  markets: { id: string; question: string }[]
  priority: number
}
export function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}
export function localClock(now: number, timezone: string) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return {
    day: `${v('year')}-${v('month')}-${v('day')}`,
    minutes: Number(v('hour')) * 60 + Number(v('minute')),
  }
}
export function planReminder(input: {
  markets: ReminderMarket[]
  answered: Set<string>
  followed: Set<string>
  bookmarked: Set<string>
  timezone: string
  channel: ReminderChannel
  now: number
  pushNow?: boolean
}): ReminderMatch[] {
  if (!validTimezone(input.timezone)) return []
  const clock = localClock(input.now, input.timezone)
  // One morning campaign, scheduled at 09:00 Madrid; email retains local timing.
  const morning = localClock(input.now, 'Europe/Madrid')
  if (
    input.channel === 'push'
      ? !input.pushNow && (morning.minutes < 540 || morning.minutes >= 600)
      : clock.minutes < 540 || clock.minutes >= 1260
  )
    return []
  const grouped = new Map<string, ReminderMatch>()
  for (const m of input.markets) {
    if (
      input.channel === 'push' &&
      !/^(p1|p2|major|premier|finals)/i.test(m.tournamentLevel ?? '')
    )
      continue
    const start = Date.parse(m.startsAt),
      lock = Date.parse(m.locksAt),
      lead = start - input.now
    if (
      m.status !== 'open' ||
      m.matchStatus !== 'scheduled' ||
      lock <= input.now ||
      !Number.isFinite(start) ||
      !Number.isFinite(lock) ||
      !m.lineup ||
      m.lineup !== m.marketLineup
    )
      continue
    if (m.requiresPrediction && m.predictionLineup !== m.lineup) continue
    const players = [...m.pair1, ...m.pair2]
    if (
      players.length !== 4 ||
      new Set(players.map((p) => p.id)).size !== 4 ||
      (input.channel === 'email' && input.answered.has(m.id))
    )
      continue
    if (
      input.channel === 'email' &&
      localClock(start, input.timezone).day !== clock.day
    )
      continue
    if (
      input.channel === 'email'
        ? lead < 3600000 || lock - input.now < 3600000
        : lead <= 0
    )
      continue
    const relevant =
      input.bookmarked.has(m.matchId) ||
      players.some((p) => input.followed.has(p.id))
    // Follows influence ordering only; everyone with Predict access is eligible.
    const priority =
      (relevant ? 100 : 0) + (m.round === 'F' ? 30 : m.round === 'SF' ? 20 : 0)
    const group = grouped.get(m.matchId) ?? { ...m, markets: [], priority }
    if (Date.parse(m.locksAt) < Date.parse(group.locksAt))
      group.locksAt = m.locksAt
    group.markets.push({ id: m.id, question: m.question })
    grouped.set(m.matchId, group)
  }
  return [...grouped.values()]
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        Date.parse(a.startsAt) - Date.parse(b.startsAt) ||
        a.matchId.localeCompare(b.matchId)
    )
    .slice(0, 3)
}
