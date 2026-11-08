import { Dispatcher, ProxyAgent, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

const FIP_IMAGE_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** Only public FIP artwork uses the metered proxy. All other traffic stays direct. */
export function isFipImageRequest(options: Pick<Dispatcher.DispatchOptions, 'origin' | 'path'>): boolean {
  try {
    const origin = new URL(String(options.origin))
    return origin.protocol === 'https:'
      && (origin.hostname === 'www.padelfip.com' || origin.hostname === 'padelfip.com')
      && (origin.port === '' || origin.port === '443')
      && options.path.startsWith('/wp-content/uploads/')
  } catch {
    return false
  }
}

export class FipImageDispatcher extends Dispatcher {
  constructor(private readonly direct: Dispatcher, private readonly proxy: Dispatcher) {
    super()
  }

  dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    if (!isFipImageRequest(options)) return this.direct.dispatch(options, handler)
    // FIP rejects Node's default User-Agent even from the configured proxy.
    const headers: string[] = []
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
    headers.push('user-agent', FIP_IMAGE_USER_AGENT)
    return this.proxy.dispatch({ ...options, headers }, handler)
  }
}

/** Next's image optimizer uses Node fetch, which shares this dispatcher. */
export function installFipImageProxy(): void {
  const proxyUrl = process.env.FIP_PROXY_URL
  if (!proxyUrl) return
  const direct = getGlobalDispatcher()
  if (direct instanceof FipImageDispatcher) return
  setGlobalDispatcher(new FipImageDispatcher(direct, new ProxyAgent(proxyUrl)))
}
