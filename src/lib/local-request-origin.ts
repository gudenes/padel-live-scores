/** Next may normalize req.url to localhost even when the browser used 127.0.0.1.
 * Compare against the incoming Host, while restricting both sides to loopback.
 * Do not trust forwarded headers or accept arbitrary local origins/ports.
 */
export function hasSameLocalOrigin(req: Request): boolean {
  try {
    const url = new URL(req.url)
    const origin = req.headers.get('origin')
    if (!origin) return false
    const incoming = new URL(origin)
    const host = req.headers.get('host') ?? url.host
    const expected = new URL(`${url.protocol}//${host}`)
    const loopback = ['localhost', '127.0.0.1', '[::1]']
    return loopback.includes(url.hostname) && loopback.includes(expected.hostname)
      && expected.host === host && expected.port === url.port
      && incoming.origin === origin && incoming.origin === expected.origin
  } catch { return false }
}
