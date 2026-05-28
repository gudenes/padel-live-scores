'use client'

import { useState, type SyntheticEvent } from 'react'
import Image from 'next/image'
import { useTranslations, useLocale } from 'next-intl'
import { ChunkyPressButton } from './ChunkyPressButton'

/**
 * Photo treatment: pick between cover (immersive crop) and contain (letterbox
 * + blurred backdrop) per-image based on aspect ratio. Landscape source photos
 * (AR > 1.4) get the contain treatment so we don't squish them vertically;
 * portrait/square photos get the cover treatment with an upper-third bias
 * (`center 30%`) so faces survive the crop.
 *
 * The threshold of 1.4 was picked empirically: 16:9 ≈ 1.78, 4:3 ≈ 1.33. So
 * "TV-shape" landscape uses contain; 4:3 and squarer uses cover.
 */
const LANDSCAPE_AR_THRESHOLD = 1.4
type FitMode = 'cover' | 'contain'

export interface ForYouArticle {
  id: string
  title: string
  /** Eager Haiku translation populated by sync-articles on ingest. Falls back to `title`. */
  title_translations: Partial<Record<string, string>> | null
  source_url: string
  source_name: string | null
  favicon_url: string | null
  image_url: string | null
  published_at: string | null
  language: string | null
  summary_md: string | null
  summary_translations: Record<string, string>
  tournament_level: string | null
}

export interface ForYouCardProps {
  article: ForYouArticle
  onBack: () => void
  /** Deprecated — scroll-snap in ForYouTab now handles the peek via shorter
   *  card containers. Kept for backwards-compat with the scratch route. */
  peekPx?: number
}

function pickTitle(article: ForYouArticle, locale: string): string {
  const short = (locale ?? 'en').slice(0, 2).toLowerCase()
  const translated = article.title_translations?.[short]
  return translated && translated.trim().length > 0 ? translated : article.title
}

function summaryToParagraph(summary: string): string {
  if (summary.includes('\n') || summary.startsWith('•')) {
    return summary
      .split('\n')
      .map(line => line.replace(/^•\s*/, '').trim())
      .filter(Boolean)
      .join(' ')
  }
  return summary.trim()
}

function AISparkleIcon({ size = 12, color = 'rgba(184,143,255,0.85)' }: { size?: number; color?: string }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color, flexShrink: 0 }}>
      <path d="M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4z" />
    </svg>
  )
}

