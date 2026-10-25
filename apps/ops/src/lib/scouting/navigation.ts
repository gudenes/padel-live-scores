// Only internal scouting destinations may be used by contextual return links.
export function scoutingPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith('/scouting') || /[\\\r\n]/.test(value)) return null
  try {
    const url = new URL(value, 'https://local.invalid')
    if (url.origin !== 'https://local.invalid' || !/^\/scouting(?:\/|$)/.test(url.pathname)) return null
    return url.pathname + url.search + url.hash
  } catch { return null }
}
export function scoutingEntity(path: string): string {
  const url = new URL(path, 'https://local.invalid')
  if(url.pathname==='/scouting')return url.pathname+':'+(url.searchParams.get('tournament')||url.searchParams.get('tournamentLabel')||'matches')
  return url.pathname === '/scouting/players' ? `${url.pathname}:${url.searchParams.get('player') || url.searchParams.get('view') || 'players'}` : url.pathname
}
export function playerProfileHref(ids: (string | null | undefined)[]): string | null {
  if (!ids.length || ids.length > 2 || ids.some(id => !id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) || new Set(ids).size !== ids.length) return null
  return '/scouting/players?player=' + ids.slice().sort().join('~') + '&section=overview'
}

export function tournamentMatchesHref(id?:string|null,label?:string|null):string|null {
  if(id&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return '/scouting?tournament='+id
  const name=label?.trim()
  return name&&!['Private match','Tournament','Unknown tournament'].includes(name)?'/scouting?'+new URLSearchParams({tournamentLabel:name.slice(0,300)}):null
}
