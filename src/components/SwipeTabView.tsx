'use client'

import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSwipeTabs } from '@/hooks/useSwipeTabs'

// useLayoutEffect runs on the client only; alias to useEffect during SSR to
// avoid React's "useLayoutEffect does nothing on the server" warning. Used so
// the active-panel height is measured before paint (no flash of the tall state).
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

interface Tab {
  key: string
  label: string
  badge?: ReactNode
}

interface SwipeTabViewProps {
  tabs: Tab[]
  currentTab: number
  onTabChange: (idx: number) => void
  children: ReactNode[]
  preserveScroll?: boolean
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function SwipeTabView({
  tabs,
  currentTab: controlledTab,
  onTabChange,
  children,
  preserveScroll = true,
}: SwipeTabViewProps) {
  const count = tabs.length

  const { currentTab, goTo, trackStyle, handlers, progress, isDragging } = useSwipeTabs({
    count,
    initial: controlledTab,
    onTabChange,
  })

  // Sync external currentTab → internal position
  const prevControlledTab = useRef(controlledTab)
  useEffect(() => {
    if (controlledTab !== prevControlledTab.current) {
      prevControlledTab.current = controlledTab
      goTo(controlledTab)
    }
  }, [controlledTab, goTo])

  // Scroll preservation
  const panelRefs = useRef<(HTMLDivElement | null)[]>([])
  const scrollMap = useRef<Map<number, number>>(new Map())
  const prevTab = useRef(currentTab)

  useEffect(() => {
    const leaving = prevTab.current
    const arriving = currentTab

    if (leaving !== arriving) {
      // Save departing panel scroll position
      if (preserveScroll) {
        const leavingEl = panelRefs.current[leaving]
        if (leavingEl) {
          scrollMap.current.set(leaving, leavingEl.scrollTop)
        }
      }

      // Restore arriving panel scroll position
      if (preserveScroll) {
        const arrivingEl = panelRefs.current[arriving]
        if (arrivingEl) {
          arrivingEl.scrollTop = scrollMap.current.get(arriving) ?? 0
        }
      }

      prevTab.current = arriving
    }
  }, [currentTab, preserveScroll])

  // ── Auto-height ───────────────────────────────────────────────
  // The track lays all panels side-by-side in a flex ROW, so by default every
  // panel is stretched to the tallest one. Once the Live Feed fills up, the
  // short tabs (summary / players / h2h) inherit its height and render a long
  // empty scroll area. Fix: top-align panels (each keeps its own intrinsic
  // height) and pin the viewport to the ACTIVE panel's height. A ResizeObserver
  // tracks the live feed growing in real time; re-subscribes on tab change.
  const [activeHeight, setActiveHeight] = useState<number | null>(null)
  useIsomorphicLayoutEffect(() => {
    const el = panelRefs.current[currentTab]
    if (!el) return
    const measure = () => setActiveHeight(el.offsetHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [currentTab])

  // Indicator transition matches track
  const reducedMotion = typeof window !== 'undefined' ? prefersReducedMotion() : false
  const indicatorTransition =
    !isDragging && !reducedMotion
      ? 'transform 350ms cubic-bezier(0.25, 0.1, 0.25, 1)'
      : 'none'

  const tabWidth = 100 / count

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div
        role="tablist"
        style={{
          display: 'flex',
          position: 'relative',
          background: '#141414',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        {tabs.map((tab, i) => {
          const isActive = i === currentTab
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => goTo(i)}
              style={{
                flex: 1,
                padding: '12px 8px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: isActive ? '#7ED321' : '#6B7280',
                fontWeight: isActive ? 600 : 400,
                fontSize: 14,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                transition: 'color 200ms ease',
                userSelect: 'none',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {tab.label}
              {tab.badge != null && (
                <span
                  style={{
                    background: isActive ? '#7ED321' : 'rgba(255,255,255,0.15)',
                    color: isActive ? '#000' : '#9CA3AF',
                    borderRadius: 10,
                    padding: '1px 6px',
                    fontSize: 11,
                    fontWeight: 600,
                    lineHeight: 1.6,
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}

        {/* Sliding indicator */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: `${tabWidth}%`,
            height: 2,
            background: '#7ED321',
            transform: `translateX(${progress * 100}%)`,
            transition: indicatorTransition,
            willChange: 'transform',
          }}
        />
      </div>

      {/* Swipe viewport — height follows the active panel (see Auto-height) */}
      <div
        style={{
          overflow: 'hidden',
          touchAction: 'pan-y',
          width: '100%',
          // Once measured, the explicit height is authoritative — drop flex-grow
          // so it can't stretch the viewport back to the (tallest) track height.
          flex: activeHeight != null ? 'none' : 1,
          height: activeHeight ?? undefined,
          transition: !isDragging && !reducedMotion ? 'height 350ms cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none',
        }}
        {...handlers}
      >
        {/* Track — flex-start so panels keep their own height instead of all
            stretching to the tallest one */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            width: `${count * 100}%`,
            ...trackStyle,
          }}
        >
          {children.map((child, i) => (
            <div
              key={tabs[i]?.key ?? i}
              role="tabpanel"
              aria-label={tabs[i]?.label}
              ref={(el) => {
                panelRefs.current[i] = el
              }}
              style={{
                width: `${tabWidth}%`,
                flexShrink: 0,
                overflowY: 'auto',
                minHeight: 200,
              }}
            >
              {child}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
