export type StaffUser = { id?: string; isOperator?: boolean; isScouter?: boolean; isViewer?: boolean }
export const canScout = (user: StaffUser | null | undefined) => !!(user?.isOperator || user?.isScouter)
export const canViewReports = (user: StaffUser | null | undefined) => canScout(user) || !!user?.isViewer
export const canWriteSession = (user: StaffUser, existing: { assigned_scouter_user_id?: string | null } | null) =>
  !!user.isOperator || (!!user.isScouter && !!user.id && (!existing || existing.assigned_scouter_user_id === user.id))

// Fail closed for scoped accounts, including unknown/new routes and server actions.
export function scouterRouteAllowed(path: string, method: string, viewer = false) {
  const read = method === 'GET' || method === 'HEAD'
  if (read && ['/scouting', '/scouting/matches', '/scouting/methodology', '/not-authorized'].includes(path)) return true
  if (read && /^\/scouting\/(manual\/)?[0-9a-f-]{36}\/report$/i.test(path)) return true
  if (read && /^\/api\/internal\/scouting\/[0-9a-f-]{36}$/i.test(path)) return true
  if (viewer) return read && /^\/api\/internal\/(manual-)?video-scouting\/[0-9a-f-]{36}$/i.test(path)
  if (read && ['/api/internal/scouting-extension/session', '/api/internal/scouting-catalog','/api/internal/scouting-coaches', '/api/internal/tournament-explorer', '/api/internal/tournament-matches'].includes(path)) return true
  if (['GET','HEAD','POST'].includes(method) && /^\/api\/internal\/(manual-)?video-scouting\/[0-9a-f-]{36}$/i.test(path)) return true
  return ['GET','HEAD','POST'].includes(method) && path === '/api/internal/manual-scouting-matches'
}
