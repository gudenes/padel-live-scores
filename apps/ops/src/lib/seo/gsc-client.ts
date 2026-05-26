// apps/ops/src/lib/seo/gsc-client.ts
// Thin wrapper around Google Search Console's Search Analytics API.
// Auth: OAuth 2.0 refresh-token flow via google-auth-library's
// UserRefreshClient. The refresh token is minted once via
// apps/ops/scripts/mint-gsc-refresh-token.ts and stored in Vercel env.
// We use OAuth (not service-account JSON) because the GCP org policy
// iam.managed.disableServiceAccountKeyCreation blocks key creation.
//
// Token caching: UserRefreshClient caches the short-lived access token
// in memory and only refreshes when it expires. Re-use the same
// GscClient instance for the lifetime of a Lambda invocation to avoid
// redundant token-refresh round-trips.

import { UserRefreshClient } from 'google-auth-library'

const FETCH_TIMEOUT_MS = 10_000

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

const SEARCH_ANALYTICS_URL = (siteUrl: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`

const LIST_SITES_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites'

export interface GscQueryInput {
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  // Curated subset of GSC's dimensions. The API supports more
  // (searchAppearance, searchType, …); expand if a future task needs them.
  dimensions: Array<'page' | 'query' | 'date' | 'country' | 'device'>
  rowLimit?: number
}

export interface GscRow {
  keys: string[]
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GscClientConfig {
  clientId: string
  clientSecret: string
  refreshToken: string
  siteUrl: string
}

export class GscClient {
  private auth: UserRefreshClient
  private siteUrl: string

  constructor(cfg: GscClientConfig) {
    this.auth = new UserRefreshClient(cfg.clientId, cfg.clientSecret, cfg.refreshToken)
    this.siteUrl = cfg.siteUrl
  }

  static fromEnv(): GscClient {
    const clientId = process.env.GSC_OAUTH_CLIENT_ID
    const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET
    const refreshToken = process.env.GSC_OAUTH_REFRESH_TOKEN
    const siteUrl = process.env.GSC_SITE_URL
    if (!clientId || !clientSecret || !refreshToken || !siteUrl) {
      throw new Error('GSC env vars missing: need GSC_OAUTH_CLIENT_ID, GSC_OAUTH_CLIENT_SECRET, GSC_OAUTH_REFRESH_TOKEN, GSC_SITE_URL')
    }
    return new GscClient({ clientId, clientSecret, refreshToken, siteUrl })
  }

  async listSites(): Promise<{ siteUrl: string; permissionLevel: string }[]> {
    const { token } = await this.auth.getAccessToken()
    const res = await fetchWithTimeout(LIST_SITES_URL, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error(`GSC listSites failed: ${res.status} ${await res.text()}`)
    const data = await res.json() as { siteEntry?: { siteUrl: string; permissionLevel: string }[] }
    return data.siteEntry ?? []
  }

  async query(input: GscQueryInput): Promise<GscRow[]> {
    const { token } = await this.auth.getAccessToken()
    const res = await fetchWithTimeout(SEARCH_ANALYTICS_URL(this.siteUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GSC query failed: ${res.status} ${body}`)
    }
    const data = await res.json() as { rows?: GscRow[] }
    return data.rows ?? []
  }
}
