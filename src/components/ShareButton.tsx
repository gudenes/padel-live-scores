'use client'
// src/components/ShareButton.tsx
// Share a player profile. Sends the URL only — no Web Share Level 2 file
// attachment: attaching the PNG makes the target render a loose image with a
// link beside it instead of the familiar preview card, and a profile does not
// go stale in seconds the way a live score does. The platform fetches the OG
// image from the page metadata by itself.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

export default function ShareButton({
  url,
  size = 36,
  color = '#8A8A8A',
}: {
  url: string
  size?: number
  color?: string
}) {
  const t = useTranslations('common')
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    // Order matters: navigator.share is undefined inside the Capacitor
    // WebView, so checking for it first would skip the native sheet.
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ url })
      } catch {
        // The user dismissed the sheet. Not an error.
      }
      return
    }

    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ url })
      } catch (err) {
        // AbortError means the user closed the sheet — never surface that.
        if ((err as Error)?.name !== 'AbortError') {
          await copyToClipboard()
        }
      }
      return
    }

    await copyToClipboard()
  }

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (insecure context, permissions). Nothing sensible
      // left to try, and a red error over a share button helps no one.
    }
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={handleShare}
        aria-label={t('share')}
        style={{
          width: size, height: size, border: 'none', background: 'transparent',
          cursor: 'pointer', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color, padding: 0,
        }}
      >
        <svg width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
        </svg>
      </button>
      {copied && (
        <span style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#141414', color: '#fff', fontSize: 10,
          padding: '4px 8px', whiteSpace: 'nowrap', zIndex: 20,
        }}>
          {t('linkCopied')}
        </span>
      )}
    </div>
  )
}
