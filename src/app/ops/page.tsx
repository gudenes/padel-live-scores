// src/app/ops/page.tsx
// Server component: fetches initial dashboard data and passes to client.

import OpsClient from './OpsClient'

export const dynamic = 'force-dynamic'

async function fetchInitialData(baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/ops/api/status`, {
      headers: { Cookie: `ops_token=${process.env.CRON_SECRET}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function OpsPage() {
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  const host = process.env.VERCEL_URL ?? 'localhost:3002'
  const baseUrl = `${protocol}://${host}`
  const data = await fetchInitialData(baseUrl)

  return <OpsClient initialData={data} />
}
