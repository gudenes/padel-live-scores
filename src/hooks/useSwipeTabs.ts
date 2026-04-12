'use client'

import { useState, useRef, useCallback, CSSProperties } from 'react'

interface UseSwipeTabsOptions {
  count: number
  initial?: number
  onTabChange?: (idx: number) => void
  threshold?: number
}

interface UseSwipeTabsReturn {
  currentTab: number
  goTo: (idx: number) => void
  trackStyle: CSSProperties
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
  }
  progress: number
  isDragging: boolean
}

type GestureState = 'idle' | 'detecting' | 'swiping' | 'scrolling'

const SNAP_TRANSITION = 'transform 350ms cubic-bezier(0.25, 0.1, 0.25, 1)'
const ANGLE_LOCK_PX = 8
const OVERSHOOT_MAX = 0.3
const OVERSHOOT_DAMPEN = 0.3

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useSwipeTabs({
  count,
  initial = 0,
  onTabChange,
  threshold = 0.2,
}: UseSwipeTabsOptions): UseSwipeTabsReturn {
  const [currentTab, setCurrentTab] = useState(initial)
  const [isDragging, setIsDragging] = useState(false)
  // dragOffset in px, relative to the snapped position
  const [dragOffset, setDragOffset] = useState(0)

  const gestureState = useRef<GestureState>('idle')
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const currentTabRef = useRef(currentTab)
  currentTabRef.current = currentTab

  const goTo = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(count - 1, idx))
      setCurrentTab(clamped)
      setDragOffset(0)
      setIsDragging(false)
      gestureState.current = 'idle'
      onTabChange?.(clamped)
    },
    [count, onTabChange]
  )

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
    gestureState.current = 'detecting'
    setDragOffset(0)
  }, [])

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStart.current) return
      if (gestureState.current === 'idle' || gestureState.current === 'scrolling') return

      const touch = e.touches[0]
      const dx = touch.clientX - touchStart.current.x
      const dy = touch.clientY - touchStart.current.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      if (gestureState.current === 'detecting') {
        const moved = Math.sqrt(dx * dx + dy * dy)
        if (moved < ANGLE_LOCK_PX) return

        if (absDy > absDx) {
          gestureState.current = 'scrolling'
          return
        }
        gestureState.current = 'swiping'
        setIsDragging(true)
      }

      if (gestureState.current === 'swiping') {
        e.preventDefault()

        const vw = typeof window !== 'undefined' ? window.innerWidth : 375
        const tab = currentTabRef.current

        // Clamp with edge overshoot dampening
        let offset = dx
        if (dx > 0 && tab === 0) {
          // overshoot left edge
          const maxOvershoot = vw * OVERSHOOT_MAX
          offset = Math.min(dx * OVERSHOOT_DAMPEN, maxOvershoot)
        } else if (dx < 0 && tab === count - 1) {
          // overshoot right edge
          const maxOvershoot = vw * OVERSHOOT_MAX
          offset = Math.max(dx * OVERSHOOT_DAMPEN, -maxOvershoot)
        }

        setDragOffset(offset)
      }
    },
    [count]
  )

  const onTouchEnd = useCallback(() => {
    if (gestureState.current !== 'swiping') {
      gestureState.current = 'idle'
      touchStart.current = null
      setIsDragging(false)
      setDragOffset(0)
      return
    }

    const vw = typeof window !== 'undefined' ? window.innerWidth : 375
    const tab = currentTabRef.current
    const offset = dragOffset
    const dist = Math.abs(offset)
    const direction = offset < 0 ? 1 : -1 // negative offset = swipe left = next tab

    let nextTab = tab
    if (dist > vw * threshold) {
      nextTab = Math.max(0, Math.min(count - 1, tab + direction))
    }

    gestureState.current = 'idle'
    touchStart.current = null
    setIsDragging(false)
    setDragOffset(0)

    if (nextTab !== tab) {
      setCurrentTab(nextTab)
      onTabChange?.(nextTab)
    }
  }, [count, dragOffset, threshold, onTabChange])

  // Build track style
  // The track is count*100% wide, so each tab is (100/count)% of track width.
  // translateX % is relative to the element's own width, so we divide by count.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 375
  const baseTranslate = -(currentTab * (100 / count)) // % of track width

  const translateX = `calc(${baseTranslate}% + ${dragOffset}px)`

  // Apply CSS transition only when not actively dragging (snap-back / programmatic goTo)
  const shouldTransition = !isDragging && !prefersReducedMotion()

  const trackStyle: CSSProperties = {
    transform: `translateX(${translateX})`,
    transition: shouldTransition ? SNAP_TRANSITION : 'none',
    willChange: 'transform',
  }

  // progress: current tab as a float, offset by drag fraction
  // e.g. on tab 1 dragged 30% toward tab 2 → 1.3
  const progress = currentTab + (-(dragOffset / vw))

  return {
    currentTab,
    goTo,
    trackStyle,
    handlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    progress,
    isDragging,
  }
}
