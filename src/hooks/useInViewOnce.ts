'use client'
// src/hooks/useInViewOnce.ts
//
// Reusable IntersectionObserver hook. Returns `true` once the target
// element has entered the viewport, and stays `true` forever after.
// This is the plumbing behind scroll-triggered animations that should
// only play once per mount (no replay on scroll up + back down).
//
// Honors `prefers-reduced-motion: reduce` by returning `true` immediately
// (effectively skipping the animation and showing the final state).

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface UseInViewOnceOptions {
  /** Intersection ratio at which to trigger. Default: 0.2 */
  threshold?: number
  /** rootMargin for the observer. Default: '0px 0px -5% 0px' (triggers slightly before fully in view) */
  rootMargin?: string
}

export function useInViewOnce<T extends Element>(
  ref: RefObject<T | null>,
  options: UseInViewOnceOptions = {},
): boolean {
  const { threshold = 0.2, rootMargin = '0px 0px -5% 0px' } = options
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Accessibility: skip animation for users who prefer reduced motion.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setInView(true)
      return
    }

    // If IntersectionObserver is unavailable, fall back to immediate trigger.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            observer.disconnect()
            break
          }
        }
      },
      { threshold, rootMargin },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, threshold, rootMargin])

  return inView
}
