// The signup surface is public while Play is enabled. All game data and
// account setup remain behind requirePlayAccess and the existing whitelist.

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { buildPageMetadata } from '@/lib/seo-metadata'
import {auth} from '@/auth'
import {createServiceClient} from '@/lib/supabase'
import PlayWelcome from './_components/PlayWelcome'
import { isPlayEnabled, requirePlayAccess } from '@/lib/play-access'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params

  // generateMetadata runs INDEPENDENTLY of the component tree, so it still
  // executes when the layout below is about to 404. Measured: a logged-out
  // visitor to /play got the "Esta página no existe" body under the title
  // "Play the Next | Padel Nachos" — the 404 announcing the very feature the
  // 404 exists to hide. Gate the metadata on the same check.
  //
  // This costs a second requirePlayAccess() on the allowed path. Both calls
  // are two indexed lookups against the service client, and the alternative
  // (caching the grant across the two entry points) buys microseconds at the
  // price of a subtle request-scoped cache. Not worth it.
  const grant = await requirePlayAccess()
  if (!grant) return {}

  return buildPageMetadata({ locale, pageKey: 'play', path: '/play' })
}

export default async function PlayLayout({ children }: Props) {
  const grant = await requirePlayAccess()
  if (!grant) {
    const session = await auth()
    if (!session?.user?.id && await isPlayEnabled(createServiceClient())) return <PlayWelcome/>
    notFound()
  }
  return <>{children}</>
}
