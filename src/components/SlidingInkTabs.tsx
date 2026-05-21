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
      return
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
    }, SLIDE_MS + 40)
    return () => window.clearTimeout(cleanup)
  }, [activeKey])

  // Reposition on viewport resize (orientation flip, content reflow).
  // Snap, no animation — just re-measure.
  useEffect(() => {
    function handleResize() {
      const container = containerRef.current
      const activeLabel = labelRefs.current.get(activeKey)
      if (!container || !activeLabel) return
      const containerRect = container.getBoundingClientRect()
      const labelRect = activeLabel.getBoundingClientRect()
      const x = labelRect.left - containerRect.left
      const w = labelRect.width
      container.style.setProperty('--sit-x', `${x}px`)
      container.style.setProperty('--sit-x-from', `${x}px`)
      container.style.setProperty('--sit-w', `${w}px`)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
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
