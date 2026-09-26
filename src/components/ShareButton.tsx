'use client'
// src/components/ShareButton.tsx
// Single share implementation shared by the match page and player profiles.
// Mirrors the match page's original inline share button (box-with-arrow icon,
// chunky badge styling, Web Share Level 2 file attachment, and a toast that
// ALWAYS fires on the clipboard fallback — even when the write itself throws).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

// Chunky clip-path preset, lifted from the match page's local constants
// (./match/[id]/lib/constants.ts) rather than importing across a page
// boundary.
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export default function ShareButton({
  url,
  title,
  text,
  imageUrl,
}: {
  url: string
  title?: string
  text?: string
  imageUrl?: string
}) {
  const t = useTranslations('common')
  const [toast, setToast] = useState(false)

  async function handleShare() {
    // Three platform tiers:
    // - Capacitor native (Android/iOS app): Share plugin opens the native
    //   sheet. `navigator.share` is undefined inside the WebView, so gating
    //   on it would skip the native path.
    // - Web Share API (modern browsers): Share plugin proxies to
    //   navigator.share. Level 2 file attachment is only reachable through
    //   direct navigator.share — Capacitor's Share takes file:// URI
    //   strings, not File objects.
    // - Fallback (older browsers): copy URL to clipboard.
    const canShareViaCapacitor = Capacitor.isNativePlatform()
    const canShareViaWebShare = typeof navigator !== 'undefined' && 'share' in navigator
    const canShare = canShareViaCapacitor || canShareViaWebShare

    // Try to include the image as a file attachment via Web Share API
    // Level 2 (iOS 15+, Chrome Android). Only reachable through
    // navigator.share, so skip on Capacitor native (where we'd just throw
    // the file away anyway).
    //
    // Best-effort — cap the fetch at 3s so a slow image never blocks the
    // share sheet from opening.
    let imageFile: File | null = null
    if (imageUrl && canShareViaWebShare) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 3000)
        const res = await fetch(imageUrl, { signal: controller.signal })
        clearTimeout(timeout)
        if (res.ok) {
          const blob = await res.blob()
          imageFile = new File([blob], 'padelnachos-share.png', { type: blob.type || 'image/png' })
        }
      } catch {
        // Image fetch failed or timed out — fall through to URL-only share
      }
    }

    // Copy the URL + flash the "link copied" toast. Used both as the
    // no-share-API path and as the catch-all fallback so the button
    // ALWAYS gives visible feedback (a silent `catch {}` here would leave
    // users unsure whether the tap did anything).
    const copyFallback = async () => {
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        // Clipboard blocked (insecure context / no gesture) — still flash
        // the toast so the tap isn't a dead no-op.
      }
      setToast(true)
      setTimeout(() => setToast(false), 2200)
    }

    try {
      if (canShare) {
        const canShareFiles =
          imageFile !== null &&
          canShareViaWebShare &&
          typeof navigator.canShare === 'function' &&
          navigator.canShare({ files: [imageFile] })

        if (canShareFiles && imageFile) {
          // Web Share API Level 2 file attachment.
          await navigator.share({ title, text, url, files: [imageFile] })
        } else {
          // URL-only share via Capacitor — opens native sheet on
          // Android/iOS, proxies to navigator.share on web.
          await Share.share({ title, text, url, dialogTitle: title })
        }
      } else {
        await copyFallback()
      }
    } catch (err) {
      // User dismissed the native/Web share sheet — intentional, stay quiet.
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Share genuinely failed or is unavailable in this WebView — copy the
      // link instead so the tap always produces visible feedback.
      await copyFallback()
    }
  }

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={handleShare}
        aria-label={t('share')}
        style={{
          width: 36, height: 36,
          clipPath: CHUNKY_BADGE,
          background: 'rgba(255,255,255,0.06)',
          border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', cursor: 'pointer', flexShrink: 0,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
          <polyline points="16 6 12 2 8 6" />
          <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
      </button>
      {toast && (
        <div style={{
          position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: '#7ED321', color: '#000', padding: '8px 20px',
          borderRadius: 8, fontSize: 13, fontWeight: 700, zIndex: 1000,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}>
          {t('linkCopied')}
        </div>
      )}
    </div>
  )
}
