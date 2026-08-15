export function publicAppUrl(): string {
  const auth = process.env.AUTH_URL?.replace(/\/$/, '')
  if (auth) return auth
  const app = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '')
  if (app) return app
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  return 'http://localhost:3002'
}
