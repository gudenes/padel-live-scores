import { normalizeCountry } from '@/lib/country'
import { cupTeamKey, type CupTeam } from '@/lib/world-cup'

export interface CupPlayerProfile {
  id: string
  name: string
  display_name: string | null
  country: string | null
  category: string | null
  avatar_url: string | null
}

/** Only link a unique name within the same national squad/category. Never guess by surname. */
export function resolveCupPlayer(name: string, team: CupTeam, players: CupPlayerProfile[]) {
  const key = cupTeamKey(name)
  const candidates = players.filter(p => p.category === team.category &&
    normalizeCountry(p.country) === normalizeCountry(team.country))
  const exact = candidates.filter(p => [p.name, p.display_name].some(n => n && cupTeamKey(n) === key))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const tokens = key.split(' ')
  if (tokens.length < 2) return null
  // FIP may omit a second surname. Require all published tokens, in order,
  // including the full first name; duplicate candidates remain unlinked.
  const longer = candidates.filter(p => [p.name, p.display_name].some(n => {
    if (!n) return false
    const full = cupTeamKey(n).split(' ')
    return full.length > tokens.length && tokens.every((token, i) => full[i] === token)
  }))
  return longer.length === 1 ? longer[0] : null
}
