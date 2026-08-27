// src/lib/push-copy.ts
//
// Personalized title/body for match_scheduled + player_eliminated, matching
// the live on-court grammar: "{Name} is on court" → "{Name} plays at 18:00" /
// "{Name} knocked out". Locale strings live in messages/*.json under `push`.

import en from '@/messages/en.json'
import es from '@/messages/es.json'
import pt from '@/messages/pt.json'
import it from '@/messages/it.json'
import fr from '@/messages/fr.json'
import { routing } from '@/i18n/routing'
import { playerLastName, type NameabledPlayer } from '@/lib/player-name'

export type PushLocale = (typeof routing.locales)[number]
export { playerLastName }

type PlayerName = NameabledPlayer

const PUSH_BY_LOCALE = {
  en: en.push,
  es: es.push,
  pt: pt.push,
  it: it.push,
  fr: fr.push,
} satisfies Record<PushLocale, typeof en.push>

export function resolvePushLocale(locale: string | null | undefined): PushLocale {
  if (locale && (routing.locales as readonly string[]).includes(locale)) {
    return locale as PushLocale
  }
  return routing.defaultLocale
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

export function pairLastNames(a: PlayerName | null | undefined, b: PlayerName | null | undefined): string {
  return [a, b]
    .filter((p): p is PlayerName => !!p && !!(p.display_name || p.name))
    .map((p) => playerLastName(p))
    .filter(Boolean)
    .join('/')
}

function clockInTz(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const hour = hourRaw === '24' ? '00' : hourRaw.padStart(2, '0')
  return `${hour}:${minute}`
}

function tzAbbr(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(new Date(iso))
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
}

/**
 * Format `scheduled_at` (UTC ISO) for a lock-screen title.
 * User tz → "13:00". No user tz → tournament clock + abbreviation ("18:00 CEST")
 * so a São Paulo user never reads a bare Brussels 18:00 as local.
 */
export function formatPushTime(
  scheduledAtIso: string | null | undefined,
  opts: { userTimeZone: string | null | undefined; tournamentTimeZone: string | null | undefined },
): string | null {
  if (!scheduledAtIso) return null
  const instant = Date.parse(scheduledAtIso)
  if (Number.isNaN(instant)) return null
  const userTz = opts.userTimeZone?.trim() || null
  if (userTz) return clockInTz(scheduledAtIso, userTz)
  const tournamentTz = opts.tournamentTimeZone?.trim() || 'UTC'
  const clock = clockInTz(scheduledAtIso, tournamentTz)
  const abbr = tzAbbr(scheduledAtIso, tournamentTz)
  return abbr && abbr !== clock ? `${clock} ${abbr}` : clock
}

export function composeScheduled(input: {
  locale: string
  reason: 'follow' | 'bookmark'
  playerName: string | null
  pair1: string
  pair2: string
  tournament: string
  round: string
  court: string
  time: string | null
}): { title: string; body: string } {
  const locale = resolvePushLocale(input.locale)
  const msg = PUSH_BY_LOCALE[locale]
  const name = input.playerName || ''
  const time = input.time || ''
  let title: string
  if (input.reason === 'follow' && name) {
    title = interpolate(time ? msg.scheduledFollowTitle : msg.scheduledFollowTitleNoTime, { name, time })
  } else {
    title = interpolate(time ? msg.scheduledBookmarkTitle : msg.scheduledBookmarkTitleNoTime, { time })
  }
  const tail = [input.court, [input.tournament, input.round].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(' · ')
  const body = interpolate(msg.scheduledBody, {
    pair1: input.pair1,
    pair2: input.pair2,
    tail,
  })
  return { title, body }
}

export function composeEliminated(input: {
  locale: string
  playerName: string
  score: string
  opponent: string
  tournament: string
  round: string
  category: 'men' | 'women' | string | null
}): { title: string; body: string } {
  const locale = resolvePushLocale(input.locale)
  const msg = PUSH_BY_LOCALE[locale]
  const titleKey = input.category === 'men' ? 'eliminatedTitleMen' : 'eliminatedTitleWomen'
  const title = interpolate(msg[titleKey] || msg.eliminatedTitle, { name: input.playerName })
  const event = [input.tournament, input.round].filter(Boolean).join(' ')
  const body = input.score
    ? interpolate(msg.eliminatedBody, { score: input.score, opponent: input.opponent, event })
    : interpolate(msg.eliminatedBodyNoScore, { opponent: input.opponent, event })
  return { title, body }
}

export type PushPlayer = PlayerName & { id: string; avatar_url: string | null }

export type PushMatch = {
  id: string
  round: string | null
  court: string | null
  scheduled_at: string | null
  category: string | null
  winner_pair: number | null
  tournament: { name: string | null; level: string | null; timezone: string | null } | null
  pair1_player1: PushPlayer | null
  pair1_player2: PushPlayer | null
  pair2_player1: PushPlayer | null
  pair2_player2: PushPlayer | null
  sets: Array<{ set_number: number | null; set_score: string | null; pair1_games: number | null; pair2_games: number | null }> | null
}

function allPlayers(m: PushMatch): PushPlayer[] {
  return [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2].filter((p): p is PushPlayer => !!p?.id)
}

function playerById(m: PushMatch, id: string | null | undefined): PushPlayer | null {
  if (!id) return null
  return allPlayers(m).find((p) => p.id === id) ?? null
}

function pairOf(m: PushMatch, playerId: string): 1 | 2 | null {
  if (m.pair1_player1?.id === playerId || m.pair1_player2?.id === playerId) return 1
  if (m.pair2_player1?.id === playerId || m.pair2_player2?.id === playerId) return 2
  return null
}

export type PersonalizedPush = { title: string; body: string; iconReason: 'follow' | 'bookmark'; iconAvatarUrl: string | null }

export function personalizeScheduled(
  match: PushMatch,
  recipient: { locale: string; timeZone: string | null; followedPlayerId: string | null },
): PersonalizedPush {
  const followed = playerById(match, recipient.followedPlayerId)
  const reason: 'follow' | 'bookmark' = followed ? 'follow' : 'bookmark'
  const time = formatPushTime(match.scheduled_at, {
    userTimeZone: recipient.timeZone,
    tournamentTimeZone: match.tournament?.timezone ?? null,
  })
  const copy = composeScheduled({
    locale: recipient.locale,
    reason,
    playerName: followed ? playerLastName(followed) : null,
    pair1: pairLastNames(match.pair1_player1, match.pair1_player2),
    pair2: pairLastNames(match.pair2_player1, match.pair2_player2),
    tournament: match.tournament?.name ?? '',
    round: match.round ?? '',
    court: match.court ?? '',
    time,
  })
  return {
    ...copy,
    iconReason: reason,
    iconAvatarUrl: followed?.avatar_url ?? null,
  }
}

export function personalizeEliminated(
  match: PushMatch,
  recipient: { locale: string; followedPlayerId: string | null },
): PersonalizedPush | null {
  const followed = playerById(match, recipient.followedPlayerId)
  if (!followed) return null
  const pair = pairOf(match, followed.id)
  const opp = pair === 1
    ? pairLastNames(match.pair2_player1, match.pair2_player2)
    : pair === 2
      ? pairLastNames(match.pair1_player1, match.pair1_player2)
      : ''
  const copy = composeEliminated({
    locale: recipient.locale,
    playerName: playerLastName(followed),
    score: renderFinalScore(match.sets),
    opponent: opp,
    tournament: match.tournament?.name ?? '',
    round: match.round ?? '',
    category: match.category,
  })
  return {
    ...copy,
    iconReason: 'follow',
    iconAvatarUrl: followed.avatar_url,
  }
}

export function renderFinalScore(
  sets: Array<{ set_number: number | null; set_score: string | null; pair1_games: number | null; pair2_games: number | null }> | null | undefined,
): string {
  if (!sets || sets.length === 0) return ''
  const ordered = [...sets].sort((a, b) => (a.set_number ?? 0) - (b.set_number ?? 0))
  const parts: string[] = []
  for (const s of ordered) {
    if (s.set_score) {
      parts.push(s.set_score)
      continue
    }
    if (s.pair1_games != null && s.pair2_games != null) {
      parts.push(`${s.pair1_games}-${s.pair2_games}`)
    }
  }
  return parts.join(', ')
}
