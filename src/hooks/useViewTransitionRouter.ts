'use client'
// src/hooks/useViewTransitionRouter.ts
//
// Thin wrapper around next-intl's locale-aware router that opts navigations
// into the browser-native View Transitions API when available.
//
// The browser API is stable as of 2024 (Chrome 111+, Safari 18+, Edge 111+,
// soon Firefox). On unsupported browsers it falls back to instant navigation
// — same behavior as today, no broken UI. We deliberately use the raw browser
// API rather than React's experimental `<ViewTransition>` component because
// the latter is canary-only and Next.js's own docs explicitly say "do not
// use in production" (see node_modules/next/dist/docs/01-app/.../viewTransition.md).
//
// Usage:
//   const router = useViewTransitionRouter()
//   router.push('/profile/settings')   // animates if supported, else instant
//   router.back()
//
// To make a specific element morph between routes, set a CSS view-transition-name
// on both the source and destination element with the same name. The browser
// captures pre/post snapshots and animates the morph. See profile + settings
// page for the canonical example (`profile-avatar`).

import { useCallback } from 'react'
import { useRouter } from '@/i18n/navigation'

/**
 * `document.startViewTransition` is in TypeScript's lib.dom.d.ts but the
 * method itself doesn't exist on Firefox or older Chrome/Safari. We
 * runtime-check for support before calling.
 */
function supportsViewTransitions(): boolean {
  if (typeof document === 'undefined') return false
  return typeof document.startViewTransition === 'function'
}

export function useViewTransitionRouter() {
  const router = useRouter()

  const push = useCallback(
    (href: string, opts?: Parameters<typeof router.push>[1]) => {
      if (!supportsViewTransitions()) {
        router.push(href, opts)
        return
      }
      document.startViewTransition(() => {
        router.push(href, opts)
      })
    },
    [router],
  )

  const back = useCallback(() => {
    if (!supportsViewTransitions()) {
      router.back()
      return
    }
    document.startViewTransition(() => {
      router.back()
    })
  }, [router])

  const replace = useCallback(
    (href: string, opts?: Parameters<typeof router.replace>[1]) => {
      if (!supportsViewTransitions()) {
        router.replace(href, opts)
        return
      }
      document.startViewTransition(() => {
        router.replace(href, opts)
      })
    },
    [router],
  )

  return { push, back, replace }
}
