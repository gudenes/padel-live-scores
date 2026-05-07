// src/components/desktop/DesktopRouteMarker.tsx
// When mounted, marks the document root so global CSS can opt out of
// the phone-frame chrome for routes that have a desktop layout. Removes
// the marker on unmount so navigating from a desktop-aware route to one
// that isn't (yet) restores the phone frame.

'use client'

import { useEffect } from 'react'

export default function DesktopRouteMarker() {
  useEffect(() => {
    document.documentElement.setAttribute('data-desktop-route', 'true')
    return () => {
      document.documentElement.removeAttribute('data-desktop-route')
    }
  }, [])
  return null
}
