function originOf(url: string): string {
  const trimmed = url.replace(/\/$/, '')
  try {
    return new URL(trimmed).origin
  } catch {
    return trimmed.replace(/\/api\/auth\/?$/, '')
  }
}

export function publicAppUrl(): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL
  if (site) return originOf(site)
  const app = process.env.NEXT_PUBLIC_APP_URL
  if (app) return originOf(app)
  const auth = process.env.AUTH_URL
  if (auth) return originOf(auth)
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3002'
}
