// src/app/[locale]/(app)/feed/layout.tsx
// Localised metadata — reads "seo.feed" from the active locale.

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'feed', path: '/feed' })
}

export default async function FeedLayout({ params, children }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'seo.feed' })
  return (
    <>
      <h1 className="sr-only">{t('title')}</h1>
      {children}
    </>
  )
}