export function ForYouCard({ article, onBack, peekPx = 60 }: ForYouCardProps) {
  const t = useTranslations('foryou')
  const locale = useLocale()
  const localizedTitle = pickTitle(article, locale)
  const localizedSummary = article.summary_translations?.[locale] ?? article.summary_md ?? ''
  const paragraph = summaryToParagraph(localizedSummary)

  // Default to 'cover' for the SSR / initial paint; once the image actually
  // loads we measure the natural aspect ratio and swap to 'contain' for wide
  // landscape photos (see LANDSCAPE_AR_THRESHOLD note above).
  const [fitMode, setFitMode] = useState<FitMode>('cover')
  const handleImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      const ar = img.naturalWidth / img.naturalHeight
      setFitMode(ar > LANDSCAPE_AR_THRESHOLD ? 'contain' : 'cover')
    }
  }

  const onShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: localizedTitle, url: article.source_url }) } catch {}
    } else {
      navigator.clipboard?.writeText(article.source_url)
    }
  }
  const onReadSource = () => { window.open(article.source_url, '_blank', 'noopener,noreferrer') }

  // Bottom CTAs sit at the bottom of the card itself.
  // (Browser scroll-snap shows the next-card peek BELOW this card naturally.)
  const buttonsBottom = peekPx + 14
  const contentBottom = buttonsBottom + 44 + 14

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0a0a0a', overflow: 'hidden' }}>
      {/* Hero — hybrid photo treatment.
       *  Landscape photos (AR > 1.4) render `contain` with a blurred copy as
       *  side-bar backdrop, so we never crop heads or squish the image. Other
       *  shapes render `cover` with an upper-third bias (`center 30%`) so
       *  faces in news photos survive the crop.
       *  Gradient is lighter than the old version to eat less of the photo. */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 430, overflow: 'hidden', background: '#0a0a0a' }}>
        {article.image_url ? (
          <>
            {/* Blurred backdrop — only meaningful in contain mode where the
             *  letterbox bars would otherwise be solid black. Rendered as a
             *  plain CSS background for cheap GPU compositing. */}
            {fitMode === 'contain' && (
              <div
                aria-hidden
                style={{
                  position: 'absolute', inset: 0, zIndex: 0,
                  backgroundImage: `url("${article.image_url}")`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(30px) brightness(0.55) saturate(1.1)',
                  transform: 'scale(1.2)', // hide blur edge clipping
                }}
              />
            )}
            <Image
              src={article.image_url}
              alt=""
              fill
              sizes="100vw"
              onLoad={handleImageLoad}
              style={{
                objectFit: fitMode,
                objectPosition: fitMode === 'cover' ? 'center 30%' : 'center center',
                zIndex: 1,
              }}
              unoptimized
            />
          </>
        ) : (
          <div style={{ background: '#0a0a0a', height: '100%' }} />
        )}
        <div style={{
          position: 'absolute', inset: 0, zIndex: 2,
          background: 'linear-gradient(180deg, rgba(10,10,10,.35) 0%, rgba(10,10,10,0) 20%, rgba(10,10,10,0) 65%, rgba(10,10,10,.7) 85%, rgba(10,10,10,.95) 96%, #0a0a0a 100%)',
        }} />
      </div>

      {/* Back chip */}
      <div style={{ position: 'absolute', top: 42, left: 14, zIndex: 25 }}>
        <ChunkyPressButton ariaLabel="Back" onClick={onBack} style={{ width: 32 }}>
          <span style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>‹</span>
        </ChunkyPressButton>
      </div>

      {/* Topic chip — only when tournament_level is known */}
      {article.tournament_level && (
        <div style={{
          position: 'absolute', top: 42, left: 54, zIndex: 25,
          padding: '7px 10px',
          background: '#F5A623', color: '#0a0a0a',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
          clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
        }}>
          {article.tournament_level}
        </div>
      )}

      {/* Card content — clamped, no scroll. Top tracks hero height
       *  (430) minus the gradient overlap zone (~40px) so content starts
       *  on the dark portion of the gradient. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 390, bottom: contentBottom,
        padding: '0 20px', zIndex: 4, overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#B0B0B0', marginBottom: 10 }}>
          {article.favicon_url && (
            <Image src={article.favicon_url} alt="" width={16} height={16} style={{ borderRadius: 3 }} unoptimized />
          )}
          <span style={{ fontWeight: 700, color: '#fff' }}>{article.source_name ?? 'Padel news'}</span>
          {article.published_at && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555' }} />
              <span>{relativeTime(article.published_at)}</span>
            </>
          )}
          <span aria-label={t('aiSummary')} title={t('aiSummary')} style={{ display: 'inline-flex' }}>
            <AISparkleIcon />
          </span>
        </div>

        <h1 style={{
          fontSize: 22, lineHeight: 1.15, fontWeight: 800, letterSpacing: '-0.015em',
          color: '#fff', marginBottom: 14,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {localizedTitle}
        </h1>

        <p style={{
          fontSize: 15, lineHeight: 1.5, color: '#D8D8D8', margin: 0,
          // 8-line clamp: most modern phones (800+ px svh) have room for
          // ~280-380px of body, comfortably fitting 8 lines @ 22.5px each.
          // Smaller viewports (iPhone SE @ 667px) may visually clip the
          // last line against the action-chip row; `overflow: hidden` on
          // the parent keeps the layout intact.
          display: '-webkit-box', WebkitLineClamp: 8, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}
          dangerouslySetInnerHTML={{ __html: renderInlineBold(paragraph) }}
        />
      </div>

      {/* Bottom CTAs — Read article + Share, equal width */}
      <div style={{
        position: 'absolute', left: 16, right: 16, bottom: buttonsBottom,
        display: 'flex', gap: 10, zIndex: 5,
      }}>
        <ChunkyPressButton ariaLabel={t('readSource')} variant="green" onClick={onReadSource} style={{ flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0', fontSize: 13, fontWeight: 700 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7" />
            </svg>
            {t('readArticle')}
          </span>
        </ChunkyPressButton>
        <ChunkyPressButton ariaLabel={t('share')} onClick={onShare} style={{ flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 0', fontSize: 13, fontWeight: 700 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10.59 13.5l4.83 2.83M15.41 7.66l-4.82 2.83" />
            </svg>
            {t('share')}
          </span>
        </ChunkyPressButton>
      </div>
    </div>
  )
}

function relativeTime(iso: string): string {
  const dt = Date.parse(iso)
  const dh = (Date.now() - dt) / 3_600_000
  if (dh < 1) return `${Math.max(1, Math.round(dh * 60))}m ago`
  if (dh < 24) return `${Math.round(dh)}h ago`
  return `${Math.round(dh / 24)}d ago`
}

function renderInlineBold(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}
