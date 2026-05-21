'use client'

// src/hooks/useScrollMemory.ts
//
// Persist a page's vertical scroll position across navigations so
// `router.back()` lands the user where they were — not at the
// "middle" of a still-loading page, which is what the browser's
// default scroll restoration gives you when the page renders with
// async content (skeletons render, browser restores to max-available
// scrollY, data loads, page grows past that point, user is stranded).
//
// Behavior:
//   - On scroll, throttle-saves the current scrollY to sessionStorage
//     under `key`. Survives in-tab navigation, gone after tab close.
//   - On mount, reads the saved value and tries to scroll to it. If
//     the page isn't tall enough yet (async content still loading),
//     retries every 150ms up to ~3s. Once it succeeds OR the page is
//     fully loaded, stops trying.
//   - Skips restore if saved value is 0 or missing (fresh visit).
//
// Trade-off: subsequent visits to the page within the same tab session
// land at the previous scroll position, not the top. This is usually
// what users want ("pick up where I left off") and matches iOS Safari
// behavior — pull-to-refresh resets if needed.

import { useEffect } from 'react'

const RESTORE_RETRY_MS = 150
const RESTORE_MAX_ATTEMPTS = 20 // ~3 seconds total

export function useScrollMemory(key: string) {
  // Save throttled scroll position.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        try {
          sessionStorage.setItem(key, String(window.scrollY))
        } catch {
          // sessionStorage full / blocked — give up silently
        }
      }, 150)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [key])

  // Restore with retry-on-async-content.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let saved: string | null
    try {
      saved = sessionStorage.getItem(key)
    } catch {
      return
    }
    if (!saved) return
    const target = parseInt(saved, 10)
    if (!Number.isFinite(target) || target <= 0) return

    let attempts = 0
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const tryRestore = () => {
      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight
      // If page is tall enough OR we've exhausted retries, commit the
      // scroll. Browsers cap to maxScroll automatically if target is
      // still too high, so the last attempt is a safe no-op.
      if (target <= maxScroll || attempts >= RESTORE_MAX_ATTEMPTS) {
        window.scrollTo(0, target)
        return
      }
      attempts++
      timeoutId = setTimeout(tryRestore, RESTORE_RETRY_MS)
    }
    // First attempt next frame so the initial DOM is laid out.
    timeoutId = setTimeout(tryRestore, 0)
    return () => {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [key])
}
