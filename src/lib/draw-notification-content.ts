import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveNotificationIcon } from '@/lib/notification-icon'
import { playerLastName } from '@/lib/player-name'
import { resolvePushLocale, additionalPlayersCopy } from '@/lib/push-copy'
import type { EnteredContent, EnteredPlayer } from '@/lib/player-entered-content'
import en from '@/messages/en.json'
import pt from '@/messages/pt.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import it from '@/messages/it.json'

const messages = { en: en.push, pt: pt.push, es: es.push, fr: fr.push, it: it.push }
type Tournament = { id: string; name: string | null; level: string | null; drawCategory?: string }
type DrawPlayer = EnteredPlayer & { drawCategory?: string }

export function buildDrawNotificationContent(
  tournament: Tournament, followed: DrawPlayer[], locale: string,
): EnteredContent {
  const copy = messages[resolvePushLocale(locale)]
  // One notification even for several favorites. A stable headliner supplies the image.
  const unique = [...new Map(followed.map(p => [p.id, p])).values()]
  const player = unique.filter(p => playerLastName(p)).sort((a, b) =>
    (a.ranking && a.ranking > 0 ? a.ranking : Infinity) - (b.ranking && b.ranking > 0 ? b.ranking : Infinity) || a.id.localeCompare(b.id),
  )[0]
  const tournamentName = tournament.name || copy.drawTournamentFallback
  const fill = (value: string) => value.replace(/\{(name|tournament)\}/g,
    (_, key: string) => key === 'name' ? playerLastName(player) : tournamentName)
  const category = player?.drawCategory ?? tournament.drawCategory
  return {
    title: fill(player ? copy.drawFollowTitle : copy.drawTitle) + (player && unique.length > 1 ? ` · ${additionalPlayersCopy(locale, unique.length - 1)}` : ''),
    body: fill(player ? copy.drawFollowBody : copy.drawBody),
    icon: resolveNotificationIcon({
      reason: player ? 'follow' : 'bookmark',
      tournamentLevel: tournament.level,
      followedPlayerAvatarUrl: player?.avatar_url,
    }),
    url: `/tournaments/${tournament.id}?tab=draw${category === 'women' || category === 'men' ? `&category=${category}` : ''}`,
  }
}

export async function loadDrawNotificationContents(
  supabase: Pick<SupabaseClient, 'from'>, tournamentId: string,
  userIds: string[], locales: Map<string, string>,
): Promise<{ byUser: Map<string, EnteredContent>; anonymous: EnteredContent }> {
  const [tournamentRes, drawRes, followRes] = await Promise.all([
    supabase.from('tournaments').select('id, name, level').eq('id', tournamentId).maybeSingle(),
    supabase.from('tournament_draws').select('player1_id, player2_id, category').eq('tournament_id', tournamentId),
    userIds.length ? supabase.from('user_bookmarks').select('user_id, target_id')
      .eq('bookmark_type', 'player').in('user_id', userIds) : Promise.resolve({ data: [], error: null }),
  ])
  for (const result of [tournamentRes, drawRes, followRes]) {
    if (result.error) throw new Error(`Draw notification content: ${result.error.message}`)
  }
  const tournament: Tournament = tournamentRes.data ?? { id: tournamentId, name: null, level: null }
  const bracketIds = new Set<string>((drawRes.data ?? []).flatMap(row =>
    [row.player1_id, row.player2_id].filter((id): id is string => typeof id === 'string' && !!id)))
  const categories = new Set((drawRes.data ?? []).map(row => row.category).filter(Boolean))
  if (categories.size === 1) tournament.drawCategory = [...categories][0]
  const follows = (followRes.data ?? []).filter(row => bracketIds.has(row.target_id))
  const ids = [...new Set<string>(follows.map(row => row.target_id))]
  const directory = new Map<string, DrawPlayer>()
  if (ids.length) {
    const { data, error } = await supabase.from('players')
      .select('id, name, display_name, avatar_url, ranking').in('id', ids)
    if (error) throw new Error(`Draw notification players: ${error.message}`)
    for (const player of (data ?? []) as EnteredPlayer[]) {
      const bracket = (drawRes.data ?? []).find(row => row.player1_id === player.id || row.player2_id === player.id)
      directory.set(player.id, { ...player, drawCategory: bracket?.category })
    }
  }
  const byUser = new Map<string, EnteredContent>()
  for (const id of userIds) {
    const followed = follows.filter(row => row.user_id === id)
      .map(row => directory.get(row.target_id)).filter((p): p is DrawPlayer => !!p)
    byUser.set(id, buildDrawNotificationContent(tournament, followed, locales.get(id) ?? 'en'))
  }
  return { byUser, anonymous: buildDrawNotificationContent(tournament, [], 'en') }
}
