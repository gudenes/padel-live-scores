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
  return url.pathname === '/scouting/players' ? `${url.pathname}:${url.searchParams.get('player') || url.searchParams.get('view') || 'players'}` : url.pathname
}
export function playerProfileHref(ids: (string | null | undefined)[]): string | null {
  if (!ids.length || ids.length > 2 || ids.some(id => !id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) || new Set(ids).size !== ids.length) return null
  return '/scouting/players?player=' + ids.slice().sort().join('~') + '&section=overview'
}
