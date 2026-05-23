'use client'
// src/components/DesktopDownloadRail.tsx
//
// Quiet, premium "get the app" rail that floats on the right side of the
// viewport at desktop widths only. Inspired by Linear / Stripe / Apple's
// own marketing pages — restrained typography, lots of whitespace, no
// chunky borders or competing color accents.
//
// Behaviour:
//   • Renders only at viewport ≥ 1280px (CSS media query)
//   • Renders only outside Capacitor native shells (the user is already
//     in the app; offering a download CTA inside the app would be silly)
//   • Sticky-positioned with `position: fixed` so it doesn't push the
//     center column or affect mobile layout in any way
//   • Click events are captured to PostHog as `download_badge_click`
//     with `{ platform: 'ios' | 'android' }` so we can measure web→
//     native install conversion
//
// Copy is fully localised — see `download.*` keys in src/messages/*.json.

import { Capacitor } from '@capacitor/core'
import posthog from 'posthog-js'
import { useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'

const APP_STORE_URL = 'https://apps.apple.com/app/id6770290540'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.padelnachos.app'

// Capacitor's native-platform flag never changes after the WebView boots,
// so subscribe is a no-op. We use useSyncExternalStore (the idiomatic
// React 19 way to read external state) rather than useState+useEffect to
// avoid the react-hooks/set-state-in-effect lint rule and the brief
// hydration-mismatch flash that pattern can produce.
const subscribeNoop = () => () => {}
const getNativeSnapshot = () => {
  try { return Capacitor.isNativePlatform() } catch { return false }
}
// On the server we never know the platform — render as web (rail visible
// on desktop) to avoid SSR/hydration markup mismatches.
const getNativeServerSnapshot = () => false

export default function DesktopDownloadRail() {
  const t = useTranslations('download')
  const isNative = useSyncExternalStore(subscribeNoop, getNativeSnapshot, getNativeServerSnapshot)

  if (isNative) return null

  const onAppStoreClick = () => {
    try { posthog.capture('download_badge_click', { platform: 'ios' }) } catch { /* analytics best-effort */ }
  }
  const onPlayStoreClick = () => {
    try { posthog.capture('download_badge_click', { platform: 'android' }) } catch { /* analytics best-effort */ }
  }

  return (
    <aside
      className="pn-download-rail"
      aria-label={t('ariaLabel')}
    >
      <div className="pn-download-rail__eyebrow">{t('eyebrow')}</div>
      <h2 className="pn-download-rail__title">{t('title')}</h2>
      <p className="pn-download-rail__body">{t('body')}</p>

      <div className="pn-download-rail__badges">
        <a
          href={APP_STORE_URL}
          onClick={onAppStoreClick}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('appStoreAria')}
          className="pn-download-rail__badge"
        >
          {/* Apple App Store badge */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 168 48" width="168" height="48" aria-hidden="true">
            <rect width="168" height="48" rx="8" fill="#000" />
            <rect x="0.5" y="0.5" width="167" height="47" rx="7.5" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
            <g transform="translate(13, 11)" fill="#fff">
              <path d="M16.05,11.97c-.03-3.2,2.61-4.74,2.73-4.82-1.5-2.18-3.81-2.47-4.62-2.51-1.95-.2-3.83,1.16-4.83,1.16s-2.54-1.13-4.18-1.1c-2.15.03-4.15,1.25-5.27,3.18-2.25,3.91-.58,9.67,1.61,12.83,1.07,1.55,2.34,3.28,4.01,3.22,1.62-.07,2.23-1.04,4.18-1.04s2.5,1.04,4.22,1c1.74-.03,2.84-1.58,3.91-3.13,1.24-1.79,1.75-3.55,1.77-3.64-.04-.01-3.39-1.3-3.43-5.16Z" />
              <path d="M13.04,2.45c.89-1.07,1.49-2.55,1.33-4.04-1.28.05-2.83.86-3.75,1.92-.82.94-1.55,2.46-1.36,3.91,1.43.11,2.89-.71,3.78-1.79Z" />
            </g>
            <g fill="#fff" fontFamily="-apple-system, Helvetica, Arial, sans-serif">
              <text x="42" y="20" fontSize="8.5" fontWeight="400" letterSpacing="0.3">{t('appStoreEyebrow')}</text>
              <text x="42" y="36" fontSize="17" fontWeight="600" letterSpacing="-0.3">{t('appStoreName')}</text>
            </g>
          </svg>
        </a>

        <a
          href={PLAY_STORE_URL}
          onClick={onPlayStoreClick}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('playStoreAria')}
          className="pn-download-rail__badge"
        >
          {/* Google Play badge */}
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 168 48" width="168" height="48" aria-hidden="true">
            <rect width="168" height="48" rx="8" fill="#000" />
            <rect x="0.5" y="0.5" width="167" height="47" rx="7.5" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
            <g transform="translate(13, 12)">
              <defs>
                <linearGradient id="pn-play-g" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00f2a8" />
                  <stop offset="100%" stopColor="#00d2ff" />
                </linearGradient>
                <linearGradient id="pn-play-b" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00d2ff" />
                  <stop offset="100%" stopColor="#0099ff" />
                </linearGradient>
                <linearGradient id="pn-play-r" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ff4757" />
                  <stop offset="100%" stopColor="#ff2d55" />
                </linearGradient>
                <linearGradient id="pn-play-y" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffd60a" />
                  <stop offset="100%" stopColor="#ff9500" />
                </linearGradient>
              </defs>
              <path d="M0.5,1 L12,12 L0.5,23 Z" fill="url(#pn-play-g)" />
              <path d="M0.5,1 L18,11.5 L12,12 Z" fill="url(#pn-play-y)" />
              <path d="M0.5,23 L12,12 L18,12.5 Z" fill="url(#pn-play-r)" />
              <path d="M12,12 L18,11.5 L18,12.5 Z" fill="url(#pn-play-b)" />
            </g>
            <g fill="#fff" fontFamily="-apple-system, Helvetica, Arial, sans-serif">
              <text x="42" y="20" fontSize="8.5" fontWeight="400" letterSpacing="0.4">{t('playStoreEyebrow')}</text>
              <text x="42" y="36" fontSize="17" fontWeight="600" letterSpacing="-0.3">{t('playStoreName')}</text>
            </g>
          </svg>
        </a>
      </div>

      <div className="pn-download-rail__meta">
        <span className="pn-download-rail__meta-strong">{t('metaStrong')}</span>{' '}
        {t('metaTail')}
      </div>

      <style jsx>{`
        .pn-download-rail {
          display: none;
        }
        /* Only show at desktop widths (≥1280px). Below that, mobile/tablet
           users either have the app or are running the mobile-first PWA —
           pushing them to install duplicates of what they already have. */
        @media (min-width: 1280px) {
          .pn-download-rail {
            display: block;
            position: fixed;
            top: 96px;
            /* Anchor to the right of the centered ~480px-wide app column.
               Formula: half-viewport offset, plus app half-width (240px),
               plus a 64px gutter to where the rail begins. */
            right: max(24px, calc((100vw - 480px) / 2 - 64px - 280px));
            width: 280px;
            z-index: 40;
            pointer-events: auto;
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
            animation: pn-download-rail-fade 0.6s ease-out 0.4s both;
          }
        }
        @keyframes pn-download-rail-fade {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .pn-download-rail__eyebrow {
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.8px;
          text-transform: uppercase;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .pn-download-rail__eyebrow::before {
          content: '';
          width: 24px;
          height: 1px;
          background: var(--text-dim);
          display: block;
        }
        .pn-download-rail__title {
          font-size: 26px;
          font-weight: 600;
          line-height: 1.15;
          letter-spacing: -0.025em;
          color: var(--text-primary);
          margin: 0 0 12px;
        }
        .pn-download-rail__body {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.55;
          font-weight: 400;
          margin: 0 0 32px;
          max-width: 260px;
        }
        .pn-download-rail__badges {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .pn-download-rail__badge {
          display: inline-block;
          text-decoration: none;
          transition: opacity 0.2s ease, transform 0.2s ease;
          line-height: 0;
          border-radius: 8px;
        }
        .pn-download-rail__badge:hover {
          opacity: 0.92;
          transform: translateX(2px);
        }
        .pn-download-rail__badge:focus-visible {
          outline: 2px solid var(--text-primary);
          outline-offset: 3px;
        }
        .pn-download-rail__meta {
          margin-top: 32px;
          padding-top: 24px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
          color: var(--text-muted);
          font-size: 12px;
          line-height: 1.55;
          font-weight: 400;
        }
        .pn-download-rail__meta-strong {
          color: var(--text-secondary);
          font-weight: 500;
        }
      `}</style>
    </aside>
  )
}
