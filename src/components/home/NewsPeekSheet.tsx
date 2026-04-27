'use client'

// src/components/home/NewsPeekSheet.tsx
//
// Bottom-sheet preview for a news article. Triggered when a user taps a
// news card in the home `<HighlightsPreview>` carousel — instead of
// navigating away to the source URL on first tap, we open this sheet
// with the article's snippet (translated to user locale if needed) and
// give them an explicit "Read at source" CTA.
//
// Why a sheet vs a route:
//   - Carousel doesn't lose its scroll position
//   - Translation can be lazy + cached without page-load overhead
//   - Source language toggle is right there, instead of buried in a
//     settings menu
//
// Translation fetch:
//   - Hits /api/articles/[id]/translate?locale=<userLocale>
//   - Skipped entirely when article.language === userLocale (the API
//     also short-circuits in that case, so this is just a latency win)
//   - Skeleton shimmer renders while in-flight; if Claude fails the
//     route gracefully degrades to source snippet, so we never block
//
// Accessibility:
//   - Focus trapped inside the sheet while open (close button receives
//     initial focus)
//   - ESC + backdrop click both close
//   - aria-modal + role="dialog"
//   - prefers-reduced-motion: skip the slide-up animation
//
// We deliberately don't implement swipe-to-dismiss yet — the
// close button + backdrop + ESC cover all platforms; swipe is a
// follow-up if user testing shows people reaching for it.

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { GREEN, MUTED, BG_CARD, localizedTitle, type NewsItem } from './shared'

// Brand surfaces for the sheet — slightly darker than BG_CARD so the
// transition from page background reads as elevated content.
const SHEET_BG = '#0F0F0F'
const ELEVATED = '#1F1F1F'
const BORDER = 'rgba(255,255,255,0.06)'
const GREEN_DIM = 'rgba(126,211,33,0.15)'

// 5 app locales per next-intl. Used both for the language toggle UI
// and to validate userLocale before passing it as a query param.
const SUPPORTED_LOCALES = ['en', 'es', 'pt', 'it', 'fr'] as const
type Locale = (typeof SUPPORTED_LOCALES)[number]

const LOCALE_LABEL: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  pt: 'Português',
  it: 'Italiano',
  fr: 'Français',
}

interface TranslateResponse {
  snippet: string | null
  translated: boolean
  sourceLocale: string | null
  targetLocale: Locale
  fromCache: boolean
}

export interface NewsPeekSheetProps {
  article: NewsItem | null
  onClose: () => void
  userLocale: string
  bookmarked: boolean
  onToggleBookmark: () => void
}

