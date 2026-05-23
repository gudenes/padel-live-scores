// src/hooks/useVerticalSwipeNavigation.ts
// Attach a vertical-swipe gesture to a target element with optional
// in-progress drag tracking (peek effect).
//
// - onDragMove(dy):  fires on every pointermove with the current delta
//                    (positive = swiped up, negative = swiped down).
// - onNext / onPrev: fire once on release if threshold + velocity met.
// - onDragEnd():     fires on release whether or not a swipe committed.
//                    Parent uses this to snap any peek transform back to 0.
'use client'

import { RefObject, useEffect } from 'react'

export interface UseVerticalSwipeOptions {
  threshold?: number              // minimum px of vertical movement to commit
  velocityThreshold?: number      // minimum px/ms to commit
  onNext: () => void
  onPrev?: () => void
  onDragMove?: (dy: number) => void
  onDragEnd?: () => void
  enabled?: boolean
}

export function useVerticalSwipeNavigation(
  ref: RefObject<HTMLElement | null>,
  options: UseVerticalSwipeOptions,
) {
  const {
    threshold = 80,
    velocityThreshold = 0.3,
    onNext,
    onPrev,
    onDragMove,
    onDragEnd,
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
      // Skip multi-touch and right/middle clicks
      if (e.button !== 0 && e.pointerType === 'mouse') return
      pointerStartY = e.clientY
      pointerStartT = performance.now()
      dragging = true
      try { el.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging || !onDragMove) return
      onDragMove(pointerStartY - e.clientY)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      const dy = pointerStartY - e.clientY
      const dt = performance.now() - pointerStartT
      const velocity = Math.abs(dy) / Math.max(1, dt)
      const committed = Math.abs(dy) >= threshold && velocity >= velocityThreshold
      if (committed) {
        if (dy > 0) onNext()
        else if (onPrev) onPrev()
      }
      if (onDragEnd) onDragEnd()
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [ref, threshold, velocityThreshold, onNext, onPrev, onDragMove, onDragEnd, enabled])
}
