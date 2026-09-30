import {hasSameLocalOrigin} from './local-request-origin'
/** Auth cookies also support Apple's cross-site callback: mutations need an origin gate. */
export function isTrustedPlayWrite(req: Request, contentType = 'application/json'): boolean {
  const origin = req.headers.get('origin')
  if (!origin || !req.headers.get('content-type')?.toLowerCase().startsWith(contentType)) return false
  if (process.env.NODE_ENV === 'production') {
    return origin === 'https://padelnachos.com' || origin === 'https://www.padelnachos.com'
  }
  return hasSameLocalOrigin(req) || origin === new URL(req.url).origin
}
