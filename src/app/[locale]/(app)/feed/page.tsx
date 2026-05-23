// src/app/[locale]/(app)/feed/page.tsx
import { setRequestLocale } from 'next-intl/server'
import { listPublished } from '@/lib/news-queries'
import type { NewsLocale } from '@/types/news'
import FeedClient from './FeedClient'
import { auth } from '@/auth'
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
  const [originals, session, flag] = await Promise.all([
    listPublished(locale),
    auth(),
    fetchFeatureFlag(supabase, FLAG_KEYS.FORYOU_ENABLED),
  ])

  // Resolve the flag for prod (`enabled` column). isLocalEnv() only works
  // client-side, so server-side trusts `enabled` directly; the allow-list
  // rescues operators/testers during dark launch.
  const showForYou =
    (flag.enabled === true) ||
    isInForYouAllowList(session?.user?.email)

  const foryouArticles = showForYou ? await loadForYouArticles(supabase, locale) : []

  return (
    <FeedClient
      originals={originals}
      showForYou={showForYou}
      foryouArticles={foryouArticles}
    />
  )
}
