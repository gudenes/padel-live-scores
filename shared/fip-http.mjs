import { Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

export const FIP_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const installedMarker = Symbol.for('padelnachos.fipProxy')

/** Only the public FIP HTTPS hosts use the metered proxy. */
export function isFipRequest(options) {
  try {
    const origin = new URL(String(options.origin))
    return origin.protocol === 'https:'
      && ['www.padelfip.com', 'padelfip.com'].includes(origin.hostname)
      && (origin.port === '' || origin.port === '443')
  } catch { return false }
}

/** Normalize legacy URLs from operator-managed sources as well as code. */
export function normalizeFipRestUrl(input) {
  const url = new URL(input)
  if (!isFipRequest({ origin: url.origin })) return input
  const match = url.pathname.match(/^(\/[a-z]{2})?\/wp-json(\/.*)$/)
  if (!match) return input
  url.pathname = `${match[1] ?? ''}/`
  url.searchParams.set('rest_route', match[2])
  return url.toString()
}

export class FipDispatcher extends Dispatcher {
  constructor(direct, proxy) {
    super()
    this.direct = direct
    this.proxy = proxy
    this[installedMarker] = true
  }

  dispatch(options, handler) {
    if (!isFipRequest(options)) return this.direct.dispatch(options, handler)
    const url = new URL(normalizeFipRestUrl(new URL(options.path, String(options.origin)).toString()))
    const headers = []
    if (Array.isArray(options.headers)) {
      for (let i = 0; i < options.headers.length; i += 2) {
        if (String(options.headers[i]).toLowerCase() !== 'user-agent') {
          headers.push(String(options.headers[i]), String(options.headers[i + 1]))
        }
      }
    } else {
      for (const [key, value] of Object.entries(options.headers ?? {})) {
        if (key.toLowerCase() === 'user-agent' || value === undefined) continue
        for (const item of Array.isArray(value) ? value : [value]) headers.push(key, String(item))
      }
    }
    headers.push('user-agent', FIP_USER_AGENT)
    return this.proxy.dispatch({ ...options, path: url.pathname + url.search, headers }, handler)
  }
}

/** Shared by both Next startup hooks and opt-in maintenance scripts. */
export function installFipProxy() {
  const proxyUrl = process.env.FIP_PROXY_URL
  if (!proxyUrl) return
  const direct = getGlobalDispatcher()
  if (direct[installedMarker]) return
  setGlobalDispatcher(new FipDispatcher(direct, new ProxyAgent(proxyUrl)))
}
