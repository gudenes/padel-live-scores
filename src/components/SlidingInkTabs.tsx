'use client'

// src/components/SlidingInkTabs.tsx
//
// Horizontal tab strip with a single shared ink-bar that physically
// slides between tabs on selection. Springy cubic-bezier overshoot
// (same easing as the BottomNavV3 ink bar) makes the change feel
// playful instead of snapping into a new position.
//
// Bar width = active label's text width (each tab has its own).
// The bar's `width` is transitioned alongside its `transform: translate`
// so a tab swap interpolates both the position AND the size in one
// gesture.
//
// Usage:
//   <SlidingInkTabs
//     tabs={[{ key: 'overview', label: t('overview') }, ...]}
//     activeKey={tab}
//     onChange={setTab}
//   />
//
// Composition tweaks via `containerStyle`, `tabStyle`, and `barColor`.
// The container is `position: relative` so the absolutely-positioned
// bar anchors correctly — don't override that.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react'

export interface SlidingInkTabsTab<K extends string = string> {
  key: K
  label: ReactNode
}

export interface SlidingInkTabsProps<K extends string = string> {
  tabs: ReadonlyArray<SlidingInkTabsTab<K>>
  activeKey: K
  onChange: (key: K) => void
  /** Bar color. Defaults to brand lime. */
  barColor?: string
  /** Active tab text color. Defaults to brand lime. */
  activeColor?: string
  /** Inactive tab text color. Defaults to muted grey. */
  inactiveColor?: string
  /** Bar height in px. Default 2. */
  barHeight?: number
  /** Style for the container (the `<div>` wrapping all tabs). */
  containerStyle?: CSSProperties
  /** Style for each tab button. */
  tabStyle?: CSSProperties
  /** Optional ARIA label for the tablist region. */
  ariaLabel?: string
}

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const SPRING_EASING = 'cubic-bezier(0.34, 1.56, 0.64, 1)'
const SLIDE_MS = 360
// Polygon-chunky clip path so the bar matches the brand silhouette of
// other indicators (BottomNav ink bar uses the same polygon).
const BAR_CLIP = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export default function SlidingInkTabs<K extends string = string>({
  tabs,
  activeKey,
  onChange,
  barColor = GREEN,
  activeColor = GREEN,
  inactiveColor = MUTED,
  barHeight = 2,
  containerStyle,
  tabStyle,
  ariaLabel,
}: SlidingInkTabsProps<K>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const labelRefs = useRef<Map<K, HTMLSpanElement>>(new Map())
  const isFirstRef = useRef(true)
  const previousKeyRef = useRef<K>(activeKey)

  // Measure the active label and write the ink-bar position+width vars.
  // Returns the measured {x, w} so callers can decide whether to update.
  // Snap-style (no animation) — used for first mount and corrective re-snaps.
  function snapToActive(): { x: number; w: number } | null {
    const container = containerRef.current
    const activeLabel = labelRefs.current.get(activeKey)
    if (!container || !activeLabel) return null
    const containerRect = container.getBoundingClientRect()
    const labelRect = activeLabel.getBoundingClientRect()
    const x = labelRect.left - containerRect.left
    const w = labelRect.width
    container.style.setProperty('--sit-x', `${x}px`)
    container.style.setProperty('--sit-x-from', `${x}px`)
    container.style.setProperty('--sit-w', `${w}px`)
    return { x, w }
  }

  // Measure the active label span and update CSS vars so the bar
  // slides + resizes to match. useLayoutEffect avoids the "bar pops
  // from 0px on first paint" frame that useEffect would produce.
  useLayoutEffect(() => {
    const container = containerRef.current
    const activeLabel = labelRefs.current.get(activeKey)
    if (!container || !activeLabel) return

    const containerRect = container.getBoundingClientRect()
    const labelRect = activeLabel.getBoundingClientRect()
    const x = labelRect.left - containerRect.left
    const w = labelRect.width
    const previousX =
      parseFloat(container.style.getPropertyValue('--sit-x') || '0') || 0

    if (isFirstRef.current) {
      // Snap on first paint — no slide animation, no transition.
      container.style.setProperty('--sit-x', `${x}px`)
      container.style.setProperty('--sit-x-from', `${x}px`)
      container.style.setProperty('--sit-w', `${w}px`)
      isFirstRef.current = false
      previousKeyRef.current = activeKey

      // Stabilization loop: re-snap each frame for a fixed window. A
      // single rAF isn't enough on pages where layout shifts later than
      // one frame — e.g., a wrapping ".app-frame" mockup on desktop
      // that re-positions after hydration, an async hero image loading,
      // or fonts swapping in. The shift can happen 100ms+ after mount,
      // and the first frames are often "stable but wrong" (the layout
      // just hasn't shifted yet), so early-termination on stability is
      // unreliable — we just run for the full window. Each frame is a
      // few getBoundingClientRect reads + idempotent CSS-var writes;
      // negligible.
      const MAX_FRAMES = 180 // ~3s at 60fps
      let frames = 0
      let rafId = 0
      const loop = () => {
        frames++
        snapToActive()
        if (frames < MAX_FRAMES) rafId = requestAnimationFrame(loop)
      }
      rafId = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(rafId)
    }
    if (previousKeyRef.current === activeKey) return

    container.style.setProperty('--sit-x-from', `${previousX}px`)
    container.style.setProperty('--sit-x', `${x}px`)
    container.style.setProperty('--sit-w', `${w}px`)
    // Toggle one-shot class to fire the keyframe slide-with-stretch.
    container.classList.remove('sit-animating')
    // Force reflow so the keyframe re-fires.
    void container.offsetWidth
    container.classList.add('sit-animating')
    previousKeyRef.current = activeKey

    const cleanup = window.setTimeout(() => {
      container.classList.remove('sit-animating')
      // Corrective re-snap after the slide finishes. If layout was still
      // settling when the animation path measured (font load, parent
      // reflow), the bar landed at a stale x. Re-measure now that the
      // slide is done and quietly correct. .sit-animating is already
      // removed so this is an instant jump, not a re-animation — visually
      // imperceptible at the end of the slide, but avoids the bar
      // resting under the wrong tab.
      snapToActive()
    }, SLIDE_MS + 40)
    return () => window.clearTimeout(cleanup)
    // snapToActive is intentionally excluded — it's a stable function
    // reference within this render and closes over activeKey via the dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  // Reposition on viewport resize and container reflow. Snap, no
  // animation. ResizeObserver catches the cases that don't trigger a
  // window resize event: font swaps, parent layout shifts (hero image
  // load), sticky positioning settling after scroll.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handle = () => { snapToActive() }
    window.addEventListener('resize', handle)

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(handle)
      ro.observe(container)
      // Observe every label — a width change in a non-active tab (e.g.
      // a translation finishing load) shifts the active tab's x position
      // without changing its own size, so observing only the active
      // label would miss it.
      labelRefs.current.forEach(label => ro!.observe(label))
    }

    return () => {
      window.removeEventListener('resize', handle)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES(barColor, barHeight) }} />
      <div
        ref={containerRef}
        role="tablist"
        aria-label={ariaLabel}
        style={{
          position: 'relative',
          display: 'flex',
          ...containerStyle,
        }}
      >
        {/* Shared ink-bar — slides between active labels */}
        <div className="sit-ink-bar" aria-hidden />

        {tabs.map((tab) => {
          const active = tab.key === activeKey
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.key)}
              style={{
                flex: 1,
                padding: '12px 0',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 0.5,
                fontFamily: 'inherit',
                color: active ? activeColor : inactiveColor,
                position: 'relative',
                transition: 'color 0.2s',
                textTransform: 'uppercase',
                ...tabStyle,
              }}
            >
              {/* Label span — its bounding box is what the ink-bar
                  measures, so the bar width tracks the text exactly. */}
              <span
                ref={(el) => {
                  if (el) labelRefs.current.set(tab.key, el)
                  else labelRefs.current.delete(tab.key)
                }}
                style={{ display: 'inline-block' }}
              >
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

const STYLES = (barColor: string, barHeight: number) => `
.sit-ink-bar {
  position: absolute;
  bottom: -1px;
  left: 0;
  width: var(--sit-w, 40px);
  height: ${barHeight}px;
  background: ${barColor};
  clip-path: ${BAR_CLIP};
  transform: translate3d(var(--sit-x, 0px), 0, 0) scaleX(1) scaleY(1);
  transition: transform ${SLIDE_MS}ms ${SPRING_EASING},
              width ${SLIDE_MS}ms ${SPRING_EASING};
  transform-origin: left center;
  pointer-events: none;
}
.sit-animating .sit-ink-bar {
  animation: sit-bar-slide ${SLIDE_MS}ms ${SPRING_EASING};
}
@keyframes sit-bar-slide {
  0%   { transform: translate3d(var(--sit-x-from), 0, 0) scaleX(1) scaleY(1); }
  60%  { transform: translate3d(var(--sit-x), 0, 0)      scaleX(1.15) scaleY(0.7); }
  100% { transform: translate3d(var(--sit-x), 0, 0)      scaleX(1) scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .sit-ink-bar { transition: none; }
  .sit-animating .sit-ink-bar { animation: none; }
}
`
