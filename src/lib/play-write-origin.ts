/** Auth cookies also support Apple's cross-site callback: mutations need an origin gate. */
export function isTrustedPlayWrite(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin || !req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return false
  if (process.env.NODE_ENV === 'production') {
    return origin === 'https://padelnachos.com' || origin === 'https://www.padelnachos.com'
  }
  return origin === new URL(req.url).origin
}
