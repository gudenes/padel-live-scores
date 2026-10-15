import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnonSub } from '@/lib/notify-recipients'
import { loadPushMatches } from '@/lib/push-event-match'
import { groupedScheduleCopy, personalizeScheduled, playerLastName, resolvePushLocale, resolveScheduledTimeZone, type PushMatch, type PushPlayer } from '@/lib/push-copy'
import { resolveNotificationIcon } from '@/lib/notification-icon'
import type { EnteredContent } from '@/lib/player-entered-content'

export function schedulePlayers(match: PushMatch): PushPlayer[] {
  return [match.pair1_player1, match.pair1_player2, match.pair2_player1, match.pair2_player2].filter((p): p is PushPlayer => !!p)
}
function rank(player: PushPlayer) {
  return player.ranking != null && player.ranking > 0 ? player.ranking : Infinity
}

/** Only the recipient's own matches/favorites contribute to the headline and count. */
export function buildScheduledNotificationContent(
  matches: PushMatch[], followedIds: Set<string>, bookmarkedIds: Set<string>,
  recipient: { locale: string; timeZone: string | null },
): EnteredContent | null {
  const relevant = matches.filter(m => (!m.status || m.status === 'scheduled') &&
    (bookmarkedIds.has(m.id) || schedulePlayers(m).some(p => followedIds.has(p.id))))
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '') || a.id.localeCompare(b.id))
  if (!relevant.length) return null
  const followed = [...new Map(relevant.flatMap(schedulePlayers).filter(p => followedIds.has(p.id)).map(p => [p.id, p])).values()]
    .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))
  const headliner = followed[0]
  const match = relevant.find(m => headliner && schedulePlayers(m).some(p => p.id === headliner.id)) ?? relevant[0]
  const copy = personalizeScheduled(match, { ...recipient, followedPlayerId: headliner?.id ?? null })
  const grouped = relevant.length > 1 || followed.length > 1
  const groupCopy = groupedScheduleCopy(recipient.locale, headliner ? playerLastName(headliner) : null, Math.max(0, followed.length - 1), relevant.length)
  return {
    title: grouped ? groupCopy.title : copy.title,
    body: grouped ? `${copy.title}\n${copy.body}\n${groupCopy.hint}` : copy.body,
    icon: resolveNotificationIcon({ reason: copy.iconReason, tournamentLevel: match.tournament?.level ?? null, followedPlayerAvatarUrl: copy.iconAvatarUrl }),
    url: relevant.length > 1 ? '/following' : `/match/${match.id}`,
  }
}

type Supa = Pick<SupabaseClient, 'from'>
type Bookmark = { user_id?: string; device_id?: string; bookmark_type: string; target_id: string }
export async function loadScheduledNotificationContents(
  supabase: Supa, ids: string[], userIds: string[], anonSubs: AnonSub[],
  locales: Map<string, string>, countries: Map<string, string | null>,
): Promise<{ byUser: Map<string, EnteredContent>; bySubscription: Map<string, EnteredContent> }> {
  const devices = [...new Set(anonSubs.map(s => s.device_id).filter((id): id is string => !!id))]
  const empty = Promise.resolve({ data: [], error: null })
  const [matches, bookmarks, anonBookmarks, native, web] = await Promise.all([
    loadPushMatches(supabase, ids),
    userIds.length ? supabase.from('user_bookmarks').select('user_id, bookmark_type, target_id').in('user_id', userIds).in('bookmark_type', ['match', 'player']) : empty,
    devices.length ? supabase.from('anon_bookmarks').select('device_id, bookmark_type, target_id').in('device_id', devices).in('bookmark_type', ['match', 'player']) : empty,
    userIds.length ? supabase.from('native_push_subscriptions').select('user_id, locale, timezone').in('user_id', userIds) : empty,
    userIds.length ? supabase.from('push_subscriptions').select('user_id, timezone').in('user_id', userIds) : empty,
  ])
  for (const r of [bookmarks, anonBookmarks, native, web]) if (r.error) throw new Error(`Schedule recipients: ${r.error.message}`)
  const zones = new Map<string, string>()
  const languages = new Map(locales)
  for (const row of web.data ?? []) if (row.timezone) zones.set(row.user_id, row.timezone)
  for (const row of native.data ?? []) {
    if (row.timezone) zones.set(row.user_id, row.timezone)
    if (row.locale) languages.set(row.user_id, resolvePushLocale(row.locale))
  }
  function content(rows: Bookmark[], locale: string, timeZone: string | null) {
    return buildScheduledNotificationContent(matches,
      new Set(rows.filter(r => r.bookmark_type === 'player').map(r => r.target_id)),
      new Set(rows.filter(r => r.bookmark_type === 'match').map(r => r.target_id)), { locale, timeZone })
  }
  const byUser = new Map<string, EnteredContent>()
  for (const id of userIds) {
    const built = content((bookmarks.data ?? []).filter(r => r.user_id === id), languages.get(id) ?? 'en', resolveScheduledTimeZone(countries.get(id), zones.get(id)))
    if (built) byUser.set(id, built)
  }
  const bySubscription = new Map<string, EnteredContent>()
  for (const sub of anonSubs) {
    const built = content((anonBookmarks.data ?? []).filter(r => r.device_id === sub.device_id), 'en', null)
    if (built) bySubscription.set(sub.id, built)
  }
  return { byUser, bySubscription }
}
