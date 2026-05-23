// src/hooks/useVerticalSwipeNavigation.ts
// Attach a vertical-swipe gesture to a target element. Fires onNext when the
// user swipes up past threshold + velocity gates, onPrev for swipe down.
//
// The parent owns any in-flight visual transform (peek animation, etc.) —
// this hook only commits the transition on release, doesn't track delta
// during the drag.
'use client'

import { RefObject, useEffect } from 'react'

export interface UseVerticalSwipeOptions {
  threshold?: number          // minimum px of vertical movement to commit
  velocityThreshold?: number  // minimum px/ms to commit
  onNext: () => void
  onPrev?: () => void
  enabled?: boolean
}

/**
 * Attach vertical-swipe gesture to an element. Threshold + velocity gates.
 * Honors prefers-reduced-motion at the CSS layer (parent decides) — this hook
 * just fires the callbacks regardless.
 */
export function useVerticalSwipeNavigation(
  ref: RefObject<HTMLElement | null>,
  options: UseVerticalSwipeOptions,
) {
  const {
    threshold = 80,
    velocityThreshold = 0.3,
    onNext,
    onPrev,
    enabled = true,
  } = options

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    let pointerStartY = 0
    let pointerStartT = 0
    let dragging = false

    const onPointerDown = (e: PointerEvent) => {
      pointerStartY = e.clientY
      pointerStartT = performance.now()
      dragging = true
      el.setPointerCapture(e.pointerId)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      const dy = pointerStartY - e.clientY
      const dt = performance.now() - pointerStartT
      const velocity = Math.abs(dy) / Math.max(1, dt)
      if (Math.abs(dy) >= threshold && velocity >= velocityThreshold) {
        if (dy > 0) onNext()
        else if (onPrev) onPrev()
      }
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [ref, threshold, velocityThreshold, onNext, onPrev, enabled])
}