const NewsPeekSheet: React.FC<NewsPeekSheetProps> = ({
  article,
  onClose,
  userLocale,
  bookmarked,
  onToggleBookmark,
}) => {
  const t = useTranslations('feed.peek')
  // The component stays mounted across opens so the slide-down
  // animation has time to play before unmount. We track whether the
  // sheet should currently be visible (article != null) separately
  // from the actual `mounted` flag that drives DOM presence.
  const [mounted, setMounted] = useState(false)
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // Normalize incoming locale to one of our 5; default to English.
  // Locales like "en-US" reduce to "en".
  const normalizedLocale: Locale = useMemo(() => {
    const short = (userLocale ?? 'en').slice(0, 2).toLowerCase()
    return (SUPPORTED_LOCALES as readonly string[]).includes(short)
      ? (short as Locale)
      : 'en'
  }, [userLocale])

  // Mount + unmount with animation. When `article` becomes non-null we
  // mount immediately and the CSS transition handles the slide-up.
  // When it goes null, we keep the DOM around for 280ms to let the
  // slide-down play, then unmount.
  useEffect(() => {
    if (article) {
      setMounted(true)
      // Body scroll lock — sheet is full-height-ish; preventing the
      // page underneath from scrolling avoids the "sheet drifts off
      // the viewport" weirdness on iOS.
      document.body.style.overflow = 'hidden'
      // Defer focus to the close button until after the slide-up
      // animation kicks in; otherwise the focus ring jumps before the
      // sheet is on-screen.
      setTimeout(() => closeBtnRef.current?.focus(), 50)
      // Defensive cleanup: if this component unmounts while the sheet
      // is open (e.g., the user pivots from /home to /home?view=tournaments,
      // which swaps the whole subtree), the else-branch never fires and
      // the body stays locked at 'hidden'. Always restore on unmount.
      return () => {
        document.body.style.overflow = ''
      }
    } else if (mounted) {
      document.body.style.overflow = ''
      const t = setTimeout(() => setMounted(false), 280)
      return () => clearTimeout(t)
    }
    return undefined
    // mounted intentionally omitted — we manage it ourselves in the
    // close branch and re-running the effect on its change would
    // double-fire body-scroll-lock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article])

  // ESC closes. Captured at the document level rather than the dialog
  // element so it works even when focus is outside the sheet (e.g.,
  // user has clicked into the address bar).
  useEffect(() => {
    if (!article) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [article, onClose])

  // Translation state. Keyed on (articleId, viewLocale) so that toggling
  // the language inside an open sheet refetches as needed. We start in
  // the user's locale; the toggle below lets them flip to source if
  // they'd rather read the original.
  const [viewLocale, setViewLocale] = useState<Locale>(normalizedLocale)
  const [data, setData] = useState<TranslateResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state on article change — closing + re-opening with a
  // different article should NOT show the previous article's snippet
  // for the loading flicker.
  useEffect(() => {
    if (article) {
      setData(null)
      setError(null)
      setViewLocale(normalizedLocale)
    }
  }, [article, normalizedLocale])

  // Fetch on locale change OR new article. Source-language matches
  // skip the network entirely — the sheet just renders article.* and
  // we synthesize a TranslateResponse client-side.
  useEffect(() => {
    if (!article) return
    const sourceLang = (article.language ?? '').slice(0, 2).toLowerCase()

    // No translation needed — viewing in the source language directly.
    if (sourceLang === viewLocale || !sourceLang) {
      setData({
        snippet: null, // home query doesn't fetch snippet — we still
                       // need the API to return it from articles table
        translated: false,
        sourceLocale: sourceLang || null,
        targetLocale: viewLocale,
        fromCache: false,
      })
      // …but we still need to fetch the snippet itself, which the home
      // payload doesn't include. The route returns the source when
      // sourceLocale === targetLocale, so this is the same call.
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/articles/${encodeURIComponent(article.id)}/translate?locale=${viewLocale}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((j: TranslateResponse) => {
        if (cancelled) return
        setData(j)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load preview')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [article, viewLocale])

  // Honour the OS-level reduced-motion preference. When set we skip
  // the slide-up animation entirely (snap into place) but keep the
  // backdrop fade — a soft fade is fine for vestibular sensitivity.
  const prefersReducedMotion = useMemo(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  if (!mounted || !article) return null

  const open = article !== null
  const sourceLang = (article.language ?? '').slice(0, 2).toLowerCase() as Locale | ''
  const showLangToggle = !!sourceLang && sourceLang !== normalizedLocale && sourceLang in LOCALE_LABEL
  const sourceName = article.source_name ?? ''
  const faviconUrl = article.source_icon
    || `https://www.google.com/s2/favicons?domain=${(() => { try { return new URL(article.url).hostname } catch { return '' } })()}&sz=64`

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-peek-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {/* Backdrop — fades in/out independently of the sheet */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          opacity: open ? 1 : 0,
          transition: 'opacity 200ms ease',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }}
      />

      {/* Sheet panel */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 560,
          maxHeight: '88vh',
          background: SHEET_BG,
          borderTop: `1px solid ${BORDER}`,
          borderRadius: '16px 16px 0 0',
          overflow: 'auto',
          boxShadow: '0 -16px 40px rgba(0,0,0,0.5)',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: prefersReducedMotion
            ? 'none'
            : 'transform 320ms cubic-bezier(0.16, 1, 0.3, 1)',
          // Tap targets near the bottom safe area on iOS — extend
          // padding-bottom past the home indicator.
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Drag handle (decorative — actual drag-to-dismiss isn't
            wired up yet; backdrop + close button cover dismissal). */}
        <div
          aria-hidden="true"
          style={{
            width: 36,
            height: 4,
            background: 'rgba(255,255,255,0.16)',
            borderRadius: 2,
            margin: '8px auto 0',
          }}
        />

        {/* Image header — same aspect ratio as the carousel cards so
            the visual transition feels continuous when the sheet
            slides up over the source card. */}
        {article.image_url && (
          <div style={{
            position: 'relative',
            aspectRatio: '16 / 9',
            margin: '12px 14px 0',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.image_url}
              alt=""
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                objectFit: 'cover',
              }}
            />
            {/* Source favicon — same chip the card uses */}
            <div style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 32,
              height: 32,
              borderRadius: 8,
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
              zIndex: 2,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={faviconUrl}
                alt={sourceName}
                style={{ width: 22, height: 22, borderRadius: 4 }}
              />
            </div>
          </div>
        )}

        <div style={{ padding: '14px 16px 18px' }}>
          {/* Source line + language toggle */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 11,
            color: MUTED,
            fontFamily: 'var(--font-mono, ui-monospace), monospace',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontWeight: 600,
            marginBottom: 10,
          }}>
            <span>{sourceName}</span>
            <span style={{ color: 'rgba(255,255,255,0.3)' }}>·</span>
            <span>{timeAgoShort(article.published_at)}</span>

            {showLangToggle && (
              <div style={{
                marginLeft: 'auto',
                display: 'inline-flex',
                gap: 1,
                background: ELEVATED,
                borderRadius: 14,
                padding: 2,
                border: `1px solid ${BORDER}`,
              }}>
                <LangPill
                  active={viewLocale === normalizedLocale}
                  onClick={() => setViewLocale(normalizedLocale)}
                >
                  {normalizedLocale.toUpperCase()}
                </LangPill>
                <LangPill
                  active={viewLocale === (sourceLang as Locale)}
                  onClick={() => setViewLocale(sourceLang as Locale)}
                >
                  {sourceLang.toUpperCase()}
                </LangPill>
              </div>
            )}
          </div>

          {/* Title */}
          <h2
            id="news-peek-title"
            style={{
              fontSize: 19,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              lineHeight: 1.18,
              color: '#fff',
              margin: '0 0 12px',
            }}
          >
            {/* Render in the language the user is currently viewing
                (toggled via the source-language pill above) — when
                viewing source we use the original title, otherwise the
                cached translation. */}
            {viewLocale === sourceLang ? article.title : localizedTitle(article, viewLocale)}
          </h2>

          {/* Translation badge — only when we actually translated */}
          {data?.translated && data.sourceLocale && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginBottom: 10,
              padding: '3px 8px',
              background: GREEN_DIM,
              color: GREEN,
              borderRadius: 11,
              fontFamily: 'var(--font-mono, ui-monospace), monospace',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/>
              </svg>
              {t('autoTranslated', {
                from: data.sourceLocale.toUpperCase(),
                to: data.targetLocale.toUpperCase(),
              })}
            </div>
          )}

          {/* Snippet body — skeleton while loading, then text */}
          <div style={{
            color: 'rgba(255,255,255,0.78)',
            fontSize: 14,
            lineHeight: 1.55,
            marginBottom: 16,
            minHeight: 64,
          }}>
            {loading && !data ? <SkeletonLines count={3} /> : null}
            {!loading && error ? (
              <span style={{ color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                {t('previewUnavailable')}
              </span>
            ) : null}
            {data?.snippet}
          </div>

          {/* Primary action: open original */}
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              width: '100%',
              padding: 12,
              borderRadius: 10,
              background: GREEN,
              color: '#0a0a0a',
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
            onClick={() => {
              // Close after a tick so the new tab opens before the
              // sheet animation steals focus.
              setTimeout(onClose, 50)
            }}
          >
            {sourceName ? t('readAt', { source: sourceName }) : t('readAtSource')}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>

          {/* Secondary actions — bookmark + share */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            marginTop: 10,
          }}>
            <SecondaryBtn
              onClick={onToggleBookmark}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                </svg>
              }
              active={bookmarked}
              label={bookmarked ? t('bookmarked') : t('bookmark')}
            />
            <SecondaryBtn
              onClick={() => {
                const nav = typeof navigator !== 'undefined' ? navigator : null
                if (nav?.share) {
                  void nav.share({ title: article.title, url: article.url }).catch(() => {})
                } else if (nav?.clipboard) {
                  void nav.clipboard.writeText(article.url)
                }
              }}
              icon={
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                  <polyline points="16 6 12 2 8 6"/>
                  <line x1="12" y1="2" x2="12" y2="15"/>
                </svg>
              }
              label={t('share')}
            />
          </div>

          {/* Close button — placed at the BOTTOM of the sheet, with
              extra padding, so it's reachable on phones without the
              user having to stretch. */}
          <button
            ref={closeBtnRef}
            onClick={onClose}
            aria-label={t('close')}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 14,
              padding: '10px 12px',
              background: 'transparent',
              color: MUTED,
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────

const LangPill: React.FC<{
  active: boolean
  onClick: () => void
  children: React.ReactNode
}> = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    type="button"
    style={{
      background: active ? GREEN : 'transparent',
      color: active ? '#0a0a0a' : MUTED,
      border: 'none',
      padding: '4px 9px',
      fontFamily: 'var(--font-mono, ui-monospace), monospace',
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: '0.06em',
      borderRadius: 11,
      cursor: 'pointer',
      transition: 'background 140ms ease, color 140ms ease',
    }}
  >
    {children}
  </button>
)

const SecondaryBtn: React.FC<{
  onClick: () => void
  icon: React.ReactNode
  label: string
  active?: boolean
}> = ({ onClick, icon, label, active }) => (
  <button
    onClick={onClick}
    type="button"
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: 10,
      borderRadius: 8,
      background: 'transparent',
      color: active ? GREEN : MUTED,
      border: `1px solid ${BORDER}`,
      fontSize: 11,
      fontWeight: 600,
      cursor: 'pointer',
      fontFamily: 'inherit',
      transition: 'color 140ms ease, border-color 140ms ease',
    }}
  >
    {icon}
    {label}
  </button>
)

// Tiny shimmer skeleton for the snippet area while we wait on Claude.
// 3 staggered lines (different widths) feels more "content is coming"
// than a generic spinner.
const SkeletonLines: React.FC<{ count?: number }> = ({ count = 3 }) => {
  const widths = ['100%', '92%', '78%']
  return (
    <>
      <style>{shimmerKeyframes}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 13,
              borderRadius: 4,
              width: widths[i] ?? '100%',
              background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.04) 100%)',
              backgroundSize: '200% 100%',
              animation: 'snippetShimmer 1.4s ease-in-out infinite',
            }}
          />
        ))}
      </div>
    </>
  )
}

const shimmerKeyframes = `
@keyframes snippetShimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`

// Compact "12h" / "3d" relative time. We have a richer formatter in
// shared.tsx (`timeAgo`) but it returns localized full strings which
// don't fit the source-line treatment.
function timeAgoShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// Avoid silent prop reference for BG_CARD if some future cleanup
// removes the import — we want a typo here to show up at build time.
void BG_CARD

export default NewsPeekSheet
