// src/components/ads/StickyAdBanner.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from '@/i18n/navigation'
import { getActiveSponsor } from '@/lib/sponsors'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { AdSlot } from './AdSlot'

/**
 * Routes where the sticky banner is allowed (locale-stripped paths):
 *   /matches, /matches/<date>, /match/<id>, /player/<id>.
 * Scoped for now; widen this matcher to show on more pages later.
 */
function isAdRoute(pathname: string): boolean {
  return /^\/(matches(\/|$)|match\/|player\/)/.test(pathname)
}

/**
 * Sticky anchor banner (Sofascore-style). Pinned just above the bottom nav,
 * within the app's 500px column. Shown only on matches / match-detail / player
 * pages (see isAdRoute), and only when a sponsor matches the visitor's country
 * (else the NetworkAdSlot seam would fill it later — nothing today).
 */
export function StickyAdBanner() {
  const country = useGeoCountry()
  const pathname = usePathname()
  const sponsor = country ? getActiveSponsor('sticky-bottom', country) : null
  const visible = !!sponsor && isAdRoute(pathname)

  const ref = useRef<HTMLDivElement>(null)
  const [navHeight, setNavHeight] = useState(0)

  // Testing convenience: persist a ?geo=XX override into the cookie so it
  // survives in-app navigation (which drops the query string).
  useEffect(() => {
    const override = new URLSearchParams(window.location.search).get('geo')
    if (override) {
      document.cookie = `geo-country=${override.toUpperCase()};path=/;max-age=86400`
    }
  }, [])

  // Sit directly above the bottom nav. Measure it so we adapt to the
  // safe-area inset (notch / home indicator) without hardcoding heights.
  //
  // The nav can mount late and even be *swapped* (a page's loading skeleton
  // renders its own nav, then the real content replaces it). So we re-resolve
  // `.v3-nav` on every DOM mutation and re-point the ResizeObserver at the
  // current element. setNavHeight with an unchanged value is a no-op, so this
  // stays cheap despite the broad observer.
  useEffect(() => {
    if (!visible) return
    let observed: HTMLElement | null = null
    let ro: ResizeObserver | null = null
    const sync = () => {
      const nav = document.querySelector('.v3-nav') as HTMLElement | null
      if (nav && nav !== observed) {
        ro?.disconnect()
        ro = new ResizeObserver(() => {
          const n = document.querySelector('.v3-nav') as HTMLElement | null
          setNavHeight(n ? n.offsetHeight : 0)
        })
        ro.observe(nav)
        observed = nav
      }
      setNavHeight(nav ? nav.offsetHeight : 0)
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', sync)
    return () => {
      ro?.disconnect()
      mo.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [visible])

  // Reserve bottom space so page content can scroll clear of the banner.
  useEffect(() => {
    const el = ref.current
    if (!visible || !el) return
    const apply = () => {
      document.body.style.paddingBottom = `${el.offsetHeight}px`
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => {
      ro.disconnect()
      document.body.style.paddingBottom = ''
    }
  }, [visible])

  if (!visible) return null

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        bottom: navHeight,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '100%',
        maxWidth: 500,
        zIndex: 199,
      }}
    >
      <AdSlot slot="sticky-bottom" variant="sticky" context={{ country }} />
    </div>
  )
}
