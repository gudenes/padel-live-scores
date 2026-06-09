import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase'
import NotificationsConsole from './_components/NotificationsConsole'
import type { CatalogRow } from '@/lib/notification-catalog-types'

export const metadata = { title: 'Notifications · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

async function flagOn(): Promise<boolean> {
  const s = createServiceClient()
  const { data } = await s
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'notifications_console')
    .maybeSingle()
  // Server component (SSR) → use the prod-facing `enabled` column only.
  // `enabled_local` is a localhost-dev override (see src/lib/feature-flags.ts) and
  // must not flip the page live in production.
  return Boolean(data?.enabled)
}

export default async function NotificationsPage() {
  if (!(await flagOn())) notFound()
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  let categories: CatalogRow[] = []
  try {
    const r = await fetch(`${target}/api/internal/notification-catalog`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      cache: 'no-store',
    })
    if (r.ok) categories = ((await r.json()).categories ?? []) as CatalogRow[]
  } catch {
    /* render with empty catalog on failure */
  }
  return <NotificationsConsole initialCategories={categories} />
}
