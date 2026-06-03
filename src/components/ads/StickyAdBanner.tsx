// src/components/ads/StickyAdBanner.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { getActiveSponsor } from '@/lib/sponsors'
import { useGeoCountry } from '@/hooks/useGeoCountry'
import { AdSlot } from './AdSlot'

/**
 * App-wide sticky anchor banner (Sofascore-style). Pinned just above the bottom
 * nav, full-width within the app's 500px column. Region-targeted: only renders
 * when a sponsor matches the visitor's country (else the NetworkAdSlot seam
 * would fill it later — nothing today).
 */
export function StickyAdBanner() {
  const country = useGeoCountry()
  const sponsor = country ? getActiveSponsor('sticky-bottom', country) : null

  const ref = useRef<HTMLDivElement>(null)
  const [navHeight, setNavHeight] = useState(0)

  // Sit directly above the bottom nav. Measure it so we adapt to the
  // safe-area inset (notch / home indicator) without hardcoding heights.
  //
  // The nav can mount late and even be *swapped* (a page's loading skeleton
  // renders its own nav, then the real content replaces it). So we re-resolve
  // `.v3-nav` on every DOM mutation and re-point the ResizeObserver at the
  // current element. setNavHeight with an unchanged value is a no-op, so this
  // stays cheap despite the broad observer.
  useEffect(() => {
    if (!sponsor) return
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
  }, [sponsor])

  // Reserve bottom space so page content can scroll clear of the banner.
  useEffect(() => {
    const el = ref.current
    if (!sponsor || !el) return
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
  }, [sponsor])

  if (!sponsor) return null

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
