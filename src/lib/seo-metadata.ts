// src/lib/seo-metadata.ts
// Centralised metadata builder for localised pages.
//
// Reads title + description for the requested page key from the active
// locale's "seo" namespace, then composes full Next.js Metadata (canonical,
// hreflang alternates, openGraph, twitter). Keeps per-page layouts to a
// single function call.
//
// Why this exists: before this helper, every page layout hard-coded an
// English title + description. Non-English locales served English metadata
// and couldn't rank for localised queries (e.g. "resultados padel").

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { buildAlternates } from '@/lib/seo-helpers'

type SeoPageKey = 'home' | 'matches' | 'rankings' | 'feed' | 'about' | 'following'

// Map our i18n locale codes → BCP-47 OG locale tags
const OG_LOCALE: Record<string, string> = {
  en: 'en_US',
  es: 'es_ES',
  pt: 'pt_PT',
  it: 'it_IT',
  fr: 'fr_FR',
}

interface BuildPageMetadataInput {
  locale: string
  pageKey: SeoPageKey
  /** Canonical path without locale prefix, e.g. "/home" */
  path: string
}

/**
 * Build Metadata for a localised app page.
 *
 * Reads `seo.<pageKey>.title` and `seo.<pageKey>.description` from the
 * active locale's messages. The title is intentionally NOT suffixed with
 * "| Padel Nachos" — the root layout's title template handles that.
 */
export async function buildPageMetadata(
  { locale, pageKey, path }: BuildPageMetadataInput,
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'seo' })
  const title = t(`${pageKey}.title`)
  const description = t(`${pageKey}.description`)
  const ogLocale = OG_LOCALE[locale] ?? 'en_US'

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      locale: ogLocale,
      type: 'website',
    },
    twitter: {
      title,
      description,
    },
    ...buildAlternates(path, locale),
  }
}

/**
 * Build Metadata override for the locale root (used by [locale]/layout.tsx).
 * Provides localised description + openGraph.locale while keeping the
 * root title template intact for child pages to fill in.
 */
export async function buildLocaleRootMetadata(locale: string): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'seo' })
  const description = t('root.description')
  const ogLocale = OG_LOCALE[locale] ?? 'en_US'

  return {
    description,
    openGraph: {
      description,
      locale: ogLocale,
      type: 'website',
    },
    twitter: {
      description,
    },
  }
}

interface BuildDailyMetadataInput {
  locale: string
  /** Localised human-readable date to interpolate into "{date}" in the template. */
  dateLong: string
  /** Canonical path (locale-neutral) — e.g. "/matches/2026-04-17" */
  path: string
}

/**
 * Build Metadata for the /matches/[date] daily page. Reads template strings
 * with ICU `{date}` placeholder from `seo.daily.{title,description}`.
 */
export async function buildDailyMetadata(
  { locale, dateLong, path }: BuildDailyMetadataInput,
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'seo.daily' })
  const title = t('title', { date: dateLong })
  const description = t('description', { date: dateLong })
  const ogLocale = OG_LOCALE[locale] ?? 'en_US'

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      locale: ogLocale,
      type: 'website',
    },
    twitter: {
      title,
      description,
    },
    ...buildAlternates(path, locale),
  }
}
