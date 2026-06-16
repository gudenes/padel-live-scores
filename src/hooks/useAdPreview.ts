// src/hooks/useAdPreview.ts
'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { pickPreviewId, AD_PREVIEW_STORAGE_KEY } from '@/lib/ad-preview'

/**
 * Active preview banner id, or null. Reads ?ad_preview=<id> from the URL; the
 * URL param wins and is persisted to sessionStorage so it survives in-app
 * navigation (which drops the query string) and clears when the tab closes.
 *
 * Mirrors useGeoCountry: useSyncExternalStore keeps the server snapshot null
 * (no preview during SSR) so there is no hydration mismatch. getSnapshot stays
 * pure — the sessionStorage WRITE happens in a mount effect, not in read().
 */
function read(): string | null {
  if (typeof window === 'undefined') return null
  const fromUrl = new URLSearchParams(window.location.search).get('ad_preview')
  let stored: string | null = null
  try {
    stored = window.sessionStorage.getItem(AD_PREVIEW_STORAGE_KEY)
  } catch {
    stored = null
  }
  return pickPreviewId(fromUrl, stored)
}

const subscribe = () => () => {}

export function useAdPreview(): string | null {
  const id = useSyncExternalStore(subscribe, read, () => null)
  // Persist a fresh ?ad_preview id for the session so later in-app navigation
  // (which drops the query string) keeps previewing. Mirrors the ?geo cookie
  // write in StickyAdBanner.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('ad_preview')
    if (fromUrl && fromUrl.trim()) {
      try {
        window.sessionStorage.setItem(AD_PREVIEW_STORAGE_KEY, fromUrl.trim())
      } catch {
        // ignore (private mode / storage disabled)
      }
    }
  }, [])
  return id
}
