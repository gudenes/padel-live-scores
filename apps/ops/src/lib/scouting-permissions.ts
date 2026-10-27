export type StaffUser = { id?: string; isOperator?: boolean; isScouter?: boolean; isViewer?: boolean }
export const canScout = (user: StaffUser | null | undefined) => !!(user?.isOperator || user?.isScouter)
export const canViewReports = (user: StaffUser | null | undefined) => canScout(user) || !!user?.isViewer
export const canWriteSession = (user: StaffUser, existing: { assigned_scouter_user_id?: string | null } | null) =>
  !!user.isOperator || (!!user.isScouter && !!user.id && (!existing || existing.assigned_scouter_user_id === user.id))

// Fail closed for scoped accounts, including unknown/new routes and server actions.
export function scouterRouteAllowed(path: string, method: string, viewer = false) {
  const read = method === 'GET' || method === 'HEAD'
  if(read&&['/scouting/players','/api/internal/scouting-intelligence','/api/internal/scouting-player-search'].includes(path))return true
  if(read && ['/scouting/academy','/training-media/milano.mp4'].includes(path)) return true
  if (read && /^\/flags\/[a-z]{2}\.png$/.test(path)) return true
  if (read && /^\/downloads\/padel-nachos-scout-\d+\.\d+\.\d+\.zip$/.test(path)) return true
  if (read && ['/scouting/court-empty.webp', '/scouting', '/scouting/matches', '/scouting/methodology', '/not-authorized'].includes(path)) return true
  if (read && /^\/scouting\/(manual\/)?[0-9a-f-]{36}\/report$/i.test(path)) return true
  if (read && /^\/api\/internal\/scouting\/[0-9a-f-]{36}(?:\/pregame)?$/i.test(path)) return true
  if (!viewer && read && (/^\/scouting\/[0-9a-f-]{36}\/live$/i.test(path) || /^\/api\/internal\/standalone-scouting\/[0-9a-f-]{36}$/i.test(path))) return true
  if (!viewer && read && /^\/scout-web\/[a-z0-9_./-]+\.(html|mjs|js|css|png|svg|webp)$/i.test(path)) return true
  if (viewer) return read && /^\/api\/internal\/(manual-)?video-scouting\/[0-9a-f-]{36}$/i.test(path)
  if (read && ['/api/internal/scouting-extension/session', '/api/internal/scouting-catalog','/api/internal/scouting-coaches', '/api/internal/tournament-explorer', '/api/internal/tournament-matches'].includes(path)) return true
  if (['GET','HEAD','POST'].includes(method) && /^\/api\/internal\/(manual-)?video-scouting\/[0-9a-f-]{36}$/i.test(path)) return true
  return ['GET','HEAD','POST'].includes(method) && path === '/api/internal/manual-scouting-matches'
}
