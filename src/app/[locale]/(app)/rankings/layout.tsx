// src/app/[locale]/(app)/rankings/layout.tsx
// Localised metadata + sr-only h1 — reads "seo.rankings" from the active locale.

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { buildPageMetadata } from '@/lib/seo-metadata'

type Props = {
  params: Promise<{ locale: string }>
  children: React.ReactNode
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  return buildPageMetadata({ locale, pageKey: 'rankings', path: '/rankings' })
}

export default async function RankingLayout({ params, children }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'seo.rankings' })
  return (
    <>
      <h1 className="sr-only">{t('title')}</h1>
      {children}
    </>
  )
}
