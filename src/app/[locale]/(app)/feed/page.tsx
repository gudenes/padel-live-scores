// src/app/[locale]/(app)/feed/page.tsx
import { setRequestLocale } from 'next-intl/server'
import { listPublished } from '@/lib/news-queries'
import type { NewsLocale } from '@/types/news'
import FeedClient from './FeedClient'
import { createServerClient } from '@/lib/supabase'
import { fetchFeatureFlag, FLAG_KEYS } from '@/lib/feature-flags'
import { isInForYouAllowList } from '@/lib/foryou-allow-list'
import { loadForYouArticles } from '@/lib/foryou-queries'

// Page is per-request because the For You tab visibility depends on the user's
// session (allow-list during dark launch). Cannot use revalidate.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ locale: NewsLocale }>
}

export default async function FeedPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = createServerClient()
  // Auth + flag are both optional rescue paths — feed must render even when
  // either fails (missing DATABASE_URL in local dev, transient Supabase blip,
  // unauthenticated session). Failures degrade to "no For You tab", never 500.
  // Auth is dynamic-imported because src/auth.ts evaluates DATABASE_URL at
  // module load time; a static import here would throw during page module eval
  // in any environment where DATABASE_URL is missing/malformed.
  const safeAuth = async () => {
    try {
      const { auth } = await import('@/auth')
      return await auth()
    } catch {
      return null
    }
  }
  const [originals, session, flag] = await Promise.all([
    listPublished(locale),
    safeAuth(),
    fetchFeatureFlag(supabase, FLAG_KEYS.FORYOU_ENABLED).catch(() => ({ enabled: null, enabled_local: null })),
  ])

  // Resolve the flag for prod (`enabled` column). isLocalEnv() only works
  // client-side, so server-side trusts `enabled` directly; the allow-list
  // rescues operators/testers during dark launch.
  const showForYou =
    (flag.enabled === true) ||
    isInForYouAllowList(session?.user?.email)

  const foryouArticles = showForYou ? await loadForYouArticles(supabase) : []

  return (
    <FeedClient
      originals={originals}
      showForYou={showForYou}
      foryouArticles={foryouArticles}
    />
  )
}
