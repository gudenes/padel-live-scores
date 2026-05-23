'use client'

import Image from 'next/image'
import { useTranslations, useLocale } from 'next-intl'
import { ChunkyPressButton } from './ChunkyPressButton'
import { SideRail } from './SideRail'

export interface ForYouArticle {
  id: string
  title: string
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
  isSaved: boolean
  onSave: () => void
  onBack: () => void
}

export function ForYouCard({ article, isSaved, onSave, onBack }: ForYouCardProps) {
  const t = useTranslations('foryou')
  const locale = useLocale()
  const localizedSummary = article.summary_translations?.[locale] ?? article.summary_md ?? ''
  const bullets = localizedSummary.split('\n').map(s => s.trim()).filter(s => s.startsWith('•'))

  const onShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: article.title, url: article.source_url }) } catch {}
    } else {
      navigator.clipboard?.writeText(article.source_url)
    }
  }
  const onReadSource = () => { window.open(article.source_url, '_blank', 'noopener,noreferrer') }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0a0a0a', overflow: 'hidden' }}>
      {/* Hero */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 420, overflow: 'hidden' }}>
        {article.image_url ? (
          <Image
            src={article.image_url}
            alt=""
            fill
            sizes="100vw"
            style={{ objectFit: 'cover', objectPosition: 'center 30%' }}
            unoptimized
          />
        ) : (
          <div style={{ background: '#0a0a0a', height: '100%' }} />
        )}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(10,10,10,.6) 0%, rgba(10,10,10,.2) 12%, rgba(10,10,10,0) 30%, rgba(10,10,10,0) 50%, rgba(10,10,10,.6) 75%, rgba(10,10,10,.95) 92%, #0a0a0a 100%)',
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

      {/* Side rail */}
      <SideRail
        isSaved={isSaved}
        onSave={onSave}
        onShare={onShare}
        onReadSource={onReadSource}
      />

      {/* Card content */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 360, bottom: 64, padding: '0 20px', zIndex: 4, overflowY: 'auto' }}>
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
        </div>

        <h1 style={{ fontSize: 24, lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.015em', color: '#fff', marginBottom: 14 }}>
          {article.title}
        </h1>

        <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0 }}>
          {bullets.map((line, i) => (
            <li key={i} style={{ fontSize: 14, lineHeight: 1.5, color: '#D8D8D8', paddingLeft: 16, position: 'relative', marginBottom: 7 }}>
              <span style={{ position: 'absolute', left: 0, top: 8, width: 5, height: 5, background: '#7ED321', borderRadius: '50%' }} />
              <span dangerouslySetInnerHTML={{ __html: renderInlineBold(line.replace(/^•\s*/, '')) }} />
            </li>
          ))}
        </ul>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px',
          background: 'rgba(184,143,255,0.08)',
          border: '1px solid rgba(184,143,255,0.2)',
          borderRadius: 999,
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'rgba(184,143,255,0.85)',
        }}>
          {t('aiSummary')}
        </div>
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

/** Only allow **bold** — no other markdown to keep this safe. */
function renderInlineBold(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}
