import {hasSameLocalOrigin} from '../../../../src/lib/local-request-origin'
/** Validate the browser origin independently of Railway's internal request URL. */
export function hasAdminRequestOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  if (process.env.NODE_ENV === 'production') {
    return origin === 'https://admin.padelnachos.com'
  }
  return origin === new URL(req.url).origin || (process.env.NODE_ENV === 'development' && hasSameLocalOrigin(req))
}
